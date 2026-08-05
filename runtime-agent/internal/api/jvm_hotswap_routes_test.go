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
