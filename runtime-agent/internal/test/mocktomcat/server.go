// Package mocktomcat provides a mock Tomcat 6 server that simulates
// Tomcat management endpoints for testing the Go Runtime Agent without
// a real JDK6/Tomcat6 installation.
//
// Usage:
//
//	srv := mocktomcat.NewMockTomcatServer()
//	srv.Start()
//	defer srv.Stop()
//	fmt.Println("Tomcat listening on", srv.Addr())
package mocktomcat

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// MockTomcatServer is a simple HTTP server that simulates Tomcat
// management endpoints.
type MockTomcatServer struct {
	listener net.Listener
	addr     string
	mux      *http.ServeMux
	server   *http.Server
	wg       sync.WaitGroup
	started  time.Time

	// State tracking
	running  atomic.Bool
	uptime   atomic.Int64
	deployed atomic.Bool
	logs     []LogEntry
	logMu    sync.Mutex
}

// LogEntry is a mock log line.
type LogEntry struct {
	Line    string `json:"line"`
	TS      string `json:"ts"`
	Stream  string `json:"stream,omitempty"`
	Ordinal int64  `json:"ordinal"`
}

// StatusResponse is the response of GET /status.
type StatusResponse struct {
	Status string `json:"status"`
	Uptime int64  `json:"uptime"`
}

// DeployResponse is the response of POST /deploy.
type DeployResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// NewMockTomcatServer creates a new MockTomcatServer.
func NewMockTomcatServer() *MockTomcatServer {
	s := &MockTomcatServer{
		mux: http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *MockTomcatServer) routes() {
	s.mux.HandleFunc("/status", s.handleStatus)
	s.mux.HandleFunc("/start", s.handleStart)
	s.mux.HandleFunc("/stop", s.handleStop)
	s.mux.HandleFunc("/deploy", s.handleDeploy)
	s.mux.HandleFunc("/logs", s.handleLogs)
}

// Start starts the mock Tomcat server on a random port.
func (s *MockTomcatServer) Start() error {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("mocktomcat: listen: %w", err)
	}
	s.listener = l
	s.addr = l.Addr().String()
	s.started = time.Now()
	s.running.Store(true)

	s.server = &http.Server{
		Handler:           s.mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.server.Serve(l)
	}()

	// Add initial logs
	s.addLog("INFO: Server startup in 1234 ms", "stdout")
	s.addLog("INFO: Starting Coyote HTTP/1.1 on http-8080", "stdout")
	s.addLog("INFO: JK: ajp13 listening on /0.0.0.0:8009", "stdout")
	s.addLog("INFO: Server startup complete", "stdout")

	return nil
}

// Stop gracefully stops the mock Tomcat server.
func (s *MockTomcatServer) Stop() {
	s.running.Store(false)
	if s.server != nil {
		s.server.Close()
	}
	if s.listener != nil {
		s.listener.Close()
	}
	s.wg.Wait()
}

// Addr returns the address the server is listening on.
func (s *MockTomcatServer) Addr() string {
	return s.addr
}

// IsRunning returns whether the server is in running state.
func (s *MockTomcatServer) IsRunning() bool {
	return s.running.Load()
}

// IsDeployed returns whether an app has been deployed.
func (s *MockTomcatServer) IsDeployed() bool {
	return s.deployed.Load()
}

// AddLog adds a log entry to the mock server.
func (s *MockTomcatServer) AddLog(line, stream string) {
	s.addLog(line, stream)
}

func (s *MockTomcatServer) addLog(line, stream string) {
	s.logMu.Lock()
	defer s.logMu.Unlock()
	s.logs = append(s.logs, LogEntry{
		Line:    line,
		TS:      time.Now().UTC().Format(time.RFC3339),
		Stream:  stream,
		Ordinal: int64(len(s.logs)),
	})
}

func (s *MockTomcatServer) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "GET only"})
		return
	}
	s.uptime.Store(int64(time.Since(s.started).Seconds()))
	status := "running"
	if !s.running.Load() {
		status = "stopped"
	}
	writeJSON(w, http.StatusOK, StatusResponse{
		Status: status,
		Uptime: s.uptime.Load(),
	})
}

func (s *MockTomcatServer) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
		return
	}
	s.running.Store(true)
	s.addLog("INFO: Server started", "stdout")
	writeJSON(w, http.StatusOK, StatusResponse{
		Status: "running",
		Uptime: 0,
	})
}

func (s *MockTomcatServer) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
		return
	}
	s.running.Store(false)
	s.addLog("INFO: Server stopped", "stdout")
	writeJSON(w, http.StatusOK, StatusResponse{
		Status: "stopped",
		Uptime: s.uptime.Load(),
	})
}

func (s *MockTomcatServer) handleDeploy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
		return
	}
	s.deployed.Store(true)
	s.addLog("INFO: Deploying web application archive sample.war", "stdout")
	s.addLog("INFO: Deployment complete in 234 ms", "stdout")
	writeJSON(w, http.StatusOK, DeployResponse{
		Status:  "ok",
		Message: "Deployment successful",
	})
}

func (s *MockTomcatServer) handleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "GET only"})
		return
	}
	s.logMu.Lock()
	defer s.logMu.Unlock()
	writeJSON(w, http.StatusOK, s.logs)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}