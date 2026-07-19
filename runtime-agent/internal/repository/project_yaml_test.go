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
