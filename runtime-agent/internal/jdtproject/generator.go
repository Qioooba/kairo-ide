// Package jdtproject — JDT LS project model generator for
// legacy non-Maven projects.
//
// The Eclipse JDT Language Server needs a project model on
// disk that tells it where the source roots are, what the
// classpath is, and what compliance level to enforce. A
// standard Maven project gets this from .classpath +
// .project + pom.xml. Legacy projects that are NOT Eclipse
// projects do not have these files; the JDT LS will treat
// the workspace as empty and the IDE will look "ready" but
// produce no completion, no outline, and no diagnostics.
//
// The generator below reads `.legacyflow/project.yaml` (or
// a default config the user has not yet customised) and
// writes a JDT LS-readable project model under the runtime
// data dir. The model has the same shape Eclipse would
// produce: a `.project` describing the project name and the
// JDT nature, a `.classpath` describing the source roots
// and referenced libraries, and a `KairoJavaConfig.ini`
// capturing the source/target compliance and the project
// encoding. The output goes under
// <DataDir>/jdt-projects/<workspaceID>/, never on top of
// the user's existing files.
//
// Schema (.legacyflow/project.yaml):
//
//	projectId: legacy-sample              # required
//	name: Legacy Sample                   # optional, defaults to projectId
//	encoding: GBK                         # optional, default UTF-8
//	sourceLevel: "1.6"                    # required, default "1.6"
//	targetLevel: "1.6"                    # required, default "1.6"
//	sourceRoots:                          # relative to rootPath
//	  - src/main/java
//	  - src/main/resources
//	testSourceRoots:                      # optional
//	  - src/test/java
//	outputDir: build/classes              # optional, default build/classes
//	webappDir: WebRoot                    # optional; J2EE web project
//	libraries:                            # optional
//	  - lib/javax.servlet-api-4.0.1.jar
//	  - lib/jstl-1.2.jar
//	referencedLibraries:                  # optional, added as referenced libs
//	  - WEB-INF/lib/custom.jar
//	servletApi:                          # optional, adds JSP/Servlet API
//	  version: "2.5"
//	jstl: true                           # optional, adds JSTL API
//	dependentProjects:                    # optional, cross-project deps
//	  - ../other-legacy
//
// The generator is deterministic: feeding the same input
// produces the same output. The generated project model is
// safe to re-generate at any time; it is the source of truth
// the JDT LS reads on every workspace open.
package jdtproject

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"gopkg.in/yaml.v3"
)

// Project is the in-memory shape of .legacyflow/project.yaml.
type Project struct {
	ProjectID           string   `yaml:"projectId" json:"projectId"`
	Name                string   `yaml:"name" json:"name"`
	Encoding            string   `yaml:"encoding" json:"encoding"`
	SourceLevel         string   `yaml:"sourceLevel" json:"sourceLevel"`
	TargetLevel         string   `yaml:"targetLevel" json:"targetLevel"`
	SourceRoots         []string `yaml:"sourceRoots" json:"sourceRoots"`
	TestSourceRoots     []string `yaml:"testSourceRoots" json:"testSourceRoots"`
	OutputDir           string   `yaml:"outputDir" json:"outputDir"`
	WebappDir           string   `yaml:"webappDir" json:"webappDir"`
	Libraries           []string `yaml:"libraries" json:"libraries"`
	ReferencedLibraries []string `yaml:"referencedLibraries" json:"referencedLibraries"`
	ServletAPI          *struct {
		Version string `yaml:"version" json:"version"`
	} `yaml:"servletApi" json:"servletApi"`
	JSTL              bool     `yaml:"jstl" json:"jstl"`
	DependentProjects []string `yaml:"dependentProjects" json:"dependentProjects"`
	RootPath          string   `yaml:"-" json:"rootPath"`
	WorkspaceID       string   `yaml:"-" json:"workspaceId"`
}

// GenerateResult is the JSON the /api/v1/jdtls/project POST
// returns to the caller.
type GenerateResult struct {
	WorkspaceID      string   `json:"workspaceId"`
	ProjectID        string   `json:"projectId"`
	ProjectModel     string   `json:"projectModel"`     // absolute path of the .project file
	Classpath        string   `json:"classpath"`        // absolute path of the .classpath file
	SourceRoots      []string `json:"sourceRoots"`      // absolute paths the JDT LS will see
	ClasspathEntries []string `json:"classpathEntries"` // absolute paths of every referenced jar / folder
	OutputDir        string   `json:"outputDir"`        // absolute path the JDT LS will compile into
	Encoding         string   `json:"encoding"`
	SourceLevel      string   `json:"sourceLevel"`
	TargetLevel      string   `json:"targetLevel"`
	GeneratedAt      string   `json:"generatedAt"`
	FromCache        bool     `json:"fromCache"`
}

// Status is the JSON the /api/v1/jdtls/project GET returns.
type Status struct {
	WorkspaceID string `json:"workspaceId"`
	Exists      bool   `json:"exists"`
	ProjectID   string `json:"projectId,omitempty"`
	GeneratedAt string `json:"generatedAt,omitempty"`
}

// Generator renders the JDT project model for a workspace.
// One Generator per runtime agent.
type Generator struct {
	// DataDir is where the generated project model lives.
	// Each workspace gets its own subdirectory.
	DataDir string
	// BundledDir is the read-only "bundled" tree. The
	// generator looks for Servlet API + JSTL jars here
	// when the project says "servletApi: 2.5" or
	// "jstl: true".
	BundledDir string
	// Logger is optional; the generator never panics.
	Logger func(string, map[string]any)
}

// NewGenerator creates a Generator.
func NewGenerator(dataDir, bundledDir string) *Generator {
	return &Generator{
		DataDir:    dataDir,
		BundledDir: bundledDir,
		Logger:     func(string, map[string]any) {},
	}
}

// projectModelDir returns <DataDir>/jdt-projects/<workspaceID>.
func (g *Generator) projectModelDir(workspaceID string) string {
	return filepath.Join(g.DataDir, "jdt-projects", sanitizeWorkspaceID(workspaceID))
}

// Generate reads .legacyflow/project.yaml, renders the JDT
// project model under the data dir, and returns the result.
// If the project's config and the previously generated model
// are byte-identical, the result is returned with
// fromCache=true and no I/O.
//
// The payload from the API is JSON (because that is the
// Kairo wire protocol). The .legacyflow/project.yaml file
// is YAML (because YAML is the user-facing config format).
func (g *Generator) Generate(payload []byte) (GenerateResult, error) {
	var req struct {
		WorkspaceID string `json:"workspaceId"`
		ProjectID   string `json:"projectId"`
		RootPath    string `json:"rootPath"`
	}
	if len(payload) > 0 {
		if err := jsonUnmarshal(payload, &req); err != nil {
			return GenerateResult{}, err
		}
	}
	if req.WorkspaceID == "" {
		req.WorkspaceID = "default"
	}
	if req.RootPath == "" {
		return GenerateResult{}, errors.New("rootPath is required")
	}
	rootAbs, err := filepath.Abs(req.RootPath)
	if err != nil {
		return GenerateResult{}, err
	}
	if st, err := os.Stat(rootAbs); err != nil || !st.IsDir() {
		return GenerateResult{}, fmt.Errorf("rootPath not a directory: %s", rootAbs)
	}
	// Read the project's config.
	proj, err := readProjectConfig(rootAbs)
	if err != nil {
		return GenerateResult{}, err
	}
	if req.ProjectID != "" {
		proj.ProjectID = req.ProjectID
	}
	proj.RootPath = rootAbs
	proj.WorkspaceID = req.WorkspaceID
	if proj.ProjectID == "" {
		proj.ProjectID = filepath.Base(rootAbs)
	}
	if proj.Name == "" {
		proj.Name = proj.ProjectID
	}
	// Defaults that make sense for legacy Java Web projects.
	if proj.Encoding == "" {
		proj.Encoding = "UTF-8"
	}
	if proj.SourceLevel == "" {
		proj.SourceLevel = "1.6"
	}
	if proj.TargetLevel == "" {
		proj.TargetLevel = "1.6"
	}
	if proj.OutputDir == "" {
		proj.OutputDir = "build/classes"
	}

	// Build the absolute source roots + classpath.
	srcRoots := joinAbsAll(rootAbs, proj.SourceRoots)
	testSrcRoots := joinAbsAll(rootAbs, proj.TestSourceRoots)
	outputAbs := filepath.Join(rootAbs, proj.OutputDir)

	libs := joinAbsAll(rootAbs, proj.Libraries)
	refLibs := joinAbsAll(rootAbs, proj.ReferencedLibraries)
	// Servlet API + JSTL additions: the generator looks
	// for cached jars under <BundledDir>/servlet-api/<v>.jar
	// and <BundledDir>/jstl.jar. We never fail the build
	// if the jars are missing; we just skip the entry.
	if proj.ServletAPI != nil && proj.ServletAPI.Version != "" {
		if jar := g.servletAPIPath(proj.ServletAPI.Version); jar != "" {
			libs = append(libs, jar)
		}
	}
	if proj.JSTL {
		if jar := g.jstlPath(); jar != "" {
			libs = append(libs, jar)
		}
	}
	// Dependent projects contribute their class output dirs.
	for _, dep := range proj.DependentProjects {
		depAbs, err := filepath.Abs(filepath.Join(rootAbs, dep))
		if err != nil {
			continue
		}
		// Look for the dep's .classpath; use its
		// kairo.output dir.
		cls, err := readClasspath(depAbs)
		if err != nil {
			continue
		}
		for _, e := range cls.ClasspathEntries {
			if e.Kind == "lib" {
				libs = append(libs, e.Path)
			} else if e.Kind == "output" {
				libs = append(libs, e.Path)
			}
		}
	}

	// Render the .classpath and .project XML.
	classpath := renderClasspath(proj, srcRoots, testSrcRoots, outputAbs, libs, refLibs)
	classpathBytes, err := xml.MarshalIndent(classpath, "", "  ")
	if err != nil {
		return GenerateResult{}, err
	}
	projectBytes, err := xml.MarshalIndent(renderProject(proj), "", "  ")
	if err != nil {
		return GenerateResult{}, err
	}
	kairoConfig := renderKairoConfig(proj)

	// Decide whether to short-circuit (cache hit).
	dir := g.projectModelDir(req.WorkspaceID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return GenerateResult{}, err
	}
	cpPath := filepath.Join(dir, ".classpath")
	projPath := filepath.Join(dir, ".project")
	kairoPath := filepath.Join(dir, "KairoJavaConfig.ini")
	cacheKey := sha256.Sum256(append(append(classpathBytes, projectBytes...), []byte(kairoConfig)...))
	if !cacheChanged(dir, cacheKey[:]) {
		return GenerateResult{
			WorkspaceID:      req.WorkspaceID,
			ProjectID:        proj.ProjectID,
			ProjectModel:     projPath,
			Classpath:        cpPath,
			SourceRoots:      srcRoots,
			OutputDir:        outputAbs,
			Encoding:         proj.Encoding,
			SourceLevel:      proj.SourceLevel,
			TargetLevel:      proj.TargetLevel,
			ClasspathEntries: append(append([]string{}, libs...), refLibs...),
			GeneratedAt:      readGeneratedStamp(dir),
			FromCache:        true,
		}, nil
	}
	if err := atomicfile.WriteFile(cpPath, classpathBytes, 0o644); err != nil {
		return GenerateResult{}, err
	}
	if err := atomicfile.WriteFile(projPath, projectBytes, 0o644); err != nil {
		return GenerateResult{}, err
	}
	if err := atomicfile.WriteFile(kairoPath, []byte(kairoConfig), 0o644); err != nil {
		return GenerateResult{}, err
	}
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	if err := atomicfile.WriteFile(filepath.Join(dir, ".kairo-generated-at"),
		[]byte(stamp), 0o644); err != nil {
		return GenerateResult{}, err
	}
	if err := atomicfile.WriteFile(filepath.Join(dir, ".kairo-cache-key"),
		[]byte(hex.EncodeToString(cacheKey[:])), 0o644); err != nil {
		return GenerateResult{}, err
	}
	// Render the JDT LS settings.ini (workspace-level
	// preferences the JDT LS will read on first boot).
	if err := os.MkdirAll(filepath.Join(dir, ".settings"), 0o755); err != nil {
		return GenerateResult{}, err
	}
	if err := atomicfile.WriteFile(filepath.Join(dir, ".settings", "org.eclipse.jdt.core.prefs"),
		[]byte(renderJDTCorePrefs(proj)), 0o644); err != nil {
		return GenerateResult{}, err
	}
	return GenerateResult{
		WorkspaceID:      req.WorkspaceID,
		ProjectID:        proj.ProjectID,
		ProjectModel:     projPath,
		Classpath:        cpPath,
		SourceRoots:      srcRoots,
		OutputDir:        outputAbs,
		Encoding:         proj.Encoding,
		SourceLevel:      proj.SourceLevel,
		TargetLevel:      proj.TargetLevel,
		ClasspathEntries: append(append([]string{}, libs...), refLibs...),
		GeneratedAt:      stamp,
		FromCache:        false,
	}, nil
}

// Status returns whether a JDT project model is on disk for
// the given workspace.
func (g *Generator) Status(workspaceID string) (Status, error) {
	dir := g.projectModelDir(workspaceID)
	if workspaceID == "" {
		workspaceID = "default"
	}
	st := Status{WorkspaceID: workspaceID}
	if _, err := os.Stat(filepath.Join(dir, ".project")); err == nil {
		st.Exists = true
		st.GeneratedAt = readGeneratedStamp(dir)
		if data, err := os.ReadFile(filepath.Join(dir, ".classpath")); err == nil {
			cp, _ := parseClasspathBytes(data)
			if cp != nil {
				st.ProjectID = cp.ProjectID
			}
		}
	}
	return st, nil
}

// Invalidate removes the generated project model for the
// given workspace, forcing a re-render on the next call.
func (g *Generator) Invalidate(workspaceID string) error {
	return os.RemoveAll(g.projectModelDir(workspaceID))
}

// AllWorkspaces returns the workspace IDs that have a
// generated project model.
func (g *Generator) AllWorkspaces() ([]string, error) {
	root := filepath.Join(g.DataDir, "jdt-projects")
	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var ids []string
	for _, e := range entries {
		if e.IsDir() {
			ids = append(ids, e.Name())
		}
	}
	sort.Strings(ids)
	return ids, nil
}

// ---- helpers ----

// readProjectConfig reads .legacyflow/project.yaml. A missing
// file is NOT an error: we synthesise a default config that
// matches the legacy-sample layout, so a developer who has
// not customised anything still gets a working JDT project.
func readProjectConfig(root string) (Project, error) {
	p := filepath.Join(root, ".legacyflow", "project.yaml")
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return defaultProject(root), nil
		}
		return Project{}, err
	}
	var proj Project
	if err := yaml.Unmarshal(data, &proj); err != nil {
		return Project{}, err
	}
	if proj.ProjectID == "" {
		// Try to recover the project id from the parent
		// directory name. Better than an empty field that
		// would break Status rendering.
		proj.ProjectID = filepath.Base(root)
	}
	return proj, nil
}

// defaultProject returns the legacy-sample-style defaults.
// We look at the directory tree to pick plausible source
// roots so a brand-new project still gets a useful JDT
// model without any YAML.
func defaultProject(root string) Project {
	p := Project{
		ProjectID:   filepath.Base(root),
		Encoding:    "UTF-8",
		SourceLevel: "1.6",
		TargetLevel: "1.6",
		OutputDir:   "build/classes",
	}
	// Look for common source roots.
	candidates := []string{
		"src/main/java",
		"src/main/resources",
		"src",
		"src/java",
		"WebRoot/WEB-INF/classes",
	}
	for _, c := range candidates {
		abs := filepath.Join(root, c)
		if st, err := os.Stat(abs); err == nil && st.IsDir() {
			p.SourceRoots = append(p.SourceRoots, c)
		}
	}
	// Pick up jars under lib/ and WEB-INF/lib/.
	if entries, err := os.ReadDir(filepath.Join(root, "lib")); err == nil {
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".jar") {
				p.Libraries = append(p.Libraries, filepath.Join("lib", e.Name()))
			}
		}
	}
	if entries, err := os.ReadDir(filepath.Join(root, "WebRoot", "WEB-INF", "lib")); err == nil {
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".jar") {
				p.ReferencedLibraries = append(p.ReferencedLibraries,
					filepath.Join("WebRoot", "WEB-INF", "lib", e.Name()))
			}
		}
	}
	return p
}

func joinAbsAll(root string, rels []string) []string {
	out := make([]string, 0, len(rels))
	for _, r := range rels {
		if r == "" {
			continue
		}
		out = append(out, filepath.Join(root, r))
	}
	return out
}

func (g *Generator) servletAPIPath(version string) string {
	candidates := []string{
		filepath.Join(g.BundledDir, "servlet-api", "servlet-api-"+version+".jar"),
		filepath.Join(g.BundledDir, "servlet-api", "javax.servlet-api-"+version+".jar"),
		filepath.Join(g.BundledDir, "servlet-api", "servlet-"+version+".jar"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func (g *Generator) jstlPath() string {
	candidates := []string{
		filepath.Join(g.BundledDir, "jstl", "jstl-1.2.jar"),
		filepath.Join(g.BundledDir, "jstl", "javax.servlet.jsp.jstl-1.2.1.jar"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func sanitizeWorkspaceID(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "default"
	}
	r := strings.NewReplacer("..", "_", "/", "_", `\`, "_", " ", "_", ":", "_")
	return r.Replace(s)
}

func cacheChanged(dir string, want []byte) bool {
	p := filepath.Join(dir, ".kairo-cache-key")
	existing, err := os.ReadFile(p)
	if err != nil {
		return true
	}
	got, err := hex.DecodeString(strings.TrimSpace(string(existing)))
	if err != nil {
		return true
	}
	if len(got) != len(want) {
		return true
	}
	for i := range want {
		if got[i] != want[i] {
			return true
		}
	}
	return false
}

func readGeneratedStamp(dir string) string {
	data, err := os.ReadFile(filepath.Join(dir, ".kairo-generated-at"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
