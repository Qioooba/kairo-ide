// Package remote implements the container isolation service for Phase 3+
// remote Linux agent functionality.
//
// Provides:
//   - Docker and Podman container lifecycle management
//   - Container creation, start, stop, and removal
//   - Command execution inside containers
//   - File copy to/from containers
//   - Dockerfile builds
//   - Provider auto-detection
//   - Resource usage tracking
package remote

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ContainerProvider represents a container runtime provider.
type ContainerProvider string

const (
	// ProviderDocker uses Docker as the container runtime.
	ProviderDocker ContainerProvider = "docker"
	// ProviderPodman uses Podman as the container runtime.
	ProviderPodman ContainerProvider = "podman"
)

// ContainerConfig holds the configuration for creating a container.
type ContainerConfig struct {
	Image       string            `json:"image"`
	Name        string            `json:"name"`
	WorkDir     string            `json:"workDir"`
	Mounts      []ContainerMount  `json:"mounts"`
	Ports       []ContainerPort   `json:"ports"`
	Environment map[string]string `json:"environment"`
	Network     string            `json:"network"`    // "bridge" | "host" | "none"
	MemoryLimit int64             `json:"memoryLimit"` // bytes
	CPULimit    float64           `json:"cpuLimit"`   // cores
	Provider    ContainerProvider `json:"provider"`
}

// ContainerMount represents a volume mount for a container.
type ContainerMount struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
	ReadOnly    bool   `json:"readOnly"`
}

// ContainerPort represents a port mapping for a container.
type ContainerPort struct {
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	Protocol      string `json:"protocol"` // "tcp" | "udp"
}

// ContainerStatus represents the current state of a container.
type ContainerStatus struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Image       string          `json:"image"`
	State       string          `json:"state"` // "running" | "stopped" | "paused"
	StartedAt   time.Time       `json:"startedAt"`
	Ports       []ContainerPort `json:"ports"`
	MemoryUsage int64           `json:"memoryUsage"`
	CPUUsage    float64         `json:"cpuUsage"`
}

// ContainerIsolationManager manages container lifecycle.
type ContainerIsolationManager struct {
	mu         sync.RWMutex
	containers map[string]*ContainerStatus
	provider   ContainerProvider
}

// NewContainerIsolationManager creates a new container isolation manager.
func NewContainerIsolationManager(provider ContainerProvider) *ContainerIsolationManager {
	if provider == "" {
		provider = DetectProvider()
	}
	return &ContainerIsolationManager{
		containers: make(map[string]*ContainerStatus),
		provider:   provider,
	}
}

// generateContainerID generates a unique container ID.
func generateContainerID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		h := hex.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
		return h[:16]
	}
	return hex.EncodeToString(b)
}

// command returns the CLI command string for the configured provider.
func (m *ContainerIsolationManager) command() string {
	return string(m.provider)
}

// CreateContainer creates a new container from the given configuration.
func (m *ContainerIsolationManager) CreateContainer(cfg ContainerConfig) (string, error) {
	if cfg.Image == "" {
		return "", fmt.Errorf("container_isolation: image is required")
	}

	// Validate provider
	if cfg.Provider != "" {
		m.provider = cfg.Provider
	}

	// Generate or use provided name
	id := generateContainerID()
	containerName := cfg.Name
	if containerName == "" {
		containerName = "kairo-" + id[:12]
	}

	// Build docker/podman create command arguments
	args := []string{"create", "--name", containerName}

	if cfg.WorkDir != "" {
		args = append(args, "-w", cfg.WorkDir)
	}

	for _, mount := range cfg.Mounts {
		mountOpt := mount.Source + ":" + mount.Destination
		if mount.ReadOnly {
			mountOpt += ":ro"
		}
		args = append(args, "-v", mountOpt)
	}

	for _, port := range cfg.Ports {
		proto := port.Protocol
		if proto == "" {
			proto = "tcp"
		}
		args = append(args, "-p", fmt.Sprintf("%d:%d/%s", port.HostPort, port.ContainerPort, proto))
	}

	for k, v := range cfg.Environment {
		args = append(args, "-e", k+"="+v)
	}

	if cfg.Network != "" {
		args = append(args, "--network", cfg.Network)
	}

	if cfg.MemoryLimit > 0 {
		args = append(args, "--memory", fmt.Sprintf("%d", cfg.MemoryLimit))
	}

	if cfg.CPULimit > 0 {
		args = append(args, "--cpus", fmt.Sprintf("%.2f", cfg.CPULimit))
	}

	args = append(args, cfg.Image)

	cmd := exec.Command(m.command(), args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("container_isolation: create container: %w: %s", err, string(output))
	}

	containerID := strings.TrimSpace(string(output))
	if containerID == "" {
		containerID = id
	}

	status := &ContainerStatus{
		ID:    containerID,
		Name:  containerName,
		Image: cfg.Image,
		State: "stopped",
		Ports: cfg.Ports,
	}

	m.mu.Lock()
	m.containers[containerID] = status
	m.mu.Unlock()

	return containerID, nil
}

// StartContainer starts an existing container.
func (m *ContainerIsolationManager) StartContainer(id string) error {
	m.mu.RLock()
	status, ok := m.containers[id]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("container_isolation: container not found: %s", id)
	}

	cmd := exec.Command(m.command(), "start", id)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("container_isolation: start container: %w: %s", err, string(output))
	}

	m.mu.Lock()
	status.State = "running"
	status.StartedAt = time.Now()
	m.mu.Unlock()

	return nil
}

// StopContainer stops a running container.
func (m *ContainerIsolationManager) StopContainer(id string) error {
	m.mu.RLock()
	_, ok := m.containers[id]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("container_isolation: container not found: %s", id)
	}

	cmd := exec.Command(m.command(), "stop", id)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("container_isolation: stop container: %w: %s", err, string(output))
	}

	m.mu.Lock()
	if s, exists := m.containers[id]; exists {
		s.State = "stopped"
	}
	m.mu.Unlock()

	return nil
}

// RemoveContainer removes a stopped container.
func (m *ContainerIsolationManager) RemoveContainer(id string) error {
	m.mu.RLock()
	_, ok := m.containers[id]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("container_isolation: container not found: %s", id)
	}

	cmd := exec.Command(m.command(), "rm", "-f", id)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("container_isolation: remove container: %w: %s", err, string(output))
	}

	m.mu.Lock()
	delete(m.containers, id)
	m.mu.Unlock()

	return nil
}

// GetContainerStatus returns the current status of a container.
func (m *ContainerIsolationManager) GetContainerStatus(id string) (*ContainerStatus, error) {
	m.mu.RLock()
	status, ok := m.containers[id]
	m.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("container_isolation: container not found: %s", id)
	}

	// Try to get real-time status from the container runtime
	cmd := exec.Command(m.command(), "inspect", "--format",
		`{{.State.Status}}|{{.State.StartedAt}}`,
		id)
	output, err := cmd.CombinedOutput()
	if err == nil {
		parts := strings.SplitN(strings.TrimSpace(string(output)), "|", 2)
		if len(parts) >= 1 && parts[0] != "" {
			status.State = parts[0]
		}
		if len(parts) >= 2 && parts[1] != "" {
			if t, err := time.Parse(time.RFC3339Nano, parts[1]); err == nil {
				status.StartedAt = t
			}
		}
	}

	// Try to get memory usage
	cmd = exec.Command(m.command(), "stats", "--no-stream", "--format",
		`{{.MemUsage}}`,
		id)
	output, err = cmd.CombinedOutput()
	if err == nil {
		status.MemoryUsage = parseMemoryUsage(strings.TrimSpace(string(output)))
	}

	// Try to get CPU usage
	cmd = exec.Command(m.command(), "stats", "--no-stream", "--format",
		`{{.CPUPerc}}`,
		id)
	output, err = cmd.CombinedOutput()
	if err == nil {
		status.CPUUsage = parseCPUUsage(strings.TrimSpace(string(output)))
	}

	return status, nil
}

// ListContainers returns all managed containers.
func (m *ContainerIsolationManager) ListContainers() []*ContainerStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*ContainerStatus, 0, len(m.containers))
	for _, s := range m.containers {
		result = append(result, s)
	}
	return result
}

// ExecInContainer executes a command inside a container.
func (m *ContainerIsolationManager) ExecInContainer(id string, cmd []string) (string, error) {
	m.mu.RLock()
	_, ok := m.containers[id]
	m.mu.RUnlock()

	if !ok {
		return "", fmt.Errorf("container_isolation: container not found: %s", id)
	}

	args := append([]string{"exec", id}, cmd...)
	execCmd := exec.Command(m.command(), args...)
	output, err := execCmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("container_isolation: exec: %w: %s", err, string(output))
	}

	return string(output), nil
}

// CopyToContainer copies a file from the host to a container.
func (m *ContainerIsolationManager) CopyToContainer(id string, srcPath, dstPath string) error {
	m.mu.RLock()
	_, ok := m.containers[id]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("container_isolation: container not found: %s", id)
	}

	// Verify source file exists
	if _, err := os.Stat(srcPath); err != nil {
		return fmt.Errorf("container_isolation: source not found: %w", err)
	}

	cmd := exec.Command(m.command(), "cp", srcPath, id+":"+dstPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("container_isolation: copy to container: %w: %s", err, string(output))
	}

	return nil
}

// CopyFromContainer copies a file from a container to the host.
func (m *ContainerIsolationManager) CopyFromContainer(id string, srcPath, dstPath string) error {
	m.mu.RLock()
	_, ok := m.containers[id]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("container_isolation: container not found: %s", id)
	}

	// Ensure destination directory exists
	dir := filepath.Dir(dstPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("container_isolation: create dest dir: %w", err)
	}

	cmd := exec.Command(m.command(), "cp", id+":"+srcPath, dstPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("container_isolation: copy from container: %w: %s", err, string(output))
	}

	return nil
}

// BuildDockerfile builds a Docker image from a Dockerfile.
func (m *ContainerIsolationManager) BuildDockerfile(dockerfilePath string, tag string) error {
	if dockerfilePath == "" {
		return fmt.Errorf("container_isolation: dockerfile path is required")
	}
	if tag == "" {
		return fmt.Errorf("container_isolation: tag is required")
	}

	// Verify Dockerfile exists
	if _, err := os.Stat(dockerfilePath); err != nil {
		return fmt.Errorf("container_isolation: dockerfile not found: %w", err)
	}

	buildDir := filepath.Dir(dockerfilePath)
	cmd := exec.Command(m.command(), "build", "-t", tag, "-f", dockerfilePath, buildDir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("container_isolation: build: %w: %s", err, string(output))
	}

	return nil
}

// DetectProvider detects the available container runtime on the system.
func DetectProvider() ContainerProvider {
	providers := []ContainerProvider{ProviderDocker, ProviderPodman}

	for _, p := range providers {
		cmd := exec.Command(string(p), "--version")
		output, err := cmd.CombinedOutput()
		if err == nil {
			outputStr := strings.ToLower(string(output))
			if strings.Contains(outputStr, string(p)) {
				return p
			}
		}
	}

	return ProviderDocker
}

// parseMemoryUsage parses a memory usage string like "10.5MiB / 1GiB" or "123456789B / 2GB".
func parseMemoryUsage(s string) int64 {
	if s == "" {
		return 0
	}

	// Extract the first part (current usage) before "/"
	if idx := strings.Index(s, "/"); idx >= 0 {
		s = strings.TrimSpace(s[:idx])
	}
	s = strings.TrimSpace(s)

	// Parse numeric part and unit
	multiplier := int64(1)
	switch {
	case strings.HasSuffix(s, "GiB"):
		multiplier = 1024 * 1024 * 1024
		s = strings.TrimSuffix(s, "GiB")
	case strings.HasSuffix(s, "MiB"):
		multiplier = 1024 * 1024
		s = strings.TrimSuffix(s, "MiB")
	case strings.HasSuffix(s, "KiB"):
		multiplier = 1024
		s = strings.TrimSuffix(s, "KiB")
	case strings.HasSuffix(s, "GB"):
		multiplier = 1000 * 1000 * 1000
		s = strings.TrimSuffix(s, "GB")
	case strings.HasSuffix(s, "MB"):
		multiplier = 1000 * 1000
		s = strings.TrimSuffix(s, "MB")
	case strings.HasSuffix(s, "KB"):
		multiplier = 1000
		s = strings.TrimSuffix(s, "KB")
	case strings.HasSuffix(s, "B"):
		s = strings.TrimSuffix(s, "B")
	}

	var val float64
	fmt.Sscanf(s, "%f", &val)
	return int64(val * float64(multiplier))
}

// parseCPUUsage parses a CPU usage percentage string like "15.5%".
func parseCPUUsage(s string) float64 {
	if s == "" {
		return 0
	}
	s = strings.TrimSuffix(s, "%")
	var val float64
	fmt.Sscanf(s, "%f", &val)
	return val
}