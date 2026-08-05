package security

import (
	"net/http"
	"testing"
)

func TestIsSafeOrigin_LocalhostExact(t *testing.T) {
	tests := []string{
		"http://localhost",
		"http://localhost:3000",
		"https://localhost",
		"https://localhost:8080",
		"http://127.0.0.1",
		"http://127.0.0.1:3000",
		"https://127.0.0.1",
		"https://127.0.0.1:8080",
		"http://[::1]",
		"http://[::1]:3000",
		"https://[::1]",
		"https://[::1]:8080",
	}
	for _, origin := range tests {
		if !IsSafeOrigin(origin) {
			t.Errorf("IsSafeOrigin(%q) = false, want true", origin)
		}
	}
}

func TestIsSafeOrigin_FileAndWebview(t *testing.T) {
	tests := []string{
		"file://",
		"file:///C:/path/to/index.html",
		"vscode-webview://",
		"vscode-webview://some-id",
	}
	for _, origin := range tests {
		if !IsSafeOrigin(origin) {
			t.Errorf("IsSafeOrigin(%q) = false, want true", origin)
		}
	}
}

func TestIsSafeOrigin_Unsafe(t *testing.T) {
	tests := []string{
		"",
		"http://evil.com",
		"https://evil.com",
		"http://192.168.1.1",
		"http://10.0.0.1",
		"http://example.com",
		// Prefix-match attack: hostname is localhost.evil.com, not localhost.
		"http://localhost.evil.com",
		"https://localhost.evil.com",
		"http://localhost.evil.com:8080",
		"http://127.0.0.1.nip.io",
		"http://127.0.0.1.evil.com",
		"http://evil-localhost",
		"ftp://localhost",
		"not-a-url",
	}
	for _, origin := range tests {
		if IsSafeOrigin(origin) {
			t.Errorf("IsSafeOrigin(%q) = true, want false", origin)
		}
	}
}

func TestIsSafeWebSocketOrigin_EmptyFromLoopback(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "127.0.0.1:54321"
	if !IsSafeWebSocketOrigin(r) {
		t.Fatal("empty Origin from loopback should be allowed for WS")
	}
}

func TestIsSafeWebSocketOrigin_EmptyFromRemote(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.10:54321"
	if IsSafeWebSocketOrigin(r) {
		t.Fatal("empty Origin from non-loopback must be rejected")
	}
}

func TestIsSafeWebSocketOrigin_EvilOriginRejected(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "127.0.0.1:54321"
	r.Header.Set("Origin", "http://localhost.evil.com")
	if IsSafeWebSocketOrigin(r) {
		t.Fatal("evil prefix Origin must be rejected even from loopback")
	}
}
