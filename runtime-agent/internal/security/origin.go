package security

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

// IsSafeOrigin returns true if origin is an exact localhost/loopback
// http(s) origin, or a trusted desktop/webview scheme.
//
// Prefix matching is intentionally rejected: origins like
// "http://localhost.evil.com" must not be treated as loopback.
// An empty origin is never safe for CORS reflection.
func IsSafeOrigin(origin string) bool {
	if origin == "" {
		return false
	}

	u, err := url.Parse(origin)
	if err != nil || u.Scheme == "" {
		return false
	}

	switch strings.ToLower(u.Scheme) {
	case "file":
		// Electron renderer may present file:// origins.
		return true
	case "vscode-webview":
		// VS Code / Theia webview origins.
		return true
	case "http", "https":
		host := strings.ToLower(u.Hostname())
		return host == "localhost" || host == "127.0.0.1" || host == "::1"
	default:
		return false
	}
}

// IsSafeWebSocketOrigin is the CheckOrigin policy for agent WebSockets.
// Browsers always send Origin and must pass IsSafeOrigin. Native clients
// (Go dialer, tools) often omit Origin; allow that only from loopback
// RemoteAddr so empty-Origin CSRF from a remote host stays rejected.
func IsSafeWebSocketOrigin(r *http.Request) bool {
	if r == nil {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin != "" {
		return IsSafeOrigin(origin)
	}
	return isLoopbackRemoteAddr(r.RemoteAddr)
}

func isLoopbackRemoteAddr(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		// Some stacks pass a bare IP without a port.
		host = remoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}
