package api

import (
	"net/http"
	"runtime"
	"strconv"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
)

// handleHealth returns the agent liveness and version.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	s.mu.Lock()
	uptime := int64(time.Since(s.started).Seconds())
	addr := s.bindAddr
	port := s.port
	s.mu.Unlock()
	resp := protocol.HealthResponse{
		OK:             true,
		Version:        s.version,
		AgentVersion:   s.version,
		UptimeSec:      uptime,
		BindAddress:    addr,
		Port:           port,
		ActiveSessions: 0,
	}
	resp.Platform.OS = runtime.GOOS
	resp.Platform.Arch = runtime.GOARCH
	writeOK(w, protocol.RequestEnvelope{}, resp)
}

// _ = strconv keeps the import used.
var _ = strconv.Atoi
