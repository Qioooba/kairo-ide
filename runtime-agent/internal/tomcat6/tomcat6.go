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
)

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
		return fmt.Errorf("catalina home is required")
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

	args = []string{
		"-classpath", classpathStr,
		"-Dcatalina.home=" + cfg.CatalinaHome,
		"-Dcatalina.base=" + cfg.CatalinaBase,
		"-Djava.util.logging.config.file=" + filepath.Join(cfg.CatalinaBase, "conf", "logging.properties"),
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
		if err := writeAtomic(dst, data, 0644); err != nil {
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
								Name:       "localhost",
								AppBase:    "webapps",
								UnpackWARs: true,
								AutoDeploy: true,
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
					Reloadable: true,
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
	return writeAtomic(dst, content, 0644)
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
	return writeAtomic(lp, defaultLoggingProps, 0644)
}

func writeAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-tomcat-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
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
	Logger         interface{}
	StartTimeout   time.Duration
}

type Ports struct {
	HTTP     int `json:"http,omitempty"`
	Shutdown int `json:"shutdown,omitempty"`
	AJP      int `json:"ajp,omitempty"`
	Debug    int `json:"debug,omitempty"`
}

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

func (i *Instance) State() string            { i.mu.Lock(); defer i.mu.Unlock(); return i.state }
func (i *Instance) PID() int                 { i.mu.Lock(); defer i.mu.Unlock(); return i.pid }
func (i *Instance) StartedAt() time.Time     { i.mu.Lock(); defer i.mu.Unlock(); return i.startedAt }
func (i *Instance) Ports() Ports             { i.mu.Lock(); defer i.mu.Unlock(); return i.ports }
func (i *Instance) LogPath() string          { return i.logPath }
func (i *Instance) Stopped() <-chan struct{} { return i.stopped }

func Start(ctx context.Context, spec Spec) (*Instance, error) {
	return nil, errors.New("legacy Start() not supported; use Tomcat6Provider via RuntimeProvider interface")
}

func (i *Instance) Stop(timeout time.Duration) error {
	return errors.New("legacy Stop() not supported")
}

func (i *Instance) ForceStop() error {
	return errors.New("legacy ForceStop() not supported")
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
	return nil, nil
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
