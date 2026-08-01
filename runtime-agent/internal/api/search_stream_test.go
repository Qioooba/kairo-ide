package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestHandleSearchStream_FullFlow dials the WebSocket, sends a search
// request, and expects a searchStream event with Done=true.
func TestHandleSearchStream_FullFlow(t *testing.T) {
	srv := newTestServer(t, nil)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/search/stream"
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "sample.txt"), []byte("hello kairo world\n"), 0644)

	req := map[string]any{
		"rootPath": root,
		"query":    "kairo",
	}
	if err := conn.WriteJSON(req); err != nil {
		t.Fatalf("write request failed: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	_ = conn.SetReadDeadline(deadline)
	for {
		var ev struct {
			Kind string `json:"kind"`
			Done bool   `json:"done"`
		}
		if err := conn.ReadJSON(&ev); err != nil {
			t.Fatalf("read event failed: %v", err)
		}
		if ev.Kind != "searchStream" {
			t.Errorf("kind = %q, want searchStream", ev.Kind)
		}
		if ev.Done {
			break
		}
	}
}

// TestHandleSearchStream_MissingRoot sends a request without rootPath.
func TestHandleSearchStream_MissingRoot(t *testing.T) {
	srv := newTestServer(t, nil)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/search/stream"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{"query": "x"}); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	_ = conn.SetReadDeadline(deadline)
	var ev map[string]any
	if err := conn.ReadJSON(&ev); err != nil {
		t.Fatalf("read event failed: %v", err)
	}
	if msg, _ := ev["error"].(string); !strings.Contains(msg, "rootPath") {
		t.Errorf("expected rootPath error, got: %v", ev["error"])
	}
}

var _ = json.Marshal
