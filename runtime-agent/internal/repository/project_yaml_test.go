package repository

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadProjectConfig_Success(t *testing.T) {
	dir := t.TempDir()

	cfg := &ProjectConfig{
		SchemaVersion: 1,
		Name:          "test-project",
		SourceRoots:   []string{"src/main/java"},
		Encoding:      "GBK",
		BuildTool:     "ant",
	}

	if err := SaveProjectConfig(dir, cfg); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}

	loaded, err := LoadProjectConfig(dir)
	if err != nil {
		t.Fatalf("LoadProjectConfig failed: %v", err)
	}

	if loaded.Name != "test-project" {
		t.Errorf("expected name 'test-project', got '%s'", loaded.Name)
	}
	if loaded.Encoding != "GBK" {
		t.Errorf("expected encoding 'GBK', got '%s'", loaded.Encoding)
	}
	if loaded.BuildTool != "ant" {
		t.Errorf("expected buildTool 'ant', got '%s'", loaded.BuildTool)
	}
}

func TestLoadProjectConfig_NotFound(t *testing.T) {
	dir := t.TempDir()
	_, err := LoadProjectConfig(dir)
	if err == nil {
		t.Fatal("expected error for missing project.yaml")
	}
}

func TestSaveProjectConfig(t *testing.T) {
	dir := t.TempDir()
	cfg := &ProjectConfig{
		SchemaVersion: 1,
		Name:          "saved-project",
		SourceRoots:   []string{"src/main/java"},
		Encoding:      "UTF-8",
		BuildTool:     "javac",
	}

	if err := SaveProjectConfig(dir, cfg); err != nil {
		t.Fatalf("SaveProjectConfig failed: %v", err)
	}

	loaded, err := LoadProjectConfig(dir)
	if err != nil {
		t.Fatalf("LoadProjectConfig after save failed: %v", err)
	}
	if loaded.Name != cfg.Name {
		t.Errorf("expected name '%s', got '%s'", cfg.Name, loaded.Name)
	}
}

func TestValidateProjectConfig_Defaults(t *testing.T) {
	cfg := &ProjectConfig{
		SchemaVersion: 1,
		Name:          "test",
	}
	applied, err := applyProjectDefaults(cfg)
	if err != nil {
		t.Fatalf("applyProjectDefaults failed: %v", err)
	}

	if err := ValidateProjectConfig(applied); err != nil {
		t.Fatalf("ValidateProjectConfig failed: %v", err)
	}

	if applied.Encoding != "UTF-8" {
		t.Errorf("expected default encoding 'UTF-8', got '%s'", applied.Encoding)
	}
	if applied.SourceLevel != "1.8" {
		t.Errorf("expected default sourceLevel '1.8', got '%s'", applied.SourceLevel)
	}
	if applied.TargetLevel != "1.8" {
		t.Errorf("expected default targetLevel '1.8', got '%s'", applied.TargetLevel)
	}
	if applied.BuildTool != "javac" {
		t.Errorf("expected default buildTool 'javac', got '%s'", applied.BuildTool)
	}
	if applied.ContextPath != "/" {
		t.Errorf("expected default contextPath '/', got '%s'", applied.ContextPath)
	}
	if applied.Root != "." {
		t.Errorf("expected default root '.', got '%s'", applied.Root)
	}
}

func TestValidateProjectConfig_MissingName(t *testing.T) {
	cfg := &ProjectConfig{SchemaVersion: 1}
	_, err := applyProjectDefaults(cfg)
	if err == nil {
		t.Fatal("expected error for missing name")
	}
}

func TestProjectConfig_YAMLFormat(t *testing.T) {
	dir := t.TempDir()
	cfg := &ProjectConfig{
		SchemaVersion: 1,
		Name:          "yaml-test",
		BuildTool:     "javac",
	}

	if err := SaveProjectConfig(dir, cfg); err != nil {
		t.Fatalf("SaveProjectConfig failed: %v", err)
	}

	yamlPath := filepath.Join(dir, ".kairo", "project.yaml")
	data, err := os.ReadFile(yamlPath)
	if err != nil {
		t.Fatalf("failed to read project.yaml: %v", err)
	}

	content := string(data)
	if len(content) == 0 {
		t.Fatal("project.yaml is empty")
	}
	if content[0] == '{' || content[0] == '[' {
		t.Error("project.yaml looks like JSON, expected YAML")
	}
}

func TestLegacyConfigPath(t *testing.T) {
	path := legacyConfigPath("/project")
	expected := filepath.Join("/project", ".legacyflow", "project.yaml")
	if path != expected {
		t.Errorf("got %q, want %q", path, expected)
	}
}

func TestMigrateFromLegacy_NoLegacyConfig(t *testing.T) {
	dir := t.TempDir()
	cfg, err := MigrateFromLegacy(dir)
	if err != nil {
		t.Fatalf("MigrateFromLegacy failed: %v", err)
	}
	if cfg != nil {
		t.Error("expected nil when no legacy config exists")
	}
}

func TestMigrateFromLegacy_Success(t *testing.T) {
	dir := t.TempDir()

	// Create legacy config
	legacyDir := filepath.Join(dir, ".legacyflow")
	os.MkdirAll(legacyDir, 0755)
	legacyYAML := `schemaVersion: 1
name: legacy-project
sourceRoots:
  - src/main/java
resourceRoots:
  - src/main/resources
webappDir: WebRoot
outputDir: build/classes
sourceLevel: "1.8"
targetLevel: "1.8"
encoding: UTF-8
buildTool: javac
contextPath: /myapp
`
	os.WriteFile(filepath.Join(legacyDir, "project.yaml"), []byte(legacyYAML), 0644)

	cfg, err := MigrateFromLegacy(dir)
	if err != nil {
		t.Fatalf("MigrateFromLegacy failed: %v", err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil config")
	}
	if cfg.Name != "legacy-project" {
		t.Errorf("got %q, want %q", cfg.Name, "legacy-project")
	}
	if cfg.ContextPath != "/myapp" {
		t.Errorf("got %q, want %q", cfg.ContextPath, "/myapp")
	}

	// Verify new config was created
	newPath := ProjectConfigPath(dir)
	if _, err := os.Stat(newPath); os.IsNotExist(err) {
		t.Fatal("new project config was not created")
	}
}

func TestMigrateFromLegacy_ExistingNewConfig(t *testing.T) {
	dir := t.TempDir()

	// Create new config first
	cfg := &ProjectConfig{
		SchemaVersion: 1,
		Name:          "new-project",
		BuildTool:     "javac",
		Encoding:      "UTF-8",
	}
	if err := SaveProjectConfig(dir, cfg); err != nil {
		t.Fatalf("SaveProjectConfig failed: %v", err)
	}

	// Create legacy config
	legacyDir := filepath.Join(dir, ".legacyflow")
	os.MkdirAll(legacyDir, 0755)
	legacyYAML := `schemaVersion: 1
name: legacy-project
`
	os.WriteFile(filepath.Join(legacyDir, "project.yaml"), []byte(legacyYAML), 0644)

	// Should load existing new config instead of migrating
	result, err := MigrateFromLegacy(dir)
	if err != nil {
		t.Fatalf("MigrateFromLegacy failed: %v", err)
	}
	if result.Name != "new-project" {
		t.Errorf("expected new-project, got %q", result.Name)
	}
}

func TestMigrateFromLegacy_InvalidYAML(t *testing.T) {
	dir := t.TempDir()

	legacyDir := filepath.Join(dir, ".legacyflow")
	os.MkdirAll(legacyDir, 0755)
	os.WriteFile(filepath.Join(legacyDir, "project.yaml"), []byte(": not valid yaml"), 0644)

	_, err := MigrateFromLegacy(dir)
	if err == nil {
		t.Fatal("expected error for invalid legacy YAML")
	}
}

func TestMigrateFromLegacy_EmptyBuildTool(t *testing.T) {
	dir := t.TempDir()

	legacyDir := filepath.Join(dir, ".legacyflow")
	os.MkdirAll(legacyDir, 0755)
	legacyYAML := `schemaVersion: 1
name: no-buildtool
`
	os.WriteFile(filepath.Join(legacyDir, "project.yaml"), []byte(legacyYAML), 0644)

	cfg, err := MigrateFromLegacy(dir)
	if err != nil {
		t.Fatalf("MigrateFromLegacy failed: %v", err)
	}
	if cfg.BuildTool != "javac" {
		t.Errorf("expected default buildTool 'javac', got %q", cfg.BuildTool)
	}
}
