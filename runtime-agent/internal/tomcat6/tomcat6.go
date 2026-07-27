package tomcat6

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
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
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/proc"
)

// Logger is the logging interface for the tomcat6 package.
type Logger interface {
	Info(msg string, fields ...log.Fields)
	Warn(msg string, fields ...log.Fields)
	Error(msg string, fields ...log.Fields)
	Debug(msg string, fields ...log.Fields)
}

const (
	DefaultStartTimeout = 60 * time.Second
	DefaultStopTimeout  = 30 * time.Second
	DefaultHTTPPort     = 18080
)

type Config struct {
	CatalinaHome string
	CatalinaBase string
	JavaHome     string
	HTTPPort     int
	ShutdownPort int
	DebugPort    int
	DebugSuspend bool
	ContextPath  string
	WebappDir    string
	JVMOptions   []string
	Env          []string
}

func (c Config) Validate() error {
	if c.JavaHome == "" {
		return fmt.Errorf("java home is required")
	}
	if c.CatalinaHome == "" {
		// KAIRO-RC-WEB-205: give the user an actionable recovery instead
		// of a bare 500 — the product is offline/air-gapped, so the fix
		// is to materialize the bundled directory, not to "check network".
		return fmt.Errorf("tomcat 6 not available: run `pnpm bundled:prepare` (or set KAIRO_TOMCAT6_HOME) to materialize bundled/tomcat6")
	}
	if c.CatalinaBase == "" {
		return fmt.Errorf("catalina base is required")
	}
	if c.WebappDir == "" {
		return fmt.Errorf("webapp dir is required")
	}
	if c.HTTPPort <= 0 {
		return fmt.Errorf("http port is required")
	}
	if c.ShutdownPort <= 0 {
		return fmt.Errorf("shutdown port is required")
	}
	bootstrapJar := filepath.Join(c.CatalinaHome, "bin", "bootstrap.jar")
	if _, err := os.Stat(bootstrapJar); err != nil {
		return fmt.Errorf("bootstrap.jar not found at %s: %w", bootstrapJar, err)
	}
	return nil
}

func BootstrapClasspath(catalinaHome string) []string {
	var cp []string
	bin := filepath.Join(catalinaHome, "bin")
	for _, j := range []string{"bootstrap.jar", "tomcat-juli.jar"} {
		p := filepath.Join(bin, j)
		if _, err := os.Stat(p); err == nil {
			cp = append(cp, p)
		}
	}
	return cp
}

func BuildCommand(cfg Config) (executable string, args []string, env []string, err error) {
	if err := cfg.Validate(); err != nil {
		return "", nil, nil, err
	}

	java := filepath.Join(cfg.JavaHome, "bin", "java")
	if runtime.GOOS == "windows" {
		java += ".exe"
	}

	cp := BootstrapClasspath(cfg.CatalinaHome)
	classpathStr := strings.Join(cp, string(filepath.ListSeparator))

	// KAIRO-RC-WEB-2026-07-26: Tomcat 6's WebappClassLoader reflects
	// into java.base to clear ThreadLocals on undeploy. Java 9+
	// blocks that by default and the webapp reload crashes with
	// InaccessibleObjectException, leaving the HTTP listener up but
	// every request hanging on a half-loaded context. Auto-add the
	// --add-opens flags so the bundled tomcat6 still works on the
	// modern JDK that ships with our test environment. These are
	// no-op on Java 8, so always applying them is safe.
	addOpens := []string{
		"--add-opens=java.base/java.lang=ALL-UNNAMED",
		"--add-opens=java.base/java.util=ALL-UNNAMED",
		"--add-opens=java.base/java.lang.reflect=ALL-UNNAMED",
		"--add-opens=java.base/sun.security.x509=ALL-UNNAMED",
	}

	args = []string{
		"-classpath", classpathStr,
		"-Dcatalina.home=" + cfg.CatalinaHome,
		"-Dcatalina.base=" + cfg.CatalinaBase,
		"-Djava.util.logging.config.file=" + filepath.Join(cfg.CatalinaBase, "conf", "logging.properties"),
	}
	args = append(args, addOpens...)
	if cfg.DebugPort > 0 {
		suspend := "n"
		if cfg.DebugSuspend {
			suspend = "y"
		}
		args = append(args, fmt.Sprintf(
			"-agentlib:jdwp=transport=dt_socket,server=y,suspend=%s,address=127.0.0.1:%d",
			suspend, cfg.DebugPort,
		))
	}
	args = append(args, cfg.JVMOptions...)
	args = append(args, "org.apache.catalina.startup.Bootstrap", "start")

	env = buildEnv(cfg)
	return java, args, env, nil
}

func buildEnv(cfg Config) []string {
	envMap := make(map[string]string)
	for _, e := range cfg.Env {
		if idx := strings.IndexByte(e, '='); idx > 0 {
			k := e[:idx]
			v := e[idx+1:]
			envMap[k] = v
		}
	}
	envMap["JAVA_HOME"] = cfg.JavaHome
	envMap["CATALINA_HOME"] = cfg.CatalinaHome
	envMap["CATALINA_BASE"] = cfg.CatalinaBase
	if _, ok := envMap["JRE_HOME"]; !ok {
		envMap["JRE_HOME"] = cfg.JavaHome
	}

	var env []string
	keys := make([]string, 0, len(envMap))
	for k := range envMap {
		keys = append(keys, k)
	}
	for _, k := range keys {
		env = append(env, k+"="+envMap[k])
	}
	return env
}

func PrepareCatalinaBase(cfg Config) error {
	if err := copyMinimalConf(cfg.CatalinaHome, cfg.CatalinaBase); err != nil {
		return fmt.Errorf("copy conf: %w", err)
	}
	if err := writeServerXML(cfg); err != nil {
		return fmt.Errorf("write server.xml: %w", err)
	}
	if err := writeLoggingProperties(cfg.CatalinaBase); err != nil {
		return fmt.Errorf("write logging.properties: %w", err)
	}
	return nil
}

func copyMinimalConf(catalinaHome, catalinaBase string) error {
	confFiles := []string{
		"web.xml",
		"context.xml",
		"tomcat-users.xml",
		"catalina.policy",
	}
	homeConf := filepath.Join(catalinaHome, "conf")
	baseConf := filepath.Join(catalinaBase, "conf")

	if err := os.MkdirAll(baseConf, 0755); err != nil {
		return err
	}

	for _, f := range confFiles {
		src := filepath.Join(homeConf, f)
		dst := filepath.Join(baseConf, f)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		data, err := os.ReadFile(src)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if err := atomicfile.WriteFile(dst, data, 0644); err != nil {
			return err
		}
	}
	return nil
}

type ServerConfig struct {
	XMLName      xml.Name      `xml:"Server"`
	Port         int           `xml:"port,attr"`
	Shutdown     string        `xml:"shutdown,attr"`
	Listeners    []Listener    `xml:"Listener"`
	GlobalNaming *GlobalNaming `xml:"GlobalNamingResources,omitempty"`
	Services     []Service     `xml:"Service"`
}

type Listener struct {
	ClassName string `xml:"className,attr"`
	SSLEngine string `xml:"SSLEngine,attr,omitempty"`
}

type GlobalNaming struct {
	Resources []Resource `xml:"Resource"`
}

type Resource struct {
	Name        string `xml:"name,attr"`
	Auth        string `xml:"auth,attr"`
	Type        string `xml:"type,attr"`
	Description string `xml:"description,attr,omitempty"`
	Factory     string `xml:"factory,attr,omitempty"`
	Pathname    string `xml:"pathname,attr,omitempty"`
}

type Service struct {
	Name       string      `xml:"name,attr"`
	Connectors []Connector `xml:"Connector"`
	Engines    []Engine    `xml:"Engine"`
}

type Connector struct {
	Port              int    `xml:"port,attr"`
	Protocol          string `xml:"protocol,attr"`
	ConnectionTimeout int    `xml:"connectionTimeout,attr,omitempty"`
	RedirectPort      int    `xml:"redirectPort,attr,omitempty"`
	Address           string `xml:"address,attr,omitempty"`
}

type Engine struct {
	Name        string  `xml:"name,attr"`
	DefaultHost string  `xml:"defaultHost,attr"`
	Realms      []Realm `xml:"Realm"`
	Hosts       []Host  `xml:"Host"`
}

type Realm struct {
	ClassName    string `xml:"className,attr"`
	ResourceName string `xml:"resourceName,attr,omitempty"`
}

type Host struct {
	Name       string    `xml:"name,attr"`
	AppBase    string    `xml:"appBase,attr"`
	UnpackWARs bool      `xml:"unpackWARs,attr,omitempty"`
	AutoDeploy bool      `xml:"autoDeploy,attr,omitempty"`
	Contexts   []Context `xml:"Context"`
	Valves     []Valve   `xml:"Valve"`
}

type Valve struct {
	ClassName string `xml:"className,attr"`
	Directory string `xml:"directory,attr,omitempty"`
	Prefix    string `xml:"prefix,attr,omitempty"`
	Suffix    string `xml:"suffix,attr,omitempty"`
	Pattern   string `xml:"pattern,attr,omitempty"`
}

type Context struct {
	Path       string `xml:"path,attr"`
	DocBase    string `xml:"docBase,attr"`
	Reloadable bool   `xml:"reloadable,attr,omitempty"`
}

func defaultServerXML() ServerConfig {
	return ServerConfig{
		Port:     8005,
		Shutdown: "SHUTDOWN",
		Listeners: []Listener{
			{ClassName: "org.apache.catalina.core.AprLifecycleListener", SSLEngine: "on"},
			{ClassName: "org.apache.catalina.core.JasperListener"},
			{ClassName: "org.apache.catalina.mbeans.ServerLifecycleListener"},
			{ClassName: "org.apache.catalina.mbeans.GlobalResourcesLifecycleListener"},
		},
		GlobalNaming: &GlobalNaming{
			Resources: []Resource{
				{
					Name:        "UserDatabase",
					Auth:        "Container",
					Type:        "org.apache.catalina.UserDatabase",
					Description: "User database that can be updated and saved",
					Factory:     "org.apache.catalina.users.MemoryUserDatabaseFactory",
					Pathname:    "conf/tomcat-users.xml",
				},
			},
		},
		Services: []Service{
			{
				Name: "Catalina",
				Connectors: []Connector{
					{
						Port:              18080,
						Protocol:          "HTTP/1.1",
						ConnectionTimeout: 20000,
						RedirectPort:      8443,
						Address:           "127.0.0.1",
					},
				},
				Engines: []Engine{
					{
						Name:        "Catalina",
						DefaultHost: "localhost",
						Realms: []Realm{
							{
								ClassName:    "org.apache.catalina.realm.UserDatabaseRealm",
								ResourceName: "UserDatabase",
							},
						},
						Hosts: []Host{
							{
								Name:    "localhost",
								AppBase: "webapps",
								// KAIRO-RC-WEB-2026-07-26-23: disable auto-deploy so the
								// explicit Context below (with the project's webappDir as
								// docBase) is the only root context. Without this, Tomcat
								// auto-deploys webapps/ROOT and shadows the explicit
								// context, causing ClassNotFoundException because the
								// auto-deployed directory lacks compiled classes.
								UnpackWARs: false,
								AutoDeploy: false,
								Valves: []Valve{{
									ClassName: "org.apache.catalina.valves.AccessLogValve",
									Directory: "logs", Prefix: "kairo-access.", Suffix: ".log",
									Pattern: "%h %l %u %t \"%r\" %s %b",
								}},
							},
						},
					},
				},
			},
		},
	}
}

func writeServerXML(cfg Config) error {
	serverXML := defaultServerXML()
	serverXML.Port = cfg.ShutdownPort

	if len(serverXML.Services) > 0 {
		svc := &serverXML.Services[0]
		if len(svc.Connectors) > 0 {
			svc.Connectors[0].Port = cfg.HTTPPort
		}
		if len(svc.Engines) > 0 && len(svc.Engines[0].Hosts) > 0 {
			host := &svc.Engines[0].Hosts[0]
			contextPath := cfg.ContextPath
			if contextPath == "" {
				contextPath = "/"
			}
			host.Contexts = []Context{
				{
					Path:       contextPath,
					DocBase:    cfg.WebappDir,
					// KAIRO-RC-WEB-2026-07-26: disable auto-reload. Tomcat 6's
					// WebappClassLoader reflects into java.base internals on
					// reload, which crashes on Java 9+ and leaves the context
					// half-loaded so every request hangs. The IDE uses the
					// Kairo: Publish command to push changes explicitly.
					Reloadable: false,
				},
			}
		}
	}

	output, err := xml.MarshalIndent(serverXML, "", "  ")
	if err != nil {
		return err
	}

	xmlHeader := []byte(xml.Header)
	content := append(xmlHeader, output...)

	dst := filepath.Join(cfg.CatalinaBase, "conf", "server.xml")
	return atomicfile.WriteFile(dst, content, 0644)
}

var defaultLoggingProps = []byte(`handlers = java.util.logging.ConsoleHandler, java.util.logging.FileHandler
.level = INFO
java.util.logging.ConsoleHandler.level = INFO
java.util.logging.ConsoleHandler.formatter = java.util.logging.SimpleFormatter
java.util.logging.FileHandler.level = FINE
java.util.logging.FileHandler.pattern = %h/kairo-tomcat.log
java.util.logging.FileHandler.limit = 0
java.util.logging.FileHandler.append = true
java.util.logging.FileHandler.formatter = java.util.logging.SimpleFormatter
`)

func writeLoggingProperties(catalinaBase string) error {
	lp := filepath.Join(catalinaBase, "conf", "logging.properties")
	if _, err := os.Stat(lp); err == nil {
		return nil
	}
	return atomicfile.WriteFile(lp, defaultLoggingProps, 0644)
}

func WaitForReady(ctx context.Context, httpPort int, deadline time.Time) error {
	addr := "127.0.0.1:" + strconv.Itoa(httpPort)
	url := "http://" + addr + "/"

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("readiness timeout")
		}

		conn, err := net.DialTimeout("tcp", addr, 1*time.Second)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		conn.Close()

		cli := &http.Client{Timeout: 2 * time.Second}
		resp, err := cli.Get(url)
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// WaitForPort proves that a local listener is actually bound. It is used for
// JDWP so the API never reports a merely allocated port as "debug ready".
func WaitForPort(ctx context.Context, port int, deadline time.Time) error {
	if port <= 0 {
		return errors.New("port is required")
	}
	addr := "127.0.0.1:" + strconv.Itoa(port)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("port readiness timeout: %s", addr)
		}
		conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func SendShutdown(shutdownPort int, timeout time.Duration) error {
	addr := "127.0.0.1:" + strconv.Itoa(shutdownPort)
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(timeout))
	_, err = conn.Write([]byte("SHUTDOWN"))
	return err
}

func FindCatalinaHome(bundledDir string) (string, error) {
	if v := os.Getenv("KAIRO_TOMCAT6_HOME"); v != "" {
		if _, err := os.Stat(filepath.Join(v, "bin", "bootstrap.jar")); err == nil {
			return v, nil
		}
		return "", fmt.Errorf("KAIRO_TOMCAT6_HOME is set but bootstrap.jar not found at %s", v)
	}
	p := filepath.Join(bundledDir, "tomcat6", "apache-tomcat-6.0.53")
	if _, err := os.Stat(filepath.Join(p, "bin", "bootstrap.jar")); err == nil {
		return p, nil
	}
	tomcatDir := filepath.Join(bundledDir, "tomcat6")
	entries, err := os.ReadDir(tomcatDir)
	if err != nil {
		return "", fmt.Errorf("no bundled Tomcat 6 found under %s: %w", bundledDir, err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		candidate := filepath.Join(tomcatDir, e.Name())
		if _, err := os.Stat(filepath.Join(candidate, "bin", "bootstrap.jar")); err == nil {
			return candidate, nil
		}
	}
	return "", errors.New("Tomcat 6 not found: set KAIRO_TOMCAT6_HOME")
}

func FetchCatalinaHomeOrDownload(bundledDir string) (string, error) {
	return FindCatalinaHome(bundledDir)
}

type Spec struct {
	ID             string
	JavaHome       string
	CatalinaHome   string
	CatalinaBase   string
	HTTPPort       int
	ShutdownPort   int
	AJPPort        int
	DebugPort      int
	DebugSuspend   bool
	ContextPath    string
	WebappDir      string
	DocBase        string
	ExtraClasspath []string
	JVMOptions     []string
	Env            []string
	Logger         Logger
	StartTimeout   time.Duration
}

type Ports struct {
	HTTP     int `json:"http,omitempty"`
	Shutdown int `json:"shutdown,omitempty"`
	AJP      int `json:"ajp,omitempty"`
	Debug    int `json:"debug,omitempty"`
}

type Instance struct {
	mu              sync.Mutex
	spec            Spec
	cmd             *exec.Cmd
	pid             int
	state           string
	startedAt       time.Time
	ports           Ports
	logPath         string
	stopped         chan struct{}
	process         proc.ManagedProcess
	processIdentity domain.ProcessIdentity
}

func (i *Instance) State() string            { i.mu.Lock(); defer i.mu.Unlock(); return i.state }
func (i *Instance) PID() int                 { i.mu.Lock(); defer i.mu.Unlock(); return i.pid }
func (i *Instance) StartedAt() time.Time     { i.mu.Lock(); defer i.mu.Unlock(); return i.startedAt }
func (i *Instance) Ports() Ports             { i.mu.Lock(); defer i.mu.Unlock(); return i.ports }
func (i *Instance) LogPath() string          { return i.logPath }
func (i *Instance) Stopped() <-chan struct{} { return i.stopped }

func Start(ctx context.Context, spec Spec) (*Instance, error) {
	// 1. Build Config
	cfg := Config{
		CatalinaHome: spec.CatalinaHome,
		CatalinaBase: spec.CatalinaBase,
		JavaHome:     spec.JavaHome,
		HTTPPort:     spec.HTTPPort,
		ShutdownPort: spec.ShutdownPort,
		DebugPort:    spec.DebugPort,
		DebugSuspend: spec.DebugSuspend,
		ContextPath:  spec.ContextPath,
		WebappDir:    spec.WebappDir,
		JVMOptions:   spec.JVMOptions,
		Env:          spec.Env,
	}

	// 2. Prepare the catalina base (conf/, server.xml, logging.properties).
	// KAIRO-RC-WEB-247: Start used to skip this when invoked via the
	// /api/v1/servers service path (only the runtime provider prepared the
	// base), so Tomcat came up with no server.xml, died immediately and the
	// caller waited out the full readiness timeout for a "readiness timeout"
	// error with zero diagnostics. PrepareCatalinaBase is idempotent and
	// never overwrites existing files.
	if err := PrepareCatalinaBase(cfg); err != nil {
		return nil, fmt.Errorf("prepare catalina base: %w", err)
	}

	// 3. Build command
	executable, args, env, err := BuildCommand(cfg)
	if err != nil {
		return nil, fmt.Errorf("build command: %w", err)
	}

	// 4. Create managed process
	process := proc.New()
	procSpec := proc.ProcessSpec{
		Executable:   executable,
		Args:         args,
		Dir:          spec.CatalinaBase,
		Env:          env,
		LogDir:       filepath.Join(spec.CatalinaBase, "logs"),
		CatalinaBase: spec.CatalinaBase,
	}

	// KAIRO-RC-WEB-247: persist stdout/stderr to kairo-stdout.log (the path
	// Instance.LogPath advertises) and keep an in-memory tail so readiness
	// failures can report what Tomcat actually said instead of a bare
	// "readiness timeout".
	logPath := filepath.Join(spec.CatalinaBase, "logs", "kairo-stdout.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return nil, fmt.Errorf("create log dir: %w", err)
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open server log: %w", err)
	}
	tail := newLogTail(40)
	var logMu sync.Mutex
	process.SubscribeLogs(func(line domain.LogLine) {
		logMu.Lock()
		defer logMu.Unlock()
		stream := "stdout"
		if line.Stream == domain.LogStreamStderr {
			stream = "stderr"
		}
		fmt.Fprintf(logFile, "[%s] %s\n", stream, line.Text)
		tail.add(line.Text)
	})

	obs, err := process.Start(ctx, procSpec)
	if err != nil {
		logFile.Close()
		return nil, fmt.Errorf("start process: %w", err)
	}

	// 4. Build Instance
	inst := &Instance{
		spec:      spec,
		pid:       obs.PID,
		state:     "running",
		startedAt: time.Now(),
		ports: Ports{
			HTTP:     spec.HTTPPort,
			Shutdown: spec.ShutdownPort,
			AJP:      spec.AJPPort,
			Debug:    spec.DebugPort,
		},
		logPath:         logPath,
		stopped:         make(chan struct{}),
		process:         process,
		processIdentity: obs.Identity,
	}

	// 5. Wait for readiness
	timeout := spec.StartTimeout
	if timeout <= 0 {
		timeout = DefaultStartTimeout
	}
	deadline := time.Now().Add(timeout)
	var readinessErr error
	if spec.DebugPort > 0 {
		readinessErr = WaitForPort(ctx, spec.DebugPort, deadline)
	}
	// With suspend=y the JVM deliberately pauses before Tomcat can bind HTTP;
	// JDWP readiness is the correct launch boundary in that mode.
	if readinessErr == nil && !spec.DebugSuspend {
		readinessErr = WaitForReady(ctx, spec.HTTPPort, deadline)
	}
	if readinessErr != nil {
		// Clean up on failure
		process.ForceStop(context.Background(), obs.Identity)
		logMu.Lock()
		tailText := tail.String()
		logFile.Close()
		logMu.Unlock()
		if tailText != "" {
			return nil, fmt.Errorf("readiness: %w; last server output:\n%s", readinessErr, tailText)
		}
		return nil, fmt.Errorf("readiness: %w (server produced no output; see %s)", readinessErr, logPath)
	}

	// 6. Monitor process exit in background
	go func() {
		process.Wait()
		inst.mu.Lock()
		inst.state = "stopped"
		inst.mu.Unlock()
		logMu.Lock()
		logFile.Close()
		logMu.Unlock()
		close(inst.stopped)
	}()

	return inst, nil
}

// logTail keeps the last n lines of process output for diagnostics.
type logTail struct {
	mu    sync.Mutex
	max   int
	lines []string
}

func newLogTail(max int) *logTail { return &logTail{max: max} }

func (t *logTail) add(line string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.lines) >= t.max {
		t.lines = t.lines[1:]
	}
	t.lines = append(t.lines, line)
}

func (t *logTail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.Join(t.lines, "\n")
}

func (i *Instance) Stop(timeout time.Duration) error {
	if i.process == nil {
		return errors.New("no managed process")
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return i.process.GracefulStop(ctx, i.processIdentity)
}

func (i *Instance) ForceStop() error {
	if i.process == nil {
		return errors.New("no managed process")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return i.process.ForceStop(ctx, i.processIdentity)
}

func IsPortBound(port int) bool {
	l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return true
	}
	l.Close()
	return false
}

func (i *Instance) TailLog(n int) ([]string, error) {
	if i.logPath == "" {
		return nil, nil
	}
	data, err := os.ReadFile(i.logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	lines := tailLines(string(data), n)
	return lines, nil
}

// tailLines returns the last n lines from the given text.
func tailLines(s string, n int) []string {
	if n <= 0 {
		return nil
	}
	all := splitLines(s)
	if len(all) <= n {
		return all
	}
	return all[len(all)-n:]
}

// splitLines splits text into lines, preserving empty lines.
func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	lines := strings.Split(s, "\n")
	// Remove trailing empty string from Split if s ends with \n
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
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

func boolYN(b bool) string {
	if b {
		return "y"
	}
	return "n"
}
