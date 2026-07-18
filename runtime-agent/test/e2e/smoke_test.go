//go:build e2e
// +build e2e

// Package e2e exercises the full Build → Deploy → Run pipeline
// against a real kairo-runtime agent process.
//
// Run with:
//
//	go test -tags=e2e -count=1 ./test/e2e/...
//
// KAIRO_AGENT_PATH can be set to override the agent binary path
// (default: ../../kairo-runtime).
package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

const (
	agentPort    = 18999
	agentBaseURL = "http://127.0.0.1:18999"
	testTimeout  = 30 * time.Second
)

var agentCmd *exec.Cmd

func TestMain(m *testing.M) {
	// Start Go Agent
	dataDir, err := os.MkdirTemp("", "kairo-e2e-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create temp dir: %v\n", err)
		os.Exit(1)
	}
	defer os.RemoveAll(dataDir)

	agentPath := os.Getenv("KAIRO_AGENT_PATH")
	if agentPath == "" {
		agentPath = "../../kairo-runtime"
	}

	agentCmd = exec.Command(agentPath,
		"--port", fmt.Sprintf("%d", agentPort),
		"--data-dir", dataDir,
		"--bind", "127.0.0.1",
	)
	agentCmd.Stdout = os.Stdout
	agentCmd.Stderr = os.Stderr

	if err := agentCmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start agent: %v\n", err)
		os.Exit(1)
	}

	// Wait for health
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	healthy := false
	for !healthy {
		resp, err := http.Get(agentBaseURL + "/api/v1/health")
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			healthy = true
			break
		}
		if resp != nil {
			resp.Body.Close()
		}
		select {
		case <-ctx.Done():
			fmt.Fprintln(os.Stderr, "Agent health check timed out")
			agentCmd.Process.Kill()
			os.Exit(1)
		case <-time.After(200 * time.Millisecond):
		}
	}

	code := m.Run()

	agentCmd.Process.Signal(os.Interrupt)
	agentCmd.Wait()
	os.Exit(code)
}

func TestHealthEndpoint(t *testing.T) {
	resp, err := http.Get(agentBaseURL + "/api/v1/health")
	if err != nil {
		t.Fatalf("health check failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestWorkspaceLifecycle(t *testing.T) {
	// Create workspace — the API expects an envelope with "payload" containing
	// "rootPath" and "name".
	rootDir, err := os.MkdirTemp("", "kairo-e2e-ws-*")
	if err != nil {
		t.Fatalf("create temp dir: %v", err)
	}
	defer os.RemoveAll(rootDir)

	resp, err := httpPost(agentBaseURL+"/api/v1/workspaces", map[string]string{
		"name":     "test-workspace",
		"rootPath": rootDir,
	})
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		t.Errorf("expected 200/201, got %d", resp.StatusCode)
	}

	// List workspaces
	resp, err = http.Get(agentBaseURL + "/api/v1/workspaces")
	if err != nil {
		t.Fatalf("list workspaces: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("list workspaces: expected 200, got %d", resp.StatusCode)
	}
}

func TestEncodingValidate(t *testing.T) {
	resp, err := httpPost(agentBaseURL+"/api/v1/encoding/validate", map[string]interface{}{
		"text":     "Hello World",
		"encoding": "GBK",
	})
	if err != nil {
		t.Fatalf("encoding validate: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestConcurrentRequests(t *testing.T) {
	// Send 10 concurrent health checks
	done := make(chan error, 10)
	for i := 0; i < 10; i++ {
		go func() {
			resp, err := http.Get(agentBaseURL + "/api/v1/health")
			if err != nil {
				done <- err
				return
			}
			resp.Body.Close()
			if resp.StatusCode != 200 {
				done <- fmt.Errorf("unexpected status: %d", resp.StatusCode)
				return
			}
			done <- nil
		}()
	}

	for i := 0; i < 10; i++ {
		if err := <-done; err != nil {
			t.Errorf("concurrent request failed: %v", err)
		}
	}
}

func httpPost(url string, payload interface{}) (*http.Response, error) {
	body := map[string]interface{}{
		"requestId": fmt.Sprintf("e2e-%d", time.Now().UnixNano()),
		"payload":   payload,
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return http.DefaultClient.Do(req)
}

// keep imports used
var _ = filepath.Base
var _ = context.Background