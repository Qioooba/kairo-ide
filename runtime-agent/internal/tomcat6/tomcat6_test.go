package tomcat6

import (
	"context"
	"encoding/xml"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func createFakeCatalinaHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	binDir := filepath.Join(home, "bin")
	confDir := filepath.Join(home, "conf")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatal(err)
	}
	bootstrapJar := filepath.Join(binDir, "bootstrap.jar")
	if err := os.WriteFile(bootstrapJar, []byte("fake"), 0644); err != nil {
		t.Fatal(err)
	}
	tomcatJuliJar := filepath.Join(binDir, "tomcat-juli.jar")
	if err := os.WriteFile(tomcatJuliJar, []byte("fake-juli"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"web.xml", "context.xml", "tomcat-users.xml", "catalina.policy"} {
		if err := os.WriteFile(filepath.Join(confDir, f), []byte("<!-- "+f+" -->"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

func TestConfig_Validate_MissingJavaHome(t *testing.T) {
	cfg := Config{
		CatalinaHome: "/fake",
		CatalinaBase: "/fake-base",
		WebappDir:    "/fake-webapp",
		HTTPPort:     8080,
		ShutdownPort: 8005,
	}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "java home") {
		t.Errorf("expected java home error, got %v", err)
	}
}

func TestConfig_Validate_MissingCatalinaHome(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaBase: "/fake-base",
		WebappDir:    "/fake-webapp",
		HTTPPort:     8080,
		ShutdownPort: 8005,
	}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "catalina home") {
		t.Errorf("expected catalina home error, got %v", err)
	}
}

func TestConfig_Validate_MissingBootstrapJar(t *testing.T) {
	home := t.TempDir()
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: "/fake-base",
		WebappDir:    "/fake-webapp",
		HTTPPort:     8080,
		ShutdownPort: 8005,
	}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "bootstrap.jar") {
		t.Errorf("expected bootstrap.jar error, got %v", err)
	}
}

func TestConfig_Validate_Valid(t *testing.T) {
	home := createFakeCatalinaHome(t)
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: t.TempDir(),
		WebappDir:    "/fake-webapp",
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid config, got %v", err)
	}
}

func TestBuildCommand_ClasspathAndEnv(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	javaHome := t.TempDir()
	binDir := filepath.Join(javaHome, "bin")
	os.MkdirAll(binDir, 0755)

	cfg := Config{
		JavaHome:     javaHome,
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
		ContextPath:  "/",
		JVMOptions:   []string{"-Xmx512m"},
	}

	exe, args, env, err := BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}

	expectedJava := filepath.Join(javaHome, "bin", "java")
	if runtime.GOOS == "windows" {
		expectedJava += ".exe"
	}
	if exe != expectedJava {
		t.Errorf("expected exe %s, got %s", expectedJava, exe)
	}

	foundBootstrap := false
	foundCatalinaHome := false
	foundCatalinaBase := false
	foundStart := false
	for _, a := range args {
		if strings.Contains(a, "bootstrap.jar") {
			foundBootstrap = true
		}
		if a == "-Dcatalina.home="+home {
			foundCatalinaHome = true
		}
		if a == "-Dcatalina.base="+base {
			foundCatalinaBase = true
		}
		if a == "start" {
			foundStart = true
		}
	}
	if !foundBootstrap {
		t.Error("expected bootstrap.jar in classpath args")
	}
	if !foundCatalinaHome {
		t.Error("expected -Dcatalina.home")
	}
	if !foundCatalinaBase {
		t.Error("expected -Dcatalina.base")
	}
	if !foundStart {
		t.Error("expected 'start' argument")
	}

	envMap := make(map[string]string)
	for _, e := range env {
		idx := strings.IndexByte(e, '=')
		if idx > 0 {
			envMap[e[:idx]] = e[idx+1:]
		}
	}
	if envMap["JAVA_HOME"] != javaHome {
		t.Errorf("expected JAVA_HOME=%s, got %s", javaHome, envMap["JAVA_HOME"])
	}
	if envMap["CATALINA_HOME"] != home {
		t.Errorf("expected CATALINA_HOME=%s, got %s", home, envMap["CATALINA_HOME"])
	}
	if envMap["CATALINA_BASE"] != base {
		t.Errorf("expected CATALINA_BASE=%s, got %s", base, envMap["CATALINA_BASE"])
	}
}

func TestBuildCommand_PathWithSpaces(t *testing.T) {
	baseParent := t.TempDir()
	home := createFakeCatalinaHome(t)
	base := filepath.Join(baseParent, "path with spaces", "catalina base")
	javaHome := filepath.Join(baseParent, "jdk path")
	binDir := filepath.Join(javaHome, "bin")
	os.MkdirAll(binDir, 0755)

	cfg := Config{
		JavaHome:     javaHome,
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}

	_, _, _, err := BuildCommand(cfg)
	if err != nil {
		t.Fatalf("BuildCommand should handle paths with spaces: %v", err)
	}
}

func TestBuildCommand_PathWithChinese(t *testing.T) {
	baseParent := t.TempDir()
	home := createFakeCatalinaHome(t)
	base := filepath.Join(baseParent, "测试路径", "catalina")
	javaHome := filepath.Join(baseParent, "java home 中文")
	binDir := filepath.Join(javaHome, "bin")
	os.MkdirAll(binDir, 0755)

	cfg := Config{
		JavaHome:     javaHome,
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}

	_, _, _, err := BuildCommand(cfg)
	if err != nil {
		t.Fatalf("BuildCommand should handle paths with Chinese: %v", err)
	}
}

func TestPrepareCatalinaBase_CopiesMinimalConf(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()

	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
		ContextPath:  "/myapp",
	}

	if err := PrepareCatalinaBase(cfg); err != nil {
		t.Fatal(err)
	}

	for _, f := range []string{"web.xml", "context.xml", "tomcat-users.xml", "catalina.policy"} {
		path := filepath.Join(base, "conf", f)
		if _, err := os.Stat(path); err != nil {
			t.Errorf("expected %s to exist: %v", f, err)
		}
	}

	serverXMLPath := filepath.Join(base, "conf", "server.xml")
	data, err := os.ReadFile(serverXMLPath)
	if err != nil {
		t.Fatal(err)
	}

	var srv ServerConfig
	if err := xml.Unmarshal(data, &srv); err != nil {
		t.Fatalf("invalid server.xml: %v", err)
	}

	if srv.Port != 18005 {
		t.Errorf("expected shutdown port 18005, got %d", srv.Port)
	}
	if srv.Shutdown != "SHUTDOWN" {
		t.Errorf("expected shutdown string SHUTDOWN, got %s", srv.Shutdown)
	}
	if len(srv.Services) == 0 {
		t.Fatal("expected at least one Service")
	}
	if len(srv.Services[0].Connectors) == 0 {
		t.Fatal("expected at least one Connector")
	}
	if srv.Services[0].Connectors[0].Port != 18080 {
		t.Errorf("expected HTTP port 18080, got %d", srv.Services[0].Connectors[0].Port)
	}
	if len(srv.Services[0].Engines) == 0 || len(srv.Services[0].Engines[0].Hosts) == 0 {
		t.Fatal("expected Engine with Host")
	}
	host := srv.Services[0].Engines[0].Hosts[0]
	if len(host.Contexts) == 0 {
		t.Fatal("expected Context configured")
	}
	ctx := host.Contexts[0]
	if ctx.Path != "/myapp" {
		t.Errorf("expected context path /myapp, got %s", ctx.Path)
	}
	if ctx.DocBase != cfg.WebappDir {
		t.Errorf("expected docBase %s, got %s", cfg.WebappDir, ctx.DocBase)
	}
}

func TestPrepareCatalinaBase_DoesNotOverwriteExisting(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	confDir := filepath.Join(base, "conf")
	os.MkdirAll(confDir, 0755)

	customWebXML := []byte("<web-app>custom</web-app>")
	if err := os.WriteFile(filepath.Join(confDir, "web.xml"), customWebXML, 0644); err != nil {
		t.Fatal(err)
	}

	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}

	if err := PrepareCatalinaBase(cfg); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(confDir, "web.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(customWebXML) {
		t.Error("existing web.xml should not be overwritten")
	}
}

func TestWaitForReady_Timeout(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	deadline := time.Now().Add(200 * time.Millisecond)
	err := WaitForReady(ctx, 1, deadline)
	if err == nil {
		t.Error("expected timeout error")
	}
}

func TestWaitForReady_ContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	deadline := time.Now().Add(5 * time.Second)
	err := WaitForReady(ctx, 1, deadline)
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

func TestWaitForReady_Success(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	port := ln.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Server", "Apache-Coyote/1.1")
		w.WriteHeader(200)
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	defer srv.Close()

	time.Sleep(50 * time.Millisecond)

	ctx := context.Background()
	deadline := time.Now().Add(2 * time.Second)
	err = WaitForReady(ctx, port, deadline)
	if err != nil {
		t.Errorf("expected ready, got %v", err)
	}
}

func TestSendShutdown_ConnectionRefused(t *testing.T) {
	err := SendShutdown(1, 100*time.Millisecond)
	if err == nil {
		t.Error("expected connection error for unused port")
	}
}

func TestSendShutdown_Success(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	received := make(chan string, 1)
	go func() {
		conn, _ := ln.Accept()
		if conn != nil {
			buf := make([]byte, 100)
			n, _ := conn.Read(buf)
			received <- string(buf[:n])
			conn.Close()
		}
	}()

	port := ln.Addr().(*net.TCPAddr).Port
	err = SendShutdown(port, 1*time.Second)
	if err != nil {
		t.Errorf("expected shutdown send success, got %v", err)
	}

	select {
	case msg := <-received:
		if msg != "SHUTDOWN" {
			t.Errorf("expected SHUTDOWN message, got %s", msg)
		}
	case <-time.After(1 * time.Second):
		t.Error("timeout waiting for shutdown message")
	}
}

func TestWriteAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	data := []byte("hello atomic")
	if err := writeAtomic(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	read, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(read) != string(data) {
		t.Errorf("expected %q, got %q", data, read)
	}
}

func TestDefaultServerXML_Golden(t *testing.T) {
	srv := defaultServerXML()
	if srv.Port != 8005 {
		t.Errorf("default shutdown port = %d, want 8005", srv.Port)
	}
	if srv.Shutdown != "SHUTDOWN" {
		t.Errorf("default shutdown = %q, want SHUTDOWN", srv.Shutdown)
	}
	if len(srv.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(srv.Services))
	}
	svc := srv.Services[0]
	if svc.Name != "Catalina" {
		t.Errorf("service name = %q, want Catalina", svc.Name)
	}
	if len(svc.Connectors) != 1 {
		t.Fatalf("expected 1 connector, got %d", len(svc.Connectors))
	}
	if svc.Connectors[0].Port != DefaultHTTPPort {
		t.Errorf("default HTTP port = %d, want %d", svc.Connectors[0].Port, DefaultHTTPPort)
	}
	if svc.Connectors[0].Protocol != "HTTP/1.1" {
		t.Errorf("protocol = %q, want HTTP/1.1", svc.Connectors[0].Protocol)
	}
}

func TestIsPortBound(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	boundPort := ln.Addr().(*net.TCPAddr).Port
	if !IsPortBound(boundPort) {
		t.Error("expected port to be reported as bound")
	}
	ln.Close()
}
