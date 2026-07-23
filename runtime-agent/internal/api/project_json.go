package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

const projectJSONFile = "project.json"

// projectJSONPath returns the path to .kairo/project.json in the
// project root.
func projectJSONPath(projectRoot string) string {
	return filepath.Join(projectRoot, ".kairo", projectJSONFile)
}

// projectJSONData is the simplified JSON format saved to
// .kairo/project.json for the import wizard.
type projectJSONData struct {
	SchemaVersion int      `json:"schemaVersion"`
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	RootPath      string   `json:"rootPath"`
	SourceDirs    []string `json:"sourceDirs"`
	WebRoot       string   `json:"webRoot"`
	LibDirs       []string `json:"libDirs"`
	BuildScript   string   `json:"buildScript"`
	Encoding      string   `json:"encoding"`
	JDKVersion    string   `json:"jdkVersion"`
	SourceVersion string   `json:"sourceVersion"`
	TargetVersion string   `json:"targetVersion"`
	OutputDir     string   `json:"outputDir"`
	BuildTool     string   `json:"buildTool"`
	ContextPath   string   `json:"contextPath"`
}

// SaveProjectJSON persists the project configuration to
// .kairo/project.json in the project root.
func SaveProjectJSON(projectRoot string, project *domain.Project) error {
	data := projectJSONData{
		SchemaVersion: 1,
		ID:            string(project.ID),
		Name:          project.Name,
		RootPath:      project.RootPath,
		SourceDirs:    project.SourceRoots,
		WebRoot:       project.WebappDir,
		LibDirs:       project.LibraryDirs,
		BuildScript:   project.BuildFile,
		Encoding:      project.Encoding,
		JDKVersion:    "",
		SourceVersion: project.SourceLevel,
		TargetVersion: project.TargetLevel,
		OutputDir:     project.OutputDir,
		BuildTool:     string(project.BuildTool),
		ContextPath:   project.ContextPath,
	}

	dir := filepath.Join(projectRoot, ".kairo")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create .kairo dir: %w", err)
	}

	path := projectJSONPath(projectRoot)
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create project.json: %w", err)
	}
	defer f.Close()

	encoder := json.NewEncoder(f)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(data); err != nil {
		return fmt.Errorf("write project.json: %w", err)
	}

	return nil
}

// LoadProjectJSON reads and parses .kairo/project.json from the
// given project root.
func LoadProjectJSON(projectRoot string) (*projectJSONData, error) {
	path := projectJSONPath(projectRoot)
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open project.json: %w", err)
	}
	defer f.Close()

	var data projectJSONData
	decoder := json.NewDecoder(f)
	if err := decoder.Decode(&data); err != nil {
		return nil, fmt.Errorf("parse project.json: %w", err)
	}

	return &data, nil
}