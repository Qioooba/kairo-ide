package bootstrap

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

func TestNewContainer_WithExplicitDataDir(t *testing.T) {
	dir := t.TempDir()
	logger := log.New("test")

	cfg := Config{
		DataDir: dir,
		Logger:  logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() error = %v", err)
	}
	if container == nil {
		t.Fatal("NewContainer() returned nil container")
	}

	// Verify all fields are wired.
	if container.Services == nil {
		t.Error("container.Services is nil")
	}
	if container.EventHub == nil {
		t.Error("container.EventHub is nil")
	}
	if container.EventBus == nil {
		t.Error("container.EventBus is nil")
	}
	if container.EventBus.Hub != container.EventHub {
		t.Error("container.EventBus.Hub != container.EventHub")
	}
	if container.Sandbox == nil {
		t.Error("container.Sandbox is nil")
	}

	// Verify the DataDir was used (not replaced by home dir fallback).
	// We check that the expected subdirectories are created.
	if _, err := os.Stat(filepath.Join(dir, "toolchains")); os.IsNotExist(err) {
		t.Error("expected toolchains dir to be created")
	}
	if _, err := os.Stat(filepath.Join(dir, "workspaces")); os.IsNotExist(err) {
		t.Error("expected workspaces dir to be created")
	}
	if _, err := os.Stat(filepath.Join(dir, "projects")); os.IsNotExist(err) {
		t.Error("expected projects dir to be created")
	}
	if _, err := os.Stat(filepath.Join(dir, "builds")); os.IsNotExist(err) {
		t.Error("expected builds dir to be created")
	}
	if _, err := os.Stat(filepath.Join(dir, "deployments")); os.IsNotExist(err) {
		t.Error("expected deployments dir to be created")
	}
	if _, err := os.Stat(filepath.Join(dir, "auth")); os.IsNotExist(err) {
		t.Error("expected auth dir to be created")
	}
}

func TestNewContainer_EmptyDataDirFallback(t *testing.T) {
	// When DataDir is empty, it should fall back to ~/.kairo/runtime-agent.
	logger := log.New("test")

	cfg := Config{
		DataDir: "",
		Logger:  logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() with empty DataDir error = %v", err)
	}
	if container == nil {
		t.Fatal("NewContainer() returned nil container")
	}
	if container.Services == nil {
		t.Error("container.Services is nil")
	}

	// Verify the fallback path was used.
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skipf("cannot determine home dir: %v", err)
	}
	expectedDir := filepath.Join(home, ".kairo", "runtime-agent")
	if _, err := os.Stat(expectedDir); os.IsNotExist(err) {
		t.Errorf("expected fallback data dir %s to exist", expectedDir)
	}
}

func TestNewContainer_WithBundledDir(t *testing.T) {
	dir := t.TempDir()
	bundledDir := filepath.Join(dir, "custom-bundled")
	logger := log.New("test")

	cfg := Config{
		DataDir:    dir,
		BundledDir: bundledDir,
		Logger:     logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() error = %v", err)
	}
	if container.Services == nil {
		t.Fatal("container.Services is nil")
	}
}

func TestNewContainer_WithTomcat6Home(t *testing.T) {
	dir := t.TempDir()
	logger := log.New("test")

	cfg := Config{
		DataDir:     dir,
		Tomcat6Home: "/nonexistent/tomcat6",
		Logger:      logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() error = %v", err)
	}
	if container.Services == nil {
		t.Fatal("container.Services is nil")
	}
}

func TestNewContainer_WithSecret(t *testing.T) {
	dir := t.TempDir()
	logger := log.New("test")

	cfg := Config{
		DataDir: dir,
		Secret:  "test-secret-123",
		Logger:  logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() error = %v", err)
	}
	if container.Services == nil {
		t.Fatal("container.Services is nil")
	}
}

func TestNewContainer_WithSkipSHAVerify(t *testing.T) {
	dir := t.TempDir()
	logger := log.New("test")

	cfg := Config{
		DataDir:       dir,
		SkipSHAVerify: true,
		Logger:        logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() error = %v", err)
	}
	if container.Services == nil {
		t.Fatal("container.Services is nil")
	}
}

func TestNewContainer_WithJDTLSURL(t *testing.T) {
	dir := t.TempDir()
	logger := log.New("test")

	cfg := Config{
		DataDir:  dir,
		JDTLSURL: "https://mirror.example.com/jdtls.tar.gz",
		Logger:   logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() error = %v", err)
	}
	if container.Services == nil {
		t.Fatal("container.Services is nil")
	}
}

func TestNewContainer_AllConfigFields(t *testing.T) {
	dir := t.TempDir()
	bundledDir := filepath.Join(dir, "bundled")
	logger := log.New("test")

	cfg := Config{
		DataDir:       dir,
		BundledDir:    bundledDir,
		Logger:        logger,
		Tomcat6Home:   "/opt/tomcat6",
		Secret:        "my-secret",
		SkipSHAVerify: true,
		JDTLSURL:      "https://custom.jdtls.url/",
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() with all config error = %v", err)
	}
	if container.Services == nil {
		t.Fatal("container.Services is nil")
	}
	if container.EventBus == nil {
		t.Fatal("container.EventBus is nil")
	}
	if container.Sandbox == nil {
		t.Fatal("container.Sandbox is nil")
	}
}

func TestContainer_Shutdown(t *testing.T) {
	dir := t.TempDir()
	logger := log.New("test")

	cfg := Config{
		DataDir: dir,
		Logger:  logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() error = %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err = container.Shutdown(ctx)
	if err != nil {
		t.Errorf("Shutdown() error = %v", err)
	}
}

func TestContainer_Shutdown_CancelledContext(t *testing.T) {
	dir := t.TempDir()
	logger := log.New("test")

	cfg := Config{
		DataDir: dir,
		Logger:  logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // immediately cancel

	err = container.Shutdown(ctx)
	// Shutdown should still succeed since the shutdown function is a simple log.
	if err != nil {
		t.Errorf("Shutdown() with cancelled context error = %v", err)
	}
}

func TestContainer_Shutdown_AlreadyCancelled(t *testing.T) {
	dir := t.TempDir()
	logger := log.New("test")

	cfg := Config{
		DataDir: dir,
		Logger:  logger,
	}

	container, err := NewContainer(cfg)
	if err != nil {
		t.Fatalf("NewContainer() error = %v", err)
	}

	// Shutdown should be idempotent (calling twice should not panic).
	ctx := context.Background()
	if err := container.Shutdown(ctx); err != nil {
		t.Errorf("first Shutdown() error = %v", err)
	}
	if err := container.Shutdown(ctx); err != nil {
		t.Errorf("second Shutdown() error = %v", err)
	}
}

func TestConfig_ZeroValue(t *testing.T) {
	var cfg Config
	if cfg.DataDir != "" {
		t.Error("zero Config.DataDir should be empty")
	}
	if cfg.BundledDir != "" {
		t.Error("zero Config.BundledDir should be empty")
	}
	if cfg.Logger != nil {
		t.Error("zero Config.Logger should be nil")
	}
}

func TestConfig_Fields(t *testing.T) {
	dir := t.TempDir()
	logger := log.New("test")

	cfg := Config{
		DataDir:       dir,
		BundledDir:    filepath.Join(dir, "bundled"),
		Logger:        logger,
		Tomcat6Home:   "/opt/tomcat6",
		Secret:        "s3cret",
		SkipSHAVerify: true,
		JDTLSURL:      "https://jdtls.example.com/",
	}

	if cfg.DataDir != dir {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, dir)
	}
	if cfg.Logger != logger {
		t.Error("Logger not preserved")
	}
	if cfg.Tomcat6Home != "/opt/tomcat6" {
		t.Errorf("Tomcat6Home = %q, want %q", cfg.Tomcat6Home, "/opt/tomcat6")
	}
	if cfg.Secret != "s3cret" {
		t.Errorf("Secret = %q, want %q", cfg.Secret, "s3cret")
	}
	if !cfg.SkipSHAVerify {
		t.Error("SkipSHAVerify should be true")
	}
	if cfg.JDTLSURL != "https://jdtls.example.com/" {
		t.Errorf("JDTLSURL = %q, want %q", cfg.JDTLSURL, "https://jdtls.example.com/")
	}
}