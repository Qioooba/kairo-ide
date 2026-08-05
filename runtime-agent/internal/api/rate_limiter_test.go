package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
)

func TestRateLimiter_BasicAllow(t *testing.T) {
	rl := NewRateLimiter(100)
	defer rl.Stop()

	// First request should be allowed
	if !rl.Allow("192.168.1.1") {
		t.Error("first request should be allowed")
	}
}

func TestRateLimiter_ExhaustTokens(t *testing.T) {
	rl := NewRateLimiter(5)
	defer rl.Stop()

	ip := "10.0.0.1"
	// Consume all 5 tokens
	for i := 0; i < 5; i++ {
		if !rl.Allow(ip) {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}

	// 6th request should be denied
	if rl.Allow(ip) {
		t.Error("6th request should be rate limited")
	}
}

func TestRateLimiter_DifferentIPsSeparateLimits(t *testing.T) {
	rl := NewRateLimiter(2)
	defer rl.Stop()

	ip1 := "10.0.0.1"
	ip2 := "10.0.0.2"

	// Exhaust ip1
	if !rl.Allow(ip1) { t.Error("ip1 request 1 should be allowed") }
	if !rl.Allow(ip1) { t.Error("ip1 request 2 should be allowed") }
	if rl.Allow(ip1) { t.Error("ip1 request 3 should be denied") }

	// ip2 should still have its own limit
	if !rl.Allow(ip2) { t.Error("ip2 request 1 should be allowed") }
	if !rl.Allow(ip2) { t.Error("ip2 request 2 should be allowed") }
	if rl.Allow(ip2) { t.Error("ip2 request 3 should be denied") }
}

func TestRateLimiter_TokenRefill(t *testing.T) {
	rl := NewRateLimiter(60) // 1 token per second
	defer rl.Stop()

	ip := "10.0.0.1"
	// Set up a bucket with 0 tokens
	rl.buckets[ip] = &tokenBucket{
		tokens:     0,
		lastRefill: time.Now().Add(-2 * time.Second),
	}

	// After 2 seconds, should have ~2 tokens available
	if !rl.Allow(ip) {
		t.Error("should have refilled at least 1 token after 2 seconds")
	}
}

func TestRateLimiter_ConfigurableRate(t *testing.T) {
	rl := NewRateLimiter(50)
	defer rl.Stop()

	if rl.rate != 50 {
		t.Errorf("rate = %d, want 50", rl.rate)
	}

	rl2 := NewRateLimiter(0) // should default to 100
	defer rl2.Stop()

	if rl2.rate != 100 {
		t.Errorf("default rate = %d, want 100", rl2.rate)
	}

	rl3 := NewRateLimiter(-1) // should default to 100
	defer rl3.Stop()

	if rl3.rate != 100 {
		t.Errorf("negative rate = %d, want 100", rl3.rate)
	}
}

func TestRateLimiter_CleanupStaleEntries(t *testing.T) {
	rl := NewRateLimiter(100)
	defer rl.Stop()

	// Add a stale entry
	rl.mu.Lock()
	rl.buckets["stale-ip"] = &tokenBucket{
		tokens:     50,
		lastRefill: time.Now().Add(-10 * time.Minute),
	}
	rl.buckets["active-ip"] = &tokenBucket{
		tokens:     50,
		lastRefill: time.Now(),
	}
	rl.mu.Unlock()

	rl.cleanup()

	rl.mu.Lock()
	_, staleExists := rl.buckets["stale-ip"]
	_, activeExists := rl.buckets["active-ip"]
	rl.mu.Unlock()

	if staleExists {
		t.Error("stale entry should have been cleaned up")
	}
	if !activeExists {
		t.Error("active entry should still exist")
	}
}

func TestRateLimiter_Middleware(t *testing.T) {
	rl := NewRateLimiter(2)
	defer rl.Stop()

	var called bool
	handler := rl.RateLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	// First request: allowed
	req1 := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	req1.RemoteAddr = "192.168.1.1:12345"
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK || !called {
		t.Error("first request should succeed")
	}

	// Second request: allowed
	called = false
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	req2.RemoteAddr = "192.168.1.1:12345"
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK || !called {
		t.Error("second request should succeed")
	}

	// Third request: rate limited
	called = false
	req3 := httptest.NewRequest(http.MethodGet, "/api/v1/builds", nil)
	req3.RemoteAddr = "192.168.1.1:12345"
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, req3)
	if w3.Code != http.StatusTooManyRequests {
		t.Errorf("status = %d, want %d", w3.Code, http.StatusTooManyRequests)
	}
	if called {
		t.Error("rate-limited request should not reach the handler")
	}
	if w3.Header().Get("Retry-After") != "60" {
		t.Errorf("Retry-After = %q, want %q", w3.Header().Get("Retry-After"), "60")
	}

	// Verify error response contains the correct error code
	var errResp protocol.ErrorResponse
	if err := json.NewDecoder(bytes.NewReader(w3.Body.Bytes())).Decode(&errResp); err != nil {
		t.Fatalf("parse error response: %v", err)
	}
	if errResp.Error.Code != protocol.ErrRateLimited {
		t.Errorf("error code = %q, want %q", errResp.Error.Code, protocol.ErrRateLimited)
	}
}

func TestRateLimiter_MiddlewarePublicEndpointsExempt(t *testing.T) {
	rl := NewRateLimiter(1) // only 1 request allowed
	defer rl.Stop()

	var called bool
	handler := rl.RateLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust the limit
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	req.RemoteAddr = "10.0.0.1:12345"
	handler.ServeHTTP(httptest.NewRecorder(), req)

	// Health and endpoints should still be allowed
	for _, path := range []string{"/api/v1/health", "/api/v1/endpoints"} {
		called = false
		req2 := httptest.NewRequest(http.MethodGet, path, nil)
		req2.RemoteAddr = "10.0.0.1:12345"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req2)
		if w.Code != http.StatusOK || !called {
			t.Errorf("public endpoint %s should be exempt from rate limiting", path)
		}
	}
}

func TestExtractIP(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		xff        string
		want       string
	}{
		{"ipv4", "192.168.1.1:12345", "", "192.168.1.1"},
		{"ipv6", "[::1]:12345", "", "[::1]"},
		{"no port", "10.0.0.1", "", "10.0.0.1"},
		{"xff single", "10.0.0.2:80", "192.168.1.100", "192.168.1.100"},
		{"xff multiple", "10.0.0.2:80", "192.168.1.100, 10.0.0.3", "192.168.1.100"},
		// GO-P2-1: loopback ignores forged XFF
		{"loopback ignores xff", "127.0.0.1:54321", "1.2.3.4", "127.0.0.1"},
		{"ipv6 loopback ignores xff", "[::1]:54321", "1.2.3.4", "[::1]"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tc.remoteAddr
			if tc.xff != "" {
				req.Header.Set("X-Forwarded-For", tc.xff)
			}
			got := extractIP(req)
			if got != tc.want {
				t.Errorf("extractIP = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRateLimiter_Stop(t *testing.T) {
	rl := NewRateLimiter(100)
	rl.Stop()
	// Calling Stop twice should not panic
	rl.Stop()
}