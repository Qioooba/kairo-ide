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

// Valid diagnostic port range (GO-P3-7): any TCP port 1–65535.
// Privileged ports (<1024) are allowed so operators can diagnose
// conflicts on 80/443; the suggestion text must match this range.
const (
	diagPortMin = 1
	diagPortMax = 65535
)

// diagnosePort checks whether a port is occupied and returns
// diagnostics about the occupying process.
//
// Platform backends shell out to lsof/ss/netstat/tasklist and parse
// text — best-effort only (GO-P3-7). Prefer exact local-address port
// matching over substring Contains to avoid :8080 matching :18080.
func diagnosePort(port int) PortDiagnostics {
	result := PortDiagnostics{Port: port}
	if port < diagPortMin || port > diagPortMax {
		result.Suggestion = fmt.Sprintf(
			"Invalid port number. Use a port between %d and %d.",
			diagPortMin, diagPortMax,
		)
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
	// lsof -iTCP:PORT scopes by numeric port; avoid building ":*port" that
	// could be confused with substring filters elsewhere.
	out, err := exec.Command("lsof", "-nP", fmt.Sprintf("-iTCP:%d", port), "-sTCP:LISTEN", "-t").Output()
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
	return pid, getProcessName(pid)
}

func findPortOccupierLinux(port int) (int, string) {
	// Try ss first (modern), fall back to netstat.
	out, err := exec.Command("ss", "-tlnp", "sport", "=", fmt.Sprintf(":%d", port)).Output()
	if err == nil {
		return parseSSOutput(string(out), port)
	}
	out, err = exec.Command("netstat", "-tlnp").Output()
	if err != nil {
		return 0, ""
	}
	return parseNetstatOutput(string(out), port)
}

// fieldHasPort reports whether an address field ends with exactly :port
// (avoids HasSuffix(":8080") matching ":18080").
func fieldHasPort(field string, port int) bool {
	idx := strings.LastIndexByte(field, ':')
	if idx < 0 || idx+1 >= len(field) {
		return false
	}
	n, err := strconv.Atoi(field[idx+1:])
	return err == nil && n == port
}

func parseSSOutput(output string, port int) (int, string) {
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		matched := false
		for _, field := range fields {
			if fieldHasPort(field, port) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		// Format: LISTEN  0  128  0.0.0.0:8080  0.0.0.0:*  users:(("java",pid=12345,fd=42))
		for _, field := range fields {
			if !strings.HasPrefix(field, "users:((") {
				continue
			}
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
			start := len("users:((\"")
			nameEnd := strings.IndexByte(field[start:], '"')
			if nameEnd < 0 {
				nameEnd = 0
			}
			procName := field[start : start+nameEnd]
			return pid, procName
		}
	}
	return 0, ""
}

func parseNetstatOutput(output string, port int) (int, string) {
	for _, line := range strings.Split(output, "\n") {
		if !strings.Contains(line, "LISTEN") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		// Local address is typically field[3] on Linux netstat -tlnp.
		localIdx := -1
		for i, f := range fields {
			if fieldHasPort(f, port) {
				localIdx = i
				break
			}
		}
		if localIdx < 0 {
			continue
		}
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
	out, err := exec.Command("netstat", "-ano", "-p", "TCP").Output()
	if err != nil {
		return 0, ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "LISTENING") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		// Windows netstat: Proto LocalAddress ForeignAddress State PID
		// Local address is fields[1].
		if !fieldHasPort(fields[1], port) {
			continue
		}
		pid, err := strconv.Atoi(fields[len(fields)-1])
		if err != nil || pid <= 0 {
			continue
		}
		return pid, getProcessName(pid)
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
	if err != nil || port < diagPortMin || port > diagPortMax {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: fmt.Sprintf("port must be a number between %d and %d", diagPortMin, diagPortMax),
		})
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
