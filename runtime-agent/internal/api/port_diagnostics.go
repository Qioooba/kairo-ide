package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
)

// PortDiagnostics describes what is occupying a given port.
type PortDiagnostics struct {
	Port        int    `json:"port"`
	Occupied    bool   `json:"occupied"`
	PID         int    `json:"pid,omitempty"`
	ProcessName string `json:"processName,omitempty"`
	Suggestion  string `json:"suggestion,omitempty"`
}

// diagnosePort checks whether a port is occupied and returns
// diagnostics about the occupying process. It works on macOS (lsof)
// and Linux (ss/netstat).
func diagnosePort(port int) PortDiagnostics {
	result := PortDiagnostics{Port: port}
	if port <= 0 || port > 65535 {
		result.Suggestion = "Invalid port number. Use a port between 1024 and 65535."
		return result
	}

	pid, procName := findPortOccupier(port)
	if pid <= 0 {
		return result
	}

	result.Occupied = true
	result.PID = pid
	result.ProcessName = procName
	result.Suggestion = fmt.Sprintf(
		"Port %d is occupied by process %q (PID %d). "+
			"Choose a different port or stop the conflicting process.",
		port, procName, pid,
	)
	return result
}

// findPortOccupier returns the PID and process name of the process
// that is listening on the given port. Returns 0, "" if not found.
func findPortOccupier(port int) (int, string) {
	switch runtime.GOOS {
	case "darwin":
		return findPortOccupierLsof(port)
	case "linux":
		return findPortOccupierLinux(port)
	case "windows":
		return findPortOccupierWindows(port)
	default:
		return 0, ""
	}
}

func findPortOccupierLsof(port int) (int, string) {
	addr := fmt.Sprintf(":%d", port)
	// lsof -nP -iTCP:PORT -sTCP:LISTEN -t returns just the PID
	out, err := exec.Command("lsof", "-nP", "-iTCP:"+addr, "-sTCP:LISTEN", "-t").Output()
	if err != nil {
		return 0, ""
	}
	pidStr := strings.TrimSpace(string(out))
	if pidStr == "" {
		return 0, ""
	}
	pid, err := strconv.Atoi(strings.Split(pidStr, "\n")[0])
	if err != nil || pid <= 0 {
		return 0, ""
	}
	// Get process name
	procName := getProcessName(pid)
	return pid, procName
}

func findPortOccupierLinux(port int) (int, string) {
	// Try ss first (modern), fall back to netstat
	addr := fmt.Sprintf(":%d", port)
	out, err := exec.Command("ss", "-tlnp", "sport", "="+addr).Output()
	if err == nil {
		return parseSSOutput(string(out), port)
	}
	// Fall back to netstat
	out, err = exec.Command("netstat", "-tlnp").Output()
	if err != nil {
		return 0, ""
	}
	return parseNetstatOutput(string(out), port)
}

func parseSSOutput(output string, port int) (int, string) {
	addr := fmt.Sprintf(":%d", port)
	for _, line := range strings.Split(output, "\n") {
		if !strings.Contains(line, addr) {
			continue
		}
		// Format: LISTEN  0  128  0.0.0.0:8080  0.0.0.0:*  users:(("java",pid=12345,fd=42))
		fields := strings.Fields(line)
		for _, field := range fields {
			if strings.HasPrefix(field, "users:((") {
				// Extract pid from users:(("java",pid=12345,fd=42))
				idx := strings.Index(field, "pid=")
				if idx < 0 {
					continue
				}
				rest := field[idx+4:]
				end := strings.IndexAny(rest, ",)")
				if end < 0 {
					continue
				}
				pid, err := strconv.Atoi(rest[:end])
				if err != nil || pid <= 0 {
					continue
				}
				// Extract process name
				start := len("users:((\"")
				nameEnd := strings.IndexByte(field[start:], '"')
				if nameEnd < 0 {
					nameEnd = 0
				}
				procName := field[start : start+nameEnd]
				return pid, procName
			}
		}
	}
	return 0, ""
}

func parseNetstatOutput(output string, port int) (int, string) {
	addr := fmt.Sprintf(":%d", port)
	for _, line := range strings.Split(output, "\n") {
		if !strings.Contains(line, addr) || !strings.Contains(line, "LISTEN") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		// Last field: 12345/java
		last := fields[len(fields)-1]
		parts := strings.SplitN(last, "/", 2)
		if len(parts) != 2 {
			continue
		}
		pid, err := strconv.Atoi(parts[0])
		if err != nil || pid <= 0 {
			continue
		}
		return pid, parts[1]
	}
	return 0, ""
}

func findPortOccupierWindows(port int) (int, string) {
	addr := fmt.Sprintf(":%d", port)
	out, err := exec.Command("netstat", "-ano", "-p", "TCP").Output()
	if err != nil {
		return 0, ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "LISTENING") || !strings.Contains(line, addr) {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		pid, err := strconv.Atoi(fields[len(fields)-1])
		if err != nil || pid <= 0 {
			continue
		}
		procName := getProcessName(pid)
		return pid, procName
	}
	return 0, ""
}

func getProcessName(pid int) string {
	if pid <= 0 {
		return ""
	}
	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/FO", "CSV", "/NH").Output()
		if err != nil {
			return ""
		}
		parts := strings.SplitN(string(out), ",", 2)
		if len(parts) >= 1 {
			return strings.Trim(parts[0], `"`)
		}
		return ""
	default:
		out, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "comm=").Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	}
}

func (s *Server) handlePortDiagnostics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	portStr := r.URL.Query().Get("port")
	if portStr == "" {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "port query parameter is required"})
		return
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 || port > 65535 {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "port must be a number between 1 and 65535"})
		return
	}

	result := diagnosePort(port)
	writeJSON(w, http.StatusOK, protocol.ResponseEnvelope{
		OK:      true,
		Payload: result,
	})
}

// MarshalJSON for PortDiagnostics
var _ = json.Marshal