//go:build remote

package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// TestNewAgentProxy tests proxy creation and validation.
func TestNewAgentProxy(t *testing.T) {
	tests := []struct {
		name    string
		cfg     ProxyConfig
		wantErr bool
	}{
		{
			name: "valid config",
			cfg: ProxyConfig{
				RemoteAddr:   "localhost:9443",
				SessionToken: "test-token",
			},
			wantErr: false,
		},
		{
			name: "empty remote addr",
			cfg: ProxyConfig{
				RemoteAddr: "",
			},
			wantErr: true,
		},
		{
			name: "defaults applied",
			cfg: ProxyConfig{
				RemoteAddr: "localhost:9443",
				Timeout:    0,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proxy, err := NewAgentProxy(tt.cfg)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("NewAgentProxy: %v", err)
			}
			if proxy == nil {
				t.Fatal("proxy should not be nil")
			}
			if proxy.client == nil {
				t.Error("HTTP client should not be nil")
			}
		})
	}
}

// TestAgentProxy_DefaultConfig tests default configuration values.
func TestAgentProxy_DefaultConfig(t *testing.T) {
	cfg := DefaultProxyConfig()
	if cfg.Timeout != 30*time.Second {
		t.Errorf("Timeout = %v, want 30s", cfg.Timeout)
	}
	if cfg.MaxBodySize != 50*1024*1024 {
		t.Errorf("MaxBodySize = %d, want 50MB", cfg.MaxBodySize)
	}
}

// TestAgentProxy_ProxyRequest tests proxying to a test HTTP server.
func TestAgentProxy_ProxyRequest(t *testing.T) {
	// Create a test server that responds with known data
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/api/v1/test" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	// Extract host:port from test server URL
	addr := ts.Listener.Addr().String()

	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	resp, err := proxy.ProxyRequest(context.Background(), http.MethodGet, "test", nil)
	if err != nil {
		t.Fatalf("ProxyRequest: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	if result["status"] != "ok" {
		t.Errorf("response status = %q, want ok", result["status"])
	}
}

// TestAgentProxy_ProxyJSONRequest tests JSON request/response proxying.
func TestAgentProxy_ProxyJSONRequest(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/echo" {
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(body)
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()

	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	reqBody := map[string]string{"message": "hello"}
	var respBody map[string]string

	err = proxy.ProxyJSONRequest(context.Background(), http.MethodPost, "echo", reqBody, &respBody)
	if err != nil {
		t.Fatalf("ProxyJSONRequest: %v", err)
	}

	if respBody["message"] != "hello" {
		t.Errorf("response message = %q, want hello", respBody["message"])
	}
}

// TestAgentProxy_ProxyJSONRequest_Error tests error handling in JSON proxying.
func TestAgentProxy_ProxyJSONRequest_Error(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"code":    "INTERNAL_ERROR",
				"message": "something went wrong",
			},
		})
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()

	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	err = proxy.ProxyJSONRequest(context.Background(), http.MethodGet, "test", nil, nil)
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

// TestAgentProxy_SessionToken tests that the session token is included in requests.
func TestAgentProxy_SessionToken(t *testing.T) {
	var receivedToken string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedToken = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()

	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr:   addr,
		SessionToken: "my-session-token",
		Logger:       log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	resp, err := proxy.ProxyRequest(context.Background(), http.MethodGet, "test", nil)
	if err != nil {
		t.Fatalf("ProxyRequest: %v", err)
	}
	resp.Body.Close()

	if receivedToken != "Bearer my-session-token" {
		t.Errorf("Authorization header = %q, want Bearer my-session-token", receivedToken)
	}
}

// TestAgentProxy_Close tests client cleanup.
func TestAgentProxy_Close(t *testing.T) {
	proxy, _ := NewAgentProxy(ProxyConfig{
		RemoteAddr: "localhost:9443",
		Logger:     log.New("test"),
	})

	// Should not panic
	proxy.Close()
}

// TestAgentProxy_LoggerDefault tests default logger.
func TestAgentProxy_LoggerDefault(t *testing.T) {
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: "localhost:9443",
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	if proxy.logger == nil {
		t.Error("logger should not be nil when not provided")
	}
}

// TestAgentProxy_ExecRemote_NilClient tests exec with nil SSH client.
func TestAgentProxy_ExecRemote_NilClient(t *testing.T) {
	proxy, _ := NewAgentProxy(ProxyConfig{
		RemoteAddr: "localhost:9443",
		Logger:     log.New("test"),
	})

	_, _, err := proxy.ExecRemote(context.Background(), nil, "ls")
	if err == nil {
		t.Fatal("expected error for nil SSH client")
	}
}

// TestAgentProxy_UploadFile_NilClient tests upload with nil SSH client.
func TestAgentProxy_UploadFile_NilClient(t *testing.T) {
	proxy, _ := NewAgentProxy(ProxyConfig{
		RemoteAddr: "localhost:9443",
		Logger:     log.New("test"),
	})

	err := proxy.UploadFile(context.Background(), nil, "/local/file", "/remote/file")
	if err == nil {
		t.Fatal("expected error for nil SSH client")
	}
}

// TestAgentProxy_DownloadFile_NilClient tests download with nil SSH client.
func TestAgentProxy_DownloadFile_NilClient(t *testing.T) {
	proxy, _ := NewAgentProxy(ProxyConfig{
		RemoteAddr: "localhost:9443",
		Logger:     log.New("test"),
	})

	var buf bytes.Buffer
	err := proxy.DownloadFile(context.Background(), nil, "/remote/file", &buf)
	if err == nil {
		t.Fatal("expected error for nil SSH client")
	}
}

// TestAgentProxy_ListRemoteFiles_NilClient tests list with nil SSH client.
func TestAgentProxy_ListRemoteFiles_NilClient(t *testing.T) {
	proxy, _ := NewAgentProxy(ProxyConfig{
		RemoteAddr: "localhost:9443",
		Logger:     log.New("test"),
	})

	_, err := proxy.ListRemoteFiles(context.Background(), nil, "/home")
	if err == nil {
		t.Fatal("expected error for nil SSH client")
	}
}

// TestParseLSLine tests parsing of ls -la output lines.
func TestParseLSLine(t *testing.T) {
	tests := []struct {
		line     string
		wantName string
		wantDir  bool
	}{
		{
			line:     "drwxr-xr-x  2 root root  4096 2024-01-15 10:30 Documents",
			wantName: "Documents",
			wantDir:  true,
		},
		{
			line:     "-rw-r--r--  1 root root   123 2024-01-15 10:30 readme.txt",
			wantName: "readme.txt",
			wantDir:  false,
		},
		{
			line:     "total 123",
			wantName: "",
			wantDir:  false,
		},
		{
			line:     "",
			wantName: "",
			wantDir:  false,
		},
	}

	for _, tt := range tests {
		info := parseLSLine(tt.line)
		if tt.wantName == "" {
			if info != nil {
				t.Errorf("parseLSLine(%q): expected nil, got %+v", tt.line, info)
			}
			continue
		}
		if info == nil {
			t.Errorf("parseLSLine(%q): expected info, got nil", tt.line)
			continue
		}
		if info.Name != tt.wantName {
			t.Errorf("parseLSLine(%q).Name = %q, want %q", tt.line, info.Name, tt.wantName)
		}
		if info.IsDir != tt.wantDir {
			t.Errorf("parseLSLine(%q).IsDir = %v, want %v", tt.line, info.IsDir, tt.wantDir)
		}
	}
}

// TestRemoteFileInfo tests the RemoteFileInfo struct.
func TestRemoteFileInfo(t *testing.T) {
	info := RemoteFileInfo{
		Name:   "test.txt",
		Size:   1024,
		IsDir:  false,
		Mode:   "-rw-r--r--",
		Owner:  "root",
		Group:  "root",
	}

	if info.Name != "test.txt" {
		t.Errorf("Name = %q, want test.txt", info.Name)
	}
	if info.Size != 1024 {
		t.Errorf("Size = %d, want 1024", info.Size)
	}
	if info.IsDir {
		t.Error("IsDir should be false")
	}
}