// Package jdtproject — XML/INI renderers for the JDT project model.
package jdtproject

import (
	"encoding/xml"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

// Classpath is the .classpath XML root.
type Classpath struct {
	XMLName          xml.Name         `xml:"classpath"`
	ProjectID        string           `xml:"-" json:"projectId,omitempty"`
	ClasspathEntries []ClasspathEntry `xml:"classpathentry"`
}

// ClasspathEntry is one row of the .classpath file. The Kind
// is the "kind" attribute: "src", "output", "lib", "con".
type ClasspathEntry struct {
	Kind       string `xml:"kind,attr"`
	Path       string `xml:"path,attr,omitempty"`
	SourcePath string `xml:"sourcepath,attr,omitempty"`
	Output     string `xml:"output,attr,omitempty"`
	Including  string `xml:"including,attr,omitempty"`
	Excluding  string `xml:"excluding,attr,omitempty"`
}

// ProjectModel is the .project XML root. Eclipse requires the
// <projectDescription> root — a <project> root fails with
// "Failed to read project description file" on import
// (KAIRO-RC-WEB-251). (We name it ProjectModel rather than
// Project to avoid collision with the .legacyflow/project.yaml
// schema struct in the generator's package.)
type ProjectModel struct {
	XMLName         xml.Name         `xml:"projectDescription"`
	ProjectID       string           `xml:"-" json:"projectId"`
	Name            string           `xml:"name"`
	Description     string           `xml:"comment"`
	LinkedResources []LinkedResource `xml:"linkedResources,omitempty"`
	BuildSpec       []BuildSpec      `xml:"buildSpec>buildCommand"`
	Natures         []string         `xml:"natures>nature"`
}

// BuildSpec is one Eclipse build command. We only enable
// the JDT builder; the Kairo runtime agent compiles with
// javac directly and writes the .class files into the
// output dir.
type BuildSpec struct {
	Name      string `xml:"name"`
	Arguments string `xml:"arguments,omitempty"`
	Triggers  string `xml:"triggers,omitempty"`
}

// LinkedResource maps a classpath entry that lives outside
// the project to an Eclipse linked resource. We use this for
// jars that are pulled from the runtime data dir (e.g.
// Servlet API + JSTL when the project has no copy of its own).
type LinkedResource struct {
	Name        string `xml:"name"`
	Type        string `xml:"type"`
	Location    string `xml:"location"`
	LocationURI string `xml:"locationURI,omitempty"`
}

// minJDTCompliance is the lowest compiler compliance the bundled
// JDT LS can actually build with. JDT 1.5x running on a host JDK 21
// cannot resolve compliance/source/target below 1.8: the project
// still imports and syntax diagnostics run, but JDT's compiler
// environment fails to initialise and the search engine silently
// dies — textDocument/implementation and textDocument/references
// return [] for every symbol (BUG-20260826-400). Legacy 1.5–1.7
// sources compile cleanly under 1.8 semantics, so the *Eclipse*
// project model is clamped up while KairoJavaConfig.ini keeps the
// real project level for javac/Ant builds (ADR-0017 降级策略).
const minJDTCompliance = "1.8"

// clampCompliance returns level raised to minJDTCompliance when it
// denotes an older release. Accepts "1.5".."1.8" and bare majors
// ("8", "11", "17"); unknown strings are returned unchanged.
func clampCompliance(level string) string {
	lv, ok := complianceValue(level)
	if !ok {
		return level
	}
	floor, _ := complianceValue(minJDTCompliance)
	if lv < floor {
		return minJDTCompliance
	}
	return normalizeCompliance(level)
}

// complianceValue maps a release string to a comparable integer:
// "1.6" → 6, "8" → 8, "11" → 11.
func complianceValue(level string) (int, bool) {
	level = strings.TrimSpace(level)
	if level == "" {
		return 0, false
	}
	parts := strings.SplitN(level, ".", 2)
	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, false
	}
	if major != 1 || len(parts) == 1 {
		return major, true
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, false
	}
	return minor, true
}

// normalizeCompliance renders a release in Eclipse's canonical
// "1.x" form for legacy levels and bare form for modern ones.
func normalizeCompliance(level string) string {
	v, ok := complianceValue(level)
	if !ok {
		return level
	}
	if v <= 8 {
		return fmt.Sprintf("1.%d", v)
	}
	return fmt.Sprintf("%d", v)
}

func renderClasspath(proj Project, srcRoots, testSrcRoots []string, output string, libs, refLibs []string) Classpath {
	cp := Classpath{ProjectID: proj.ProjectID}
	// Eclipse resolves src/output paths against the PROJECT
	// LOCATION (the directory holding .project) and does not
	// accept absolute src entries — so these stay relative to
	// the project root. (The launcher flow writes the model
	// into the project root via IntoProjectRoot; the data-dir
	// model dir only feeds Status reporting.)
	for _, s := range srcRoots {
		cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
			Kind: "src",
			Path: relPathOrAbs(s, proj.RootPath),
		})
	}
	for _, s := range testSrcRoots {
		cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
			Kind:   "src",
			Path:   relPathOrAbs(s, proj.RootPath),
			Output: relPathOrAbs(output, proj.RootPath),
		})
	}
	cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
		Kind: "output",
		Path: relPathOrAbs(output, proj.RootPath),
	})
	// The JRE container must use Eclipse's full EE form
	// (…/StandardVMType/JavaSE-x.y): a bare "JRE_CONTAINER/1.6"
	// resolves to NOTHING, leaving the project with no JDK at
	// all — the LS logged "Unable to locate JDK types" and
	// returned zero completions everywhere (KAIRO-RC-WEB-251).
	jreName := "org.eclipse.jdt.launching.JRE_CONTAINER"
	if proj.SourceLevel != "" {
		jreName += "/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-" + clampCompliance(proj.SourceLevel)
	}
	cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
		Kind: "con",
		Path: jreName,
	})
	for _, l := range libs {
		cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
			Kind:       "lib",
			Path:       l, // absolute path is allowed by the JDT LS
			SourcePath: relPathOrAbs(l, proj.RootPath),
		})
	}
	for _, l := range refLibs {
		cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
			Kind: "lib",
			Path: relPathOrAbs(l, proj.RootPath),
		})
	}
	return cp
}

func renderProject(proj Project) ProjectModel {
	p := ProjectModel{
		ProjectID:   proj.ProjectID,
		Name:        proj.Name,
		Description: "Kairo IDE managed project for " + proj.ProjectID,
	}
	p.Natures = append(p.Natures, "org.eclipse.jdt.core.javanature")
	p.BuildSpec = append(p.BuildSpec, BuildSpec{
		Name: "org.eclipse.jdt.core.javabuilder",
	})
	return p
}

func renderKairoConfig(proj Project) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Kairo IDE generated JDT config for %s\n", proj.ProjectID)
	fmt.Fprintf(&b, "kairo.project.id = %s\n", proj.ProjectID)
	fmt.Fprintf(&b, "kairo.source.level = %s\n", proj.SourceLevel)
	fmt.Fprintf(&b, "kairo.target.level = %s\n", proj.TargetLevel)
	fmt.Fprintf(&b, "kairo.encoding = %s\n", proj.Encoding)
	fmt.Fprintf(&b, "kairo.output.dir = %s\n", proj.OutputDir)
	for i, s := range proj.SourceRoots {
		fmt.Fprintf(&b, "kairo.source.root.%d = %s\n", i, s)
	}
	for i, t := range proj.TestSourceRoots {
		fmt.Fprintf(&b, "kairo.test.source.root.%d = %s\n", i, t)
	}
	return b.String()
}

func renderJDTCorePrefs(proj Project) string {
	// Clamp to minJDTCompliance — see the constant's comment: lower
	// levels silently kill JDT's search engine on host JDK 21.
	source := clampCompliance(proj.SourceLevel)
	target := clampCompliance(proj.TargetLevel)
	var b strings.Builder
	b.WriteString("eclipse.preferences.version=1\n")
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.compliance=%s\n", source)
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.source=%s\n", source)
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.target=%s\n", target)
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.encoding=%s\n", encodingIDForJDT(string(proj.Encoding)))
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.codegen.targetPlatform=%s\n", target)
	b.WriteString("org.eclipse.jdt.core.compiler.problem.assertIdentifier=error\n")
	return b.String()
}

func encodingIDForJDT(enc string) string {
	upper := strings.ToUpper(strings.TrimSpace(enc))
	switch upper {
	case "UTF-8", "UTF8":
		return "UTF-8"
	case "GBK", "GB18030":
		return "GBK"
	case "ISO-8859-1":
		return "ISO-8859-1"
	case "US-ASCII":
		return "US-ASCII"
	default:
		if upper == "" {
			return "UTF-8"
		}
		return upper
	}
}

func relPathOrAbs(abs, root string) string {
	if abs == "" {
		return ""
	}
	if root == "" {
		return abs
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return abs
	}
	return rel
}

// readClasspath reads a sibling project's .classpath file.
// Used to resolve dependentProjects entries without having
// to re-parse the YAML.
type parsedClasspath struct {
	ProjectID        string
	ClasspathEntries []ClasspathEntry
}

func readClasspath(root string) (*parsedClasspath, error) {
	p := filepath.Join(root, ".classpath")
	data, err := osReadFile(p)
	if err != nil {
		return nil, err
	}
	return parseClasspathBytes(data)
}

func parseClasspathBytes(data []byte) (*parsedClasspath, error) {
	var cp Classpath
	if err := xml.Unmarshal(data, &cp); err != nil {
		return nil, err
	}
	return &parsedClasspath{ProjectID: cp.ProjectID, ClasspathEntries: cp.ClasspathEntries}, nil
}
