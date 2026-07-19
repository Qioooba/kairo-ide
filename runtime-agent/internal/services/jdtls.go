package services

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"github.com/kairo-ide/runtime-agent/internal/jdtls"
	"github.com/kairo-ide/runtime-agent/internal/log"
)

// ----------------- JDTLS (jdt-language-server distribution) -----------------
//
// jdtlsService manages the JDT LS distribution (download, install,
// verify) and provides launch descriptors to the Theia backend.
// As of Phase 4, the Theia backend owns the JDT LS process
// lifecycle and LSP communication. The Go Agent does NOT start
// JDT LS or send LSP initialize.
//
// The launch descriptor is a JSON payload with the command,
// JVM arguments, working directory, and environment variables
// the Theia backend needs to spawn the JDT LS process.

type jdtlsService struct {
	mu        sync.Mutex
	mgr       *jdtls.Manager
	logger    *log.Logger
	sourceLvl string
}

const defaultJDTLSMaxHeapMB = 768

// jdtlsMaxHeapMB keeps the default useful for real legacy workspaces while
// allowing constrained deployments to tune it without rebuilding Kairo.
// Bounds prevent accidental values that either guarantee GC thrashing or can
// exhaust a developer machine.
func jdtlsMaxHeapMB() int {
	const minHeapMB = 256
	const maxHeapMB = 4096
	raw := os.Getenv("KAIRO_JDTLS_MAX_HEAP_MB")
	if raw == "" {
		return defaultJDTLSMaxHeapMB
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minHeapMB || value > maxHeapMB {
		return defaultJDTLSMaxHeapMB
	}
	return value
}

func newJDTLSService(dataDir, bundled string, logger *log.Logger, skipSHAVerify bool, jdtlsURL string) *jdtlsService {
	mgr := jdtls.New(dataDir, bundled, os.Getenv("KAIRO_JRE17_HOME"), skipSHAVerify, jdtlsURL, logger)
	return &jdtlsService{
		mgr:       mgr,
		logger:    logger,
		sourceLvl: "1.6",
	}
}

// jdtlsStatus is the JSON shape /api/v1/jdtls GET returns.
type jdtlsStatus struct {
	State       string `json:"state"`
	Pid         int    `json:"pid,omitempty"`
	Version     string `json:"version,omitempty"`
	StartedAt   string `json:"startedAt,omitempty"`
	StoppedAt   string `json:"stoppedAt,omitempty"`
	JRE         string `json:"jre,omitempty"`
	Jar         string `json:"jar,omitempty"`
	SourceLevel string `json:"sourceLevel,omitempty"`
	LastError   string `json:"lastError,omitempty"`
}

func (s *jdtlsService) Status() (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := jdtlsStatus{
		State:       s.mgr.State(),
		Version:     jdtls.JDTLSVersion,
		JRE:         s.mgr.JREPath(),
		SourceLevel: s.sourceLvl,
		LastError:   s.mgr.LastError(),
	}
	if last := s.mgr.LastStart(); last != nil {
		st.Pid = last.Pid
		st.StartedAt = last.StartedAt
		st.Jar = last.Jar
	}
	return json.Marshal(st)
}

func (s *jdtlsService) Prepare(ctx context.Context) (json.RawMessage, error) {
	rep, err := s.mgr.EnsureInstalled(ctx)
	if err != nil {
		return nil, err
	}
	return json.Marshal(rep)
}

// GetLaunchDescriptor returns the JVM launch descriptor for JDT LS.
// The Theia backend uses this to spawn the JDT LS process and own
// the LSP communication over stdio.
func (s *jdtlsService) GetLaunchDescriptor(ctx context.Context, workspaceID string, projectID string) (json.RawMessage, error) {
	// Ensure the distribution is installed first
	rep, err := s.mgr.EnsureInstalled(ctx)
	if err != nil {
		return nil, fmt.Errorf("jdtls distribution not installed: %w", err)
	}
	_ = rep

	// Build the launch descriptor
	javaBin := filepath.Join(s.mgr.JREPath(), "bin", "java")
	jdtlsDir := filepath.Join(s.mgr.BundledDir(), "jdtls")
	launcherGlob := filepath.Join(jdtlsDir, "plugins", "org.eclipse.equinox.launcher_*.jar")
	matches, err := filepath.Glob(launcherGlob)
	if err != nil || len(matches) == 0 {
		return nil, fmt.Errorf("JDT LS launcher not found in %s. Please run prepare first.", jdtlsDir)
	}

	configDir := filepath.Join(s.mgr.DataDir(), "runtime", "jdtls-config")
	os.MkdirAll(configDir, 0755)

	workspaceData := filepath.Join(s.mgr.DataDir(), "runtime", "jdtls-workspace", workspaceID+"_"+projectID)

	args := []string{
		"-Declipse.application=org.eclipse.jdt.ls.core.id1",
		"-Dosgi.bundles.defaultStartLevel=4",
		"-Declipse.product=org.eclipse.jdt.ls.core.product",
		"-Dlog.protocol=false",
		"-Dlog.level=WARN",
		"-Xms128m",
		fmt.Sprintf("-Xmx%dm", jdtlsMaxHeapMB()),
		"-XX:+UseG1GC",
		"-XX:MaxGCPauseMillis=200",
		"-jar", matches[0],
		"-configuration", configDir,
		"-data", workspaceData,
	}

	desc := map[string]interface{}{
		"command":    javaBin,
		"args":       args,
		"workingDir": projectID, // will be resolved to project root by the caller
		"env":        os.Environ(),
	}
	return json.Marshal(desc)
}
