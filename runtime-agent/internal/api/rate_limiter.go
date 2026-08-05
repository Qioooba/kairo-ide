// Package api is the HTTP layer of the Runtime Agent.
package api

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
)

// RateLimiter implements a per-IP token-bucket rate limiter.
// It is safe for concurrent use.
type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*tokenBucket
	rate     int           // requests per minute
	cleanupInterval time.Duration
	stopCh   chan struct{}
	stopOnce sync.Once
}

// tokenBucket tracks tokens for a single IP.
type tokenBucket struct {
	tokens   float64
	lastRefill time.Time
}

// NewRateLimiter creates a RateLimiter with the given requests-per-minute
// rate. If ratePerMinute <= 0, a default of 100 is used.
func NewRateLimiter(ratePerMinute int) *RateLimiter {
	if ratePerMinute <= 0 {
		ratePerMinute = 100
	}
	rl := &RateLimiter{
		buckets:  make(map[string]*tokenBucket),
		rate:     ratePerMinute,
		cleanupInterval: 5 * time.Minute,
		stopCh:   make(chan struct{}),
	}
	go rl.cleanupLoop()
	return rl
}

// Stop shuts down the background cleanup goroutine.
func (rl *RateLimiter) Stop() {
	rl.stopOnce.Do(func() {
		close(rl.stopCh)
	})
}

// Allow checks whether the given IP is allowed to make a request.
// Returns true if allowed, false if rate limited.
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	bucket, ok := rl.buckets[ip]
	if !ok {
		bucket = &tokenBucket{
			tokens:     float64(rl.rate),
			lastRefill: time.Now(),
		}
		rl.buckets[ip] = bucket
	}

	rl.refill(bucket)
	if bucket.tokens >= 1 {
		bucket.tokens--
		return true
	}
	return false
}

func (rl *RateLimiter) refill(b *tokenBucket) {
	now := time.Now()
	elapsed := now.Sub(b.lastRefill).Seconds()
	// Tokens to add = rate (per minute) * elapsed (minutes)
	newTokens := float64(rl.rate) * elapsed / 60.0
	b.tokens += newTokens
	if b.tokens > float64(rl.rate) {
		b.tokens = float64(rl.rate)
	}
	b.lastRefill = now
}

// cleanupLoop periodically removes stale entries.
func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(rl.cleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			rl.cleanup()
		case <-rl.stopCh:
			return
		}
	}
}

func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	for ip, bucket := range rl.buckets {
		if now.Sub(bucket.lastRefill) > rl.cleanupInterval {
			delete(rl.buckets, ip)
		}
	}
}

// extractIP extracts the client IP from the request.
// X-Forwarded-For is ignored when RemoteAddr is loopback (GO-P2-1): the
// agent binds locally, so a client-supplied XFF would let any local process
// forge distinct rate-limit buckets and bypass the limiter.
func extractIP(r *http.Request) string {
	remote := stripHostPort(r.RemoteAddr)
	if isLoopbackHost(remote) {
		return remote
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first IP in the chain
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return strings.TrimSpace(xff[:i])
			}
		}
		return strings.TrimSpace(xff)
	}
	return remote
}

func stripHostPort(hostport string) string {
	host := hostport
	// Handle IPv6 bracket notation: [::1]:12345
	if len(host) > 0 && host[0] == '[' {
		for i := 1; i < len(host); i++ {
			if host[i] == ']' {
				return host[:i+1]
			}
		}
		return host
	}
	// Strip port for IPv4: 192.168.1.1:12345
	for i := len(host) - 1; i >= 0; i-- {
		if host[i] == ':' {
			return host[:i]
		}
	}
	return host
}

func isLoopbackHost(host string) bool {
	h := strings.Trim(host, "[]")
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// RateLimitMiddleware returns an HTTP middleware that enforces
// per-IP rate limiting. Public endpoints (health, endpoints) are
// exempt.
func (rl *RateLimiter) RateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip rate limiting for public endpoints
		switch r.URL.Path {
		case "/api/v1/health", "/api/v1/endpoints":
			next.ServeHTTP(w, r)
			return
		}

		ip := extractIP(r)
		if !rl.Allow(ip) {
			w.Header().Set("Retry-After", "60")
			writeError(w, "", "", protocol.KairoError{
				Code:    protocol.ErrRateLimited,
				Message: "rate limit exceeded; retry after " + strconv.Itoa(60) + " seconds",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}