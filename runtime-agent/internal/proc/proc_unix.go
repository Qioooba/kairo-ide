//go:build !windows
// +build !windows

package proc

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

// clockTicksPerSecond is the value of sysconf(_SC_CLK_TCK) on essentially
// every modern Linux system. The /proc/{pid}/stat field 22 (starttime) is
// expressed in clock ticks since system boot.
const clockTicksPerSecond = 100

// bootTimeEpsilon allows the starttime field read from /proc/{pid}/stat to
// match a Go-recorded StartTime even when the two are derived from slightly
// different clock sources (CLOCK_MONOTONIC for /proc, wall clock for Go).
const bootTimeEpsilon = 2 * time.Second

func sysProcAttrForOS() *syscall.SysProcAttr {
	// Setpgid=true creates a new process group so that we can signal the
	// whole tree via kill(-pgid, sig). This is the Unix equivalent of the
	// Windows CREATE_NEW_PROCESS_GROUP + Job Object combination.
	return &syscall.SysProcAttr{
		Setpgid: true,
		Pgid:    0,
	}
}

// afterStartHook is invoked by the cross-platform Start() implementation
// after a process has been successfully launched. On Unix there is no
// equivalent of the Windows Job Object that would auto-kill child
// processes when the parent exits. Instead we rely on:
//   - the process group created via Setpgid (above) so that the Agent
//     can signal the whole tree on Shutdown, and
//   - the product rule (ADR-0011 Section 9): the Agent's Shutdown()
//     explicitly force-stops every non-terminal server before the Agent
//     process exits.
//
// If the Agent crashes (no clean Shutdown), Unix will reparent the
// orphaned Tomcat to init (PID 1). The product rule accepts this
// trade-off: the next Agent lifecycle will mark the persisted record as
// Crashed and the user is responsible for any orphaned process cleanup.
func afterStartHook(pid int) error {
	_ = pid
	return nil
}

func terminateProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	pgid := -pid
	if err := syscall.Kill(pgid, syscall.SIGTERM); err != nil {
		if err == syscall.ESRCH {
			return nil
		}
		return syscall.Kill(pid, syscall.SIGTERM)
	}
	return nil
}

func killProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	pgid := -pid
	if err := syscall.Kill(pgid, syscall.SIGKILL); err != nil {
		if err == syscall.ESRCH {
			return nil
		}
		return syscall.Kill(pid, syscall.SIGKILL)
	}
	return nil
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if err := p.Signal(syscall.Signal(0)); err != nil {
		if errors.Is(err, os.ErrProcessDone) {
			return false
		}
		if err == syscall.ESRCH {
			return false
		}
		return false
	}
	return true
}

// verifyProcessIdentity performs a complete OS-level identity check before
// the Agent is allowed to signal a Kairo-managed process. On Linux it uses
// the /proc filesystem to verify:
//
//  1. PID is still alive.
//  2. Executable path matches the recorded one via /proc/{pid}/exe.
//  3. Process start time matches via /proc/{pid}/stat field 22.
//  4. Marker token is present in /proc/{pid}/environ (when accessible).
//
// On Darwin (macOS) /proc is not available, so this function falls back to
// a PID-only check. Darwin is treated as a development-only platform; the
// hardening guarantees here apply to Linux and Windows production hosts.
//
// CatalinaBase is checked at the Go level via identityMatches() in
// proc.go; it is not re-derived from the OS.
func verifyProcessIdentity(pid int, identity domain.ProcessIdentity) bool {
	if pid <= 0 {
		return false
	}
	if !isProcessAlive(pid) {
		return false
	}

	if exe, err := readProcExe(pid); err == nil {
		if !sameExecutable(exe, identity.Executable) {
			return false
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		// /proc exists but we could not read the link for another reason
		// (e.g. permission). Treat as a verification failure rather than
		// silently falling back to PID-only.
		return false
	}
	// On platforms without /proc (Darwin), readProcExe returns
	// os.ErrNotExist and we skip the executable check.

	if startedAt, err := readProcStartTime(pid); err == nil {
		diff := startedAt.Sub(identity.StartTime)
		if diff < 0 {
			diff = -diff
		}
		if diff > bootTimeEpsilon {
			return false
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return false
	}

	if identity.MarkerToken != "" {
		if token, err := readProcMarker(pid); err == nil {
			if token != identity.MarkerToken {
				return false
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			// Permission denied reading environ on Linux is common when
			// the Agent runs as a different user than the Tomcat. We do
			// NOT treat this as a hard failure because the executable
			// and start-time checks are already strong. The marker is
			// additionally checked in-memory via identityMatches().
		}
	}

	return true
}

// readProcExe returns the canonical executable path for pid by reading
// /proc/{pid}/exe. Returns os.ErrNotExist (wrapped) when /proc is not
// available (e.g. on Darwin).
func readProcExe(pid int) (string, error) {
	exeLink := fmt.Sprintf("/proc/%d/exe", pid)
	exe, err := os.Readlink(exeLink)
	if err != nil {
		return "", err
	}
	return exe, nil
}

// readProcStartTime parses /proc/{pid}/stat and returns field 22
// (starttime) as a wall-clock time.Time. Returns os.ErrNotExist (wrapped)
// when /proc is not available.
func readProcStartTime(pid int) (time.Time, error) {
	statPath := fmt.Sprintf("/proc/%d/stat", pid)
	data, err := os.ReadFile(statPath)
	if err != nil {
		return time.Time{}, err
	}
	// /proc/{pid}/stat fields are space-separated, but field 2 (comm) is
	// surrounded by parentheses and may contain spaces. Find the last ')'
	// to skip the comm field safely.
	s := string(data)
	parenEnd := strings.LastIndexByte(s, ')')
	if parenEnd < 0 {
		return time.Time{}, fmt.Errorf("malformed /proc/%d/stat: missing comm close paren", pid)
	}
	rest := strings.Fields(s[parenEnd+1:])
	// After "comm) state ppid pgrp session tty_nr tpgid flags ..." field
	// 22 (starttime) is at index 22-3 = 19 in the rest slice (we have
	// already consumed fields 1 and 2).
	const starttimeFieldIndex = 19
	if len(rest) <= starttimeFieldIndex {
		return time.Time{}, fmt.Errorf("malformed /proc/%d/stat: too few fields", pid)
	}
	ticks, err := strconv.ParseInt(rest[starttimeFieldIndex], 10, 64)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse starttime: %w", err)
	}
	bootTime, err := readBootTime()
	if err != nil {
		return time.Time{}, err
	}
	startedAt := bootTime.Add(time.Duration(ticks) * time.Second / clockTicksPerSecond)
	return startedAt, nil
}

// readBootTime reads /proc/stat and returns the btime line as a time.Time.
func readBootTime() (time.Time, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return time.Time{}, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "btime ") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				return time.Time{}, fmt.Errorf("malformed btime line")
			}
			secs, err := strconv.ParseInt(fields[1], 10, 64)
			if err != nil {
				return time.Time{}, fmt.Errorf("parse btime: %w", err)
			}
			return time.Unix(secs, 0), nil
		}
	}
	return time.Time{}, fmt.Errorf("btime not found in /proc/stat")
}

// readProcMarker reads /proc/{pid}/environ and returns the value of
// KAIRO_PROCESS_MARKER. Returns os.ErrNotExist (wrapped) when /proc is not
// available.
func readProcMarker(pid int) (string, error) {
	envPath := fmt.Sprintf("/proc/%d/environ", pid)
	data, err := os.ReadFile(envPath)
	if err != nil {
		return "", err
	}
	// /proc/{pid}/environ uses '\0' as the field separator.
	for _, kv := range strings.Split(string(data), "\x00") {
		if strings.HasPrefix(kv, "KAIRO_PROCESS_MARKER=") {
			return strings.TrimPrefix(kv, "KAIRO_PROCESS_MARKER="), nil
		}
	}
	return "", fmt.Errorf("KAIRO_PROCESS_MARKER not found in /proc/%d/environ", pid)
}

// sameExecutable compares two executable paths after resolving symlinks
// and normalising. Used by verifyProcessIdentity to defeat PID reuse.
func sameExecutable(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	aResolved, err := filepath.EvalSymlinks(a)
	if err != nil {
		aResolved = a
	}
	bResolved, err := filepath.EvalSymlinks(b)
	if err != nil {
		bResolved = b
	}
	return filepath.Clean(aResolved) == filepath.Clean(bResolved)
}

// ensure user package is referenced when we add per-user checks later.
var _ = user.Current

// findChildProcesses returns the PIDs of all direct child processes of pid.
// On Linux it reads /proc/{pid}/task/{pid}/children; on macOS it uses pgrep.
func findChildProcesses(pid int) []int {
	if pid <= 0 {
		return nil
	}
	// Try Linux /proc interface first
	childrenPath := fmt.Sprintf("/proc/%d/task/%d/children", pid, pid)
	data, err := os.ReadFile(childrenPath)
	if err == nil {
		fields := strings.Fields(string(data))
		result := make([]int, 0, len(fields))
		for _, f := range fields {
			if cp, err := strconv.Atoi(f); err == nil && cp > 0 {
				result = append(result, cp)
			}
		}
		return result
	}
	// macOS fallback: pgrep -P <pid>
	out, err := exec.Command("pgrep", "-P", strconv.Itoa(pid)).Output()
	if err != nil {
		return nil
	}
	fields := strings.Fields(string(out))
	result := make([]int, 0, len(fields))
	for _, f := range fields {
		if cp, err := strconv.Atoi(f); err == nil && cp > 0 {
			result = append(result, cp)
		}
	}
	return result
}
