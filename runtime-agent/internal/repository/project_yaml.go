package repository

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
	"gopkg.in/yaml.v3"
)

type ProjectConfig struct {
	SchemaVersion int                `yaml:"schemaVersion"`
	Name          string             `yaml:"name"`
	Root          string             `yaml:"root,omitempty"`
	SourceRoots   []string           `yaml:"sourceRoots"`
	ResourceRoots []string           `yaml:"resourceRoots"`
	LibraryDirs   []string           `yaml:"libraryDirs,omitempty"`
	WebappDir     string             `yaml:"webappDir"`
	OutputDir     string             `yaml:"outputDir"`
	BuildFile     string             `yaml:"buildFile,omitempty"`
	BuildTargets  []string           `yaml:"buildTargets,omitempty"`
	SourceLevel   string             `yaml:"sourceLevel"`
	TargetLevel   string             `yaml:"targetLevel"`
	Encoding      string             `yaml:"encoding"`
	BuildTool     domain.BuildToolID `yaml:"buildTool"`
	ContextPath   string             `yaml:"contextPath"`
	ToolchainID   string             `yaml:"toolchainId,omitempty"`
	RuntimeID     string             `yaml:"runtimeId,omitempty"`
}

var defaultProjectConfig = ProjectConfig{
	SchemaVersion: 1,
	SourceRoots:   []string{"src/main/java"},
	ResourceRoots: []string{"src/main/resources"},
	LibraryDirs:   []string{"lib"},
	WebappDir:     "src/main/webapp",
	OutputDir:     "target/classes",
	BuildFile:     "build.xml",
	BuildTargets:  []string{"compile"},
	SourceLevel:   "1.8",
	TargetLevel:   "1.8",
	Encoding:      "UTF-8",
	BuildTool:     domain.BuildToolJavac,
	ContextPath:   "/",
	Root:          ".",
}

const (
	kairoProjectDir  = ".kairo"
	legacyProjectDir = ".legacyflow"
	projectYAMLFile  = "project.yaml"
)

func ProjectConfigPath(projectRoot string) string {
	return filepath.Join(projectRoot, kairoProjectDir, projectYAMLFile)
}

func projectConfigPath(projectRoot string) string {
	return ProjectConfigPath(projectRoot)
}

func legacyConfigPath(projectRoot string) string {
	return filepath.Join(projectRoot, legacyProjectDir, projectYAMLFile)
}

func LoadProjectConfig(projectRoot string) (*ProjectConfig, error) {
	path := projectConfigPath(projectRoot)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read project config %s: %w", path, err)
	}

	var cfg ProjectConfig
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&cfg); err != nil {
		return nil, &CorruptionError{Path: path, Err: fmt.Errorf("parse yaml: %w", err)}
	}

	appliedDefaults, err := applyProjectDefaults(&cfg)
	if err != nil {
		return nil, fmt.Errorf("apply defaults %s: %w", path, err)
	}

	if err := ValidateProjectConfig(appliedDefaults); err != nil {
		return nil, fmt.Errorf("validate project config %s: %w", path, err)
	}

	return appliedDefaults, nil
}

func SaveProjectConfig(projectRoot string, cfg *ProjectConfig) error {
	cfg.SchemaVersion = currentSchemaVersion
	applied, err := applyProjectDefaults(cfg)
	if err != nil {
		return fmt.Errorf("apply defaults: %w", err)
	}
	if err := ValidateProjectConfig(applied); err != nil {
		return fmt.Errorf("validate: %w", err)
	}

	path := projectConfigPath(projectRoot)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	return AtomicWriteYAML(path, applied, 0644)
}

func applyProjectDefaults(cfg *ProjectConfig) (*ProjectConfig, error) {
	out := *cfg

	if out.SchemaVersion == 0 {
		out.SchemaVersion = defaultProjectConfig.SchemaVersion
	}
	if out.Name == "" {
		return nil, errors.New("project name is required")
	}
	if len(out.SourceRoots) == 0 {
		out.SourceRoots = append([]string(nil), defaultProjectConfig.SourceRoots...)
	}
	if len(out.ResourceRoots) == 0 {
		out.ResourceRoots = append([]string(nil), defaultProjectConfig.ResourceRoots...)
	}
	if out.WebappDir == "" {
		out.WebappDir = defaultProjectConfig.WebappDir
	}
	if out.OutputDir == "" {
		out.OutputDir = defaultProjectConfig.OutputDir
	}
	if out.BuildFile == "" {
		out.BuildFile = defaultProjectConfig.BuildFile
	}
	if len(out.BuildTargets) == 0 {
		out.BuildTargets = append([]string(nil), defaultProjectConfig.BuildTargets...)
	}
	if out.SourceLevel == "" {
		out.SourceLevel = defaultProjectConfig.SourceLevel
	}
	if out.TargetLevel == "" {
		out.TargetLevel = defaultProjectConfig.TargetLevel
	}
	if out.Encoding == "" {
		out.Encoding = defaultProjectConfig.Encoding
	}
	if out.BuildTool == "" {
		out.BuildTool = defaultProjectConfig.BuildTool
	}
	if out.ContextPath == "" {
		out.ContextPath = defaultProjectConfig.ContextPath
	}
	if out.Root == "" {
		out.Root = defaultProjectConfig.Root
	}

	return &out, nil
}

func ValidateProjectConfig(cfg *ProjectConfig) error {
	if err := ValidateSchemaVersion(cfg.SchemaVersion); err != nil {
		return err
	}
	if cfg.Name == "" {
		return errors.New("name is required")
	}
	paths := [][]string{
		cfg.SourceRoots,
		cfg.ResourceRoots,
		cfg.LibraryDirs,
	}
	policy := pathpolicy.NewDefaultPathPolicy()
	for _, list := range paths {
		for _, p := range list {
			if err := policy.ValidateRelativeConfigPath(p, false); err != nil {
				return fmt.Errorf("invalid path %q: %w", p, err)
			}
		}
	}
	singlePaths := []string{cfg.WebappDir, cfg.OutputDir, cfg.BuildFile, cfg.Root}
	for _, p := range singlePaths {
		if err := policy.ValidateRelativeConfigPath(p, false); err != nil {
			return fmt.Errorf("invalid path %q: %w", p, err)
		}
	}
	switch cfg.BuildTool {
	case domain.BuildToolAnt, domain.BuildToolJavac:
	default:
		return fmt.Errorf("unsupported build tool: %s", cfg.BuildTool)
	}
	return nil
}

func MigrateFromLegacy(projectRoot string) (*ProjectConfig, error) {
	legacyPath := legacyConfigPath(projectRoot)
	data, err := os.ReadFile(legacyPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read legacy config %s: %w", legacyPath, err)
	}

	var legacy struct {
		SchemaVersion int      `yaml:"schemaVersion"`
		Name          string   `yaml:"name"`
		SourceRoots   []string `yaml:"sourceRoots"`
		ResourceRoots []string `yaml:"resourceRoots"`
		WebappDir     string   `yaml:"webappDir"`
		OutputDir     string   `yaml:"outputDir"`
		SourceLevel   string   `yaml:"sourceLevel"`
		TargetLevel   string   `yaml:"targetLevel"`
		Encoding      string   `yaml:"encoding"`
		BuildTool     string   `yaml:"buildTool"`
		ContextPath   string   `yaml:"contextPath"`
	}
	if err := yaml.Unmarshal(data, &legacy); err != nil {
		return nil, fmt.Errorf("parse legacy config %s: %w", legacyPath, err)
	}

	newPath := projectConfigPath(projectRoot)
	if _, err := os.Stat(newPath); err == nil {
		return LoadProjectConfig(projectRoot)
	}

	cfg := &ProjectConfig{
		SchemaVersion: currentSchemaVersion,
		Name:          legacy.Name,
		SourceRoots:   legacy.SourceRoots,
		ResourceRoots: legacy.ResourceRoots,
		LibraryDirs:   defaultProjectConfig.LibraryDirs,
		WebappDir:     legacy.WebappDir,
		OutputDir:     legacy.OutputDir,
		BuildFile:     defaultProjectConfig.BuildFile,
		BuildTargets:  defaultProjectConfig.BuildTargets,
		SourceLevel:   legacy.SourceLevel,
		TargetLevel:   legacy.TargetLevel,
		Encoding:      legacy.Encoding,
		BuildTool:     domain.BuildToolID(legacy.BuildTool),
		ContextPath:   legacy.ContextPath,
		Root:          ".",
	}
	if cfg.BuildTool == "" {
		cfg.BuildTool = domain.BuildToolJavac
	}

	if err := SaveProjectConfig(projectRoot, cfg); err != nil {
		return nil, fmt.Errorf("save migrated config: %w", err)
	}
	return LoadProjectConfig(projectRoot)
}

func ProjectToConfig(project *domain.Project) *ProjectConfig {
	return &ProjectConfig{
		SchemaVersion: currentSchemaVersion,
		Name:          project.Name,
		Root:          ".",
		SourceRoots:   project.SourceRoots,
		ResourceRoots: project.ResourceRoots,
		LibraryDirs:   project.LibraryDirs,
		WebappDir:     project.WebappDir,
		OutputDir:     project.OutputDir,
		BuildFile:     project.BuildFile,
		BuildTargets:  project.BuildTargets,
		SourceLevel:   project.SourceLevel,
		TargetLevel:   project.TargetLevel,
		Encoding:      project.Encoding,
		BuildTool:     project.BuildTool,
		ContextPath:   project.ContextPath,
		ToolchainID:   project.ToolchainID,
		RuntimeID:     project.RuntimeID,
	}
}

func ConfigToProject(cfg *ProjectConfig, workspaceID domain.WorkspaceID, projectID domain.ProjectID) *domain.Project {
	return &domain.Project{
		ID:            projectID,
		WorkspaceID:   workspaceID,
		Name:          cfg.Name,
		Root:          cfg.Root,
		SourceRoots:   cfg.SourceRoots,
		ResourceRoots: cfg.ResourceRoots,
		LibraryDirs:   cfg.LibraryDirs,
		WebappDir:     cfg.WebappDir,
		OutputDir:     cfg.OutputDir,
		BuildFile:     cfg.BuildFile,
		BuildTargets:  cfg.BuildTargets,
		SourceLevel:   cfg.SourceLevel,
		TargetLevel:   cfg.TargetLevel,
		Encoding:      cfg.Encoding,
		BuildTool:     cfg.BuildTool,
		ContextPath:   cfg.ContextPath,
		ToolchainID:   cfg.ToolchainID,
		RuntimeID:     cfg.RuntimeID,
	}
}
