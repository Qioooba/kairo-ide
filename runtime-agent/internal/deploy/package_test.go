package deploy

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

// =============================================================================
// PackageArchive tests
// =============================================================================

func TestPackageArchive_WAR(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "webapp")
	os.MkdirAll(filepath.Join(srcDir, "WEB-INF"), 0755)
	writeTestFile(t, srcDir, "index.jsp", "<html>Hello</html>")
	writeTestFile(t, filepath.Join(srcDir, "WEB-INF"), "web.xml", "<web-app/>")

	outputPath := filepath.Join(dir, "app.war")
	result, err := PackageArchive(context.Background(), PackageRequest{
		Type:       PackageTypeWAR,
		SourceDir:  srcDir,
		OutputPath: outputPath,
	})
	if err != nil {
		t.Fatalf("PackageArchive failed: %v", err)
	}
	if result.EntryCount != 2 {
		t.Errorf("expected 2 entries, got %d", result.EntryCount)
	}
	if result.Size <= 0 {
		t.Error("expected non-zero size")
	}
	if _, err := os.Stat(outputPath); err != nil {
		t.Errorf("archive file not found: %v", err)
	}
}

func TestPackageArchive_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "empty")
	os.MkdirAll(srcDir, 0755)

	outputPath := filepath.Join(dir, "empty.war")
	result, err := PackageArchive(context.Background(), PackageRequest{
		Type:       PackageTypeWAR,
		SourceDir:  srcDir,
		OutputPath: outputPath,
	})
	if err != nil {
		t.Fatalf("PackageArchive failed: %v", err)
	}
	if result.EntryCount != 0 {
		t.Errorf("expected 0 entries, got %d", result.EntryCount)
	}
}

func TestPackageArchive_Excludes(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "webapp")
	os.MkdirAll(srcDir, 0755)
	writeTestFile(t, srcDir, "index.jsp", "content")
	writeTestFile(t, srcDir, ".gitignore", "ignore")

	outputPath := filepath.Join(dir, "app.war")
	result, err := PackageArchive(context.Background(), PackageRequest{
		Type:            PackageTypeWAR,
		SourceDir:       srcDir,
		OutputPath:      outputPath,
		ExcludePatterns: []string{".gitignore"},
	})
	if err != nil {
		t.Fatalf("PackageArchive failed: %v", err)
	}
	if result.EntryCount != 1 {
		t.Errorf("expected 1 entry (excluded .gitignore), got %d", result.EntryCount)
	}
}

func TestPackageArchive_MissingSource(t *testing.T) {
	_, err := PackageArchive(context.Background(), PackageRequest{
		SourceDir:  "/nonexistent",
		OutputPath: "/tmp/test.war",
	})
	if err == nil {
		t.Fatal("expected error for missing source directory")
	}
}

func TestPackageArchive_CanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := PackageArchive(ctx, PackageRequest{
		SourceDir:  "/tmp",
		OutputPath: "/tmp/test.war",
	})
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestPackageArchive_SubDirectory(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "webapp")
	os.MkdirAll(filepath.Join(srcDir, "css"), 0755)
	os.MkdirAll(filepath.Join(srcDir, "js"), 0755)
	writeTestFile(t, filepath.Join(srcDir, "css"), "style.css", "body {}")
	writeTestFile(t, filepath.Join(srcDir, "js"), "app.js", "console.log(1)")

	outputPath := filepath.Join(dir, "app.war")
	result, err := PackageArchive(context.Background(), PackageRequest{
		Type:       PackageTypeWAR,
		SourceDir:  srcDir,
		OutputPath: outputPath,
	})
	if err != nil {
		t.Fatalf("PackageArchive failed: %v", err)
	}
	if result.EntryCount != 2 {
		t.Errorf("expected 2 entries, got %d", result.EntryCount)
	}
}

// =============================================================================
// HotDeploy tests
// =============================================================================

func TestHotDeploy_Success(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "src")
	deployRoot := filepath.Join(dir, "deploy")
	os.MkdirAll(srcDir, 0755)
	os.MkdirAll(deployRoot, 0755)

	writeTestFile(t, srcDir, "index.jsp", "<html>v1</html>")
	writeTestFile(t, srcDir, "style.css", "body{}")

	result, err := HotDeploy(context.Background(), HotDeployRequest{
		DeploymentRoot: deployRoot,
		ChangedFiles:   []string{filepath.Join(srcDir, "index.jsp"), filepath.Join(srcDir, "style.css")},
		SourceRoots:    []string{srcDir},
	})
	if err != nil {
		t.Fatalf("HotDeploy failed: %v", err)
	}
	if result.Status != HotDeployDone {
		t.Errorf("expected status 'done', got %s", result.Status)
	}
	if len(result.Deployed) != 2 {
		t.Errorf("expected 2 deployed, got %d", len(result.Deployed))
	}

	// Verify files were copied
	if _, err := os.Stat(filepath.Join(deployRoot, "index.jsp")); err != nil {
		t.Errorf("deployed file not found: %v", err)
	}
	if _, err := os.Stat(filepath.Join(deployRoot, "style.css")); err != nil {
		t.Errorf("deployed file not found: %v", err)
	}
}

func TestHotDeploy_PartialFailure(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "src")
	deployRoot := filepath.Join(dir, "deploy")
	os.MkdirAll(srcDir, 0755)
	os.MkdirAll(deployRoot, 0755)

	writeTestFile(t, srcDir, "good.jsp", "good")
	nonExistent := filepath.Join(dir, "outside", "missing.jsp")

	result, err := HotDeploy(context.Background(), HotDeployRequest{
		DeploymentRoot: deployRoot,
		ChangedFiles:   []string{filepath.Join(srcDir, "good.jsp"), nonExistent},
		SourceRoots:    []string{srcDir},
	})
	if err != nil {
		t.Fatalf("HotDeploy failed: %v", err)
	}
	if result.Status != HotDeployFailed {
		t.Errorf("expected status 'failed', got %s", result.Status)
	}
	if len(result.Deployed) != 1 {
		t.Errorf("expected 1 deployed, got %d", len(result.Deployed))
	}
	if len(result.Failed) != 1 {
		t.Errorf("expected 1 failed, got %d", len(result.Failed))
	}
}

func TestHotDeploy_EmptyChanges(t *testing.T) {
	result, err := HotDeploy(context.Background(), HotDeployRequest{
		DeploymentRoot: "/tmp/deploy",
		ChangedFiles:   nil,
		SourceRoots:    []string{"/tmp/src"},
	})
	if err != nil {
		t.Fatalf("HotDeploy failed: %v", err)
	}
	if result.Status != HotDeployDone {
		t.Errorf("expected status 'done', got %s", result.Status)
	}
	if len(result.Deployed) != 0 {
		t.Errorf("expected 0 deployed, got %d", len(result.Deployed))
	}
}

func TestHotDeploy_CanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := HotDeploy(ctx, HotDeployRequest{
		DeploymentRoot: "/tmp/deploy",
		ChangedFiles:   []string{"/tmp/src/file.jsp"},
		SourceRoots:    []string{"/tmp/src"},
	})
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

// =============================================================================
// DeployTracker tests
// =============================================================================

func TestDeployTracker_Track(t *testing.T) {
	tracker := NewDeployTracker()
	dep := &TrackedDeployment{
		ID:             "dep_001",
		WorkspaceID:    "ws1",
		ProjectID:      "p1",
		Status:         DeployStatusPending,
		DeploymentRoot: "/tmp/deploy",
		StartedAt:      time.Now(),
	}
	tracker.Track(dep)

	got := tracker.Get("dep_001")
	if got == nil {
		t.Fatal("expected deployment to be tracked")
	}
	if got.ID != "dep_001" {
		t.Errorf("expected ID 'dep_001', got %q", got.ID)
	}
}

func TestDeployTracker_UpdateStatus(t *testing.T) {
	tracker := NewDeployTracker()
	dep := &TrackedDeployment{
		ID:     "dep_001",
		Status: DeployStatusPending,
	}
	tracker.Track(dep)

	tracker.UpdateStatus("dep_001", DeployStatusInProgress, "")
	got := tracker.Get("dep_001")
	if got.Status != DeployStatusInProgress {
		t.Errorf("expected status 'in_progress', got %s", got.Status)
	}

	tracker.UpdateStatus("dep_001", DeployStatusCompleted, "")
	got = tracker.Get("dep_001")
	if got.Status != DeployStatusCompleted {
		t.Errorf("expected status 'completed', got %s", got.Status)
	}
	if got.CompletedAt == nil {
		t.Error("expected CompletedAt to be set")
	}
}

func TestDeployTracker_UpdateStatus_WithError(t *testing.T) {
	tracker := NewDeployTracker()
	dep := &TrackedDeployment{
		ID:     "dep_001",
		Status: DeployStatusPending,
	}
	tracker.Track(dep)

	tracker.UpdateStatus("dep_001", DeployStatusFailed, "permission denied")
	got := tracker.Get("dep_001")
	if got.Status != DeployStatusFailed {
		t.Errorf("expected status 'failed', got %s", got.Status)
	}
	if got.Error != "permission denied" {
		t.Errorf("expected error 'permission denied', got %q", got.Error)
	}
}

func TestDeployTracker_Get_NotFound(t *testing.T) {
	tracker := NewDeployTracker()
	got := tracker.Get("nonexistent")
	if got != nil {
		t.Error("expected nil for non-existent deployment")
	}
}

func TestDeployTracker_List(t *testing.T) {
	tracker := NewDeployTracker()
	tracker.Track(&TrackedDeployment{ID: "dep_001", Status: DeployStatusPending})
	tracker.Track(&TrackedDeployment{ID: "dep_002", Status: DeployStatusCompleted})

	list := tracker.List()
	if len(list) != 2 {
		t.Errorf("expected 2 deployments, got %d", len(list))
	}
}

func TestDeployTracker_ListByProject(t *testing.T) {
	tracker := NewDeployTracker()
	now := time.Now()
	tracker.Track(&TrackedDeployment{
		ID:          "dep_001",
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		Status:      DeployStatusCompleted,
		StartedAt:   now.Add(-1 * time.Hour),
	})
	tracker.Track(&TrackedDeployment{
		ID:          "dep_002",
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		Status:      DeployStatusCompleted,
		StartedAt:   now,
	})
	tracker.Track(&TrackedDeployment{
		ID:          "dep_003",
		WorkspaceID: "ws1",
		ProjectID:   "p2",
		Status:      DeployStatusCompleted,
		StartedAt:   now,
	})

	list := tracker.ListByProject("ws1", "p1")
	if len(list) != 2 {
		t.Errorf("expected 2 deployments for p1, got %d", len(list))
	}
	// Should be sorted by time descending
	if list[0].ID != "dep_002" {
		t.Errorf("expected dep_002 first, got %s", list[0].ID)
	}
}

// =============================================================================
// Rollback tests
// =============================================================================

func TestRollbackEngine_Rollback(t *testing.T) {
	dir := t.TempDir()
	deployRoot := filepath.Join(dir, "deploy")
	os.MkdirAll(deployRoot, 0755)

	// Write original file
	writeTestFile(t, deployRoot, "test.txt", "original content")

	// Create snapshot
	snapshot, err := CreateSnapshot(context.Background(), deployRoot, []string{"test.txt"})
	if err != nil {
		t.Fatalf("CreateSnapshot failed: %v", err)
	}

	// Modify the file
	os.WriteFile(filepath.Join(deployRoot, "test.txt"), []byte("modified content"), 0644)

	// Rollback
	tracker := NewDeployTracker()
	tracker.Track(&TrackedDeployment{
		ID:             "dep_001",
		DeploymentRoot: deployRoot,
		Snapshot:       snapshot,
	})

	engine := NewRollbackEngine(tracker)
	result, err := engine.Rollback(context.Background(), "dep_001")
	if err != nil {
		t.Fatalf("Rollback failed: %v", err)
	}
	if !result.Success {
		t.Error("expected successful rollback")
	}
	if result.RestoredFiles != 1 {
		t.Errorf("expected 1 restored file, got %d", result.RestoredFiles)
	}

	// Verify content was restored
	content, err := os.ReadFile(filepath.Join(deployRoot, "test.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "original content" {
		t.Errorf("expected 'original content', got %q", string(content))
	}
}

func TestRollbackEngine_NotFound(t *testing.T) {
	tracker := NewDeployTracker()
	engine := NewRollbackEngine(tracker)
	_, err := engine.Rollback(context.Background(), "nonexistent")
	if err == nil {
		t.Fatal("expected error for non-existent deployment")
	}
}

func TestRollbackEngine_NoSnapshot(t *testing.T) {
	tracker := NewDeployTracker()
	tracker.Track(&TrackedDeployment{
		ID:             "dep_001",
		DeploymentRoot: "/tmp/deploy",
		Snapshot:       nil,
	})

	engine := NewRollbackEngine(tracker)
	_, err := engine.Rollback(context.Background(), "dep_001")
	if err == nil {
		t.Fatal("expected error for missing snapshot")
	}
}

func TestCreateSnapshot_NewFile(t *testing.T) {
	dir := t.TempDir()
	deployRoot := filepath.Join(dir, "deploy")
	os.MkdirAll(deployRoot, 0755)

	// File that doesn't exist yet (new deployment)
	snapshot, err := CreateSnapshot(context.Background(), deployRoot, []string{"new-file.txt"})
	if err != nil {
		t.Fatalf("CreateSnapshot failed: %v", err)
	}
	if len(snapshot.Files) != 1 {
		t.Errorf("expected 1 file in snapshot, got %d", len(snapshot.Files))
	}
	if snapshot.Files[0].Content != nil {
		t.Error("expected nil content for non-existent file")
	}
}

func TestCreateSnapshot_ExistingFile(t *testing.T) {
	dir := t.TempDir()
	deployRoot := filepath.Join(dir, "deploy")
	os.MkdirAll(deployRoot, 0755)
	writeTestFile(t, deployRoot, "existing.txt", "hello world")

	snapshot, err := CreateSnapshot(context.Background(), deployRoot, []string{"existing.txt"})
	if err != nil {
		t.Fatalf("CreateSnapshot failed: %v", err)
	}
	if len(snapshot.Files) != 1 {
		t.Errorf("expected 1 file in snapshot, got %d", len(snapshot.Files))
	}
	if string(snapshot.Files[0].Content) != "hello world" {
		t.Errorf("expected 'hello world', got %q", string(snapshot.Files[0].Content))
	}
}

// =============================================================================
// ResolveDeployTarget tests
// =============================================================================

func TestResolveDeployTarget(t *testing.T) {
	tests := []struct {
		name          string
		catalinaBase  string
		contextPath   string
		expectedSuffix string
	}{
		{"root context", "/opt/tomcat", "/", "ROOT"},
		{"empty context", "/opt/tomcat", "", "ROOT"},
		{"custom context", "/opt/tomcat", "/myapp", "myapp"},
		{"nested context", "/opt/tomcat", "/app/v1", "app_v1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ResolveDeployTarget(tt.catalinaBase, tt.contextPath)
			expected := filepath.Join(tt.catalinaBase, "webapps", tt.expectedSuffix)
			if result != expected {
				t.Errorf("expected %q, got %q", expected, result)
			}
		})
	}
}

// =============================================================================
// IsValidDeployMode tests
// =============================================================================

func TestIsValidDeployMode(t *testing.T) {
	tests := []struct {
		mode string
		valid bool
	}{
		{"merge", true},
		{"mirror", true},
		{"replace", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.mode, func(t *testing.T) {
			got := IsValidDeployMode(domain.DeployMode(tt.mode))
			if got != tt.valid {
				t.Errorf("IsValidDeployMode(%q) = %v, want %v", tt.mode, got, tt.valid)
			}
		})
	}
}

func TestDeployModeDescription(t *testing.T) {
	merge := DeployModeDescription(domain.DeployModeMerge)
	if merge == "" {
		t.Error("expected non-empty description for merge mode")
	}
	mirror := DeployModeDescription(domain.DeployModeMirror)
	if mirror == "" {
		t.Error("expected non-empty description for mirror mode")
	}
	unknown := DeployModeDescription("unknown")
	if unknown == "" {
		t.Error("expected non-empty description for unknown mode")
	}
}

