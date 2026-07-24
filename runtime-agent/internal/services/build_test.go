package services

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/build"
)

func TestAsyncBuildEngineReturnsDetachedSnapshots(t *testing.T) {
	stored := &api.BuildResult{
		ID:    "build-1",
		State: "running",
		Diagnostics: []build.Diagnostic{{
			Message: "original",
		}},
	}
	engine := &asyncBuildEngine{
		finished: map[string]*api.BuildResult{stored.ID: stored},
	}

	got, err := engine.Get(stored.ID)
	if err != nil {
		t.Fatal(err)
	}
	got.State = "corrupted"
	got.Diagnostics[0].Message = "corrupted"

	again, err := engine.Get(stored.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.State != "running" || again.Diagnostics[0].Message != "original" {
		t.Fatalf("Get returned shared state: %+v", again)
	}

	listed := engine.List()
	listed[0].State = "corrupted"
	again, err = engine.Get(stored.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.State != "running" {
		t.Fatalf("List returned shared state: %+v", again)
	}
}

func newTestAsyncBuildEngine(t *testing.T) *asyncBuildEngine {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "builds")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("JAVA_HOME", t.TempDir())
	return &asyncBuildEngine{
		dir:      dir,
		running:  map[string]*runningBuild{},
		finished: map[string]*api.BuildResult{},
	}
}

func trustedBuildRequest(t *testing.T) api.BuildRequest {
	t.Helper()
	root := t.TempDir()
	source := filepath.Join(root, "Example.java")
	if err := os.WriteFile(source, []byte("class Example {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	return api.BuildRequest{
		ProjectID:   "project-1",
		ProjectRoot: root,
		OutputDir:   filepath.Join(root, "build", "classes"),
		Files:       []string{source},
		TraceID:     "trace-test-1",
	}
}

func TestAsyncBuildEngineCancelIsIdempotentAndPersistsTerminalState(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	started := make(chan struct{})
	engine.compile = func(ctx context.Context, _ build.Request) (*build.Result, error) {
		close(started)
		<-ctx.Done()
		// Deliberately race cancellation with a nominal success result.
		// The engine must give cancellation precedence.
		return &build.Result{Success: true, ExitCode: 0}, nil
	}
	initial, err := engine.Start(trustedBuildRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("compiler did not start")
	}

	cancelled, err := engine.Cancel(context.Background(), initial.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.State != "cancelled" || cancelled.FinishedAt == "" {
		t.Fatalf("cancelled result = %+v", cancelled)
	}
	if cancelled.TraceID != "trace-test-1" {
		t.Fatalf("traceId = %q", cancelled.TraceID)
	}
	again, err := engine.Cancel(context.Background(), initial.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.State != "cancelled" || again.FinishedAt != cancelled.FinishedAt {
		t.Fatalf("second cancel changed terminal result: first=%+v second=%+v", cancelled, again)
	}
}

func TestAsyncBuildEngineDoesNotReportEmptyBuildAsSuccess(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	req := trustedBuildRequest(t)
	if err := os.Remove(req.Files[0]); err != nil {
		t.Fatal(err)
	}
	req.Files = nil
	if _, err := engine.Start(req); err == nil {
		t.Fatal("empty project must not produce a queued or successful build")
	}
	if len(engine.List()) != 0 {
		t.Fatalf("failed preflight must not create build history: %+v", engine.List())
	}
	if _, err := os.Stat(req.OutputDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("empty-source preflight mutated output directory: %v", err)
	}
}

func TestAsyncBuildEngineRejectsOutputOutsideProjectBeforeClean(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	req := trustedBuildRequest(t)
	outside := t.TempDir()
	marker := filepath.Join(outside, "keep.txt")
	if err := os.WriteFile(marker, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	req.OutputDir = outside
	req.Clean = true
	if _, err := engine.Start(req); err == nil {
		t.Fatal("outside output directory must be rejected")
	}
	if data, err := os.ReadFile(marker); err != nil || string(data) != "keep" {
		t.Fatalf("outside file was modified: data=%q err=%v", data, err)
	}
}

func TestAuthorizeAbsoluteWithinRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation requires privileges on some Windows hosts")
	}
	root := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(root, "escaped")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if _, err := authorizeAbsoluteWithin(root, filepath.Join(link, "classes")); err == nil {
		t.Fatal("symlink escape must be rejected")
	}
}

func TestCollectAuthorizedJavaSourcesSkipsGeneratedAndMetadataTrees(t *testing.T) {
	root := t.TempDir()
	keep := filepath.Join(root, "src", "Keep.java")
	if err := os.MkdirAll(filepath.Dir(keep), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keep, []byte("class Keep {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, excluded := range []string{".git", ".legacyflow", "node_modules", "target", filepath.Join("build", "classes")} {
		file := filepath.Join(root, excluded, "Ignore.java")
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("class Ignore {}"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	sources, err := collectAuthorizedJavaSources(root, filepath.Join(root, "build", "classes"))
	if err != nil {
		t.Fatal(err)
	}
	realKeep, err := filepath.EvalSymlinks(keep)
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 || sources[0] != realKeep {
		t.Fatalf("sources = %v, want only %s", sources, realKeep)
	}
}

func TestNormalizeBuildDiagnosticsUsesWorkspaceRelativePaths(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "src", "Example.java")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("class Example {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "Secret.java")
	diagnostics := normalizeBuildDiagnostics([]build.Diagnostic{{File: file}, {File: outside}}, root, "")
	if diagnostics[0].File != "src/Example.java" {
		t.Fatalf("relative diagnostic = %q", diagnostics[0].File)
	}
	if diagnostics[1].File != "" {
		t.Fatalf("outside diagnostic leaked absolute path: %q", diagnostics[1].File)
	}
}

func TestSanitizeBuildTextRedactsPathsSecretsAndBoundsBytes(t *testing.T) {
	root := `C:\Users\Alice\workspace`
	jdk := `C:\Java\jdk8`
	input := strings.Repeat("界", maxBuildOutputBytes) + " " + strings.ToUpper(root) + ` ` + jdk + ` token=tok_abc password=hunter2`
	got := sanitizeBuildText(input, root, jdk, maxBuildOutputBytes)
	if !utf8.ValidString(got) {
		t.Fatal("sanitized output is not valid UTF-8")
	}
	if !strings.Contains(got, "...[truncated]") {
		t.Fatal("oversized output was not truncated")
	}

	visible := sanitizeBuildText(strings.ToUpper(root)+` `+jdk+` token=tok_abc password=hunter2`, root, jdk, maxBuildOutputBytes)
	for _, secret := range []string{"ALICE", "tok_abc", "hunter2", "C:\\JAVA"} {
		if strings.Contains(strings.ToUpper(visible), strings.ToUpper(secret)) {
			t.Fatalf("sensitive value %q leaked in %q", secret, visible)
		}
	}
	if !strings.Contains(visible, "<workspace>") || !strings.Contains(visible, "<jdk>") || !strings.Contains(visible, "[REDACTED]") {
		t.Fatalf("placeholders missing: %q", visible)
	}
}

// TestBuild_CleanTarget 验证 Clean 构建目标
func TestBuild_CleanTarget(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	req := trustedBuildRequest(t)
	req.Clean = true
	req.OutputDir = filepath.Join(req.ProjectRoot, "build", "classes")

	// 先创建输出目录，验证 Clean 标志会清除它
	if err := os.MkdirAll(req.OutputDir, 0o755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(req.OutputDir, "old.class")
	if err := os.WriteFile(marker, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	engine.compile = func(ctx context.Context, _ build.Request) (*build.Result, error) {
		close(started)
		<-ctx.Done()
		return &build.Result{Success: true, ExitCode: 0}, nil
	}

	result, err := engine.Start(req)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
		// 验证 clean 后旧文件已被删除
		if _, err := os.Stat(marker); !os.IsNotExist(err) {
			t.Errorf("clean build should remove old files, but marker still exists: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("build did not start")
	}

	// 取消构建避免泄漏
	engine.Cancel(context.Background(), result.ID)
}

// TestBuild_Timeout 验证构建超时处理
func TestBuild_Timeout(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	started := make(chan struct{})
	engine.compile = func(ctx context.Context, _ build.Request) (*build.Result, error) {
		close(started)
		<-ctx.Done()
		return nil, context.DeadlineExceeded
	}

	result, err := engine.Start(trustedBuildRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("build did not start")
	}

	// 发送取消信号
	cancelled, err := engine.Cancel(context.Background(), result.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.State != "cancelled" {
		t.Errorf("state = %q, want cancelled", cancelled.State)
	}
}

// TestBuild_RejectsMissingProjectID 验证缺失 ProjectID 被拒绝
func TestBuild_RejectsMissingProjectID(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	req := trustedBuildRequest(t)
	req.ProjectID = ""
	_, err := engine.Start(req)
	if err == nil {
		t.Fatal("expected error for missing projectId")
	}
}

// TestBuild_RejectsMissingProjectRoot 验证缺失 ProjectRoot 被拒绝
func TestBuild_RejectsMissingProjectRoot(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	req := trustedBuildRequest(t)
	req.ProjectRoot = ""
	_, err := engine.Start(req)
	if err == nil {
		t.Fatal("expected error for missing project root")
	}
}

// TestBuild_RejectsMissingOutputDir 验证缺失 OutputDir 被拒绝
func TestBuild_RejectsMissingOutputDir(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	req := trustedBuildRequest(t)
	req.OutputDir = ""
	_, err := engine.Start(req)
	if err == nil {
		t.Fatal("expected error for missing output directory")
	}
}

// TestBuild_OutputDirCannotBeProjectRoot 验证输出目录不能是项目根目录
func TestBuild_OutputDirCannotBeProjectRoot(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	req := trustedBuildRequest(t)
	req.OutputDir = req.ProjectRoot
	_, err := engine.Start(req)
	if err == nil {
		t.Fatal("expected error when outputDir equals projectRoot")
	}
}

// TestBuild_GetNotFound 验证获取不存在的构建返回错误
func TestBuild_GetNotFound(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	_, err := engine.Get("nonexistent-id")
	if err == nil {
		t.Fatal("expected error for nonexistent build")
	}
}

// TestBuild_ListEmpty 验证空列表
func TestBuild_ListEmpty(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	items := engine.List()
	if len(items) != 0 {
		t.Errorf("len(List) = %d, want 0", len(items))
	}
}

// TestBuild_CancelNonExistent 验证取消不存在的构建返回错误
func TestBuild_CancelNonExistent(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	_, err := engine.Cancel(context.Background(), "nonexistent-id")
	if err == nil {
		t.Fatal("expected error for nonexistent build cancellation")
	}
}

// TestBuild_CompilerError 验证编译器错误被正确记录
func TestBuild_CompilerError(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	engine.compile = func(ctx context.Context, _ build.Request) (*build.Result, error) {
		return nil, errors.New("compilation failed: syntax error")
	}

	result, err := engine.Start(trustedBuildRequest(t))
	if err != nil {
		t.Fatal(err)
	}

	// 等待构建完成
	time.Sleep(200 * time.Millisecond)
	final, err := engine.Get(result.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.State != "failure" {
		t.Errorf("state = %q, want failure", final.State)
	}
	if final.Error == "" {
		t.Errorf("expected error message")
	}
}

// TestBuild_SuccessfulCompilation 验证成功编译
func TestBuild_SuccessfulCompilation(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	engine.compile = func(ctx context.Context, _ build.Request) (*build.Result, error) {
		return &build.Result{
			Success:       true,
			ExitCode:      0,
			FilesCompiled: 5,
			ElapsedMs:     100,
			Output:        "Build completed successfully",
		}, nil
	}

	result, err := engine.Start(trustedBuildRequest(t))
	if err != nil {
		t.Fatal(err)
	}

	// 等待构建完成
	time.Sleep(200 * time.Millisecond)
	final, err := engine.Get(result.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.State != "success" {
		t.Errorf("state = %q, want success", final.State)
	}
	if final.FilesCompiled != 5 {
		t.Errorf("FilesCompiled = %d, want 5", final.FilesCompiled)
	}
	if final.ElapsedMs != 100 {
		t.Errorf("ElapsedMs = %d, want 100", final.ElapsedMs)
	}
}

// TestBuild_PersistAndLoadFinished 验证构建结果持久化
// TestEvalSymlinksNearestBuildPath verifies symlink resolution for
// paths that may or may not exist.
func TestEvalSymlinksNearestBuildPath(t *testing.T) {
	// Test with a real directory that exists
	dir := t.TempDir()
	resolved, err := evalSymlinksNearestBuildPath(dir)
	if err != nil {
		t.Fatalf("evalSymlinksNearestBuildPath on real dir: %v", err)
	}
	if resolved != dir {
		t.Errorf("resolved = %q, want %q", resolved, dir)
	}

	// Test with a path that doesn't exist but has a real parent
	nonexistent := filepath.Join(dir, "nonexistent", "sub", "file.java")
	resolved, err = evalSymlinksNearestBuildPath(nonexistent)
	if err != nil {
		t.Fatalf("evalSymlinksNearestBuildPath on nonexistent child: %v", err)
	}
	if resolved != filepath.Clean(nonexistent) {
		t.Errorf("resolved = %q, want %q", resolved, filepath.Clean(nonexistent))
	}
}

// TestAuthorizeAbsoluteWithin_EdgeCases verifies additional edge cases.
func TestAuthorizeAbsoluteWithin_EdgeCases(t *testing.T) {
	root := t.TempDir()
	// Test with a valid path within root
	valid := filepath.Join(root, "src", "Main.java")
	if err := os.MkdirAll(filepath.Dir(valid), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(valid, []byte("class Main{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	resolved, err := authorizeAbsoluteWithin(root, valid)
	if err != nil {
		t.Fatalf("authorizeAbsoluteWithin valid path: %v", err)
	}
	if resolved != valid {
		t.Errorf("resolved = %q, want %q", resolved, valid)
	}
}

// TestValidateTrustedBuildRequest_SourceFileEdgeCases verifies source file validation.
func TestValidateTrustedBuildRequest_SourceFileEdgeCases(t *testing.T) {
	root := t.TempDir()

	// Test with non-existent source file
	req := &api.BuildRequest{
		ProjectID:   "test",
		ProjectRoot: root,
		OutputDir:   filepath.Join(root, "build"),
		Files:       []string{filepath.Join(root, "DoesNotExist.java")},
	}
	err := validateTrustedBuildRequest(req)
	if err == nil {
		t.Fatal("expected error for non-existent source file")
	}

	// Test with non-.java file
	readme := filepath.Join(root, "README.txt")
	if err := os.WriteFile(readme, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	req.Files = []string{readme}
	err = validateTrustedBuildRequest(req)
	if err == nil {
		t.Fatal("expected error for non-.java file")
	}

	// Test with classpath entry outside root
	req.Files = nil
	req.Classpath = []string{t.TempDir()}
	err = validateTrustedBuildRequest(req)
	if err == nil {
		t.Fatal("expected error for classpath outside root")
	}
}

// TestSanitizeBuildText_EmptyValues verifies empty project/toolchain.
func TestSanitizeBuildText_EmptyValues(t *testing.T) {
	got := sanitizeBuildText("hello world", "", "", 100)
	if got != "hello world" {
		t.Errorf("sanitizeBuildText with empty values = %q, want hello world", got)
	}
}

// TestSanitizeBuildText_NoTruncation verifies no truncation when under limit.
func TestSanitizeBuildText_NoTruncation(t *testing.T) {
	got := sanitizeBuildText("short text", "/root", "/jdk", 100)
	if strings.Contains(got, "[truncated]") {
		t.Error("short text should not be truncated")
	}
}

// TestSanitizeBuildText_ZeroMaxBytes verifies zero maxBytes means no truncation.
func TestSanitizeBuildText_ZeroMaxBytes(t *testing.T) {
	got := sanitizeBuildText("hello", "/root", "/jdk", 0)
	if got != "hello" {
		t.Errorf("sanitizeBuildText with 0 maxBytes = %q, want hello", got)
	}
}

// TestCloneBuildResult_Nil verifies nil handling.
func TestCloneBuildResult_Nil(t *testing.T) {
	if cloneBuildResult(nil) != nil {
		t.Error("cloneBuildResult(nil) should return nil")
	}
}

// TestAsyncBuildEngine_CancelAlreadyCancelled verifies cancellation of a
// build that is already in terminal state.
func TestAsyncBuildEngine_CancelAlreadyCancelled(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	engine.compile = func(ctx context.Context, _ build.Request) (*build.Result, error) {
		return nil, context.Canceled
	}
	result, err := engine.Start(trustedBuildRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	// Cancel again should return the same result
	again, err := engine.Cancel(context.Background(), result.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.State != "cancelled" {
		t.Errorf("state = %q, want cancelled", again.State)
	}
}

// TestAsyncBuildEngine_Cancel_ContextDone verifies that a cancelled context
// passed to Cancel returns immediately.
func TestAsyncBuildEngine_Cancel_ContextDone(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	engine.compile = func(ctx context.Context, _ build.Request) (*build.Result, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	result, err := engine.Start(trustedBuildRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = engine.Cancel(ctx, result.ID)
	if err == nil {
		// Clean up the running goroutine before failing.
		engine.Cancel(context.Background(), result.ID)
		t.Fatal("expected error for cancelled context")
	}
	// Properly cancel the running build so the goroutine exits
	// before TempDir cleanup on Windows.
	engine.Cancel(context.Background(), result.ID)
}

// TestBuildRequest_WithToolchain looks up toolchain.
func TestBuildRequest_WithToolchain(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	req := trustedBuildRequest(t)
	req.Toolchain = "nonexistent-toolchain"
	_, err := engine.Start(req)
	if err == nil {
		t.Fatal("expected error for nonexistent toolchain")
	}
}

func TestBuild_PersistAndLoadFinished(t *testing.T) {
	engine := newTestAsyncBuildEngine(t)
	engine.compile = func(ctx context.Context, _ build.Request) (*build.Result, error) {
		return &build.Result{Success: true, ExitCode: 0}, nil
	}

	result, err := engine.Start(trustedBuildRequest(t))
	if err != nil {
		t.Fatal(err)
	}

	// 等待构建完成
	time.Sleep(200 * time.Millisecond)

	// 模拟重载
	engine.loadFinished()
	reloaded, err := engine.Get(result.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.State != "success" {
		t.Errorf("state after reload = %q, want success", reloaded.State)
	}
}
