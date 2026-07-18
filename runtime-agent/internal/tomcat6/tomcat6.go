// Package tomcat6 is the real Apache Tomcat 6 runtime provider.
//
// It launches `org.apache.catalina.startup.Bootstrap start`
// directly via `java -classpath ...` (no shell) with separate
// CATALINA_HOME (the read-only Tomcat install) and CATALINA_BASE
// (a per-project instance directory with conf, logs, webapps,
// work, temp). State is tracked by polling the configured HTTP
// port; shutdown uses Bootstrap stop followed by SIGTERM and a
// forced SIGKILL.
package tomcat6

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/log"
)

// sysProcAttr returns platform-specific process attributes for
// spawned processes.
func sysProcAttr() *syscall.SysProcAttr {
	return sysProcAttrForOS()
}

// Spec is the input to Start.
type Spec struct {
	// ID is the server id (used for log lines and catalina base dir).
	ID string
	// JavaHome is the JRE/JDK used to run Tomcat.
	JavaHome string
	// CatalinaHome is the read-only Tomcat install dir (the
	// `apache-tomcat-6.0.53` directory).
	CatalinaHome string
	// CatalinaBase is a per-instance dir; the runner creates
	// conf/, logs/, webapps/, work/, temp/ inside it.
	CatalinaBase string
	// HTTP / Shutdown / AJP / Debug ports. Use 0 for "auto".
	HTTPPort      int
	ShutdownPort  int
	AJPPort       int
	DebugPort     int
	DebugSuspend  bool
	// ContextPath is the URL path the webapp is mounted at.
	ContextPath string
	// WebappDir is the exploded webapp to deploy (the output
	// of the build + deploy steps).
	WebappDir string
	// DocBase is the path Tomcat uses as the docBase for the
	// context. Defaults to WebappDir.
	DocBase string
	// ExtraClasspath: optional additional JARs to add to the
	// Tomcat classpath (rare; usually the webapp has its own).
	ExtraClasspath []string
	// JVM options (e.g. -Dfile.encoding=GBK, -Xmx...).
	JVMOptions []string
	// Environment variables to add to the Java process.
	Env []string
	// Logger for structured output.
	Logger *log.Logger
}

// DefaultHTTPPort is the port used when 0 is requested.
const DefaultHTTPPort = 18080

// Instance is a running Tomcat 6 server.
type Instance struct {
	mu        sync.Mutex
	spec      Spec
	cmd       *exec.Cmd
	pid       int
	state     string
	startedAt time.Time
	ports     Ports
	logPath   string
	stopped   chan struct{}
}

// Ports is the live port map.
type Ports struct {
	HTTP     int `json:"http,omitempty"`
	Shutdown int `json:"shutdown,omitempty"`
	AJP      int `json:"ajp,omitempty"`
	Debug    int `json:"debug,omitempty"`
}

// State is the lifecycle state.
func (i *Instance) State() string {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.state
}

// PID returns the process ID.
func (i *Instance) PID() int {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.pid
}

// StartedAt returns the start time.
func (i *Instance) StartedAt() time.Time {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.startedAt
}

// Ports returns the assigned ports.
func (i *Instance) Ports() Ports {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.ports
}

// LogPath returns the path to the live log file.
func (i *Instance) LogPath() string { return i.logPath }

// Stopped returns a channel that's closed when the process exits.
func (i *Instance) Stopped() <-chan struct{} { return i.stopped }

// BootstrapClasspath constructs the classpath for the
// org.apache.catalina.startup.Bootstrap launch, exactly as
// catalina.sh does on Unix and catalina.bat does on Windows.
func BootstrapClasspath(catalinaHome string) string {
	bin := filepath.Join(catalinaHome, "bin")
	lib := filepath.Join(catalinaHome, "lib")
	var cp []string
	// bootstrap.jar first, then tomcat-juli.jar, then everything in lib.
	for _, j := range []string{"bootstrap.jar", "tomcat-juli.jar"} {
		p := filepath.Join(bin, j)
		if _, err := os.Stat(p); err == nil {
			cp = append(cp, p)
		}
	}
	matches, _ := filepath.Glob(filepath.Join(lib, "*.jar"))
	cp = append(cp, matches...)
	return strings.Join(cp, string(filepath.ListSeparator))
}

// FindCatalinaHome returns the path to the bundled Tomcat 6.0.53
// install under bundledDir, or an error if not present.
func FindCatalinaHome(bundledDir string) (string, error) {
	// Allow override via env.
	if v := os.Getenv("KAIRO_TOMCAT6_HOME"); v != "" {
		if _, err := os.Stat(filepath.Join(v, "bin", "bootstrap.jar")); err == nil {
			return v, nil
		}
		return "", fmt.Errorf("KAIRO_TOMCAT6_HOME is set but bootstrap.jar not found at %s", v)
	}
	// Default: bundled/tomcat6/apache-tomcat-6.0.53
	p := filepath.Join(bundledDir, "tomcat6", "apache-tomcat-6.0.53")
	if _, err := os.Stat(filepath.Join(p, "bin", "bootstrap.jar")); err == nil {
		return p, nil
	}
	// Also try without the version suffix (some users extract differently).
	entries, err := os.ReadDir(filepath.Join(bundledDir, "tomcat6"))
	if err != nil {
		return "", fmt.Errorf("no bundled Tomcat 6 found under %s: %w", bundledDir, err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		candidate := filepath.Join(bundledDir, "tomcat6", e.Name())
		if _, err := os.Stat(filepath.Join(candidate, "bin", "bootstrap.jar")); err == nil {
			return candidate, nil
		}
	}
	return "", errors.New("Tomcat 6 not found: set KAIRO_TOMCAT6_HOME or run scripts/fetch-tomcat6.sh")
}

// FetchCatalinaHomeOrDownload is FindCatalinaHome with a
// last-ditch attempt to download the official archive. Disabled
// by default unless KAIRO_ALLOW_DOWNLOAD=1.
func FetchCatalinaHomeOrDownload(bundledDir string) (string, error) {
	if home, err := FindCatalinaHome(bundledDir); err == nil {
		return home, nil
	}
	if os.Getenv("KAIRO_ALLOW_DOWNLOAD") != "1" {
		return "", errors.New("Tomcat 6 not bundled and KAIRO_ALLOW_DOWNLOAD!=1; set KAIRO_TOMCAT6_HOME or run scripts/fetch-tomcat6.sh")
	}
	// Download.
	dest := filepath.Join(bundledDir, "tomcat6")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return "", err
	}
	archive := filepath.Join(dest, "apache-tomcat-6.0.53.tar.gz")
	url := "https://archive.apache.org/dist/tomcat/tomcat-6/v6.0.53/bin/apache-tomcat-6.0.53.tar.gz"
	expected := "35249a4b40f41fb5f602f5602142d59faaa96dc1567df807d108d4d2b942e2f0"
	cmd := exec.Command("curl", "-fsSL", "--max-time", "60", "-o", archive, url)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("download Tomcat 6 failed: %v: %s", err, out)
	}
	actual, err := fileSHA256(archive)
	if err != nil {
		return "", err
	}
	if actual != expected {
		os.Remove(archive)
		return "", fmt.Errorf("Tomcat 6 SHA-256 mismatch: got %s, expected %s", actual, expected)
	}
	if err := untar(archive, dest); err != nil {
		return "", err
	}
	return filepath.Join(dest, "apache-tomcat-6.0.53"), nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func untar(archive, dest string) error {
	cmd := exec.Command("tar", "-xzf", archive, "-C", dest)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("untar failed: %v: %s", err, out)
	}
	return nil
}

// Start launches Tomcat 6 and returns when the HTTP port is
// accepting connections (or after StartTimeout if it isn't).
func Start(ctx context.Context, spec Spec) (*Instance, error) {
	if err := validateSpec(&spec); err != nil {
		return nil, err
	}
	// Auto-pick ports.
	ports, err := assignPorts(&spec)
	if err != nil {
		return nil, err
	}
	spec.HTTPPort = ports.HTTP
	spec.ShutdownPort = ports.Shutdown
	spec.AJPPort = ports.AJP
	if spec.DebugPort > 0 {
		// Keep the requested port; if conflict, assignPorts will
		// have picked a different one.
	}

	if err := prepareCatalinaBase(&spec); err != nil {
		return nil, err
	}
	if err := writeServerXML(&spec); err != nil {
		return nil, err
	}

	java := filepath.Join(spec.JavaHome, "bin", "java")
	if runtime.GOOS == "windows" {
		java = filepath.Join(spec.JavaHome, "bin", "java.exe")
	}
	cp := BootstrapClasspath(spec.CatalinaHome)
	if len(spec.ExtraClasspath) > 0 {
		cp = cp + string(filepath.ListSeparator) + strings.Join(spec.ExtraClasspath, string(filepath.ListSeparator))
	}
	args := []string{
		"-classpath", cp,
		// System properties Bootstrap needs.
		"-Dcatalina.home=" + spec.CatalinaHome,
		"-Dcatalina.base=" + spec.CatalinaBase,
		// Make stdout/stderr line-buffered so log streaming
		// works correctly under our supervisor.
		"-Djava.util.logging.config.file=" + filepath.Join(spec.CatalinaBase, "conf", "logging.properties"),
	}
	args = append(args, spec.JVMOptions...)
	if spec.DebugPort > 0 {
		jdwp := fmt.Sprintf("-agentlib:jdwp=transport=dt_socket,server=y,suspend=%s,address=127.0.0.1:%d",
			boolYN(spec.DebugSuspend), spec.DebugPort)
		args = append(args, jdwp)
	}
	args = append(args, "org.apache.catalina.startup.Bootstrap", "start")

	cmd := exec.CommandContext(ctx, java, args...)
	cmd.Dir = spec.CatalinaBase
	cmd.Env = append(os.Environ(), spec.Env...)

	// Open the log file and pipe stdout/stderr to it.
	logPath := filepath.Join(spec.CatalinaBase, "logs", "kairo-stdout.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return nil, err
	}
	lf, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}
	cmd.Stdout = lf
	cmd.Stderr = lf
	cmd.SysProcAttr = sysProcAttr()

	if spec.Logger != nil {
		spec.Logger.Info("tomcat6 starting", log.Fields{
			"id":     spec.ID,
			"http":   spec.HTTPPort,
			"home":   spec.CatalinaHome,
			"base":   spec.CatalinaBase,
		})
	}
	if err := cmd.Start(); err != nil {
		lf.Close()
		return nil, fmt.Errorf("start tomcat6: %w", err)
	}

	inst := &Instance{
		spec:      spec,
		cmd:       cmd,
		pid:       cmd.Process.Pid,
		state:     "starting",
		startedAt: time.Now(),
		ports:     ports,
		logPath:   logPath,
		stopped:   make(chan struct{}),
	}
	go inst.waitAndWatch(lf)
	// Wait for HTTP to be ready.
	if err := inst.waitForHTTP(60 * time.Second); err != nil {
		inst.ForceStop()
		return nil, err
	}
	inst.mu.Lock()
	inst.state = "running"
	inst.mu.Unlock()
	if spec.Logger != nil {
		spec.Logger.Info("tomcat6 running", log.Fields{
			"id":   spec.ID,
			"http": spec.HTTPPort,
			"pid":  inst.pid,
		})
	}
	return inst, nil
}

func validateSpec(s *Spec) error {
	if s.JavaHome == "" {
		return errors.New("JavaHome is required")
	}
	if s.CatalinaHome == "" {
		return errors.New("CatalinaHome is required")
	}
	if s.CatalinaBase == "" {
		return errors.New("CatalinaBase is required")
	}
	if s.ContextPath == "" {
		s.ContextPath = "/"
	}
	if !strings.HasPrefix(s.ContextPath, "/") {
		s.ContextPath = "/" + s.ContextPath
	}
	if s.WebappDir == "" {
		return errors.New("WebappDir is required")
	}
	return nil
}

// assignPorts picks a port for each role, respecting explicit
// values. Returns the assigned ports.
func assignPorts(s *Spec) (Ports, error) {
	var p Ports
	if s.HTTPPort == 0 {
		port, err := pickFreePort()
		if err != nil {
			return p, err
		}
		p.HTTP = port
	} else {
		p.HTTP = s.HTTPPort
	}
	if s.ShutdownPort == 0 {
		port, err := pickFreePort()
		if err != nil {
			return p, err
		}
		p.Shutdown = port
	} else {
		p.Shutdown = s.ShutdownPort
	}
	if s.AJPPort == 0 {
		port, err := pickFreePort()
		if err != nil {
			return p, err
		}
		p.AJP = port
	} else {
		p.AJP = s.AJPPort
	}
	if s.DebugPort > 0 {
		p.Debug = s.DebugPort
	}
	return p, nil
}

// pickFreePort asks the kernel for a free TCP port.
func pickFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// IsPortBound returns true if 127.0.0.1:port is listening.
func IsPortBound(port int) bool {
	l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return true
	}
	l.Close()
	return false
}

// prepareCatalinaBase creates the per-instance directory
// structure: conf/, logs/, webapps/, work/, temp/.
func prepareCatalinaBase(s *Spec) error {
	for _, sub := range []string{"conf", "logs", "webapps", "work", "temp"} {
		if err := os.MkdirAll(filepath.Join(s.CatalinaBase, sub), 0o755); err != nil {
			return err
		}
	}
	// logging.properties: default to file + console.
	lp := filepath.Join(s.CatalinaBase, "conf", "logging.properties")
	if _, err := os.Stat(lp); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(lp, defaultLoggingProps, 0o644); err != nil {
			return err
		}
	}
	// Copy context.xml from CATALINA_HOME (best effort).
	for _, f := range []string{"context.xml", "web.xml"} {
		src := filepath.Join(s.CatalinaHome, "conf", f)
		dst := filepath.Join(s.CatalinaBase, "conf", f)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		data, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		_ = os.WriteFile(dst, data, 0o644)
	}
	return nil
}

var defaultLoggingProps = []byte(`handlers = java.util.logging.ConsoleHandler, java.util.logging.FileHandler
.level = INFO
java.util.logging.ConsoleHandler.level = INFO
java.util.logging.ConsoleHandler.formatter = java.util.logging.SimpleFormatter
java.util.logging.FileHandler.level = FINE
java.util.logging.FileHandler.pattern = %h/kairo-stdout.log
java.util.logging.FileHandler.limit = 0
java.util.logging.FileHandler.append = true
java.util.logging.FileHandler.formatter = java.util.logging.SimpleFormatter
`)

// writeServerXML writes a minimal server.xml with the chosen
// ports and the webapp mounted at the requested context.
func writeServerXML(s *Spec) error {
	docBase := s.DocBase
	if docBase == "" {
		docBase = s.WebappDir
	}
	sx := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<Server port="%d" shutdown="SHUTDOWN">
  <Listener className="org.apache.catalina.core.AprLifecycleListener" SSLEngine="on" />
  <Listener className="org.apache.catalina.core.JasperListener" />
  <Listener className="org.apache.catalina.mbeans.ServerLifecycleListener" />
  <Listener className="org.apache.catalina.mbeans.GlobalResourcesLifecycleListener" />
  <GlobalNamingResources>
    <Resource name="UserDatabase" auth="Container"
              type="org.apache.catalina.UserDatabase"
              description="User database that can be updated and saved"
              factory="org.apache.catalina.users.MemoryUserDatabaseFactory"
              pathname="conf/tomcat-users.xml" />
  </GlobalNamingResources>
  <Service name="Catalina">
    <Connector port="%d" protocol="HTTP/1.1"
               connectionTimeout="20000"
               redirectPort="8443"
               address="127.0.0.1" />
    <Engine name="Catalina" defaultHost="localhost">
      <Realm className="org.apache.catalina.realm.UserDatabaseRealm"
             resourceName="UserDatabase" />
      <Host name="localhost" appBase="webapps" unpackWARs="true" autoDeploy="true">
        <Context path="%s" docBase="%s" reloadable="true" />
      </Host>
    </Engine>
  </Service>
</Server>
`, s.ShutdownPort, s.HTTPPort, escapeXML(s.ContextPath), escapeXML(docBase))
	return os.WriteFile(filepath.Join(s.CatalinaBase, "conf", "server.xml"), []byte(sx), 0o644)
}

func escapeXML(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return r.Replace(s)
}

// waitForHTTP polls the configured HTTP port until it accepts
// a connection, or until timeout.
func (i *Instance) waitForHTTP(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	url := "http://127.0.0.1:" + strconv.Itoa(i.spec.HTTPPort) + i.spec.ContextPath
	if i.spec.Logger != nil {
		i.spec.Logger.Info("tomcat6 polling", log.Fields{"url": url, "timeoutSec": int(timeout.Seconds())})
	}
	for time.Now().Before(deadline) {
		if !IsPortBound(i.spec.HTTPPort) {
			// check process still alive
			if i.cmd.Process == nil {
				return errors.New("process exited before becoming ready")
			}
			if !isAlive(i.cmd.Process.Pid) {
				return errors.New("process exited before becoming ready")
			}
			time.Sleep(200 * time.Millisecond)
			continue
		}
		// Port is open. Issue a real HTTP request to confirm
		// the connector is serving (not just the kernel
		// accepting). On some failures Tomcat binds the port
		// very early but the engine is still starting.
		cli := &http.Client{Timeout: 2 * time.Second}
		resp, err := cli.Get(url)
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	// Read the last few lines of the log to give the user a hint.
	tail := i.tailLog(40)
	return fmt.Errorf("tomcat6 did not become ready on port %d within %v\n--- last log lines ---\n%s",
		i.spec.HTTPPort, timeout, tail)
}

func (i *Instance) tailLog(n int) string {
	f, err := os.Open(i.logPath)
	if err != nil {
		return "(no log)"
	}
	defer f.Close()
	// Read all, take last n lines. The log is small early on.
	data, err := io.ReadAll(f)
	if err != nil {
		return err.Error()
	}
	lines := strings.Split(string(data), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// waitAndWatch blocks until the process exits, then closes the
// log file and updates the state.
func (i *Instance) waitAndWatch(lf *os.File) {
	err := i.cmd.Wait()
	lf.Close()
	close(i.stopped)
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.state == "stopping" {
		i.state = "stopped"
		return
	}
	if err != nil {
		i.state = "crashed"
	} else {
		i.state = "stopped"
	}
	if i.spec.Logger != nil {
		i.spec.Logger.Warn("tomcat6 exited", log.Fields{
			"id":    i.spec.ID,
			"pid":   i.pid,
			"error": fmt.Sprintf("%v", err),
		})
	}
}

// Stop issues a graceful stop via the shutdown port, then
// SIGTERM, then SIGKILL. Returns when the process has actually
// exited or timeout elapses.
func (i *Instance) Stop(timeout time.Duration) error {
	i.mu.Lock()
	if i.state != "running" && i.state != "starting" {
		i.mu.Unlock()
		return nil
	}
	i.state = "stopping"
	pid := i.pid
	i.mu.Unlock()

	// 1. Send the shutdown string to the shutdown port.
	if i.spec.ShutdownPort > 0 {
		_ = sendShutdown(i.spec.ShutdownPort, "SHUTDOWN")
	}
	select {
	case <-i.stopped:
		return nil
	case <-time.After(timeout / 2):
		// continue to step 2
	}
	// 2. SIGTERM.
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Signal(syscall.SIGTERM)
	}
	select {
	case <-i.stopped:
		return nil
	case <-time.After(timeout / 2):
	}
	// 3. SIGKILL.
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Signal(syscall.SIGKILL)
	}
	select {
	case <-i.stopped:
		return nil
	case <-time.After(2 * time.Second):
		return errors.New("tomcat6 process did not exit after SIGKILL")
	}
}

// ForceStop sends SIGKILL immediately.
func (i *Instance) ForceStop() error {
	i.mu.Lock()
	if i.cmd == nil || i.cmd.Process == nil {
		i.mu.Unlock()
		return nil
	}
	pid := i.cmd.Process.Pid
	i.mu.Unlock()
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Signal(syscall.SIGKILL)
	}
	<-i.stopped
	return nil
}

func sendShutdown(port int, msg string) error {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), 2*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(2 * time.Second))
	_, err = conn.Write([]byte(msg))
	return err
}

func boolYN(b bool) string {
	if b {
		return "y"
	}
	return "n"
}

// TailLog returns the last n lines of the captured stdout/stderr
// log file.
func (i *Instance) TailLog(n int) ([]string, error) {
	f, err := os.Open(i.logPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var lines []string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) > n*4 {
			// cheap cap; trim at the end
		}
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines, scanner.Err()
}
