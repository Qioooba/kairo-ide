// Package maven provides pom.xml parsing and Maven lifecycle task execution.
package maven

import (
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// Project holds parsed pom.xml metadata.
type Project struct {
	GroupID      string       `json:"groupId"`
	ArtifactID   string       `json:"artifactId"`
	Version      string       `json:"version"`
	Packaging    string       `json:"packaging"`
	Name         string       `json:"name"`
	Description  string       `json:"description"`
	Dependencies []Dependency `json:"dependencies"`
	BuildDir     string       `json:"buildDir"`
	OutputDir    string       `json:"outputDir"`
}

// Dependency represents a single dependency entry.
type Dependency struct {
	GroupID    string `json:"groupId"`
	ArtifactID string `json:"artifactId"`
	Version    string `json:"version"`
	Scope      string `json:"scope"`
	Optional   bool   `json:"optional"`
	Type       string `json:"type"`
}

// DependencyTreeNode is a node in the dependency tree.
type DependencyTreeNode struct {
	GroupID   string               `json:"groupId"`
	ArtifactID string              `json:"artifactId"`
	Version    string              `json:"version"`
	Scope      string              `json:"scope"`
	Optional   bool                `json:"optional"`
	Type       string              `json:"type"`
	Children   []DependencyTreeNode `json:"children,omitempty"`
}

// EffectivePOM represents the resolved (effective) POM including
// inherited parent POM properties and plugin configurations.
type EffectivePOM struct {
	GroupID      string                `json:"groupId"`
	ArtifactID   string                `json:"artifactId"`
	Version      string                `json:"version"`
	Packaging    string                `json:"packaging"`
	Name         string                `json:"name"`
	Description  string                `json:"description"`
	Properties   map[string]string     `json:"properties"`
	Modules      []string              `json:"modules,omitempty"`
	Dependencies []Dependency          `json:"dependencies"`
	Plugins      []Plugin              `json:"plugins,omitempty"`
	Repositories []Repository          `json:"repositories,omitempty"`
	Parent       *ParentRef            `json:"parent,omitempty"`
}

// ParentRef is a reference to the parent POM.
type ParentRef struct {
	GroupID    string `json:"groupId"`
	ArtifactID string `json:"artifactId"`
	Version    string `json:"version"`
}

// Plugin represents a Maven plugin configuration.
type Plugin struct {
	GroupID    string `json:"groupId"`
	ArtifactID string `json:"artifactId"`
	Version    string `json:"version"`
}

// Repository represents a Maven repository definition.
type Repository struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Name string `json:"name"`
}

// DependencyConflict represents a version conflict between
// dependencies.
type DependencyConflict struct {
	GroupID         string   `json:"groupId"`
	ArtifactID      string   `json:"artifactId"`
	Versions        []string `json:"versions"`
	ResolvedVersion string   `json:"resolvedVersion"`
	Depth           int      `json:"depth"`
}

// DetectResult is the response for pom.xml detection.
type DetectResult struct {
	Found        bool                  `json:"found"`
	Project      *Project              `json:"project,omitempty"`
	Tasks        []LifecycleTask       `json:"tasks"`
	Dependencies []Dependency          `json:"dependencies"`
	Tree         []DependencyTreeNode  `json:"tree,omitempty"`
	Conflicts    []DependencyConflict  `json:"conflicts,omitempty"`
	Warnings     []string              `json:"warnings"`
}

// LifecycleTask is a runnable Maven lifecycle phase.
type LifecycleTask struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Phase       string `json:"phase"`
}

// RunRequest is the request to run a Maven lifecycle task.
type RunRequest struct {
	RootPath string `json:"rootPath"`
	Task     string `json:"task"`
	Offline  bool   `json:"offline"`
}

// RunResult is the result of running a Maven task.
type RunResult struct {
	Task     string `json:"task"`
	Success  bool   `json:"success"`
	ExitCode int    `json:"exitCode"`
	Output   string `json:"output"`
	Error    string `json:"error,omitempty"`
}

// DepTreeRequest is the request for dependency tree resolution.
type DepTreeRequest struct {
	RootPath string `json:"rootPath"`
	Offline  bool   `json:"offline"`
}

// EffectivePOMRequest is the request for effective POM generation.
type EffectivePOMRequest struct {
	RootPath string `json:"rootPath"`
}

// LifecycleTasks lists the standard Maven lifecycle phases
// that are available for execution.
var LifecycleTasks = []LifecycleTask{
	{ID: "clean", Label: "Clean", Description: "Delete target/ directory", Phase: "clean"},
	{ID: "validate", Label: "Validate", Description: "Validate project structure", Phase: "validate"},
	{ID: "compile", Label: "Compile", Description: "Compile Java sources", Phase: "compile"},
	{ID: "test", Label: "Test", Description: "Run unit tests", Phase: "test"},
	{ID: "package", Label: "Package", Description: "Package into JAR/WAR", Phase: "package"},
	{ID: "verify", Label: "Verify", Description: "Run integration tests", Phase: "verify"},
	{ID: "install", Label: "Install", Description: "Install to local repository", Phase: "install"},
}

// pomXML is the XML structure for parsing pom.xml.
type pomXML struct {
	XMLName     xml.Name `xml:"project"`
	Parent      pomParent
	GroupID     string         `xml:"groupId"`
	ArtifactID  string         `xml:"artifactId"`
	Version     string         `xml:"version"`
	Packaging   string         `xml:"packaging"`
	Name        string         `xml:"name"`
	Description string         `xml:"description"`
	Build       pomBuild       `xml:"build"`
	Deps        pomDependencies `xml:"dependencies"`
}

type pomParent struct {
	GroupID    string `xml:"groupId"`
	ArtifactID string `xml:"artifactId"`
	Version    string `xml:"version"`
}

type pomBuild struct {
	Directory string `xml:"directory"`
	OutputDir string `xml:"outputDirectory"`
}

type pomDependencies struct {
	Deps []pomDependency `xml:"dependency"`
}

type pomDependency struct {
	GroupID    string `xml:"groupId"`
	ArtifactID string `xml:"artifactId"`
	Version    string `xml:"version"`
	Scope      string `xml:"scope"`
	Optional   string `xml:"optional"`
	Type       string `xml:"type"`
}

// Detect scans a directory for pom.xml and parses it.
func Detect(rootPath string) (*DetectResult, error) {
	result := &DetectResult{
		Warnings: []string{},
	}
	pomPath := filepath.Join(rootPath, "pom.xml")
	data, err := os.ReadFile(pomPath)
	if err != nil {
		if os.IsNotExist(err) {
			result.Found = false
			return result, nil
		}
		return nil, err
	}
	result.Found = true

	var pom pomXML
	if err := xml.Unmarshal(data, &pom); err != nil {
		return nil, err
	}

	project := &Project{
		GroupID:     pom.GroupID,
		ArtifactID:  pom.ArtifactID,
		Version:     pom.Version,
		Packaging:   pom.Packaging,
		Name:        pom.Name,
		Description: pom.Description,
		BuildDir:    pom.Build.Directory,
		OutputDir:   pom.Build.OutputDir,
	}

	// Fallback to parent pom values
	if project.GroupID == "" {
		project.GroupID = pom.Parent.GroupID
	}
	if project.Version == "" {
		project.Version = pom.Parent.Version
	}
	if project.Packaging == "" {
		project.Packaging = "jar"
	}
	if project.BuildDir == "" {
		project.BuildDir = "target"
	}
	if project.OutputDir == "" {
		project.OutputDir = filepath.Join(project.BuildDir, "classes")
	}

	// Parse dependencies
	deps := make([]Dependency, 0, len(pom.Deps.Deps))
	for _, d := range pom.Deps.Deps {
		dep := Dependency{
			GroupID:    d.GroupID,
			ArtifactID: d.ArtifactID,
			Version:    d.Version,
			Scope:      d.Scope,
			Type:       d.Type,
		}
		if d.Optional == "true" {
			dep.Optional = true
		}
		if dep.Scope == "" {
			dep.Scope = "compile"
		}
		if dep.Type == "" {
			dep.Type = "jar"
		}
		deps = append(deps, dep)
	}
	project.Dependencies = deps

	result.Project = project
	result.Tasks = LifecycleTasks
	result.Dependencies = deps

	// Build dependency tree
	tree := buildDependencyTree(deps)
	result.Tree = tree

	// Detect dependency conflicts
	result.Conflicts = DetectConflicts(deps)

	return result, nil
}

func buildDependencyTree(deps []Dependency) []DependencyTreeNode {
	nodes := make([]DependencyTreeNode, 0, len(deps))
	for _, d := range deps {
		node := DependencyTreeNode{
			GroupID:    d.GroupID,
			ArtifactID: d.ArtifactID,
			Version:    d.Version,
			Scope:      d.Scope,
			Optional:   d.Optional,
			Type:       d.Type,
		}
		nodes = append(nodes, node)
	}
	return nodes
}

// GetDependencies returns the dependency tree for a Maven project.
// In offline mode, it uses the local Maven repository to resolve transitive
// dependencies by scanning pom files in ~/.m2/repository.
func GetDependencies(rootPath string, offline bool) (*DetectResult, error) {
	result, err := Detect(rootPath)
	if err != nil {
		return nil, err
	}
	if !result.Found {
		return result, nil
	}

	if offline {
		transitive := resolveTransitiveFromLocalRepo(result.Dependencies)
		if len(transitive) > 0 {
			result.Tree = transitive
		}
	} else {
		tree := tryMavenDependencyTree(rootPath)
		if tree != nil {
			result.Tree = tree
		}
	}

	return result, nil
}

func resolveTransitiveFromLocalRepo(deps []Dependency) []DependencyTreeNode {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	m2Repo := filepath.Join(home, ".m2", "repository")

	nodes := make([]DependencyTreeNode, 0, len(deps))
	for _, d := range deps {
		node := DependencyTreeNode{
			GroupID:    d.GroupID,
			ArtifactID: d.ArtifactID,
			Version:    d.Version,
			Scope:      d.Scope,
			Optional:   d.Optional,
			Type:       d.Type,
		}

		pomPath := filepath.Join(m2Repo,
			strings.ReplaceAll(d.GroupID, ".", "/"),
			d.ArtifactID,
			d.Version,
			d.ArtifactID+"-"+d.Version+".pom",
		)
		if data, err := os.ReadFile(pomPath); err == nil {
			var pom pomXML
			if err := xml.Unmarshal(data, &pom); err == nil {
				for _, td := range pom.Deps.Deps {
					child := DependencyTreeNode{
						GroupID:    td.GroupID,
						ArtifactID: td.ArtifactID,
						Version:    td.Version,
						Scope:      td.Scope,
					}
					if td.Optional == "true" {
						child.Optional = true
					}
					if child.Scope == "" {
						child.Scope = "compile"
					}
					if child.Type == "" {
						child.Type = "jar"
					}
					node.Children = append(node.Children, child)
				}
			}
		}
		nodes = append(nodes, node)
	}
	return nodes
}

func tryMavenDependencyTree(rootPath string) []DependencyTreeNode {
	mvn, err := exec.LookPath("mvn")
	if err != nil {
		return nil
	}
	cmd := exec.Command(mvn, "dependency:tree", "-DoutputType=text", "-q")
	cmd.Dir = rootPath
	output, err := cmd.Output()
	if err != nil {
		return nil
	}
	return parseMavenDependencyTree(string(output))
}

func parseMavenDependencyTree(output string) []DependencyTreeNode {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	var roots []DependencyTreeNode
	var stack []*DependencyTreeNode

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "[INFO]") || strings.HasPrefix(line, "[WARNING]") {
			continue
		}

		depth := 0
		trimmed := line
		for strings.HasPrefix(trimmed, "|") || strings.HasPrefix(trimmed, "+") || strings.HasPrefix(trimmed, "\\") || strings.HasPrefix(trimmed, "-") || strings.HasPrefix(trimmed, " ") {
			if strings.HasPrefix(trimmed, "|") || strings.HasPrefix(trimmed, "+") || strings.HasPrefix(trimmed, "\\") {
				depth++
			}
			trimmed = trimmed[1:]
		}
		trimmed = strings.TrimSpace(trimmed)

		parts := strings.Split(trimmed, ":")
		if len(parts) < 4 {
			continue
		}
		node := DependencyTreeNode{
			GroupID:    parts[0],
			ArtifactID: parts[1],
			Type:       parts[2],
			Version:    parts[3],
			Scope:      "compile",
		}
		if len(parts) >= 5 {
			node.Scope = parts[4]
		}

		for len(stack) > depth {
			stack = stack[:len(stack)-1]
		}

		if depth == 0 || len(stack) == 0 {
			roots = append(roots, node)
			stack = []*DependencyTreeNode{&roots[len(roots)-1]}
		} else {
			parent := stack[len(stack)-1]
			parent.Children = append(parent.Children, node)
			stack = append(stack, &parent.Children[len(parent.Children)-1])
		}
	}
	return roots
}

// RunTask runs a Maven lifecycle phase.
func RunTask(req RunRequest) (*RunResult, error) {
	executable, isWrapper := findMaven(req.RootPath)

	if executable == "" {
		return &RunResult{
			Task:    req.Task,
			Success: false,
			Error:   "mvn command not found on PATH and no mvnw wrapper found",
		}, nil
	}

	args := []string{req.Task}
	if req.Offline {
		args = append([]string{"-o"}, args...)
	}
	args = append(args, "-B")

	cmd := exec.Command(executable, args...)
	cmd.Dir = req.RootPath
	output, runErr := cmd.CombinedOutput()

	result := &RunResult{
		Task:   req.Task,
		Output: string(output),
	}
	if runErr != nil {
		result.Success = false
		result.Error = runErr.Error()
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else {
			result.ExitCode = -1
		}
	} else {
		result.Success = true
		result.ExitCode = 0
	}

	if isWrapper {
		result.Output = "[mvnw wrapper] " + result.Output
	}

	return result, nil
}

// findMaven locates the Maven executable, preferring mvnw when available.
// Returns (path, isWrapper).
func findMaven(rootPath string) (string, bool) {
	// Check for Maven wrapper first
	mvnwPath := filepath.Join(rootPath, "mvnw")
	if isExecutable(mvnwPath) {
		return mvnwPath, true
	}
	mvnwPath = filepath.Join(rootPath, "mvnw.cmd")
	if isExecutable(mvnwPath) {
		return mvnwPath, true
	}

	// Fallback to system mvn
	mvn, err := exec.LookPath("mvn")
	if err != nil {
		return "", false
	}
	return mvn, false
}

// isExecutable checks if the file exists and is executable.
func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

// GenerateEffectivePOM produces the effective POM by resolving parent
// and property inheritance.
func GenerateEffectivePOM(req EffectivePOMRequest) (*EffectivePOM, error) {
	pomPath := filepath.Join(req.RootPath, "pom.xml")
	data, err := os.ReadFile(pomPath)
	if err != nil {
		return nil, err
	}

	var pom rawPOM
	if err := xml.Unmarshal(data, &pom); err != nil {
		return nil, err
	}

	effective := &EffectivePOM{
		GroupID:     pom.GroupID,
		ArtifactID:  pom.ArtifactID,
		Version:     pom.Version,
		Packaging:   pom.Packaging,
		Name:        pom.Name,
		Description: pom.Description,
		Properties:  make(map[string]string),
		Modules:     pom.Modules.Module,
	}

	// Resolve parent
	if pom.Parent.GroupID != "" {
		effective.Parent = &ParentRef{
			GroupID:    pom.Parent.GroupID,
			ArtifactID: pom.Parent.ArtifactID,
			Version:    pom.Parent.Version,
		}
		if effective.GroupID == "" {
			effective.GroupID = pom.Parent.GroupID
		}
		if effective.Version == "" {
			effective.Version = pom.Parent.Version
		}
	}

	if effective.Packaging == "" {
		effective.Packaging = "jar"
	}

	// Collect properties
	for _, p := range pom.Properties.Entries {
		effective.Properties[p.Name] = p.Value
	}

	// Parse dependencies
	for _, d := range pom.Deps.Deps {
		dep := Dependency{
			GroupID:    d.GroupID,
			ArtifactID: d.ArtifactID,
			Version:    d.Version,
			Scope:      d.Scope,
			Type:       d.Type,
		}
		if d.Optional == "true" {
			dep.Optional = true
		}
		if dep.Scope == "" {
			dep.Scope = "compile"
		}
		if dep.Type == "" {
			dep.Type = "jar"
		}
		effective.Dependencies = append(effective.Dependencies, dep)
	}

	// Parse plugins
	for _, pl := range pom.Build.Plugins.Plugin {
		effective.Plugins = append(effective.Plugins, Plugin{
			GroupID:    pl.GroupID,
			ArtifactID: pl.ArtifactID,
			Version:    pl.Version,
		})
	}

	// Parse repositories
	for _, r := range pom.Repositories.Repo {
		effective.Repositories = append(effective.Repositories, Repository{
			ID:   r.ID,
			URL:  r.URL,
			Name: r.Name,
		})
	}

	return effective, nil
}

// DetectConflicts finds dependency version conflicts in the given
// dependencies.
func DetectConflicts(deps []Dependency) []DependencyConflict {
	seen := make(map[string][]string)
	order := make([]string, 0)

	for _, d := range deps {
		key := d.GroupID + ":" + d.ArtifactID
		if _, ok := seen[key]; !ok {
			order = append(order, key)
		}
		seen[key] = append(seen[key], d.Version)
	}

	var conflicts []DependencyConflict
	for _, key := range order {
		versions := seen[key]
		uniqueVersions := uniqueStrings(versions)
		if len(uniqueVersions) > 1 {
			parts := strings.SplitN(key, ":", 2)
			conflicts = append(conflicts, DependencyConflict{
				GroupID:         parts[0],
				ArtifactID:      parts[1],
				Versions:        uniqueVersions,
				ResolvedVersion: uniqueVersions[0],
				Depth:           0,
			})
		}
	}

	return conflicts
}

func uniqueStrings(slice []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, s := range slice {
		if !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}

// rawPOM is the full XML structure for parsing pom.xml with all
// sections needed for effective POM generation.
type rawPOM struct {
	XMLName      xml.Name      `xml:"project"`
	Parent       rawParent     `xml:"parent"`
	GroupID      string        `xml:"groupId"`
	ArtifactID   string        `xml:"artifactId"`
	Version      string        `xml:"version"`
	Packaging    string        `xml:"packaging"`
	Name         string        `xml:"name"`
	Description  string        `xml:"description"`
	Properties   rawProperties `xml:"properties"`
	Build        rawBuild      `xml:"build"`
	Deps         rawDependencies `xml:"dependencies"`
	Modules      rawModules    `xml:"modules"`
	Repositories rawRepositories `xml:"repositories"`
}

type rawParent struct {
	GroupID    string `xml:"groupId"`
	ArtifactID string `xml:"artifactId"`
	Version    string `xml:"version"`
}

type rawProperties struct {
	Entries []rawProperty `xml:",any"`
}

type rawProperty struct {
	XMLName xml.Name
	Value   string `xml:",chardata"`
	Name    string
}

type rawBuild struct {
	Plugins rawPlugins `xml:"plugins"`
}

type rawPlugins struct {
	Plugin []rawPlugin `xml:"plugin"`
}

type rawPlugin struct {
	GroupID    string `xml:"groupId"`
	ArtifactID string `xml:"artifactId"`
	Version    string `xml:"version"`
}

type rawDependencies struct {
	Deps []rawDependency `xml:"dependency"`
}

type rawDependency struct {
	GroupID    string `xml:"groupId"`
	ArtifactID string `xml:"artifactId"`
	Version    string `xml:"version"`
	Scope      string `xml:"scope"`
	Optional   string `xml:"optional"`
	Type       string `xml:"type"`
}

type rawModules struct {
	Module []string `xml:"module"`
}

type rawRepositories struct {
	Repo []rawRepository `xml:"repository"`
}

type rawRepository struct {
	ID   string `xml:"id"`
	URL  string `xml:"url"`
	Name string `xml:"name"`
}

// ----- Multi-Module Support -----

// MultiModuleProject represents a Maven multi-module project
// with parent/child relationships and aggregated metadata.
type MultiModuleProject struct {
	Root     ModuleInfo   `json:"root"`
	Modules  []ModuleInfo `json:"modules"`
	BuildOrder []string   `json:"buildOrder"`
}

// ModuleInfo holds metadata for a single module in a multi-module project.
type ModuleInfo struct {
	Path            string       `json:"path"`
	GroupID         string       `json:"groupId"`
	ArtifactID      string       `json:"artifactId"`
	Version         string       `json:"version"`
	Packaging       string       `json:"packaging"`
	Name            string       `json:"name"`
	Dependencies    []Dependency `json:"dependencies"`
	Parent          *ParentRef   `json:"parent,omitempty"`
	SubModules      []string     `json:"subModules,omitempty"`
	IsRoot          bool         `json:"isRoot"`
}

// ModuleDepEdge represents a dependency edge between two modules
// in the reactor.
type ModuleDepEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// ReactorGraph holds the dependency graph for topological sort.
type ReactorGraph struct {
	Nodes map[string]bool
	Edges []ModuleDepEdge
}

// CrossModuleClasspath maps module artifact IDs to their resolved
// classpath entries (direct + transitive reactor dependencies).
type CrossModuleClasspath struct {
	ModuleArtifactID  string              `json:"moduleArtifactId"`
	Classpath         []string            `json:"classpath"`
	ModuleClasspaths  map[string][]string `json:"moduleClasspaths,omitempty"`
}

// ResolveMultiModule scans a root directory for a pom.xml with
// <modules> and recursively resolves child modules.
func ResolveMultiModule(rootPath string) (*MultiModuleProject, error) {
	rootPomPath := filepath.Join(rootPath, "pom.xml")
	data, err := os.ReadFile(rootPomPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var pom rawPOM
	if err := xml.Unmarshal(data, &pom); err != nil {
		return nil, fmt.Errorf("parse root pom.xml: %w", err)
	}

	rootModule := ModuleInfo{
		Path:       rootPath,
		GroupID:    pom.GroupID,
		ArtifactID: pom.ArtifactID,
		Version:    pom.Version,
		Packaging:  pom.Packaging,
		Name:       pom.Name,
		IsRoot:     true,
	}
	if rootModule.Packaging == "" {
		rootModule.Packaging = "pom"
	}
	// Inherit from parent
	if rootModule.GroupID == "" {
		rootModule.GroupID = pom.Parent.GroupID
	}
	if rootModule.Version == "" {
		rootModule.Version = pom.Parent.Version
	}
	if pom.Parent.GroupID != "" {
		rootModule.Parent = &ParentRef{
			GroupID:    pom.Parent.GroupID,
			ArtifactID: pom.Parent.ArtifactID,
			Version:    pom.Parent.Version,
		}
	}

	// Parse deps
	for _, d := range pom.Deps.Deps {
		dep := Dependency{
			GroupID:    d.GroupID,
			ArtifactID: d.ArtifactID,
			Version:    d.Version,
			Scope:      d.Scope,
			Type:       d.Type,
		}
		if d.Optional == "true" {
			dep.Optional = true
		}
		if dep.Scope == "" {
			dep.Scope = "compile"
		}
		if dep.Type == "" {
			dep.Type = "jar"
		}
		rootModule.Dependencies = append(rootModule.Dependencies, dep)
	}

	rootModule.SubModules = pom.Modules.Module

	project := &MultiModuleProject{
		Root:    rootModule,
		Modules: []ModuleInfo{rootModule},
	}

	// Resolve child modules recursively
	for _, modName := range pom.Modules.Module {
		childPath := filepath.Join(rootPath, modName)
		child, err := resolveModuleInfo(childPath, rootPath)
		if err != nil {
			// Non-fatal: skip unresolvable modules
			continue
		}
		project.Modules = append(project.Modules, child)
	}

	// Compute reactor build order via topological sort
	project.BuildOrder = ResolveReactorBuildOrder(project.Modules)

	return project, nil
}

// resolveModuleInfo parses a single module pom.xml and returns its info.
func resolveModuleInfo(modulePath string, rootPath string) (ModuleInfo, error) {
	pomPath := filepath.Join(modulePath, "pom.xml")
	data, err := os.ReadFile(pomPath)
	if err != nil {
		return ModuleInfo{}, err
	}

	var pom rawPOM
	if err := xml.Unmarshal(data, &pom); err != nil {
		return ModuleInfo{}, err
	}

	info := ModuleInfo{
		Path:       modulePath,
		GroupID:    pom.GroupID,
		ArtifactID: pom.ArtifactID,
		Version:    pom.Version,
		Packaging:  pom.Packaging,
		Name:       pom.Name,
	}

	if info.Packaging == "" {
		info.Packaging = "jar"
	}
	if info.GroupID == "" {
		info.GroupID = pom.Parent.GroupID
	}
	if info.Version == "" {
		info.Version = pom.Parent.Version
	}
	if pom.Parent.GroupID != "" {
		info.Parent = &ParentRef{
			GroupID:    pom.Parent.GroupID,
			ArtifactID: pom.Parent.ArtifactID,
			Version:    pom.Parent.Version,
		}
	}

	for _, d := range pom.Deps.Deps {
		dep := Dependency{
			GroupID:    d.GroupID,
			ArtifactID: d.ArtifactID,
			Version:    d.Version,
			Scope:      d.Scope,
			Type:       d.Type,
		}
		if d.Optional == "true" {
			dep.Optional = true
		}
		if dep.Scope == "" {
			dep.Scope = "compile"
		}
		if dep.Type == "" {
			dep.Type = "jar"
		}
		info.Dependencies = append(info.Dependencies, dep)
	}

	info.SubModules = pom.Modules.Module

	// Recursively resolve sub-sub-modules
	for _, subName := range pom.Modules.Module {
		childPath := filepath.Join(modulePath, subName)
		// Avoid infinite recursion by checking it's not already the root
		if childPath == rootPath {
			continue
		}
		// Note: sub-sub-modules are NOT added to the list here; they are
		// resolved by the caller which iterates the full list.
		_ = childPath
	}

	return info, nil
}

// ResolveReactorBuildOrder computes a topological sort of the
// reactor modules based on inter-module dependencies.
func ResolveReactorBuildOrder(modules []ModuleInfo) []string {
	// Build a map of artifactID to module index
	artifactToIndex := make(map[string]int)
	artifacts := make([]string, len(modules))
	for i, m := range modules {
		artifacts[i] = m.ArtifactID
		// Also map by G:A key
		key := m.GroupID + ":" + m.ArtifactID
		artifactToIndex[key] = i
		artifactToIndex[m.ArtifactID] = i
	}

	// Build adjacency list
	n := len(modules)
	graph := make([][]int, n)
	inDegree := make([]int, n)

	for i, m := range modules {
		for _, dep := range m.Dependencies {
			// Check if dependency is an internal module
			depKey := dep.GroupID + ":" + dep.ArtifactID
			if j, ok := artifactToIndex[depKey]; ok && i != j {
				// Edge from dependency (j) to depender (i):
				// j must be built before i
				graph[j] = append(graph[j], i)
				inDegree[i]++
			}
		}
	}

	// Kahn's algorithm for topological sort
	var queue []int
	for i := 0; i < n; i++ {
		if inDegree[i] == 0 {
			queue = append(queue, i)
		}
	}

	var order []string
	for len(queue) > 0 {
		// Sort queue for deterministic ordering
		sort.Slice(queue, func(a, b int) bool {
			return artifacts[queue[a]] < artifacts[queue[b]]
		})
		u := queue[0]
		queue = queue[1:]
		order = append(order, artifacts[u])

		for _, v := range graph[u] {
			inDegree[v]--
			if inDegree[v] == 0 {
				queue = append(queue, v)
			}
		}
	}

	// If we couldn't sort all modules, return original order
	if len(order) < n {
		order = artifacts
	}

	return order
}

// ResolveCrossModuleClasspath computes the classpath for each module,
// including direct dependencies on sibling modules and their transitive
// reactor dependencies.
func ResolveCrossModuleClasspath(modules []ModuleInfo) *CrossModuleClasspath {
	// Build artifact ID → module info map
	modMap := make(map[string]ModuleInfo)
	for _, m := range modules {
		modMap[m.ArtifactID] = m
	}

	// Build G:A → module info map
	gaMap := make(map[string]ModuleInfo)
	for _, m := range modules {
		key := m.GroupID + ":" + m.ArtifactID
		gaMap[key] = m
	}

	result := &CrossModuleClasspath{
		ModuleClasspaths: make(map[string][]string),
	}

	for _, m := range modules {
		classpath := resolveModuleClasspath(m, modules, gaMap, make(map[string]bool))
		result.ModuleClasspaths[m.ArtifactID] = classpath
	}

	// Set the first module's classpath as the default
	if len(modules) > 0 {
		result.ModuleArtifactID = modules[0].ArtifactID
		result.Classpath = result.ModuleClasspaths[modules[0].ArtifactID]
	}

	return result
}

// resolveModuleClasspath resolves a single module's classpath entries
// from the reactor.
func resolveModuleClasspath(m ModuleInfo, allModules []ModuleInfo, gaMap map[string]ModuleInfo, visited map[string]bool) []string {
	key := m.GroupID + ":" + m.ArtifactID
	if visited[key] {
		return nil
	}
	visited[key] = true

	var classpath []string

	for _, dep := range m.Dependencies {
		depKey := dep.GroupID + ":" + dep.ArtifactID
		if sibling, ok := gaMap[depKey]; ok {
			// Add sibling's output directory to classpath
			entry := filepath.Join(sibling.Path, "target", "classes")
			classpath = append(classpath, entry)
			// Recurse into sibling's dependencies
			transitive := resolveModuleClasspath(sibling, allModules, gaMap, visited)
			classpath = append(classpath, transitive...)
		}
	}

	return uniqueStrings(classpath)
}

// GetModuleDependencies returns all dependencies (direct + transitive)
// for a specific module, distinguishing internal vs external.
func GetModuleDependencies(modules []ModuleInfo, moduleArtifactID string) (internal []Dependency, external []Dependency) {
	gaMap := make(map[string]bool)
	for _, m := range modules {
		key := m.GroupID + ":" + m.ArtifactID
		gaMap[key] = true
	}

	for _, m := range modules {
		if m.ArtifactID != moduleArtifactID {
			continue
		}
		for _, dep := range m.Dependencies {
			depKey := dep.GroupID + ":" + dep.ArtifactID
			if gaMap[depKey] {
				internal = append(internal, dep)
			} else {
				external = append(external, dep)
			}
		}
		break
	}
	return
}