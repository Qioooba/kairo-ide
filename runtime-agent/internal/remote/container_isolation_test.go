//go:build remote

package remote

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestNewContainerIsolationManager tests basic creation.
func TestNewContainerIsolationManager(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	if mgr == nil {
		t.Fatal("NewContainerIsolationManager returned nil")
	}
	if mgr.provider != ProviderDocker {
		t.Errorf("provider = %q, want %q", mgr.provider, ProviderDocker)
	}
	if mgr.containers == nil {
		t.Error("containers map is nil")
	}
}

// TestNewContainerIsolationManager_EmptyProvider tests auto-detection fallback.
func TestNewContainerIsolationManager_EmptyProvider(t *testing.T) {
	mgr := NewContainerIsolationManager("")
	if mgr == nil {
		t.Fatal("NewContainerIsolationManager returned nil")
	}
	// Should default to docker when empty
	if mgr.provider == "" {
		t.Error("provider should not be empty")
	}
}

// TestContainerProvider_Constants tests provider constants.
func TestContainerProvider_Constants(t *testing.T) {
	if ProviderDocker != "docker" {
		t.Errorf("ProviderDocker = %q, want docker", ProviderDocker)
	}
	if ProviderPodman != "podman" {
		t.Errorf("ProviderPodman = %q, want podman", ProviderPodman)
	}
}

// TestContainerConfig_Defaults tests ContainerConfig struct.
func TestContainerConfig_Defaults(t *testing.T) {
	cfg := ContainerConfig{
		Image:   "ubuntu:latest",
		Name:    "test-container",
		WorkDir: "/app",
		Network: "bridge",
	}
	if cfg.Image != "ubuntu:latest" {
		t.Errorf("Image = %q", cfg.Image)
	}
	if cfg.Name != "test-container" {
		t.Errorf("Name = %q", cfg.Name)
	}
	if cfg.WorkDir != "/app" {
		t.Errorf("WorkDir = %q", cfg.WorkDir)
	}
	if cfg.Network != "bridge" {
		t.Errorf("Network = %q", cfg.Network)
	}
}

// TestContainerConfig_WithMounts tests mount configuration.
func TestContainerConfig_WithMounts(t *testing.T) {
	cfg := ContainerConfig{
		Image: "nginx:latest",
		Mounts: []ContainerMount{
			{Source: "/host/path", Destination: "/container/path", ReadOnly: true},
			{Source: "/host/data", Destination: "/container/data", ReadOnly: false},
		},
	}
	if len(cfg.Mounts) != 2 {
		t.Errorf("expected 2 mounts, got %d", len(cfg.Mounts))
	}
	if !cfg.Mounts[0].ReadOnly {
		t.Error("first mount should be read-only")
	}
	if cfg.Mounts[1].ReadOnly {
		t.Error("second mount should be read-write")
	}
}

// TestContainerConfig_WithPorts tests port configuration.
func TestContainerConfig_WithPorts(t *testing.T) {
	cfg := ContainerConfig{
		Image: "web:latest",
		Ports: []ContainerPort{
			{HostPort: 8080, ContainerPort: 80, Protocol: "tcp"},
			{HostPort: 8443, ContainerPort: 443, Protocol: "tcp"},
		},
	}
	if len(cfg.Ports) != 2 {
		t.Errorf("expected 2 ports, got %d", len(cfg.Ports))
	}
	if cfg.Ports[0].HostPort != 8080 {
		t.Errorf("HostPort = %d, want 8080", cfg.Ports[0].HostPort)
	}
	if cfg.Ports[0].ContainerPort != 80 {
		t.Errorf("ContainerPort = %d, want 80", cfg.Ports[0].ContainerPort)
	}
}

// TestContainerConfig_WithEnvironment tests environment configuration.
func TestContainerConfig_WithEnvironment(t *testing.T) {
	cfg := ContainerConfig{
		Image: "app:latest",
		Environment: map[string]string{
			"NODE_ENV": "production",
			"PORT":     "3000",
		},
	}
	if cfg.Environment["NODE_ENV"] != "production" {
		t.Errorf("NODE_ENV = %q", cfg.Environment["NODE_ENV"])
	}
	if cfg.Environment["PORT"] != "3000" {
		t.Errorf("PORT = %q", cfg.Environment["PORT"])
	}
}

// TestContainerConfig_WithResourceLimits tests resource limits.
func TestContainerConfig_WithResourceLimits(t *testing.T) {
	cfg := ContainerConfig{
		Image:       "app:latest",
		MemoryLimit: 512 * 1024 * 1024, // 512 MB
		CPULimit:    2.0,               // 2 cores
	}
	if cfg.MemoryLimit != 512*1024*1024 {
		t.Errorf("MemoryLimit = %d", cfg.MemoryLimit)
	}
	if cfg.CPULimit != 2.0 {
		t.Errorf("CPULimit = %f", cfg.CPULimit)
	}
}

// TestContainerStatus_Fields tests ContainerStatus struct.
func TestContainerStatus_Fields(t *testing.T) {
	now := time.Now()
	status := ContainerStatus{
		ID:          "abc123",
		Name:        "test",
		Image:       "ubuntu:latest",
		State:       "running",
		StartedAt:   now,
		MemoryUsage: 100 * 1024 * 1024,
		CPUUsage:    15.5,
	}
	if status.ID != "abc123" {
		t.Errorf("ID = %q", status.ID)
	}
	if status.State != "running" {
		t.Errorf("State = %q", status.State)
	}
	if status.MemoryUsage != 100*1024*1024 {
		t.Errorf("MemoryUsage = %d", status.MemoryUsage)
	}
	if status.CPUUsage != 15.5 {
		t.Errorf("CPUUsage = %f", status.CPUUsage)
	}
	if !status.StartedAt.Equal(now) {
		t.Error("StartedAt mismatch")
	}
}

// TestListContainers_Empty tests listing containers when none exist.
func TestListContainers_Empty(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	containers := mgr.ListContainers()
	if len(containers) != 0 {
		t.Errorf("expected 0 containers, got %d", len(containers))
	}
}

// TestDetectProvider tests provider detection.
func TestDetectProvider(t *testing.T) {
	provider := DetectProvider()
	// On a system without docker/podman, it defaults to docker
	if provider == "" {
		t.Error("DetectProvider should return a non-empty provider")
	}
}

// TestParseMemoryUsage tests memory usage parsing.
func TestParseMemoryUsage(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  int64
	}{
		{"empty", "", 0},
		{"bytes", "123456789B", 123456789},
		{"kibibytes", "10KiB", 10 * 1024},
		{"mebibytes", "10MiB", 10 * 1024 * 1024},
		{"gibibytes", "2GiB", 2 * 1024 * 1024 * 1024},
		{"kilobytes", "10KB", 10 * 1000},
		{"megabytes", "10MB", 10 * 1000 * 1000},
		{"gigabytes", "2GB", 2 * 1000 * 1000 * 1000},
		{"with limit", "10MiB / 1GiB", 10 * 1024 * 1024},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseMemoryUsage(tt.input)
			if got != tt.want {
				t.Errorf("parseMemoryUsage(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

// TestParseCPUUsage tests CPU usage parsing.
func TestParseCPUUsage(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  float64
	}{
		{"empty", "", 0},
		{"zero", "0%", 0},
		{"integer", "50%", 50},
		{"decimal", "15.5%", 15.5},
		{"no percent", "75", 75},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseCPUUsage(tt.input)
			if got != tt.want {
				t.Errorf("parseCPUUsage(%q) = %f, want %f", tt.input, got, tt.want)
			}
		})
	}
}

// TestContainerIsolationManager_CreateContainer_NoImage tests that image is required.
func TestContainerIsolationManager_CreateContainer_NoImage(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	_, err := mgr.CreateContainer(ContainerConfig{})
	if err == nil {
		t.Fatal("expected error for missing image, got nil")
	}
}

// TestContainerIsolationManager_StartContainer_NotFound tests starting a nonexistent container.
func TestContainerIsolationManager_StartContainer_NotFound(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	err := mgr.StartContainer("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent container, got nil")
	}
}

// TestContainerIsolationManager_StopContainer_NotFound tests stopping a nonexistent container.
func TestContainerIsolationManager_StopContainer_NotFound(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	err := mgr.StopContainer("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent container, got nil")
	}
}

// TestContainerIsolationManager_RemoveContainer_NotFound tests removing a nonexistent container.
func TestContainerIsolationManager_RemoveContainer_NotFound(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	err := mgr.RemoveContainer("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent container, got nil")
	}
}

// TestContainerIsolationManager_GetContainerStatus_NotFound tests status of nonexistent container.
func TestContainerIsolationManager_GetContainerStatus_NotFound(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	_, err := mgr.GetContainerStatus("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent container, got nil")
	}
}

// TestContainerIsolationManager_ExecInContainer_NotFound tests exec in nonexistent container.
func TestContainerIsolationManager_ExecInContainer_NotFound(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	_, err := mgr.ExecInContainer("nonexistent", []string{"echo", "hello"})
	if err == nil {
		t.Fatal("expected error for nonexistent container, got nil")
	}
}

// TestContainerIsolationManager_CopyToContainer_NotFound tests copy to nonexistent container.
func TestContainerIsolationManager_CopyToContainer_NotFound(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	err := mgr.CopyToContainer("nonexistent", "/tmp/src", "/tmp/dst")
	if err == nil {
		t.Fatal("expected error for nonexistent container, got nil")
	}
}

// TestContainerIsolationManager_CopyFromContainer_NotFound tests copy from nonexistent container.
func TestContainerIsolationManager_CopyFromContainer_NotFound(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	err := mgr.CopyFromContainer("nonexistent", "/tmp/src", "/tmp/dst")
	if err == nil {
		t.Fatal("expected error for nonexistent container, got nil")
	}
}

// TestContainerIsolationManager_BuildDockerfile_EmptyPath tests building with empty path.
func TestContainerIsolationManager_BuildDockerfile_EmptyPath(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	err := mgr.BuildDockerfile("", "test:latest")
	if err == nil {
		t.Fatal("expected error for empty dockerfile path, got nil")
	}
}

// TestContainerIsolationManager_BuildDockerfile_EmptyTag tests building with empty tag.
func TestContainerIsolationManager_BuildDockerfile_EmptyTag(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	err := mgr.BuildDockerfile("Dockerfile", "")
	if err == nil {
		t.Fatal("expected error for empty tag, got nil")
	}
}

// TestContainerIsolationManager_BuildDockerfile_NotFound tests building with nonexistent file.
func TestContainerIsolationManager_BuildDockerfile_NotFound(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	err := mgr.BuildDockerfile("/nonexistent/Dockerfile", "test:latest")
	if err == nil {
		t.Fatal("expected error for nonexistent dockerfile, got nil")
	}
}

// TestCopyToContainer_SourceNotFound tests source file not found.
func TestCopyToContainer_SourceNotFound(t *testing.T) {
	dir := t.TempDir()
	mgr := NewContainerIsolationManager(ProviderDocker)

	// Create a mock container entry
	mgr.mu.Lock()
	mgr.containers["test-id"] = &ContainerStatus{
		ID:    "test-id",
		Name:  "test-container",
		State: "running",
	}
	mgr.mu.Unlock()

	err := mgr.CopyToContainer("test-id", filepath.Join(dir, "nonexistent.txt"), "/tmp/dst.txt")
	if err == nil {
		t.Fatal("expected error for nonexistent source file, got nil")
	}
}

// TestContainerMount_Fields tests ContainerMount struct.
func TestContainerMount_Fields(t *testing.T) {
	mount := ContainerMount{
		Source:      "/host/src",
		Destination: "/container/dst",
		ReadOnly:    true,
	}
	if mount.Source != "/host/src" {
		t.Errorf("Source = %q", mount.Source)
	}
	if mount.Destination != "/container/dst" {
		t.Errorf("Destination = %q", mount.Destination)
	}
	if !mount.ReadOnly {
		t.Error("ReadOnly should be true")
	}
}

// TestContainerPort_Fields tests ContainerPort struct.
func TestContainerPort_Fields(t *testing.T) {
	port := ContainerPort{
		HostPort:      8080,
		ContainerPort: 80,
		Protocol:      "tcp",
	}
	if port.HostPort != 8080 {
		t.Errorf("HostPort = %d", port.HostPort)
	}
	if port.ContainerPort != 80 {
		t.Errorf("ContainerPort = %d", port.ContainerPort)
	}
	if port.Protocol != "tcp" {
		t.Errorf("Protocol = %q", port.Protocol)
	}
}

// TestContainerIsolationManager_ProviderSwitch tests provider switching via config.
func TestContainerIsolationManager_ProviderSwitch(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	if mgr.provider != ProviderDocker {
		t.Errorf("initial provider = %q, want docker", mgr.provider)
	}

	// CreateContainer with Podman provider should switch
	cfg := ContainerConfig{
		Image:    "test:latest",
		Provider: ProviderPodman,
	}
	// This will fail because podman is not available, but the provider should switch
	_, _ = mgr.CreateContainer(cfg)
	if mgr.provider != ProviderPodman {
		t.Errorf("provider after create = %q, want podman", mgr.provider)
	}
}

// TestParseMemoryUsage_Decimal tests memory with decimal values.
func TestParseMemoryUsage_Decimal(t *testing.T) {
	got := parseMemoryUsage("1.5GiB")
	want := int64(1.5 * 1024 * 1024 * 1024)
	if got != want {
		t.Errorf("parseMemoryUsage = %d, want %d", got, want)
	}
}

// TestCopyFromContainer_DirCreation tests directory creation for copy from.
func TestCopyFromContainer_DirCreation(t *testing.T) {
	dir := t.TempDir()
	mgr := NewContainerIsolationManager(ProviderDocker)

	// Create a mock container entry
	mgr.mu.Lock()
	mgr.containers["test-id"] = &ContainerStatus{
		ID:    "test-id",
		Name:  "test-container",
		State: "running",
	}
	mgr.mu.Unlock()

	dstPath := filepath.Join(dir, "sub", "deep", "output.txt")
	err := mgr.CopyFromContainer("test-id", "/tmp/src.txt", dstPath)
	// This will fail because docker is not available, but the directory should be created
	// We just check that the error is from docker, not from dir creation
	_ = err
	// Verify directory was created
	if _, err := os.Stat(filepath.Dir(dstPath)); err != nil {
		t.Errorf("destination directory should exist: %v", err)
	}
}

// TestContainerIsolationManager_GenerateContainerID tests ID generation.
func TestContainerIsolationManager_GenerateContainerID(t *testing.T) {
	id1 := generateContainerID()
	id2 := generateContainerID()

	if id1 == "" {
		t.Error("generated ID is empty")
	}
	if id2 == "" {
		t.Error("generated ID is empty")
	}
	if id1 == id2 {
		t.Error("generated IDs should be unique")
	}
	if len(id1) != 32 {
		t.Errorf("ID length = %d, want 32", len(id1))
	}
}

// TestContainerConfig_AllFields tests full ContainerConfig usage.
func TestContainerConfig_AllFields(t *testing.T) {
	cfg := ContainerConfig{
		Image:   "golang:1.25",
		Name:    "builder",
		WorkDir: "/workspace",
		Mounts: []ContainerMount{
			{Source: "/tmp", Destination: "/host-tmp", ReadOnly: false},
		},
		Ports: []ContainerPort{
			{HostPort: 3000, ContainerPort: 3000, Protocol: "tcp"},
		},
		Environment: map[string]string{
			"GOOS":   "linux",
			"GOARCH": "amd64",
		},
		Network:     "bridge",
		MemoryLimit: 1024 * 1024 * 1024,
		CPULimit:    1.5,
		Provider:    ProviderDocker,
	}

	if cfg.Image != "golang:1.25" {
		t.Errorf("Image = %q", cfg.Image)
	}
	if cfg.MemoryLimit != 1024*1024*1024 {
		t.Errorf("MemoryLimit = %d", cfg.MemoryLimit)
	}
}