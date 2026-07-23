// Package maven provides pom.xml parsing and Maven lifecycle task execution.
package maven

import (
	"encoding/xml"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Project holds parsed pom.xml metadata.
type Project struct {
	GroupID      string        `json:"groupId"`
	ArtifactID   string        `json:"artifactId"`
	Version      string        `json:"version"`
	Packaging    string        `json:"packaging"`
	Name         string        `json:"name"`
	Description  string        `json:"description"`
	Dependencies []Dependency  `json:"dependencies"`
	BuildDir     string        `json:"buildDir"`
	OutputDir    string        `json:"outputDir"`
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
	GroupID    string                `json:"groupId"`
	ArtifactID string                `json:"artifactId"`
	Version    string                `json:"version"`
	Scope      string                `json:"scope"`
	Optional   bool                  `json:"optional"`
	Type       string                `json:"type"`
	Children   []DependencyTreeNode  `json:"children,omitempty"`
}

// DetectResult is the response for pom.xml detection.
type DetectResult struct {
	Found        bool                  `json:"found"`
	Project      *Project              `json:"project,omitempty"`
	Tasks        []LifecycleTask       `json:"tasks"`
	Dependencies []Dependency          `json:"dependencies"`
	Tree         []DependencyTreeNode  `json:"tree,omitempty"`
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
	mvn, err := exec.LookPath("mvn")
	if err != nil {
		return &RunResult{
			Task:    req.Task,
			Success: false,
			Error:   "mvn command not found on PATH",
		}, nil
	}

	args := []string{req.Task}
	if req.Offline {
		args = append([]string{"-o"}, args...)
	}
	args = append(args, "-B")

	cmd := exec.Command(mvn, args...)
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
	return result, nil
}