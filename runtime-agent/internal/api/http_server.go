package api

import (
	"context"
	"crypto/subtle"
	"fmt"
	"log"
	"net/http"
	"strings"
)

// HTTPServer is a thin wrapper around the HTTP server that the
// container uses to start and stop the API server.
type HTTPServer struct {
	handler *APIHandler
	port    int
	secret  string
	srv     *http.Server
}

// NewHTTPServer creates a new HTTPServer.
func NewHTTPServer(handler *APIHandler, port int, secret string) *HTTPServer {
	return &HTTPServer{
		handler: handler,
		port:    port,
		secret:  secret,
	}
}

// Start begins listening on the configured port.
func (s *HTTPServer) Start(ctx context.Context) error {
	mux := http.NewServeMux()
	s.registerRoutes(mux)

	var h http.Handler = mux
	h = corsMiddleware(h)
	if s.secret != "" {
		h = secretAuthMiddleware(s.secret)(h)
	}

	s.srv = &http.Server{
		Addr:    fmt.Sprintf(":%d", s.port),
		Handler: h,
	}

	log.Printf("HTTP server listening on :%d", s.port)
	return s.srv.ListenAndServe()
}

// secretAuthMiddleware returns a middleware that requires the
// X-Kairo-Secret header on every request except health endpoints.
// Uses constant-time comparison to prevent timing attacks.
func secretAuthMiddleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Health endpoints are exempt from auth.
			if strings.HasPrefix(r.URL.Path, "/api/v1/health") {
				next.ServeHTTP(w, r)
				return
			}
			provided := r.Header.Get("X-Kairo-Secret")
			if subtle.ConstantTimeCompare([]byte(provided), []byte(secret)) != 1 {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"ok":false,"error":{"code":"unauthenticated","message":"missing or invalid auth secret"}}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Shutdown gracefully stops the HTTP server.
func (s *HTTPServer) Shutdown(ctx context.Context) error {
	if s.srv == nil {
		return nil
	}
	return s.srv.Shutdown(ctx)
}

// corsMiddleware allows the Theia browser frontend (served from
// :3000) to call the agent (:18080) during dev. Without it the
// browser blocks every /api/v1/* request as a cross-origin
// violation and the IDE shows a white screen with 404/ERR_FAILED
// in the console. The middleware:
//   - echoes the request Origin back as Access-Control-Allow-Origin
//     (so any host works in dev; prod should sit behind a proxy)
//   - allows the headers the frontend actually sends
//     (X-Kairo-Secret, X-Kairo-Request-Id, X-Kairo-Workspace-Id,
//     X-Kairo-CSRF, Content-Type)
//   - answers OPTIONS preflight with 204 so the browser can
//     proceed with the real GET/POST
func corsMiddleware(next http.Handler) http.Handler {
	allowedHeaders := "Content-Type, X-Kairo-Secret, X-Kairo-Request-Id, X-Kairo-Workspace-Id, X-Kairo-CSRF"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", allowedHeaders)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *HTTPServer) registerRoutes(mux *http.ServeMux) {
	// Health
	mux.HandleFunc("/api/v1/health", s.handler.HandleHealth)
	mux.HandleFunc("/api/v1/health/ready", s.handler.HandleHealthReady)

	// Workspaces
	mux.HandleFunc("/api/v1/workspaces", s.handler.HandleWorkspaces)

	// Projects
	mux.HandleFunc("/api/v1/projects", s.handler.HandleProjects)

	// Builds (frozen API contract)
	mux.HandleFunc("GET /api/v1/builds/{buildId}", s.handler.HandleBuildByID)
	mux.HandleFunc("DELETE /api/v1/builds/{buildId}", s.handler.HandleBuildByID)
	mux.HandleFunc("/api/v1/builds", s.handler.HandleBuilds)

	// Deployments (frozen API contract)
	mux.HandleFunc("GET /api/v1/deployments/{deploymentId}", s.handler.HandleDeploymentByID)
	mux.HandleFunc("/api/v1/deployments", s.handler.HandleDeployments)

	// Servers (frozen API contract)
	mux.HandleFunc("GET /api/v1/servers/{serverId}", s.handler.HandleServerByID)
	mux.HandleFunc("DELETE /api/v1/servers/{serverId}", s.handler.HandleServerByID)
	mux.HandleFunc("POST /api/v1/servers/{serverId}/restart", s.handler.HandleServerRestart)
	mux.HandleFunc("GET /api/v1/servers/{serverId}/logs", s.handler.HandleServerLogs)
	mux.HandleFunc("/api/v1/servers", s.handler.HandleServers)

	// Events (SSE)
	mux.HandleFunc("/api/v1/events", s.handler.HandleEvents)

	// Toolchains
	mux.HandleFunc("/api/v1/toolchains", s.handler.HandleToolchains)
}
