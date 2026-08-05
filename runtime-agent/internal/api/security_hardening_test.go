package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
)

func newSandboxServer(t *testing.T, roots ...string) *Server {
	t.Helper()
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	sandbox, err := security.NewWorkspaceRoots(roots...)
	if err != nil {
		t.Fatalf("NewWorkspaceRoots: %v", err)
	}
	return NewServer(&Services{Sandbox: sandbox}, logger, auditLog, "test-0.1.0", "")
}

func TestAuthorizeAbsPath_RejectsWhenNoRoots(t *testing.T) {
	srv := newSandboxServer(t)
	dir := t.TempDir()
	body := mustEnvelope(t, map[string]any{"rootPath": dir, "task": "compile"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/run", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 when sandbox has no roots, body=%s", rr.Code, rr.Body.String())
	}
}

func TestAuthorizeAbsPath_RejectsOutsideRoot(t *testing.T) {
	inside := t.TempDir()
	outside := t.TempDir()
	srv := newSandboxServer(t, inside)

	body := mustEnvelope(t, map[string]any{"rootPath": outside, "task": "compile"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/run", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for outside rootPath, body=%s", rr.Code, rr.Body.String())
	}
}

func TestMavenRun_RejectsNonWhitelistedTask(t *testing.T) {
	dir := t.TempDir()
	srv := newSandboxServer(t, dir)
	body := mustEnvelope(t, map[string]any{"rootPath": dir, "task": "exec:exec"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/run", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for non-whitelisted task, body=%s", rr.Code, rr.Body.String())
	}
}

func TestBuildPost_IdempotentReplay(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })

	dir := t.TempDir()
	sandbox, err := security.NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatalf("NewWorkspaceRoots: %v", err)
	}
	proj := domainProjectFixture(dir)
	srv := NewServer(&Services{
		Sandbox:      sandbox,
		ProjectStore: &fakeProjectStore{saved: proj},
		BuildEngine:  &hardeningFakeBuildEngine{},
	}, logger, auditLog, "test-0.1.0", "")

	reqID := "idempotent-build-req-1"
	body := mustEnvelopeWithRequestID(t, reqID, map[string]any{"projectId": string(proj.ID)})
	rr1 := httptest.NewRecorder()
	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader(body))
	req1.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Fatalf("first build status = %d, body=%s", rr1.Code, rr1.Body.String())
	}

	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("replay build status = %d, body=%s", rr2.Code, rr2.Body.String())
	}
	if rr2.Header().Get("X-Kairo-Idempotent-Replay") != "1" {
		t.Fatalf("expected idempotent replay header, got %q", rr2.Header().Get("X-Kairo-Idempotent-Replay"))
	}
	if rr1.Body.String() != rr2.Body.String() {
		t.Fatalf("replay body differs from first response")
	}
}

func TestWorkspacesPost_RejectsNonDirectory(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	ws := &fakeWorkspaceStore{}
	srv := NewServer(&Services{WorkspaceStore: ws}, logger, auditLog, "test-0.1.0", "")

	file := filepath.Join(t.TempDir(), "not-a-dir.txt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	body := mustEnvelope(t, map[string]any{"rootPath": file, "name": "Bad"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for non-directory root, body=%s", rr.Code, rr.Body.String())
	}
}

func mustEnvelopeWithRequestID(t *testing.T, requestID string, payload map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"requestId": requestID,
		"payload":   payload,
	})
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	return raw
}

type hardeningFakeBuildEngine struct{}

func (f *hardeningFakeBuildEngine) Start(_ BuildRequest) (*BuildResult, error) {
	return &BuildResult{ID: "build-test-1", ProjectID: "proj-test-1", State: "success"}, nil
}

func (f *hardeningFakeBuildEngine) Get(_ string) (*BuildResult, error) {
	return nil, ErrBuildNotFound
}

func (f *hardeningFakeBuildEngine) List() []*BuildResult {
	return nil
}

func (f *hardeningFakeBuildEngine) Cancel(_ context.Context, _ string) (*BuildResult, error) {
	return nil, ErrBuildNotFound
}

func domainProjectFixture(root string) domain.Project {
	return domain.Project{
		ID:          domain.ProjectID("proj-test-1"),
		WorkspaceID: domain.WorkspaceID("ws-1"),
		Name:        "fixture",
		RootPath:    root,
		OutputDir:   "build/classes",
		WebappDir:   "WebRoot",
		BuildTool:   domain.BuildToolAnt,
	}
}
