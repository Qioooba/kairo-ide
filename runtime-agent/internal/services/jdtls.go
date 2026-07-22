package services

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/jdtls"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
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
//
// The descriptor does NOT include os.Environ() — only the minimal
// allowlist of PATH, JAVA_HOME, and essential JVM variables.
func (s *jdtlsService) GetLaunchDescriptor(ctx context.Context, workspaceID string, projectID string, workingDir string) (json.RawMessage, error) {
	// Ensure the distribution is installed first
	_, err := s.mgr.EnsureInstalled(ctx)
	if err != nil {
		return nil, fmt.Errorf("jdtls distribution not installed: %w", err)
	}

	// Set the per-workspace data dir so the launch descriptor
	// uses an isolated Eclipse workspace.
	s.mgr.SetWorkspace(workspaceID + "_" + projectID)

	// Build the launch descriptor. workingDir is the project root
	// resolved by the caller (handlers.go resolves from repository);
	// passing the raw projectID here produced the bogus rootUri
	// file:///project-ws_... and JDT LS opened the wrong workspace
	// (KAIRO-RC-WEB-251 follow-up).
	desc, err := s.mgr.BuildLaunchDescriptor(workingDir)
	if err != nil {
		return nil, fmt.Errorf("build launch descriptor: %w", err)
	}
	return json.Marshal(desc)
}
