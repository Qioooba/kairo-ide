package repository

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// ProjectConfig is the JSON/YAML representation of .kairo/project.yaml.
type ProjectConfig struct {
	SchemaVersion int      `json:"schemaVersion" yaml:"schemaVersion"`
	Name          string   `json:"name" yaml:"name"`
	SourceRoots   []string `json:"sourceRoots" yaml:"sourceRoots"`
	ResourceRoots []string `json:"resourceRoots" yaml:"resourceRoots"`
	WebappDir     string   `json:"webappDir" yaml:"webappDir"`
	OutputDir     string   `json:"outputDir" yaml:"outputDir"`
	SourceLevel   string   `json:"sourceLevel" yaml:"sourceLevel"`
	TargetLevel   string   `json:"targetLevel" yaml:"targetLevel"`
	Encoding      string   `json:"encoding" yaml:"encoding"`
	BuildTool     string   `json:"buildTool" yaml:"buildTool"`
	ContextPath   string   `json:"contextPath" yaml:"contextPath"`
}

var defaultProjectConfig = ProjectConfig{
	SchemaVersion: 1,
	Name:          "",
	SourceRoots:   []string{"src/main/java"},
	ResourceRoots: []string{"src/main/resources"},
	WebappDir:     "src/main/webapp",
	OutputDir:     "target/classes",
	SourceLevel:   "1.6",
	TargetLevel:   "1.6",
	Encoding:      "UTF-8",
	BuildTool:     "javac",
	ContextPath:   "/",
}

// kairoProjectDir is the directory name for Kairo project configuration.
const kairoProjectDir = ".kairo"

// legacyProjectDir is the directory name for legacy (.legacyflow) project configuration.
const legacyProjectDir = ".legacyflow"

// projectYAMLFile is the filename for project YAML config.
const projectYAMLFile = "project.yaml"

// ProjectConfigPath returns the path to .kairo/project.yaml for the given project root.
func ProjectConfigPath(projectRoot string) string {
	return filepath.Join(projectRoot, kairoProjectDir, projectYAMLFile)
}

func projectConfigPath(projectRoot string) string {
	return ProjectConfigPath(projectRoot)
}

func legacyConfigPath(projectRoot string) string {
	return filepath.Join(projectRoot, legacyProjectDir, projectYAMLFile)
}

// LoadProjectConfig reads and parses .kairo/project.yaml from the given project root.
func LoadProjectConfig(projectRoot string) (*ProjectConfig, error) {
	path := projectConfigPath(projectRoot)
	doc, err := ReadVersionedJSON[ProjectConfig](path)
	if err != nil {
		return nil, fmt.Errorf("read project config %s: %w", path, err)
	}
	if err := ValidateSchemaVersion(doc.SchemaVersion); err != nil {
		return nil, fmt.Errorf("validate project config %s: %w", path, err)
	}
	cfg := doc.Data
	if err := ValidateProjectConfig(&cfg); err != nil {
		return nil, fmt.Errorf("validate project config %s: %w", path, err)
	}
	return &cfg, nil
}

// SaveProjectConfig writes the project config to .kairo/project.yaml atomically.
func SaveProjectConfig(projectRoot string, cfg *ProjectConfig) error {
	cfg.SchemaVersion = currentSchemaVersion
	if err := ValidateProjectConfig(cfg); err != nil {
		return fmt.Errorf("validate project config: %w", err)
	}
	path := projectConfigPath(projectRoot)
	doc := NewVersioned(*cfg)
	return AtomicWriteJSON(path, doc, 0644)
}

// ValidateProjectConfig checks required fields and fills defaults.
func ValidateProjectConfig(cfg *ProjectConfig) error {
	if cfg.SchemaVersion == 0 {
		cfg.SchemaVersion = currentSchemaVersion
	}
	if err := ValidateSchemaVersion(cfg.SchemaVersion); err != nil {
		return err
	}
	if cfg.Name == "" {
		return fmt.Errorf("project name is required")
	}
	if len(cfg.SourceRoots) == 0 {
		cfg.SourceRoots = defaultProjectConfig.SourceRoots
	}
	if len(cfg.ResourceRoots) == 0 {
		cfg.ResourceRoots = defaultProjectConfig.ResourceRoots
	}
	if cfg.WebappDir == "" {
		cfg.WebappDir = defaultProjectConfig.WebappDir
	}
	if cfg.OutputDir == "" {
		cfg.OutputDir = defaultProjectConfig.OutputDir
	}
	if cfg.SourceLevel == "" {
		cfg.SourceLevel = defaultProjectConfig.SourceLevel
	}
	if cfg.TargetLevel == "" {
		cfg.TargetLevel = defaultProjectConfig.TargetLevel
	}
	if cfg.Encoding == "" {
		cfg.Encoding = defaultProjectConfig.Encoding
	}
	if cfg.BuildTool == "" {
		cfg.BuildTool = defaultProjectConfig.BuildTool
	}
	if cfg.ContextPath == "" {
		cfg.ContextPath = defaultProjectConfig.ContextPath
	}
	return nil
}

// MigrateFromLegacy reads .legacyflow/project.yaml if it exists, converts it to the new
// .kairo/project.yaml format, saves it, and returns the config. If no legacy config exists,
// it returns nil without error.
func MigrateFromLegacy(projectRoot string) (*ProjectConfig, error) {
	legacyPath := legacyConfigPath(projectRoot)
	data, err := os.ReadFile(legacyPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read legacy config %s: %w", legacyPath, err)
	}
	var cfg ProjectConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse legacy config %s: %w", legacyPath, err)
	}
	cfg.SchemaVersion = 1
	if err := SaveProjectConfig(projectRoot, &cfg); err != nil {
		return nil, fmt.Errorf("save migrated config: %w", err)
	}
	return &cfg, nil
}