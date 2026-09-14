package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
)

// AgentState aliases protocol.AgentState.
type AgentState = protocol.AgentState

var stateFileMu sync.Mutex

// WriteAgentStateAtomic writes st to <dataDir>/agent-state.json atomically via a
// temporary file + rename. It enforces generation monotonicity so a dying or stale
// instance cannot overwrite a newer generation (F18 / T33).
func WriteAgentStateAtomic(dataDir string, st AgentState) error {
	if dataDir == "" {
		return errors.New("dataDir is required")
	}
	stateFileMu.Lock()
	defer stateFileMu.Unlock()

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create dataDir: %w", err)
	}

	statePath := filepath.Join(dataDir, "agent-state.json")

	// Read existing state to verify generation monotonicity.
	if raw, err := os.ReadFile(statePath); err == nil {
		var existing AgentState
		if jerr := json.Unmarshal(raw, &existing); jerr == nil {
			if existing.Generation > st.Generation {
				return fmt.Errorf("refusing to overwrite newer generation %d with older generation %d", existing.Generation, st.Generation)
			}
			if existing.Generation == st.Generation && existing.PID != 0 && st.PID != 0 &&
				existing.PID != st.PID && existing.Status == "ready" && st.Status == "starting" {
				return fmt.Errorf("refusing to overwrite ready PID %d with starting PID %d in generation %d", existing.PID, st.PID, st.Generation)
			}
		}
	}

	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal agent state: %w", err)
	}

	if err := atomicfile.WriteFile(statePath, data, 0o600); err != nil {
		return fmt.Errorf("replace agent state file %s: %w", statePath, err)
	}
	return nil
}

// ReadAgentState reads and unmarshals <dataDir>/agent-state.json.
func ReadAgentState(dataDir string) (AgentState, error) {
	if dataDir == "" {
		return AgentState{}, errors.New("dataDir is required")
	}
	statePath := filepath.Join(dataDir, "agent-state.json")
	raw, err := os.ReadFile(statePath)
	if err != nil {
		return AgentState{}, err
	}
	var st AgentState
	if err := json.Unmarshal(raw, &st); err != nil {
		return AgentState{}, fmt.Errorf("unmarshal agent state %s: %w", statePath, err)
	}
	return st, nil
}

// RemoveAgentState removes <dataDir>/agent-state.json only if the current file
// on disk matches pid and generation <= existing.Generation. If a successor
// generation has already taken over, the file is preserved (F18 / T31, T33).
func RemoveAgentState(dataDir string, pid int, generation int) error {
	if dataDir == "" {
		return nil
	}
	stateFileMu.Lock()
	defer stateFileMu.Unlock()

	statePath := filepath.Join(dataDir, "agent-state.json")
	existing, err := ReadAgentState(dataDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	// If state file belongs to a successor generation or another PID, do not remove!
	if existing.Generation > generation || (existing.PID != 0 && existing.PID != pid) {
		return nil
	}
	return os.Remove(statePath)
}

// isAddrInUse returns true if err indicates that the address/port is already in use.
func isAddrInUse(err error) bool {
	if err == nil {
		return false
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		var sysErr *os.SyscallError
		if errors.As(opErr.Err, &sysErr) {
			if errors.Is(sysErr.Err, syscall.EADDRINUSE) {
				return true
			}
			// Windows WSAEADDRINUSE is 10048
			if errno, ok := sysErr.Err.(syscall.Errno); ok && errno == 10048 {
				return true
			}
		}
		if errors.Is(opErr.Err, syscall.EADDRINUSE) {
			return true
		}
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "address already in use") ||
		strings.Contains(msg, "only one usage of each socket address") ||
		strings.Contains(msg, "wsagetlasterror 10048")
}

// ListenWithHandoff binds addr. If addr is in use and timeout > 0, it retries with
// backoff until the preceding generation releases the port or the timeout expires (F18 / T31, T32).
func ListenWithHandoff(ctx context.Context, addr string, timeout time.Duration) (net.Listener, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if timeout <= 0 {
		return net.Listen("tcp", addr)
	}

	start := time.Now()
	interval := 50 * time.Millisecond
	maxInterval := 250 * time.Millisecond

	for {
		ln, err := net.Listen("tcp", addr)
		if err == nil {
			return ln, nil
		}

		if !isAddrInUse(err) {
			// Non-busy error (e.g. invalid host, permissions): fail immediately
			return nil, err
		}

		if time.Since(start) >= timeout {
			return nil, fmt.Errorf("bind %s failed: address remained in use after %v handoff timeout: %w", addr, timeout, err)
		}

		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("bind %s cancelled: %w", addr, ctx.Err())
		case <-time.After(interval):
		}

		interval *= 2
		if interval > maxInterval {
			interval = maxInterval
		}
	}
}
