package runtime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHotReloadWatcher_StatusTransitions(t *testing.T) {
	dir := t.TempDir()
	webappDir := filepath.Join(dir, "webapp")
	deployDir := filepath.Join(dir, "deploy")
	os.MkdirAll(webappDir, 0755)
	os.MkdirAll(deployDir, 0755)

	cfg := DefaultHotReloadConfig()
	cfg.WebappDir = webappDir
	cfg.DeploymentDir = deployDir
	cfg.PollInterval = 50 * time.Millisecond

	w := NewHotReloadWatcher(cfg)

	if w.Status() != HotReloadSynced {
		t.Errorf("initial status should be synced, got %s", w.Status())
	}

	statusChanges := make(chan HotReloadStatus, 3)
	w.SetStatusChangeCallback(func(s HotReloadStatus) {
		statusChanges <- s
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	defer w.Stop()

	// Create a static file to trigger a change.
	jspFile := filepath.Join(webappDir, "test.jsp")
	if err := os.WriteFile(jspFile, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	// Wait for the scan to pick up the change.
	time.Sleep(200 * time.Millisecond)

	// The static file should be synced to the deployment dir.
	copied := filepath.Join(deployDir, "test.jsp")
	if _, err := os.Stat(copied); err != nil {
		t.Errorf("expected static file to be synced: %v", err)
	}

	// Verify no status change was emitted for static-only changes.
	select {
	case s := <-statusChanges:
		t.Errorf("unexpected status change for static file: %s", s)
	case <-time.After(100 * time.Millisecond):
		// expected — static changes do not change status
	}
}

func TestHotReloadWatcher_JavaChangeTriggersCompile(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "src")
	os.MkdirAll(srcDir, 0755)

	cfg := DefaultHotReloadConfig()
	cfg.SourceDirs = []string{srcDir}
	cfg.PollInterval = 50 * time.Millisecond

	w := NewHotReloadWatcher(cfg)

	statusChanges := make(chan HotReloadStatus, 3)
	w.SetStatusChangeCallback(func(s HotReloadStatus) {
		statusChanges <- s
	})

	compileCalled := make(chan []string, 1)
	w.SetCompileCallback(func(ctx context.Context, changedFiles []string) error {
		compileCalled <- changedFiles
		return nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	defer w.Stop()

	// Create a Java file.
	javaFile := filepath.Join(srcDir, "Test.java")
	if err := os.WriteFile(javaFile, []byte("class Test {}"), 0644); err != nil {
		t.Fatal(err)
	}

	// Wait for poll.
	time.Sleep(200 * time.Millisecond)

	// Should get a compiling status.
	select {
	case s := <-statusChanges:
		if s != HotReloadCompiling {
			t.Errorf("expected compiling status, got %s", s)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("expected compiling status change")
	}

	// Should get a synced status after successful compile.
	select {
	case s := <-statusChanges:
		if s != HotReloadSynced {
			t.Errorf("expected synced status, got %s", s)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("expected synced status change")
	}

	// Compile callback should have been called.
	select {
	case files := <-compileCalled:
		if len(files) != 1 || !strings.HasSuffix(files[0], "Test.java") {
			t.Errorf("unexpected compile files: %v", files)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("expected compile callback to be called")
	}
}

func TestHotReloadWatcher_JavaCompileFailureTriggersRestart(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "src")
	os.MkdirAll(srcDir, 0755)

	cfg := DefaultHotReloadConfig()
	cfg.SourceDirs = []string{srcDir}
	cfg.PollInterval = 50 * time.Millisecond

	w := NewHotReloadWatcher(cfg)

	statusChanges := make(chan HotReloadStatus, 3)
	w.SetStatusChangeCallback(func(s HotReloadStatus) {
		statusChanges <- s
	})

	w.SetCompileCallback(func(ctx context.Context, changedFiles []string) error {
		return os.ErrNotExist // simulate compile failure
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	defer w.Stop()

	javaFile := filepath.Join(srcDir, "Test.java")
	if err := os.WriteFile(javaFile, []byte("class Test {}"), 0644); err != nil {
		t.Fatal(err)
	}

	time.Sleep(200 * time.Millisecond)

	// Should get compiling then restart_required.
	var got []HotReloadStatus
	for i := 0; i < 2; i++ {
		select {
		case s := <-statusChanges:
			got = append(got, s)
		case <-time.After(200 * time.Millisecond):
			t.Fatalf("expected status change %d", i)
		}
	}

	if len(got) < 2 || got[0] != HotReloadCompiling || got[1] != HotReloadRestartRequired {
		t.Errorf("expected compiling -> restart_required, got %v", got)
	}
}

func TestHotReloadWatcher_FileModifiedTriggersChange(t *testing.T) {
	dir := t.TempDir()
	webappDir := filepath.Join(dir, "webapp")
	deployDir := filepath.Join(dir, "deploy")
	os.MkdirAll(webappDir, 0755)
	os.MkdirAll(deployDir, 0755)

	jspFile := filepath.Join(webappDir, "page.jsp")
	if err := os.WriteFile(jspFile, []byte("v1"), 0644); err != nil {
		t.Fatal(err)
	}

	cfg := DefaultHotReloadConfig()
	cfg.WebappDir = webappDir
	cfg.DeploymentDir = deployDir
	cfg.PollInterval = 50 * time.Millisecond

	w := NewHotReloadWatcher(cfg)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	defer w.Stop()

	// First scan: learn the initial hash.
	time.Sleep(100 * time.Millisecond)

	// Modify the file.
	if err := os.WriteFile(jspFile, []byte("v2"), 0644); err != nil {
		t.Fatal(err)
	}

	time.Sleep(200 * time.Millisecond)

	// The deployment dir should have the updated content.
	copied := filepath.Join(deployDir, "page.jsp")
	data, err := os.ReadFile(copied)
	if err != nil {
		t.Fatalf("expected synced file: %v", err)
	}
	if string(data) != "v2" {
		t.Errorf("expected 'v2' in synced file, got %q", string(data))
	}
}

func TestHotReloadWatcher_StopStopsPolling(t *testing.T) {
	dir := t.TempDir()
	webappDir := filepath.Join(dir, "webapp")
	os.MkdirAll(webappDir, 0755)

	cfg := DefaultHotReloadConfig()
	cfg.WebappDir = webappDir
	cfg.PollInterval = 50 * time.Millisecond

	w := NewHotReloadWatcher(cfg)
	ctx := context.Background()
	w.Start(ctx)
	w.Stop()

	w.mu.RLock()
	running := w.running
	w.mu.RUnlock()

	if running {
		t.Error("watcher should not be running after Stop")
	}
}

func TestHotReloadWatcher_NoCompileCallbackNoJavaProcessing(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "src")
	os.MkdirAll(srcDir, 0755)

	cfg := DefaultHotReloadConfig()
	cfg.SourceDirs = []string{srcDir}
	cfg.PollInterval = 50 * time.Millisecond

	w := NewHotReloadWatcher(cfg)

	// No compile callback set — Java changes should be ignored.

	statusChanges := make(chan HotReloadStatus, 1)
	w.SetStatusChangeCallback(func(s HotReloadStatus) {
		statusChanges <- s
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	defer w.Stop()

	javaFile := filepath.Join(srcDir, "Test.java")
	if err := os.WriteFile(javaFile, []byte("class Test {}"), 0644); err != nil {
		t.Fatal(err)
	}

	time.Sleep(200 * time.Millisecond)

	// No status change should be emitted.
	select {
	case s := <-statusChanges:
		t.Errorf("unexpected status change without compile callback: %s", s)
	case <-time.After(100 * time.Millisecond):
		// expected
	}
}

func TestHotReloadWatcher_DefaultConfig(t *testing.T) {
	cfg := DefaultHotReloadConfig()
	if cfg.PollInterval <= 0 {
		t.Error("poll interval should be positive")
	}
	if len(cfg.StaticExtensions) == 0 {
		t.Error("static extensions should not be empty")
	}
	if len(cfg.SkipDirs) == 0 {
		t.Error("skip dirs should not be empty")
	}
}

func TestHotReloadWatcher_IsStaticFile(t *testing.T) {
	w := NewHotReloadWatcher(HotReloadConfig{})

	tests := []struct {
		path     string
		expected bool
	}{
		{"index.jsp", true},
		{"style.css", true},
		{"app.js", true},
		{"logo.png", true},
		{"Test.java", false},
		{"build.xml", true},
		{"web.xml", true},
		{"data.json", true},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := w.isStaticFile(tt.path); got != tt.expected {
				t.Errorf("isStaticFile(%q) = %v, want %v", tt.path, got, tt.expected)
			}
		})
	}
}

func TestHotReloadWatcher_SkipDirs(t *testing.T) {
	dir := t.TempDir()
	webappDir := filepath.Join(dir, "webapp")
	os.MkdirAll(filepath.Join(webappDir, "WEB-INF", "lib"), 0755)
	os.MkdirAll(filepath.Join(webappDir, "css"), 0755)

	// File in skipped dir.
	if err := os.WriteFile(filepath.Join(webappDir, "WEB-INF", "web.xml"), []byte("xml"), 0644); err != nil {
		t.Fatal(err)
	}
	// File in normal dir.
	if err := os.WriteFile(filepath.Join(webappDir, "css", "style.css"), []byte("css"), 0644); err != nil {
		t.Fatal(err)
	}

	cfg := DefaultHotReloadConfig()
	cfg.WebappDir = webappDir
	cfg.PollInterval = 50 * time.Millisecond

	w := NewHotReloadWatcher(cfg)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	defer w.Stop()

	time.Sleep(200 * time.Millisecond)

	// WEB-INF should be skipped (no hash entry).
	w.mu.RLock()
	_, hasWEBINF := w.fileHashes[filepath.Join(webappDir, "WEB-INF", "web.xml")]
	_, hasCSS := w.fileHashes[filepath.Join(webappDir, "css", "style.css")]
	w.mu.RUnlock()

	if hasWEBINF {
		t.Error("WEB-INF directory should be skipped")
	}
	if !hasCSS {
		t.Error("css/style.css should be tracked")
	}
}

func TestHotReloadWatcher_DirectDocBaseNoCopy(t *testing.T) {
	dir := t.TempDir()
	webappDir := filepath.Join(dir, "webapp")
	os.MkdirAll(webappDir, 0755)

	// direct mode: DeploymentDir == "" (Tomcat serves directly from WebappDir)
	cfg := DefaultHotReloadConfig()
	cfg.WebappDir = webappDir
	cfg.DeploymentDir = ""
	cfg.PollInterval = 50 * time.Millisecond

	w := NewHotReloadWatcher(cfg)
	// Directly test syncStaticFile is no-op in direct mode.
	tmpFile := filepath.Join(webappDir, "index.jsp")
	if err := os.WriteFile(tmpFile, []byte("v1"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := w.syncStaticFile(context.Background(), tmpFile); err != nil {
		t.Errorf("direct mode sync should be no-op, got %v", err)
	}
	// Also with DeploymentDir == WebappDir
	cfg2 := DefaultHotReloadConfig()
	cfg2.WebappDir = webappDir
	cfg2.DeploymentDir = webappDir
	w2 := NewHotReloadWatcher(cfg2)
	if err := w2.syncStaticFile(context.Background(), tmpFile); err != nil {
		t.Errorf("same-dir direct mode sync should be no-op, got %v", err)
	}
	// Watcher should still detect changes without error.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	defer w.Stop()
	time.Sleep(150 * time.Millisecond)
	w.mu.RLock()
	_, tracked := w.fileHashes[tmpFile]
	w.mu.RUnlock()
	if !tracked {
		t.Error("file should be tracked in direct mode")
	}
}

func TestSyncCompiledClasses(t *testing.T) {
	dir := t.TempDir()
	outputDir := filepath.Join(dir, "output")
	webappDir := filepath.Join(dir, "webapp")
	os.MkdirAll(filepath.Join(outputDir, "com", "example"), 0755)
	os.MkdirAll(filepath.Join(webappDir, "WEB-INF", "classes"), 0755)

	classFile := filepath.Join(outputDir, "com", "example", "App.class")
	if err := os.WriteFile(classFile, []byte("cafebabe"), 0644); err != nil {
		t.Fatal(err)
	}
	// Non-class file should be ignored.
	if err := os.WriteFile(filepath.Join(outputDir, "com", "example", "App.java"), []byte("class"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := syncCompiledClasses(outputDir, webappDir); err != nil {
		t.Fatalf("syncCompiledClasses failed: %v", err)
	}
	target := filepath.Join(webappDir, "WEB-INF", "classes", "com", "example", "App.class")
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("expected synced class: %v", err)
	}
	if string(data) != "cafebabe" {
		t.Errorf("unexpected synced content: %q", string(data))
	}
	// Ensure .java was not copied.
	if _, err := os.Stat(filepath.Join(webappDir, "WEB-INF", "classes", "com", "example", "App.java")); !os.IsNotExist(err) {
		t.Error("non-class file should not be synced")
	}
}

func TestFileHash(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(f, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	h1, err := fileHash(f)
	if err != nil {
		t.Fatal(err)
	}
	if h1 == "" {
		t.Error("hash should not be empty")
	}

	// Same content should produce same hash.
	h2, err := fileHash(f)
	if err != nil {
		t.Fatal(err)
	}
	if h1 != h2 {
		t.Error("same file should produce same hash")
	}

	// Different content should produce different hash.
	if err := os.WriteFile(f, []byte("world"), 0644); err != nil {
		t.Fatal(err)
	}
	h3, err := fileHash(f)
	if err != nil {
		t.Fatal(err)
	}
	if h1 == h3 {
		t.Error("different content should produce different hash")
	}

	// Non-existent file should error.
	_, err = fileHash(filepath.Join(dir, "nope.txt"))
	if err == nil {
		t.Error("non-existent file should error")
	}
}