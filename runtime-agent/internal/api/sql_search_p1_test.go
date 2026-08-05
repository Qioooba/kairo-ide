package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
	"github.com/gorilla/websocket"
)

func TestSQLExecute_NotImplemented(t *testing.T) {
	srv := newTestServer(t, nil)
	body := mustEnvelope(t, map[string]any{
		"connectionId": "conn-1",
		"sql":          "SELECT 1 FROM DUAL",
	})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/execute", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
	var resp protocol.ErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.OK {
		t.Fatal("expected OK=false")
	}
	if resp.Error.Code != protocol.ErrNotFound {
		t.Fatalf("code = %q, want not_found", resp.Error.Code)
	}
	// Ensure single envelope (no nested ResponseEnvelope as payload).
	if strings.Contains(rr.Body.String(), `"payload":{"requestId"`) {
		t.Fatal("response appears double-enveloped")
	}
}

func TestSQLExecute_RegisteredConnectionInstantClient(t *testing.T) {
	srv := newTestServer(t, nil)

	// Register via test-connection (stub always fails Instant Client, but returns connectionId).
	testBody := mustEnvelope(t, map[string]any{
		"host":           "localhost",
		"port":           1521,
		"sid":            "orcl",
		"useServiceName": false,
		"username":       "scott",
		"password":       "tiger",
	})
	testRR := httptest.NewRecorder()
	testReq := httptest.NewRequest(http.MethodPost, "/api/v1/sql/test-connection", bytes.NewReader(testBody))
	testReq.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(testRR, testReq)
	if testRR.Code != http.StatusNotImplemented {
		t.Fatalf("test-connection status = %d, want 501, body=%s", testRR.Code, testRR.Body.String())
	}
	var testResp protocol.ErrorResponse
	if err := json.NewDecoder(testRR.Body).Decode(&testResp); err != nil {
		t.Fatalf("decode test-connection: %v", err)
	}
	details, _ := testResp.Error.Details.(map[string]any)
	if details == nil {
		// Details may decode as map via json.RawMessage path — re-marshal.
		raw, _ := json.Marshal(testResp.Error.Details)
		_ = json.Unmarshal(raw, &details)
	}
	connID, _ := details["connectionId"].(string)
	if connID == "" {
		t.Fatalf("expected connectionId in error details, got %+v", testResp.Error.Details)
	}

	execBody := mustEnvelope(t, map[string]any{
		"connectionId": connID,
		"sql":          "SELECT 1 FROM DUAL",
	})
	execRR := httptest.NewRecorder()
	execReq := httptest.NewRequest(http.MethodPost, "/api/v1/sql/execute", bytes.NewReader(execBody))
	execReq.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(execRR, execReq)
	if execRR.Code != http.StatusNotImplemented {
		t.Fatalf("execute status = %d, want 501, body=%s", execRR.Code, execRR.Body.String())
	}
	var execResp protocol.ErrorResponse
	if err := json.NewDecoder(execRR.Body).Decode(&execResp); err != nil {
		t.Fatalf("decode execute: %v", err)
	}
	if execResp.Error.Code != protocol.ErrUnsupported {
		t.Fatalf("code = %q, want unsupported", execResp.Error.Code)
	}
	if !strings.Contains(execResp.Error.Message, "Instant Client") {
		t.Fatalf("message = %q, want Instant Client hint", execResp.Error.Message)
	}
}

func TestHandleSearchStream_SandboxForbidden(t *testing.T) {
	wsRoot := t.TempDir()
	sandbox, err := security.NewWorkspaceRoots(wsRoot)
	if err != nil {
		t.Fatalf("sandbox: %v", err)
	}
	outside := t.TempDir()
	if filepath.Clean(outside) == filepath.Clean(wsRoot) {
		t.Fatal("temp dirs collided")
	}

	logger := log.New("test").WithLevel(log.LevelWarn)
	srv := NewServer(&Services{Sandbox: sandbox}, logger, nil, "test", "")

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		srv.handleSearchStream(w, r)
	}))
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http")
	hdr := http.Header{}
	hdr.Set("Origin", "http://127.0.0.1")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, hdr)
	if err != nil {
		t.Fatalf("WebSocket dial failed: %v", err)
	}
	defer conn.Close()

	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	payload, _ := json.Marshal(map[string]any{
		"rootPath": outside,
		"query":    "foo",
	})
	if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
		t.Fatalf("WriteMessage: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	var ev protocol.SearchStreamEvent
	if err := json.Unmarshal(msg, &ev); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if ev.Error == "" {
		t.Fatal("expected sandbox error for outside rootPath")
	}
	if !strings.Contains(ev.Error, "outside") && !strings.Contains(ev.Error, "path") {
		t.Fatalf("unexpected error: %q", ev.Error)
	}
}
