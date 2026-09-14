package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

func TestHandleJDTLSDistribution(t *testing.T) {
	t.Run("wrong method", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtls/distribution", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("ok", func(t *testing.T) {
		srv := newTestServer(t, &fakeJDTLS{state: "stopped", version: "1.55.0"})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls/distribution", nil)
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
		_, payload := decodeOK(t, rr.Body.Bytes())
		if payload["installed"] != true {
			t.Errorf("installed = %v", payload["installed"])
		}
		if payload["version"] != "1.55.0" {
			t.Errorf("version = %v", payload["version"])
		}
	})
}

func TestHandleJvmCompile(t *testing.T) {
	t.Run("wrong method", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/jvm/compile", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("missing file", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/compile", bytes.NewReader(envelopeBody(t, map[string]any{})))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("project store not configured", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/compile", bytes.NewReader(envelopeBody(t, map[string]any{
			"file": "Foo.java",
		})))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInternal {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("no matching project", func(t *testing.T) {
		root := t.TempDir()
		store := &fakeProjectStore{saved: domain.Project{
			ID:        "p1",
			RootPath:  root,
			OutputDir: "out",
		}}
		srv := newTestServerWithServices(t, &Services{ProjectStore: store})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/compile", bytes.NewReader(envelopeBody(t, map[string]any{
			"file": filepath.Join(t.TempDir(), "Outside.java"),
		})))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrNotFound {
			t.Errorf("error code = %s message=%s", e.Code, e.Message)
		}
	})
}

func TestHandleJvmRedefine(t *testing.T) {
	t.Run("wrong method", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/jvm/redefine", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("missing sourcePath", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/redefine", bytes.NewReader(envelopeBody(t, map[string]any{})))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("missing classPath", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/redefine", bytes.NewReader(envelopeBody(t, map[string]any{
			"sourcePath": "src/Foo.java",
		})))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("no jdwp port returns unsupported", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/redefine", bytes.NewReader(envelopeBody(t, map[string]any{
			"sourcePath": "src/Foo.java",
			"classPath":  "out",
			"projectId":  "p1",
		})))
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != http.StatusNotImplemented {
			t.Fatalf("status = %d want 501 body=%s", rr.Code, rr.Body.String())
		}
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrUnsupported {
			t.Errorf("error code = %s", e.Code)
		}
		if e.Message == "" {
			t.Error("expected non-empty error message")
		}
	})
}

func TestFindProjectContainingFile(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	javaFile := filepath.Join(nested, "Foo.java")
	if err := os.WriteFile(javaFile, []byte("class Foo {}"), 0o644); err != nil {
		t.Fatal(err)
	}

	store := &listProjectStore{projects: []domain.Project{
		{ID: "outer", RootPath: root, OutputDir: "out"},
		{ID: "inner", RootPath: nested, OutputDir: "out"},
	}}
	p, err := findProjectContainingFile(store, javaFile)
	if err != nil {
		t.Fatal(err)
	}
	if p.ID != "inner" {
		t.Errorf("got project %s, want inner (longest prefix)", p.ID)
	}
}

type listProjectStore struct {
	projects []domain.Project
}

func (s *listProjectStore) List() []domain.Project { return s.projects }
func (s *listProjectStore) Get(id string) (domain.Project, error) {
	for _, p := range s.projects {
		if string(p.ID) == id {
			return p, nil
		}
	}
	return domain.Project{}, os.ErrNotExist
}
func (s *listProjectStore) Update(id string, cfg *domain.Project) (domain.Project, error) {
	return domain.Project{}, os.ErrNotExist
}
func (s *listProjectStore) Delete(id string) error { return os.ErrNotExist }

// PR02 (F02 / T05): File URI resolution in findProjectContainingFile
func TestFindProjectContainingFile_FileURI(t *testing.T) {
	root := t.TempDir()
	javaFile := filepath.Join(root, "src", "Main.java")
	if err := os.MkdirAll(filepath.Dir(javaFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(javaFile, []byte("class Main {}"), 0o644); err != nil {
		t.Fatal(err)
	}

	store := &listProjectStore{projects: []domain.Project{
		{ID: "my-project", RootPath: root, OutputDir: "out"},
	}}

	// Construct file:/// URI from javaFile
	fileURI := "file:///" + filepath.ToSlash(javaFile)
	p, err := findProjectContainingFile(store, fileURI)
	if err != nil {
		t.Fatalf("findProjectContainingFile with file URI failed: %v", err)
	}
	if p.ID != "my-project" {
		t.Errorf("got project %s, want my-project", p.ID)
	}
}

// PR02 (F21 / T06): Sibling directory must not match (startsWith bug fixed)
func TestFindProjectContainingFile_SiblingNoMatch(t *testing.T) {
	tmp := t.TempDir()
	repo := filepath.Join(tmp, "repo")
	repoOther := filepath.Join(tmp, "repo-other")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(repoOther, 0o755); err != nil {
		t.Fatal(err)
	}
	siblingFile := filepath.Join(repoOther, "Foo.java")
	if err := os.WriteFile(siblingFile, []byte("class Foo {}"), 0o644); err != nil {
		t.Fatal(err)
	}

	store := &listProjectStore{projects: []domain.Project{
		{ID: "repo-project", RootPath: repo, OutputDir: "out"},
	}}

	_, err := findProjectContainingFile(store, siblingFile)
	if err == nil {
		t.Fatalf("expected error matching sibling directory %q, but it matched!", siblingFile)
	}
}

// PR02 (F02 / T05): handleJvmCompile with sourceUri and invalid schemes
func TestHandleJvmCompile_URIAndSchemes(t *testing.T) {
	root := t.TempDir()
	javaFile := filepath.Join(root, "Hello.java")
	if err := os.WriteFile(javaFile, []byte("class Hello {}"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := &listProjectStore{projects: []domain.Project{
		{ID: "p1", RootPath: root, OutputDir: "out"},
	}}
	srv := newTestServerWithServices(t, &Services{ProjectStore: store})

	t.Run("sourceUri parameter supported", func(t *testing.T) {
		rr := httptest.NewRecorder()
		fileURI := "file:///" + filepath.ToSlash(javaFile)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/compile", bytes.NewReader(envelopeBody(t, map[string]any{
			"sourceUri": fileURI,
		})))
		srv.Handler().ServeHTTP(rr, req)
		// Should reach project hydration / build without failing URI parsing
		if rr.Code == http.StatusBadRequest {
			t.Fatalf("unexpected bad request: %s", rr.Body.String())
		}
	})

	t.Run("non-file URI rejected", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/compile", bytes.NewReader(envelopeBody(t, map[string]any{
			"file": "http://malicious.com/Evil.java",
		})))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("expected invalid request for http scheme, got: %s", e.Code)
		}
	})
}

// mockTargetServerRunner implements ServerRunner for target binding tests.
type mockTargetServerRunner struct {
	servers []*ServerResponse
}

func (m *mockTargetServerRunner) CatalinaHome() string { return "/fake/catalina" }
func (m *mockTargetServerRunner) Start(req StartServerRequest) (*ServerResponse, error) { return nil, nil }
func (m *mockTargetServerRunner) Get(id string) (*ServerResponse, error) {
	for _, s := range m.servers {
		if s.ID == id {
			return s, nil
		}
	}
	return nil, os.ErrNotExist
}
func (m *mockTargetServerRunner) Stop(id string, force bool) (*ServerResponse, error) { return nil, nil }
func (m *mockTargetServerRunner) Restart(id string) (*ServerResponse, error) { return nil, nil }
func (m *mockTargetServerRunner) Debug(id string) (*ServerResponse, error) { return nil, nil }
func (m *mockTargetServerRunner) Logs(id string, tail int) ([]ServerLogEntry, error) { return nil, nil }
func (m *mockTargetServerRunner) List() []*ServerResponse { return m.servers }
func (m *mockTargetServerRunner) Recoverable() []*ServerResponse { return nil }
func (m *mockTargetServerRunner) Recover(id string) (*ServerResponse, error) { return nil, nil }
func (m *mockTargetServerRunner) ReloadContext(id string) error { return nil }

// PR03 (F03 / T09, T10, T11): Debug Target Precise Binding tests
func TestHandleJvmRedefine_TargetBinding_T09_T10_T11(t *testing.T) {
	srvA := &ServerResponse{
		ID:                "srv_A",
		ProjectID:         "proj-A",
		State:             "running",
		Ports:             &ServerPorts{HTTP: 8080, Debug: 5005},
		RuntimeInstanceID: "srv_A_gen1_100",
		Generation:        1,
	}
	srvB := &ServerResponse{
		ID:                "srv_B",
		ProjectID:         "proj-B",
		State:             "running",
		Ports:             &ServerPorts{HTTP: 8081, Debug: 5006},
		RuntimeInstanceID: "srv_B_gen1_200",
		Generation:        1,
	}

	t.Run("T10: Missing target rejects - no blind fallback to first running server", func(t *testing.T) {
		runner := &mockTargetServerRunner{servers: []*ServerResponse{srvA, srvB}}
		srv := newTestServerWithServices(t, &Services{ServerRunner: runner})

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/redefine", bytes.NewReader(envelopeBody(t, map[string]any{
			"sourcePath": "src/Foo.java",
			"classPath":  "out",
		})))
		srv.Handler().ServeHTTP(rr, req)

		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrTargetNotFound && e.Code != protocol.ErrInvalidRequest {
			t.Fatalf("expected target_not_found or invalid_request when no target specified, got code=%s msg=%s", e.Code, e.Message)
		}
	})

	t.Run("T10: Target not found for unknown project", func(t *testing.T) {
		runner := &mockTargetServerRunner{servers: []*ServerResponse{srvA, srvB}}
		srv := newTestServerWithServices(t, &Services{ServerRunner: runner})

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/redefine", bytes.NewReader(envelopeBody(t, map[string]any{
			"sourcePath": "src/Foo.java",
			"classPath":  "out",
			"projectId":  "proj-unknown",
		})))
		srv.Handler().ServeHTTP(rr, req)

		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrTargetNotFound {
			t.Fatalf("expected target_not_found for unknown project, got code=%s msg=%s", e.Code, e.Message)
		}
	})

	t.Run("T10: Ambiguous target when multiple servers run for same project without serverId", func(t *testing.T) {
		srvA2 := &ServerResponse{
			ID:                "srv_A2",
			ProjectID:         "proj-A",
			State:             "debugging",
			Ports:             &ServerPorts{HTTP: 8082, Debug: 5007},
			RuntimeInstanceID: "srv_A2_gen1_300",
			Generation:        1,
		}
		runner := &mockTargetServerRunner{servers: []*ServerResponse{srvA, srvA2}}
		srv := newTestServerWithServices(t, &Services{ServerRunner: runner})

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/redefine", bytes.NewReader(envelopeBody(t, map[string]any{
			"sourcePath": "src/Foo.java",
			"classPath":  "out",
			"projectId":  "proj-A",
		})))
		srv.Handler().ServeHTTP(rr, req)

		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrTargetAmbiguous {
			t.Fatalf("expected target_ambiguous when multiple servers run for project, got code=%s msg=%s", e.Code, e.Message)
		}
	})

	t.Run("T09: Save B targets B only regardless of server list ordering", func(t *testing.T) {
		// Server A is first in list, but request binds to proj-B
		runnerAB := &mockTargetServerRunner{servers: []*ServerResponse{srvA, srvB}}
		srvAB := newTestServerWithServices(t, &Services{ServerRunner: runnerAB})

		targetB, errB := srvAB.resolveTargetEndpoint(&protocol.DebugTargetBinding{
			ProjectID: "proj-B",
		}, "proj-B", "", "src/Foo.java")
		if errB != nil {
			t.Fatalf("resolveTargetEndpoint error: %v", errB)
		}
		if targetB != 5006 {
			t.Fatalf("expected target port 5006 for proj-B, got %d", targetB)
		}

		// Swap order: Server B is first in list, request binds to proj-A
		runnerBA := &mockTargetServerRunner{servers: []*ServerResponse{srvB, srvA}}
		srvBA := newTestServerWithServices(t, &Services{ServerRunner: runnerBA})

		targetA, errA := srvBA.resolveTargetEndpoint(&protocol.DebugTargetBinding{
			ProjectID: "proj-A",
		}, "proj-A", "", "src/Foo.java")
		if errA != nil {
			t.Fatalf("resolveTargetEndpoint error: %v", errA)
		}
		if targetA != 5005 {
			t.Fatalf("expected target port 5005 for proj-A, got %d", targetA)
		}
	})

	t.Run("T11: Stale generation or instance mismatch rejected", func(t *testing.T) {
		restartedB := &ServerResponse{
			ID:                "srv_B",
			ProjectID:         "proj-B",
			State:             "running",
			Ports:             &ServerPorts{HTTP: 8081, Debug: 5006},
			RuntimeInstanceID: "srv_B_gen2_restarted",
			Generation:        2,
		}
		runner := &mockTargetServerRunner{servers: []*ServerResponse{restartedB}}
		srv := newTestServerWithServices(t, &Services{ServerRunner: runner})

		// 1. Generation mismatch
		_, errGen := srv.resolveTargetEndpoint(&protocol.DebugTargetBinding{
			ProjectID:            "proj-B",
			ServerID:             "srv_B",
			DeploymentGeneration: 1, // old generation!
		}, "proj-B", "srv_B", "")
		if errGen == nil || errGen.Code != protocol.ErrStaleTarget {
			t.Fatalf("expected stale_target error for generation mismatch, got %v", errGen)
		}

		// 2. Instance ID mismatch
		_, errInst := srv.resolveTargetEndpoint(&protocol.DebugTargetBinding{
			ProjectID:         "proj-B",
			ServerID:          "srv_B",
			RuntimeInstanceID: "srv_B_gen1_old", // old instance!
		}, "proj-B", "srv_B", "")
		if errInst == nil || errInst.Code != protocol.ErrStaleTarget {
			t.Fatalf("expected stale_target error for instance mismatch, got %v", errInst)
		}
	})

	t.Run("SSRF non-loopback host rejected", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/redefine", bytes.NewReader(envelopeBody(t, map[string]any{
			"sourcePath": "Test.java",
			"classPath":  t.TempDir(),
			"jdwpHost":   "192.168.1.100",
		})))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Fatalf("expected invalid_request error for non-loopback host, got %s", e.Code)
		}
	})

	t.Run("Explicit port without target rejected", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/redefine", bytes.NewReader(envelopeBody(t, map[string]any{
			"sourcePath": "Test.java",
			"classPath":  t.TempDir(),
			"jdwpPort":   9000,
		})))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrTargetNotFound {
			t.Fatalf("expected target_not_found error for explicit port without target, got %s", e.Code)
		}
	})
}

