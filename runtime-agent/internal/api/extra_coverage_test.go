package api

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

func TestPublishJDKProgress_NoEventBus(t *testing.T) {
	srv := newTestServer(t, nil)
	// Services nil -> no panic.
	srv.Services = nil
	srv.publishJDKProgress("ws_1", 10, "msg")
	// EventBus present but not an adapter -> no panic.
	srv.Services = &Services{EventBus: nil}
	srv.publishJDKProgress("ws_1", 10, "msg")
}

func TestPublishJDKProgress_WithEventHub(t *testing.T) {
	hub := events.NewEventHub(0, 0)
	adapter := &events.EventBusAdapter{Hub: hub}
	srv := newTestServer(t, nil)
	srv.Services = &Services{EventBus: adapter}

	ch, unsubscribe := hub.Subscribe("ws_1", "test-sub", 0)
	defer unsubscribe()

	srv.publishJDKProgress("ws_1", 42, "downloading...")

	select {
	case ev := <-ch:
		if ev.Type != "jdk.download.progress" {
			t.Errorf("event type = %s", ev.Type)
		}
		if ev.WorkspaceID != "ws_1" {
			t.Errorf("workspaceId = %s", ev.WorkspaceID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected progress event on the hub")
	}
}

func TestListenAndServe_AndShutdown(t *testing.T) {
	srv := newTestServer(t, nil)

	// Grab a free port.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()

	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.ListenAndServe("127.0.0.1:"+itoa(port), "", "")
	}()

	// Wait for the server to come up.
	var resp *http.Response
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err = http.Get("http://127.0.0.1:" + itoa(port) + "/api/v1/health")
		if err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("GET /api/v1/health failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		t.Errorf("Shutdown failed: %v", err)
	}
	select {
	case <-errCh:
	case <-time.After(3 * time.Second):
		t.Error("ListenAndServe did not return after Shutdown")
	}
}

func TestHandleCompileIncremental_ProjectNotFound(t *testing.T) {
	store := &fakeProjectStore{saved: domain.Project{ID: "other"}}
	svcs := &Services{ProjectStore: store}
	srv := newTestServerWithServices(t, svcs)

	payload := map[string]any{"projectId": "missing"}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/compile-incremental", bytes.NewReader(envelopeBody(t, payload)))
	srv.Handler().ServeHTTP(rr, req)
	_, e := decodeErr(t, rr.Body.Bytes())
	if e.Code != protocol.ErrNotFound {
		t.Errorf("error code = %s, want not_found", e.Code)
	}
}

func TestHandlePortDiagnostics_Validation(t *testing.T) {
	srv := newTestServer(t, nil)

	t.Run("wrong method", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/diagnostics/port?port=8080", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("missing port", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/diagnostics/port", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("non numeric port", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/diagnostics/port?port=abc", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("free port", func(t *testing.T) {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := l.Addr().(*net.TCPAddr).Port
		// Reserve the port so the diagnostic reports occupied.
		defer l.Close()
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/diagnostics/port?port="+itoa(port), nil)
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, body=%s", rr.Code, rr.Body.String())
		}
		_, p := decodeOK(t, rr.Body.Bytes())
		if p["port"] == nil {
			t.Errorf("expected port in payload, got %v", p)
		}
	})
}

func TestDiagnosePort_InvalidPorts(t *testing.T) {
	for _, port := range []int{0, -1, 65536, 99999} {
		d := diagnosePort(port)
		if d.Suggestion == "" {
			t.Errorf("diagnosePort(%d) expected suggestion for invalid port", port)
		}
	}
}

func TestGetProcessName_ZeroPid(t *testing.T) {
	if got := getProcessName(0); got != "" {
		t.Errorf("getProcessName(0) = %q, want empty", got)
	}
}

func TestHandleWorkspaces_PostSuccess(t *testing.T) {
	wsStore := &fakeWorkspaceStore{}
	svcs := &Services{WorkspaceStore: wsStore}
	srv := newTestServerWithServices(t, svcs)

	body := `{"payload":{"name":"demo","root":"` + filepath.ToSlash(t.TempDir()) + `"}}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(body))
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rr.Code, rr.Body.String())
	}
	_, p := decodeOK(t, rr.Body.Bytes())
	if p["id"] == nil || p["name"] != "demo" {
		t.Errorf("unexpected payload: %v", p)
	}
	if len(wsStore.workspaces) != 1 {
		t.Errorf("expected 1 workspace saved, got %d", len(wsStore.workspaces))
	}
}

func TestHandleWorkspaces_MissingFields(t *testing.T) {
	srv := newTestServerWithServices(t, &Services{WorkspaceStore: &fakeWorkspaceStore{}})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"payload":{}}`))
	srv.Handler().ServeHTTP(rr, req)
	_, e := decodeErr(t, rr.Body.Bytes())
	if e.Code != protocol.ErrInvalidRequest {
		t.Errorf("error code = %s, want invalid_request", e.Code)
	}
}

func itoa(n int) string {
	return strconv.Itoa(n)
}
