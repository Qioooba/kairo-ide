// Package diagnostics provides diagnostic bundle generation for
// Kairo IDE troubleshooting. It collects system information,
// logs, and configuration into a timestamped zip file.
package diagnostics

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// MaxBundleSize is the maximum size of the diagnostic bundle in bytes.
const MaxBundleSize = 50 * 1024 * 1024 // 50 MB

// CollectionTimeout is the maximum time allowed for collecting diagnostics.
const CollectionTimeout = 60 * time.Second

// MaxLogLines is the maximum number of log lines to include.
const MaxLogLines = 1000

// MaxRecentErrors is the maximum number of recent errors to include.
const MaxRecentErrors = 50

// BundleInfo holds all the information collected for the diagnostic bundle.
type BundleInfo struct {
	KairoVersion    string            `json:"kairoVersion"`
	AgentVersion    string            `json:"agentVersion"`
	NodeVersion     string            `json:"nodeVersion,omitempty"`
	OS              OSInfo            `json:"os"`
	JDTLS           JDTLSInfo         `json:"jdtls"`
	JDK             JDKInfo           `json:"jdk"`
	Tomcat          TomcatInfo        `json:"tomcat"`
	Logs            LogCollection     `json:"logs"`
	WorkspaceConfig map[string]string `json:"workspaceConfig"`
	EnvVars         map[string]string `json:"envVars"`
	Processes       []ProcessInfo     `json:"processes"`
	PortUsage       []PortInfo        `json:"portUsage"`
	DiskUsage       DiskInfo          `json:"diskUsage"`
	RecentErrors    []string          `json:"recentErrors"`
	CollectedAt     string            `json:"collectedAt"`
}

// OSInfo holds operating system information.
type OSInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Arch    string `json:"arch"`
}

// JDTLSInfo holds JDT LS version information.
type JDTLSInfo struct {
	Version string `json:"version"`
	Home    string `json:"home,omitempty"`
}

// JDKInfo holds JDK version information.
type JDKInfo struct {
	Versions []string `json:"versions"`
	Home     string   `json:"home,omitempty"`
}

// TomcatInfo holds Tomcat configuration.
type TomcatInfo struct {
	Version       string `json:"version"`
	CatalinaHome  string `json:"catalinaHome,omitempty"`
	CatalinaBase  string `json:"catalinaBase,omitempty"`
	Configuration string `json:"configuration,omitempty"`
}

// LogCollection holds recent log lines from various sources.
type LogCollection struct {
	Agent  []string `json:"agent"`
	JDTLS  []string `json:"jdtls"`
	Tomcat []string `json:"tomcat"`
}

// ProcessInfo holds information about a running process.
type ProcessInfo struct {
	PID     int    `json:"pid"`
	Command string `json:"command"`
	Memory  string `json:"memory,omitempty"`
}

// PortInfo holds port usage information.
type PortInfo struct {
	PID     int    `json:"pid"`
	Process string `json:"process"`
	Port    int    `json:"port"`
}

// DiskInfo holds disk usage information.
type DiskInfo struct {
	ProjectDir string `json:"projectDir"`
	Total      string `json:"total,omitempty"`
	Used       string `json:"used,omitempty"`
	Available  string `json:"available,omitempty"`
}

// DiagnosticBundle collects and packages diagnostic information.
type DiagnosticBundle struct {
	mu      sync.Mutex
	info    BundleInfo
	redact  *Redactor
	version string
}

// Redactor replaces sensitive values in strings.
type Redactor struct {
	patterns []*regexp.Regexp
}

// NewRedactor creates a Redactor with common secret patterns.
func NewRedactor() *Redactor {
	return &Redactor{
		patterns: []*regexp.Regexp{
			regexp.MustCompile(`(?i)(password|passwd|pwd|secret|token|api[_-]?key|apikey|auth[_-]?token|access[_-]?key)\s*[:=]\s*\S+`),
			regexp.MustCompile(`(?i)(cookie|session)\s*[:=]\s*\S+`),
			regexp.MustCompile(`(?i)(jdbc|mysql|postgresql|oracle|sqlserver)://[^@]*@`),
			regexp.MustCompile(`(?i)Bearer\s+\S+`),
			regexp.MustCompile(`(?i)Authorization\s*[:=]\s*\S+`),
			regexp.MustCompile(`-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----`),
		},
	}
}

// Apply redacts sensitive values from a string.
func (r *Redactor) Apply(s string) string {
	if r == nil {
		return s
	}
	for _, p := range r.patterns {
		s = p.ReplaceAllString(s, "${1}=[REDACTED]")
	}
	return s
}

// NewDiagnosticBundle creates a new DiagnosticBundle with the given version.
func NewDiagnosticBundle(version string) *DiagnosticBundle {
	return &DiagnosticBundle{
		info: BundleInfo{
			KairoVersion:    version,
			AgentVersion:    version,
			OS:              OSInfo{Arch: runtime.GOARCH},
			Logs:            LogCollection{},
			WorkspaceConfig: make(map[string]string),
			EnvVars:         make(map[string]string),
		},
		redact:  NewRedactor(),
		version: version,
	}
}

// Collect gathers all diagnostic information.
func (b *DiagnosticBundle) Collect(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, CollectionTimeout)
	defer cancel()

	var wg sync.WaitGroup
	errs := make(chan error, 10)

	// Collect OS info
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := b.collectOSInfo(ctx); err != nil {
			errs <- fmt.Errorf("os info: %w", err)
		}
	}()

	// Collect Node version
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := b.collectNodeVersion(ctx); err != nil {
			errs <- fmt.Errorf("node version: %w", err)
		}
	}()

	// Collect JDK info
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := b.collectJDKInfo(ctx); err != nil {
			errs <- fmt.Errorf("jdk info: %w", err)
		}
	}()

	// Collect processes
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := b.collectProcesses(ctx); err != nil {
			errs <- fmt.Errorf("processes: %w", err)
		}
	}()

	// Collect port usage
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := b.collectPortUsage(ctx); err != nil {
			errs <- fmt.Errorf("port usage: %w", err)
		}
	}()

	// Collect disk usage
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := b.collectDiskUsage(ctx, ""); err != nil {
			errs <- fmt.Errorf("disk usage: %w", err)
		}
	}()

	// Collect environment variables (redacted)
	wg.Add(1)
	go func() {
		defer wg.Done()
		b.collectEnvVars()
	}()

	wg.Wait()
	close(errs)

	b.info.CollectedAt = time.Now().UTC().Format(time.RFC3339Nano)
	b.info.OS.Name = runtime.GOOS

	// Return first error if any
	for err := range errs {
		return err
	}
	return nil
}

// GenerateZip creates a zip file at the given path with all collected
// diagnostic information.
func (b *DiagnosticBundle) GenerateZip(ctx context.Context, outputPath string) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Collect if not already done
	if b.info.CollectedAt == "" {
		if err := b.Collect(ctx); err != nil {
			return fmt.Errorf("collect: %w", err)
		}
	}

	// Create the output file
	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("create output file: %w", err)
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	defer zw.Close()

	// Track total size
	var totalSize int64

	// Write summary JSON
	summaryJSON, err := b.marshalSummary()
	if err != nil {
		return fmt.Errorf("marshal summary: %w", err)
	}
	if err := b.writeZipEntry(zw, "summary.json", summaryJSON, &totalSize); err != nil {
		return err
	}

	// Write logs
	if len(b.info.Logs.Agent) > 0 {
		content := strings.Join(b.info.Logs.Agent, "\n")
		if err := b.writeZipEntry(zw, "logs/agent.log", []byte(content), &totalSize); err != nil {
			return err
		}
	}
	if len(b.info.Logs.JDTLS) > 0 {
		content := strings.Join(b.info.Logs.JDTLS, "\n")
		if err := b.writeZipEntry(zw, "logs/jdtls.log", []byte(content), &totalSize); err != nil {
			return err
		}
	}
	if len(b.info.Logs.Tomcat) > 0 {
		content := strings.Join(b.info.Logs.Tomcat, "\n")
		if err := b.writeZipEntry(zw, "logs/tomcat.log", []byte(content), &totalSize); err != nil {
			return err
		}
	}

	// Write processes
	procData := b.marshalProcesses()
	if err := b.writeZipEntry(zw, "processes.txt", procData, &totalSize); err != nil {
		return err
	}

	// Write port usage
	portData := b.marshalPortUsage()
	if err := b.writeZipEntry(zw, "ports.txt", portData, &totalSize); err != nil {
		return err
	}

	// Write env vars
	envData := b.marshalEnvVars()
	if err := b.writeZipEntry(zw, "env.txt", envData, &totalSize); err != nil {
		return err
	}

	// Write errors
	if len(b.info.RecentErrors) > 0 {
		errData := []byte(strings.Join(b.info.RecentErrors, "\n"))
		if err := b.writeZipEntry(zw, "errors.txt", errData, &totalSize); err != nil {
			return err
		}
	}

	return nil
}

// GenerateZipPath returns a timestamped filename for the diagnostic bundle.
func GenerateZipPath() string {
	ts := time.Now().Format("20060102-150405")
	return fmt.Sprintf("kairo-diag-%s.zip", ts)
}

// AddLogLines adds agent log lines to the bundle.
func (b *DiagnosticBundle) AddLogLines(agent, jdtls, tomcat []string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(agent) > MaxLogLines {
		agent = agent[len(agent)-MaxLogLines:]
	}
	if len(jdtls) > MaxLogLines {
		jdtls = jdtls[len(jdtls)-MaxLogLines:]
	}
	if len(tomcat) > MaxLogLines {
		tomcat = tomcat[len(tomcat)-MaxLogLines:]
	}

	b.info.Logs.Agent = agent
	b.info.Logs.JDTLS = jdtls
	b.info.Logs.Tomcat = tomcat
}

// AddError adds a recent error to the bundle.
func (b *DiagnosticBundle) AddError(err string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.info.RecentErrors = append(b.info.RecentErrors, b.redact.Apply(err))
	if len(b.info.RecentErrors) > MaxRecentErrors {
		b.info.RecentErrors = b.info.RecentErrors[len(b.info.RecentErrors)-MaxRecentErrors:]
	}
}

// SetProjectDir sets the project directory for disk usage collection.
func (b *DiagnosticBundle) SetProjectDir(dir string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.info.DiskUsage.ProjectDir = dir
}

// SetWorkspaceConfig sets workspace configuration values.
func (b *DiagnosticBundle) SetWorkspaceConfig(config map[string]string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for k, v := range config {
		b.info.WorkspaceConfig[k] = b.redact.Apply(v)
	}
}

// SetTomcatInfo sets Tomcat configuration.
func (b *DiagnosticBundle) SetTomcatInfo(version, catalinaHome, catalinaBase string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.info.Tomcat = TomcatInfo{
		Version:      version,
		CatalinaHome: catalinaHome,
		CatalinaBase: catalinaBase,
	}
}

// SetJDTLSInfo sets JDT LS information.
func (b *DiagnosticBundle) SetJDTLSInfo(version, home string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.info.JDTLS = JDTLSInfo{Version: version, Home: home}
}

// ── Internal helpers ─────────────────────────────────────────────

func (b *DiagnosticBundle) collectOSInfo(ctx context.Context) error {
	b.info.OS = OSInfo{
		Name: runtime.GOOS,
		Arch: runtime.GOARCH,
	}

	switch runtime.GOOS {
	case "darwin":
		out, err := runCmd(ctx, "sw_vers", "-productVersion")
		if err == nil {
			b.info.OS.Version = strings.TrimSpace(string(out))
		}
	case "linux":
		out, err := runCmd(ctx, "uname", "-r")
		if err == nil {
			b.info.OS.Version = strings.TrimSpace(string(out))
		}
	case "windows":
		out, err := runCmd(ctx, "cmd", "/c", "ver")
		if err == nil {
			b.info.OS.Version = strings.TrimSpace(string(out))
		}
	}
	return nil
}

func (b *DiagnosticBundle) collectNodeVersion(ctx context.Context) error {
	out, err := runCmd(ctx, "node", "--version")
	if err != nil {
		return err
	}
	b.info.NodeVersion = strings.TrimSpace(string(out))
	return nil
}

func (b *DiagnosticBundle) collectJDKInfo(ctx context.Context) error {
	// Try to find java
	out, err := runCmd(ctx, "java", "-version")
	if err != nil {
		return err
	}
	// java -version writes to stderr
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			b.info.JDK.Versions = append(b.info.JDK.Versions, line)
		}
	}

	// Try to find JAVA_HOME
	if home := os.Getenv("JAVA_HOME"); home != "" {
		b.info.JDK.Home = home
	}

	return nil
}

func (b *DiagnosticBundle) collectProcesses(ctx context.Context) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin", "linux":
		cmd = exec.CommandContext(ctx, "ps", "aux")
	case "windows":
		cmd = exec.CommandContext(ctx, "tasklist")
	default:
		return nil
	}

	out, err := cmd.Output()
	if err != nil {
		return err
	}

	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		info := ProcessInfo{Command: strings.Join(fields[1:], " ")}
		// Try to parse PID — it's the first or second field depending on OS
		if pid, err := parsePID(fields[0]); err == nil {
			info.PID = pid
		}

		if len(fields) >= 4 {
			info.Memory = fields[3]
		}

		b.info.Processes = append(b.info.Processes, info)
	}

	return nil
}

func (b *DiagnosticBundle) collectPortUsage(ctx context.Context) error {
	switch runtime.GOOS {
	case "darwin":
		return b.collectPortsDarwin(ctx)
	case "linux":
		return b.collectPortsLinux(ctx)
	case "windows":
		return b.collectPortsWindows(ctx)
	}
	return nil
}

func (b *DiagnosticBundle) collectPortsDarwin(ctx context.Context) error {
	out, err := runCmd(ctx, "lsof", "-nP", "-iTCP", "-sTCP:LISTEN")
	if err != nil {
		return err
	}

	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		pid, err := parsePID(fields[1])
		if err != nil {
			continue
		}

		procName := fields[0]
		port := 0
		// Find port in the address field
		for _, f := range fields {
			if idx := strings.LastIndex(f, ":"); idx > 0 {
				if p, err := parsePID(f[idx+1:]); err == nil {
					port = p
					break
				}
			}
		}

		b.info.PortUsage = append(b.info.PortUsage, PortInfo{
			PID:     pid,
			Process: procName,
			Port:    port,
		})
	}
	return nil
}

func (b *DiagnosticBundle) collectPortsLinux(ctx context.Context) error {
	out, err := runCmd(ctx, "ss", "-tlnp")
	if err != nil {
		// Fallback to netstat
		out, err = runCmd(ctx, "netstat", "-tlnp")
		if err != nil {
			return err
		}
	}

	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Parse port from address
		fields := strings.Fields(line)
		for _, f := range fields {
			if idx := strings.LastIndex(f, ":"); idx > 0 {
				if port, err := parsePID(f[idx+1:]); err == nil {
					b.info.PortUsage = append(b.info.PortUsage, PortInfo{
						Port: port,
					})
				}
			}
		}
	}
	return nil
}

func (b *DiagnosticBundle) collectPortsWindows(ctx context.Context) error {
	out, err := runCmd(ctx, "netstat", "-ano", "-p", "TCP")
	if err != nil {
		return err
	}

	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "LISTENING") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}

		// Parse local address for port
		addr := fields[1]
		if idx := strings.LastIndex(addr, ":"); idx > 0 {
			if port, err := parsePID(addr[idx+1:]); err == nil {
				pid, _ := parsePID(fields[4])
				b.info.PortUsage = append(b.info.PortUsage, PortInfo{
					PID:  pid,
					Port: port,
				})
			}
		}
	}
	return nil
}

func (b *DiagnosticBundle) collectDiskUsage(ctx context.Context, projectDir string) error {
	if projectDir == "" {
		projectDir = b.info.DiskUsage.ProjectDir
	}
	if projectDir == "" {
		return nil
	}

	b.info.DiskUsage.ProjectDir = projectDir

	switch runtime.GOOS {
	case "darwin", "linux":
		out, err := runCmd(ctx, "df", "-h", projectDir)
		if err != nil {
			return err
		}
		lines := strings.Split(string(out), "\n")
		if len(lines) >= 2 {
			fields := strings.Fields(lines[1])
			if len(fields) >= 6 {
				b.info.DiskUsage.Total = fields[1]
				b.info.DiskUsage.Used = fields[2]
				b.info.DiskUsage.Available = fields[3]
			}
		}
	case "windows":
		// Windows disk usage collection is more complex, skip for now
	}

	return nil
}

func (b *DiagnosticBundle) collectEnvVars() {
	// Redact sensitive environment variables
	sensitiveKeys := map[string]bool{
		"PASSWORD": true, "PASSWD": true, "PWD": true,
		"TOKEN": true, "API_KEY": true, "APIKEY": true,
		"SECRET": true, "AUTH_TOKEN": true, "ACCESS_KEY": true,
		"COOKIE": true, "SESSION": true, "CREDENTIALS": true,
		"PRIVATE_KEY": true, "AWS_SECRET": true, "DB_PASSWORD": true,
		"JDBC_PASSWORD": true, "MYSQL_PWD": true, "PGPASSWORD": true,
	}

	for _, env := range os.Environ() {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := parts[0]
		value := parts[1]

		// Check if this is a sensitive key
		upperKey := strings.ToUpper(key)
		if sensitiveKeys[upperKey] || strings.Contains(upperKey, "PASSWORD") ||
			strings.Contains(upperKey, "TOKEN") || strings.Contains(upperKey, "SECRET") ||
			strings.Contains(upperKey, "KEY") || strings.Contains(upperKey, "CREDENTIAL") {
			value = "[REDACTED]"
		} else {
			value = b.redact.Apply(value)
		}

		b.info.EnvVars[key] = value
	}
}

func (b *DiagnosticBundle) writeZipEntry(zw *zip.Writer, name string, data []byte, totalSize *int64) error {
	*totalSize += int64(len(data))
	if *totalSize > MaxBundleSize {
		return fmt.Errorf("bundle size exceeds maximum of %d bytes", MaxBundleSize)
	}

	w, err := zw.Create(name)
	if err != nil {
		return fmt.Errorf("create zip entry %s: %w", name, err)
	}
	if _, err := w.Write(data); err != nil {
		return fmt.Errorf("write zip entry %s: %w", name, err)
	}
	return nil
}

func (b *DiagnosticBundle) marshalSummary() ([]byte, error) {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Kairo IDE Diagnostic Bundle\n"))
	sb.WriteString(fmt.Sprintf("===========================\n\n"))
	sb.WriteString(fmt.Sprintf("Collected: %s\n\n", b.info.CollectedAt))

	sb.WriteString("Versions:\n")
	sb.WriteString(fmt.Sprintf("  Kairo IDE: %s\n", b.info.KairoVersion))
	sb.WriteString(fmt.Sprintf("  Agent:     %s\n", b.info.AgentVersion))
	if b.info.NodeVersion != "" {
		sb.WriteString(fmt.Sprintf("  Node.js:   %s\n", b.info.NodeVersion))
	}

	sb.WriteString("\nOS:\n")
	sb.WriteString(fmt.Sprintf("  Name:    %s\n", b.info.OS.Name))
	sb.WriteString(fmt.Sprintf("  Version: %s\n", b.info.OS.Version))
	sb.WriteString(fmt.Sprintf("  Arch:    %s\n", b.info.OS.Arch))

	sb.WriteString("\nJDK:\n")
	for _, v := range b.info.JDK.Versions {
		sb.WriteString(fmt.Sprintf("  %s\n", v))
	}
	if b.info.JDK.Home != "" {
		sb.WriteString(fmt.Sprintf("  JAVA_HOME: %s\n", b.info.JDK.Home))
	}

	if b.info.JDTLS.Version != "" {
		sb.WriteString("\nJDT LS:\n")
		sb.WriteString(fmt.Sprintf("  Version: %s\n", b.info.JDTLS.Version))
		if b.info.JDTLS.Home != "" {
			sb.WriteString(fmt.Sprintf("  Home:    %s\n", b.info.JDTLS.Home))
		}
	}

	if b.info.Tomcat.Version != "" {
		sb.WriteString("\nTomcat:\n")
		sb.WriteString(fmt.Sprintf("  Version:      %s\n", b.info.Tomcat.Version))
		if b.info.Tomcat.CatalinaHome != "" {
			sb.WriteString(fmt.Sprintf("  CatalinaHome: %s\n", b.info.Tomcat.CatalinaHome))
		}
		if b.info.Tomcat.CatalinaBase != "" {
			sb.WriteString(fmt.Sprintf("  CatalinaBase: %s\n", b.info.Tomcat.CatalinaBase))
		}
	}

	if b.info.DiskUsage.ProjectDir != "" {
		sb.WriteString("\nDisk Usage:\n")
		sb.WriteString(fmt.Sprintf("  Directory: %s\n", b.info.DiskUsage.ProjectDir))
		sb.WriteString(fmt.Sprintf("  Total:     %s\n", b.info.DiskUsage.Total))
		sb.WriteString(fmt.Sprintf("  Used:      %s\n", b.info.DiskUsage.Used))
		sb.WriteString(fmt.Sprintf("  Available: %s\n", b.info.DiskUsage.Available))
	}

	sb.WriteString(fmt.Sprintf("\nProcesses: %d\n", len(b.info.Processes)))
	sb.WriteString(fmt.Sprintf("Port Entries: %d\n", len(b.info.PortUsage)))
	sb.WriteString(fmt.Sprintf("Recent Errors: %d\n", len(b.info.RecentErrors)))

	return []byte(sb.String()), nil
}

func (b *DiagnosticBundle) marshalProcesses() []byte {
	var sb strings.Builder
	sb.WriteString("PID\tCommand\tMemory\n")
	sb.WriteString("---\t-------\t------\n")
	for _, p := range b.info.Processes {
		sb.WriteString(fmt.Sprintf("%d\t%s\t%s\n", p.PID, p.Command, p.Memory))
	}
	return []byte(sb.String())
}

func (b *DiagnosticBundle) marshalPortUsage() []byte {
	var sb strings.Builder
	sb.WriteString("PID\tProcess\tPort\n")
	sb.WriteString("---\t-------\t----\n")
	for _, p := range b.info.PortUsage {
		sb.WriteString(fmt.Sprintf("%d\t%s\t%d\n", p.PID, p.Process, p.Port))
	}
	return []byte(sb.String())
}

func (b *DiagnosticBundle) marshalEnvVars() []byte {
	var sb strings.Builder
	for k, v := range b.info.EnvVars {
		sb.WriteString(fmt.Sprintf("%s=%s\n", k, v))
	}
	return []byte(sb.String())
}

// ── Utility functions ────────────────────────────────────────────

func runCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	// For java -version, capture stderr
	if name == "java" && args[0] == "-version" {
		cmd.Stderr = nil
		out, err := cmd.CombinedOutput()
		return out, err
	}
	return cmd.Output()
}

func parsePID(s string) (int, error) {
	var pid int
	_, err := fmt.Sscanf(s, "%d", &pid)
	return pid, err
}

// Ensure the directory exists
func init() {
	// Ensure diagnostic bundle support
	_ = io.EOF
	_ = filepath.Base
	_ = regexp.MustCompile
}