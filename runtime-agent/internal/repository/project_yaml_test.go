package repository

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadProjectConfig_Success(t *testing.T) {
	dir := t.TempDir()
	kairoDir := filepath.Join(dir, ".kairo")
	os.MkdirAll(kairoDir, 0755)

	cfg := ProjectConfig{
		SchemaVersion: 1,
		Name:          "test-project",
		SourceRoots:   []string{"src/main/java"},
		Encoding:      "GBK",
		BuildTool:     "ant",
	}

	doc := NewVersioned(cfg)
	if err := AtomicWriteJSON(filepath.Join(kairoDir, "project.yaml"), doc, 0644); err != nil {
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

	// Load it back
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

	if err := ValidateProjectConfig(cfg); err != nil {
		t.Fatalf("ValidateProjectConfig failed: %v", err)
	}

	if cfg.Encoding != "UTF-8" {
		t.Errorf("expected default encoding 'UTF-8', got '%s'", cfg.Encoding)
	}
	if cfg.SourceLevel != "1.6" {
		t.Errorf("expected default sourceLevel '1.6', got '%s'", cfg.SourceLevel)
	}
	if cfg.TargetLevel != "1.6" {
		t.Errorf("expected default targetLevel '1.6', got '%s'", cfg.TargetLevel)
	}
	if cfg.BuildTool != "javac" {
		t.Errorf("expected default buildTool 'javac', got '%s'", cfg.BuildTool)
	}
	if cfg.ContextPath != "/" {
		t.Errorf("expected default contextPath '/', got '%s'", cfg.ContextPath)
	}
}

func TestValidateProjectConfig_MissingName(t *testing.T) {
	cfg := &ProjectConfig{SchemaVersion: 1}
	if err := ValidateProjectConfig(cfg); err == nil {
		t.Fatal("expected error for missing name")
	}
}