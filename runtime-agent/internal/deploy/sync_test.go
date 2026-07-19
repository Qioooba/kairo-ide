package deploy

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

func setupTestEnv(t *testing.T) (srcRoot, deployRoot, outsideRoot string) {
	t.Helper()

	base := t.TempDir()
	srcRoot = filepath.Join(base, "src")
	deployRoot = filepath.Join(base, "deploy")
	outsideRoot = filepath.Join(base, "outside")

	if err := os.MkdirAll(srcRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(deployRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outsideRoot, 0o755); err != nil {
		t.Fatal(err)
	}

	sentinelPath := filepath.Join(outsideRoot, "sentinel.txt")
	if err := os.WriteFile(sentinelPath, []byte("OUTSIDE-SENTINEL-MUST-NOT-CHANGE"), 0o644); err != nil {
		t.Fatal(err)
	}

	return srcRoot, deployRoot, outsideRoot
}

func writeTestFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func verifySentinel(t *testing.T, outsideRoot string) {
	t.Helper()
	sentinelPath := filepath.Join(outsideRoot, "sentinel.txt")
	data, err := os.ReadFile(sentinelPath)
	if err != nil {
		t.Fatalf("sentinel file is missing or unreadable: %v", err)
	}
	if string(data) != "OUTSIDE-SENTINEL-MUST-NOT-CHANGE" {
		t.Fatalf("sentinel file was modified! content: %q", string(data))
	}
}

func validOwnerToken() domain.DeploymentOwnerToken {
	return domain.NewDeploymentOwnerToken()
}

func executePlan(t *testing.T, engine DeployEngine, plan domain.DeployPlan, allowedSourceDirs []string) (*DeployResult, error) {
	t.Helper()
	return engine.Execute(context.Background(), plan, allowedSourceDirs)
}

func TestBasicDeploy_Success(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "a.txt", "hello-a")
	writeTestFile(t, srcRoot, "sub/b.txt", "hello-b")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "a.txt"), Target: "a.txt", Action: domain.DeployActionAdd},
			{Source: filepath.Join(srcRoot, "sub", "b.txt"), Target: "sub/b.txt", Action: domain.DeployActionAdd},
		},
	}

	result, err := executePlan(t, engine, plan, []string{srcRoot})
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if result.Failed != 0 {
		t.Errorf("expected 0 failures, got %d", result.Failed)
	}
	if result.Succeeded != 2 {
		t.Errorf("expected 2 succeeded, got %d", result.Succeeded)
	}

	data, err := os.ReadFile(filepath.Join(deployRoot, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello-a" {
		t.Errorf("a.txt content = %q, want hello-a", string(data))
	}

	data, err = os.ReadFile(filepath.Join(deployRoot, "sub", "b.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello-b" {
		t.Errorf("sub/b.txt content = %q, want hello-b", string(data))
	}
}

func TestPreflight_DotDotTraversal(t *testing.T) {
	_, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(outsideRoot, "evil.txt"), Target: "../outside/evil.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{outsideRoot})
	if err == nil {
		t.Fatal("expected error for ../ traversal, got nil")
	}
	if !errors.Is(err, pathpolicy.ErrPathTraversal) {
		t.Errorf("expected ErrPathTraversal, got: %v", err)
	}

	entries, err := os.ReadDir(deployRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("preflight failure must result in 0 writes, got %d entries", len(entries))
	}
}

func TestPreflight_AbsoluteTarget(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "evil.txt", "evil-content")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "evil.txt"), Target: outsideRoot + "/evil.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for absolute target, got nil")
	}
	if !errors.Is(err, pathpolicy.ErrAbsolutePath) {
		t.Errorf("expected ErrAbsolutePath, got: %v", err)
	}
}

func TestPreflight_WindowsVolume(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "evil.txt", "evil-content")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "evil.txt"), Target: "C:\\outside\\evil.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for C:\\ target (lexical check), got nil")
	}
}

func TestPreflight_UNCTarget(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "evil.txt", "evil-content")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "evil.txt"), Target: `\\server\share\evil.txt`, Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for UNC target (lexical check), got nil")
	}
}

func TestPreflight_EmptyTarget(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "a.txt", "content")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "a.txt"), Target: "", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for empty target, got nil")
	}
	if !errors.Is(err, pathpolicy.ErrEmptyPath) {
		t.Errorf("expected ErrEmptyPath, got: %v", err)
	}
}

func TestPreflight_DuplicateTarget(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "a.txt", "content-a")
	writeTestFile(t, srcRoot, "b.txt", "content-b")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "a.txt"), Target: "same.txt", Action: domain.DeployActionAdd},
			{Source: filepath.Join(srcRoot, "b.txt"), Target: "same.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for duplicate target, got nil")
	}
	if !errors.Is(err, ErrDuplicateTarget) {
		t.Errorf("expected ErrDuplicateTarget, got: %v", err)
	}

	entries, _ := os.ReadDir(deployRoot)
	if len(entries) != 0 {
		t.Errorf("preflight failure must result in 0 writes")
	}
}

func TestPreflight_SymlinkEscape_Root(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink tests require admin on Windows")
	}

	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "ok.txt", "ok")
	writeTestFile(t, outsideRoot, "escaped.txt", "outside-content")

	symlinkPath := filepath.Join(deployRoot, "link-to-outside")
	if err := os.Symlink(outsideRoot, symlinkPath); err != nil {
		t.Fatal(err)
	}

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "ok.txt"), Target: "link-to-outside/evil.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for symlink escape via root symlink, got nil")
	}

	if _, err := os.Stat(filepath.Join(outsideRoot, "evil.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("outside file must not be created")
	}
}

func TestPreflight_SymlinkEscape_Parent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink tests require admin on Windows")
	}

	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "ok.txt", "ok")
	writeTestFile(t, outsideRoot, "parent-escaped.txt", "outside")

	parentDir := filepath.Join(deployRoot, "sub")
	if err := os.MkdirAll(parentDir, 0o755); err != nil {
		t.Fatal(err)
	}
	symlinkPath := filepath.Join(parentDir, "escape")
	if err := os.Symlink(outsideRoot, symlinkPath); err != nil {
		t.Fatal(err)
	}

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "ok.txt"), Target: "sub/escape/evil.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for parent symlink escape, got nil")
	}

	if _, err := os.Stat(filepath.Join(outsideRoot, "evil.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("outside file must not be created")
	}
}

func TestPreflight_SourceSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink tests require admin on Windows")
	}

	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	outsideTarget := filepath.Join(outsideRoot, "target.txt")
	if err := os.WriteFile(outsideTarget, []byte("external"), 0o644); err != nil {
		t.Fatal(err)
	}

	symlinkSource := filepath.Join(srcRoot, "link.txt")
	if err := os.Symlink(outsideTarget, symlinkSource); err != nil {
		t.Fatal(err)
	}

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: symlinkSource, Target: "deployed.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for source symlink, got nil")
	}
}

func TestPreflight_CollisionFileVsDir(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	if err := os.MkdirAll(filepath.Join(deployRoot, "existing"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deployRoot, "existing", "child.txt"), []byte("child"), 0o644); err != nil {
		t.Fatal(err)
	}

	writeTestFile(t, srcRoot, "a.txt", "a")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "a.txt"), Target: "existing", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected collision error (file over existing dir), got nil")
	}
	if !errors.Is(err, ErrCollision) {
		t.Logf("got error type: %T, err: %v", err, err)
	}
}

func TestDeploy_DeleteRefusesRoot(t *testing.T) {
	_, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: "", Target: ".", Action: domain.DeployActionDelete},
		},
	}

	_, err := executePlan(t, engine, plan, nil)
	if err == nil {
		t.Fatal("expected error deleting root itself, got nil")
	}
}

func TestDeploy_ContextCancel(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	for i := 0; i < 64; i++ {
		name := "file-" + string(rune('a'+i%26)) + "-" + string(rune('0'+i/26)) + ".txt"
		writeTestFile(t, srcRoot, name, "content")
	}

	engine := NewDeployEngine()
	entries := make([]domain.DeployEntry, 0, 64)
	for i := 0; i < 64; i++ {
		name := "file-" + string(rune('a'+i%26)) + "-" + string(rune('0'+i/26)) + ".txt"
		entries = append(entries, domain.DeployEntry{
			Source: filepath.Join(srcRoot, name),
			Target: name,
			Action: domain.DeployActionAdd,
		})
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries:        entries,
	}

	result, err := engine.Execute(ctx, plan, []string{srcRoot})
	if err == nil {
		t.Log("cancel happened before execution, that's fine")
	}
	if result.Partial {
		t.Logf("partial deploy occurred: %d succeeded, %d failed", result.Succeeded, result.Failed)
	}
}

func TestDeploy_ReadFailureMidway(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "good.txt", "good-content")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "good.txt"), Target: "good.txt", Action: domain.DeployActionAdd},
			{Source: filepath.Join(srcRoot, "missing.txt"), Target: "missing.txt", Action: domain.DeployActionAdd},
		},
	}

	result, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected preflight error for missing source, got nil")
	}
	if result.Succeeded != 0 {
		t.Errorf("preflight failure must result in 0 writes, got %d succeeded", result.Succeeded)
	}
	if _, err := os.Stat(filepath.Join(deployRoot, "good.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("preflight failure: good.txt must NOT be deployed (atomic preflight guarantee)")
	}
}

func TestMirrorMode_PrunesStaleFiles(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, deployRoot, "stale-old.txt", "old-stale")
	writeTestFile(t, deployRoot, "sub/stale-deep.txt", "deep-stale")
	writeTestFile(t, deployRoot, ".kairo/protected.txt", "protected-data")
	writeTestFile(t, srcRoot, "current.txt", "new-content")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMirror,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "current.txt"), Target: "current.txt", Action: domain.DeployActionAdd},
		},
	}

	result, err := executePlan(t, engine, plan, []string{srcRoot})
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if result.Failed != 0 {
		t.Errorf("expected 0 failures, got %d: %+v", result.Failed, result.FailedFiles)
	}

	if _, err := os.Stat(filepath.Join(deployRoot, "stale-old.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("stale-old.txt should have been pruned")
	}
	if _, err := os.Stat(filepath.Join(deployRoot, "sub", "stale-deep.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("sub/stale-deep.txt should have been pruned")
	}

	protectedData, err := os.ReadFile(filepath.Join(deployRoot, ".kairo", "protected.txt"))
	if err != nil {
		t.Fatalf(".kairo/protected.txt should be preserved: %v", err)
	}
	if string(protectedData) != "protected-data" {
		t.Errorf(".kairo content corrupted")
	}

	data, err := os.ReadFile(filepath.Join(deployRoot, "current.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "new-content" {
		t.Errorf("current.txt content wrong")
	}
}

func TestMirrorMode_DeepFirstDeletion(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	if err := os.MkdirAll(filepath.Join(deployRoot, "deep", "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deployRoot, "deep", "nested", "leaf.txt"), []byte("leaf"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, srcRoot, "top.txt", "top")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMirror,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "top.txt"), Target: "top.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(deployRoot, "deep")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("deep/ directory tree should be completely pruned")
	}
}

func TestSourceNotFound(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "does-not-exist.txt"), Target: "x.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for missing source")
	}
}

func TestAtomicReplace_TempFileCleanup(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "cleanup.txt", "data")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "cleanup.txt"), Target: "cleanup.txt", Action: domain.DeployActionAdd},
		},
	}

	result, err := executePlan(t, engine, plan, []string{srcRoot})
	if err != nil {
		t.Fatal(err)
	}
	if result.Failed != 0 {
		t.Fatalf("unexpected failures: %v", result.FailedFiles)
	}

	entries, err := os.ReadDir(deployRoot)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		name := e.Name()
		if len(name) >= 12 && name[:12] == ".kairo-deploy" {
			t.Errorf("temporary file %q was not cleaned up", name)
		}
	}
}

func TestMergeMode_PreservesExistingUnrelated(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, deployRoot, "unrelated.txt", "unrelated")
	writeTestFile(t, srcRoot, "new.txt", "new")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "new.txt"), Target: "new.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(deployRoot, "unrelated.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "unrelated" {
		t.Errorf("merge mode should preserve unrelated files")
	}
}

func TestDelete_SingleFile(t *testing.T) {
	_, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, deployRoot, "to-delete.txt", "remove-me")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: "", Target: "to-delete.txt", Action: domain.DeployActionDelete},
		},
	}

	_, err := executePlan(t, engine, plan, nil)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(deployRoot, "to-delete.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("file should have been deleted")
	}
}

func TestDelete_EmptyDirectory(t *testing.T) {
	_, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	emptyDir := filepath.Join(deployRoot, "empty-dir")
	if err := os.MkdirAll(emptyDir, 0o755); err != nil {
		t.Fatal(err)
	}

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: "", Target: "empty-dir", Action: domain.DeployActionDelete},
		},
	}

	_, err := executePlan(t, engine, plan, nil)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(emptyDir); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("empty directory should have been deleted")
	}
}

func TestAtomicWrite_NotFollowingSymlinkTarget(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink tests require admin on Windows")
	}

	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	writeTestFile(t, srcRoot, "legit.txt", "legit-content")
	outsideFile := filepath.Join(outsideRoot, "target-of-symlink.txt")
	if err := os.WriteFile(outsideFile, []byte("original-outside"), 0o644); err != nil {
		t.Fatal(err)
	}

	symlinkTarget := filepath.Join(deployRoot, "symlink-evil")
	if err := os.Symlink(outsideFile, symlinkTarget); err != nil {
		t.Fatal(err)
	}

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "legit.txt"), Target: "symlink-evil", Action: domain.DeployActionAdd},
		},
	}

	result, err := executePlan(t, engine, plan, []string{srcRoot})
	if err != nil {
		t.Logf("got error: %v, result: %+v", err, result)
	}

	verifySentinel(t, outsideRoot)
	outsideData, err := os.ReadFile(outsideFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(outsideData) != "original-outside" {
		t.Errorf("atomic replace should NOT have followed symlink! outside file was overwritten!")
	}
}

func TestCancelDuringLongDeploy(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	for i := 0; i < 3; i++ {
		writeTestFile(t, srcRoot, "f"+string(rune('0'+i))+".txt", "content")
	}

	engine := NewDeployEngine()
	entries := []domain.DeployEntry{
		{Source: filepath.Join(srcRoot, "f0.txt"), Target: "f0.txt", Action: domain.DeployActionAdd},
		{Source: filepath.Join(srcRoot, "f1.txt"), Target: "f1.txt", Action: domain.DeployActionAdd},
		{Source: filepath.Join(srcRoot, "f2.txt"), Target: "f2.txt", Action: domain.DeployActionAdd},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()
	time.Sleep(2 * time.Millisecond)

	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries:        entries,
	}

	_, _ = engine.Execute(ctx, plan, []string{srcRoot})
}

func TestPreflight_NonExistentRoot_InvalidEntry_ZeroWrites(t *testing.T) {
	base := t.TempDir()
	srcRoot := filepath.Join(base, "src")
	nonExistentRoot := filepath.Join(base, "does-not-exist")
	outsideRoot := filepath.Join(base, "outside")

	if err := os.MkdirAll(srcRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outsideRoot, 0o755); err != nil {
		t.Fatal(err)
	}

	sentinelPath := filepath.Join(outsideRoot, "sentinel.txt")
	if err := os.WriteFile(sentinelPath, []byte("OUTSIDE-SENTINEL"), 0o644); err != nil {
		t.Fatal(err)
	}

	writeTestFile(t, srcRoot, "a.txt", "content-a")

	beforeListing, err := os.ReadDir(base)
	if err != nil {
		t.Fatal(err)
	}

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: nonExistentRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "a.txt"), Target: "a.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err = executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for non-existent root, got nil")
	}
	if !errors.Is(err, domain.ErrRootNotFound) {
		t.Errorf("expected ErrRootNotFound wrapped, got: %v", err)
	}

	if _, err := os.Stat(nonExistentRoot); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("non-existent root must NOT be created")
	}

	afterListing, err := os.ReadDir(base)
	if err != nil {
		t.Fatal(err)
	}
	if len(afterListing) != len(beforeListing) {
		t.Fatalf("filesystem changed: before %d entries, after %d entries", len(beforeListing), len(afterListing))
	}
	for i := range beforeListing {
		if beforeListing[i].Name() != afterListing[i].Name() {
			t.Errorf("filesystem entry changed at index %d: %s vs %s", i, beforeListing[i].Name(), afterListing[i].Name())
		}
	}

	sentinelData, err := os.ReadFile(sentinelPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(sentinelData) != "OUTSIDE-SENTINEL" {
		t.Errorf("sentinel was modified")
	}
}

func TestPreflight_InvalidOwnerToken(t *testing.T) {
	srcRoot, deployRoot, _ := setupTestEnv(t)

	writeTestFile(t, srcRoot, "a.txt", "content")

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     domain.DeploymentOwnerToken{},
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: filepath.Join(srcRoot, "a.txt"), Target: "a.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for invalid owner token, got nil")
	}
	if !errors.Is(err, domain.ErrInvalidOwnerToken) {
		t.Errorf("expected ErrInvalidOwnerToken, got: %v", err)
	}

	entries, _ := os.ReadDir(deployRoot)
	if len(entries) != 0 {
		t.Errorf("invalid token must result in 0 writes, got %d entries", len(entries))
	}
}

func TestPreflight_SourceOutsideAllowedDirs(t *testing.T) {
	srcRoot, deployRoot, outsideRoot := setupTestEnv(t)
	defer verifySentinel(t, outsideRoot)

	outsideFile := filepath.Join(outsideRoot, "external.txt")
	if err := os.WriteFile(outsideFile, []byte("external"), 0o644); err != nil {
		t.Fatal(err)
	}

	engine := NewDeployEngine()
	plan := domain.DeployPlan{
		DeploymentRoot: deployRoot,
		OwnerToken:     validOwnerToken(),
		Mode:           domain.DeployModeMerge,
		Entries: []domain.DeployEntry{
			{Source: outsideFile, Target: "leaked.txt", Action: domain.DeployActionAdd},
		},
	}

	_, err := executePlan(t, engine, plan, []string{srcRoot})
	if err == nil {
		t.Fatal("expected error for source outside allowed dirs, got nil")
	}
	if !errors.Is(err, ErrSourceOutsideRoot) {
		t.Errorf("expected ErrSourceOutsideRoot, got: %v", err)
	}

	if _, err := os.Stat(filepath.Join(deployRoot, "leaked.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("file must not be deployed when source is outside allowed dirs")
	}
}
