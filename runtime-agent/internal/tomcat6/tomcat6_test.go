package tomcat6

import (
	"context"
	"encoding/xml"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
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
	if err == nil || !strings.Contains(err.Error(), "tomcat 6 not available") {
		t.Errorf("expected actionable tomcat-missing error, got %v", err)
	}
	// The message must tell the user how to recover (KAIRO-RC-WEB-205).
	if !strings.Contains(err.Error(), "bundled:prepare") {
		t.Errorf("error must name the recovery command, got %v", err)
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

func TestBuildCommand_JDWPOnlyWhenExplicitlyEnabled(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	javaHome := t.TempDir()
	if err := os.MkdirAll(filepath.Join(javaHome, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	baseConfig := Config{
		JavaHome: javaHome, CatalinaHome: home, CatalinaBase: base,
		WebappDir: filepath.Join(base, "webapps", "ROOT"), HTTPPort: 18080, ShutdownPort: 18005,
	}

	_, runArgs, _, err := BuildCommand(baseConfig)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(runArgs, " "), "jdwp") {
		t.Fatalf("normal Run unexpectedly contains JDWP args: %v", runArgs)
	}

	debugConfig := baseConfig
	debugConfig.DebugPort = 18000
	debugConfig.DebugSuspend = true
	_, debugArgs, _, err := BuildCommand(debugConfig)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(debugArgs, " ")
	for _, want := range []string{"-agentlib:jdwp=", "transport=dt_socket", "server=y", "suspend=y", "address=127.0.0.1:18000"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("debug args missing %q: %v", want, debugArgs)
		}
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

func TestWaitForPort_RequiresARealListener(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := WaitForPort(ctx, port, time.Now().Add(time.Second)); err != nil {
		t.Fatalf("WaitForPort on bound listener: %v", err)
	}
	ln.Close()
	if err := WaitForPort(ctx, port, time.Now().Add(150*time.Millisecond)); err == nil {
		t.Fatal("WaitForPort on closed listener unexpectedly succeeded")
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
	if err := atomicfile.WriteFile(path, data, 0644); err != nil {
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

func TestTailLines(t *testing.T) {
	tests := []struct {
		name string
		s    string
		n    int
		want []string
	}{
		{"n zero", "a\nb\nc", 0, nil},
		{"n negative", "a\nb\nc", -1, nil},
		{"n less than total", "a\nb\nc", 2, []string{"b", "c"}},
		{"n equals total", "a\nb\nc", 3, []string{"a", "b", "c"}},
		{"n greater than total", "a\nb\nc", 10, []string{"a", "b", "c"}},
		{"empty string", "", 5, nil},
		{"single line", "hello", 1, []string{"hello"}},
		{"trailing newline", "a\nb\n", 2, []string{"a", "b"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tailLines(tc.s, tc.n)
			if len(got) != len(tc.want) {
				t.Fatalf("len = %d, want %d", len(got), len(tc.want))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestSplitLines(t *testing.T) {
	tests := []struct {
		name string
		s    string
		want []string
	}{
		{"empty", "", nil},
		{"single", "hello", []string{"hello"}},
		{"two lines", "a\nb", []string{"a", "b"}},
		{"trailing newline", "a\nb\n", []string{"a", "b"}},
		{"three lines", "a\nb\nc", []string{"a", "b", "c"}},
		{"empty lines", "\n\n", []string{"", ""}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := splitLines(tc.s)
			if len(got) != len(tc.want) {
				t.Fatalf("len = %d, want %d", len(got), len(tc.want))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestFileSHA256(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	hash, err := fileSHA256(path)
	if err != nil {
		t.Fatalf("fileSHA256: %v", err)
	}
	if hash == "" {
		t.Error("hash should not be empty")
	}
	if len(hash) != 64 {
		t.Errorf("hash length = %d, want 64", len(hash))
	}
}

func TestFileSHA256_NotFound(t *testing.T) {
	_, err := fileSHA256("/nonexistent/file")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestBoolYN(t *testing.T) {
	if got := boolYN(true); got != "y" {
		t.Errorf("boolYN(true) = %q, want y", got)
	}
	if got := boolYN(false); got != "n" {
		t.Errorf("boolYN(false) = %q, want n", got)
	}
}

func TestLogTail(t *testing.T) {
	lt := newLogTail(3)
	lt.add("line1")
	lt.add("line2")
	lt.add("line3")
	lt.add("line4")
	// Should keep last 3
	s := lt.String()
	if !strings.Contains(s, "line2") {
		t.Error("should contain line2")
	}
	if !strings.Contains(s, "line4") {
		t.Error("should contain line4")
	}
	if strings.Contains(s, "line1") {
		t.Error("should not contain line1 (evicted)")
	}
}

func TestLogTail_Empty(t *testing.T) {
	lt := newLogTail(5)
	if s := lt.String(); s != "" {
		t.Errorf("String() = %q, want empty", s)
	}
}

func TestBootstrapClasspath(t *testing.T) {
	// Create a fake catalina home with bootstrap.jar
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	bootstrapJar := filepath.Join(binDir, "bootstrap.jar")
	if err := os.WriteFile(bootstrapJar, []byte("fake"), 0o644); err != nil {
		t.Fatal(err)
	}
	cp := BootstrapClasspath(dir)
	if len(cp) == 0 {
		t.Fatal("BootstrapClasspath returned empty")
	}
	if cp[0] != bootstrapJar {
		t.Errorf("cp[0] = %q, want %q", cp[0], bootstrapJar)
	}
}

func TestBootstrapClasspath_NoJar(t *testing.T) {
	dir := t.TempDir()
	cp := BootstrapClasspath(dir)
	if len(cp) != 0 {
		t.Errorf("expected empty classpath, got %v", cp)
	}
}

func TestWriteLoggingProperties(t *testing.T) {
	dir := t.TempDir()
	if err := writeLoggingProperties(dir); err != nil {
		t.Fatalf("writeLoggingProperties: %v", err)
	}
	path := filepath.Join(dir, "conf", "logging.properties")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("logging.properties not found: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "java.util.logging") {
		t.Error("logging.properties should contain logging config")
	}
}

func TestWriteLoggingProperties_AlreadyExists(t *testing.T) {
	dir := t.TempDir()
	confDir := filepath.Join(dir, "conf")
	os.MkdirAll(confDir, 0755)
	// Write a custom file first
	custom := []byte("custom")
	if err := os.WriteFile(filepath.Join(confDir, "logging.properties"), custom, 0644); err != nil {
		t.Fatal(err)
	}
	// Should not overwrite
	if err := writeLoggingProperties(dir); err != nil {
		t.Fatalf("writeLoggingProperties: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(confDir, "logging.properties"))
	if string(data) != string(custom) {
		t.Error("existing logging.properties should not be overwritten")
	}
}

// ── Config.Validate additional edge cases ────────────────────────

func TestConfig_Validate_MissingCatalinaBase(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/fake",
		WebappDir:    "/fake-webapp",
		HTTPPort:     8080,
		ShutdownPort: 8005,
	}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "catalina base") {
		t.Errorf("expected catalina base error, got %v", err)
	}
}

func TestConfig_Validate_MissingWebappDir(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/fake",
		CatalinaBase: "/fake-base",
		HTTPPort:     8080,
		ShutdownPort: 8005,
	}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "webapp dir") {
		t.Errorf("expected webapp dir error, got %v", err)
	}
}

func TestConfig_Validate_MissingHTTPPort(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/fake",
		CatalinaBase: "/fake-base",
		WebappDir:    "/fake-webapp",
		ShutdownPort: 8005,
	}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "http port") {
		t.Errorf("expected http port error, got %v", err)
	}
}

func TestConfig_Validate_MissingShutdownPort(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/fake",
		CatalinaBase: "/fake-base",
		WebappDir:    "/fake-webapp",
		HTTPPort:     8080,
	}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "shutdown port") {
		t.Errorf("expected shutdown port error, got %v", err)
	}
}

// ── BuildCommand error path ──────────────────────────────────────

func TestBuildCommand_InvalidConfig(t *testing.T) {
	cfg := Config{
		JavaHome: "", // invalid
	}
	_, _, _, err := BuildCommand(cfg)
	if err == nil {
		t.Error("BuildCommand should fail with invalid config")
	}
}

// ── buildEnv with custom env vars ────────────────────────────────

func TestBuildEnv_CustomOverride(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/tomcat",
		CatalinaBase: "/base",
		Env:          []string{"JRE_HOME=/custom/jre", "MY_VAR=hello"},
	}
	env := buildEnv(cfg)
	envMap := make(map[string]string)
	for _, e := range env {
		if idx := strings.IndexByte(e, '='); idx > 0 {
			envMap[e[:idx]] = e[idx+1:]
		}
	}
	if envMap["JAVA_HOME"] != "/jdk" {
		t.Errorf("JAVA_HOME = %q, want /jdk", envMap["JAVA_HOME"])
	}
	if envMap["JRE_HOME"] != "/custom/jre" {
		t.Errorf("JRE_HOME = %q, want /custom/jre", envMap["JRE_HOME"])
	}
	if envMap["MY_VAR"] != "hello" {
		t.Errorf("MY_VAR = %q, want hello", envMap["MY_VAR"])
	}
}

func TestBuildEnv_DefaultJREHome(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/tomcat",
		CatalinaBase: "/base",
	}
	env := buildEnv(cfg)
	envMap := make(map[string]string)
	for _, e := range env {
		if idx := strings.IndexByte(e, '='); idx > 0 {
			envMap[e[:idx]] = e[idx+1:]
		}
	}
	if envMap["JRE_HOME"] != "/jdk" {
		t.Errorf("JRE_HOME = %q, want /jdk (default)", envMap["JRE_HOME"])
	}
}

func TestBuildEnv_EmptyValue(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/tomcat",
		CatalinaBase: "/base",
		Env:          []string{"="},
	}
	env := buildEnv(cfg)
	// Should not crash
	if len(env) < 3 {
		t.Errorf("expected at least 3 env vars, got %d", len(env))
	}
}

// ── WaitForPort edge cases ───────────────────────────────────────

func TestWaitForPort_ZeroPort(t *testing.T) {
	ctx := context.Background()
	err := WaitForPort(ctx, 0, time.Now().Add(time.Second))
	if err == nil || !strings.Contains(err.Error(), "port is required") {
		t.Errorf("expected 'port is required' error, got %v", err)
	}
}

func TestWaitForPort_NegativePort(t *testing.T) {
	ctx := context.Background()
	err := WaitForPort(ctx, -1, time.Now().Add(time.Second))
	if err == nil || !strings.Contains(err.Error(), "port is required") {
		t.Errorf("expected 'port is required' error, got %v", err)
	}
}

func TestWaitForPort_ContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := WaitForPort(ctx, 19999, time.Now().Add(5*time.Second))
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

func TestWaitForPort_Timeout(t *testing.T) {
	ctx := context.Background()
	deadline := time.Now().Add(100 * time.Millisecond)
	err := WaitForPort(ctx, 1, deadline)
	if err == nil {
		t.Error("expected timeout error")
	}
}

// ── IsPortBound unbound case ─────────────────────────────────────

func TestIsPortBound_Unbound(t *testing.T) {
	// Find an available port, close it, then test
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	time.Sleep(50 * time.Millisecond)

	if IsPortBound(port) {
		t.Log("port still reported as bound (OS may not have released it yet)")
	}
}

// ── FindCatalinaHome tests ───────────────────────────────────────

func TestFindCatalinaHome_EnvVar(t *testing.T) {
	home := createFakeCatalinaHome(t)
	t.Setenv("KAIRO_TOMCAT6_HOME", home)
	result, err := FindCatalinaHome("/nonexistent/bundled")
	if err != nil {
		t.Fatalf("FindCatalinaHome failed: %v", err)
	}
	if result != home {
		t.Errorf("FindCatalinaHome = %q, want %q", result, home)
	}
}

func TestFindCatalinaHome_EnvVarInvalid(t *testing.T) {
	t.Setenv("KAIRO_TOMCAT6_HOME", "/nonexistent/path")
	_, err := FindCatalinaHome("/nonexistent/bundled")
	if err == nil {
		t.Error("Expected error for invalid KAIRO_TOMCAT6_HOME")
	}
}

func TestFindCatalinaHome_BundledDir(t *testing.T) {
	t.Setenv("KAIRO_TOMCAT6_HOME", "")
	t.Setenv("KAIRO_DATA_DIR", t.TempDir())
	t.Setenv("KAIRO_TOMCAT_CONFIG", "")
	bundledDir := t.TempDir()
	// Create the bundled tomcat6 directory structure
	tomcatDir := filepath.Join(bundledDir, "tomcat6", "apache-tomcat-6.0.53")
	os.MkdirAll(filepath.Join(tomcatDir, "bin"), 0755)
	os.WriteFile(filepath.Join(tomcatDir, "bin", "bootstrap.jar"), []byte("fake"), 0644)

	result, err := FindCatalinaHome(bundledDir)
	if err != nil {
		t.Fatalf("FindCatalinaHome failed: %v", err)
	}
	if result != tomcatDir {
		t.Errorf("FindCatalinaHome = %q, want %q", result, tomcatDir)
	}
}

func TestFindCatalinaHome_ScanSubdirs(t *testing.T) {
	t.Setenv("KAIRO_TOMCAT6_HOME", "")
	t.Setenv("KAIRO_DATA_DIR", t.TempDir())
	t.Setenv("KAIRO_TOMCAT_CONFIG", "")
	bundledDir := t.TempDir()
	tomcatDir := filepath.Join(bundledDir, "tomcat6")
	os.MkdirAll(filepath.Join(tomcatDir, "custom-tomcat-6.0.53", "bin"), 0755)
	os.WriteFile(filepath.Join(tomcatDir, "custom-tomcat-6.0.53", "bin", "bootstrap.jar"), []byte("fake"), 0644)

	// Also add a file (not dir) to test the IsDir check
	os.WriteFile(filepath.Join(tomcatDir, "README.txt"), []byte("readme"), 0644)

	result, err := FindCatalinaHome(bundledDir)
	if err != nil {
		t.Fatalf("FindCatalinaHome failed: %v", err)
	}
	if !strings.Contains(result, "custom-tomcat-6.0.53") {
		t.Errorf("FindCatalinaHome = %q, expected to find custom-tomcat-6.0.53", result)
	}
}

func TestFindCatalinaHome_NotFound(t *testing.T) {
	t.Setenv("KAIRO_TOMCAT6_HOME", "")
	t.Setenv("KAIRO_DATA_DIR", t.TempDir())
	t.Setenv("KAIRO_TOMCAT_CONFIG", filepath.Join(t.TempDir(), "missing-host-tomcat.json"))
	bundledDir := t.TempDir()
	_, err := FindCatalinaHome(bundledDir)
	if err == nil {
		t.Error("Expected error when no Tomcat 6 found")
	}
}

func TestFindCatalinaHome_Persisted(t *testing.T) {
	t.Setenv("KAIRO_TOMCAT6_HOME", "")
	home := createFakeCatalinaHome(t)
	dataDir := t.TempDir()
	cfgPath := filepath.Join(dataDir, "host-tomcat.json")
	payload := []byte(`{"catalinaHome":` + strconv.Quote(home) + `}`)
	if err := os.WriteFile(cfgPath, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KAIRO_DATA_DIR", dataDir)
	t.Setenv("KAIRO_TOMCAT_CONFIG", "")

	result, err := FindCatalinaHome("/nonexistent/bundled")
	if err != nil {
		t.Fatalf("FindCatalinaHome failed: %v", err)
	}
	if result != home {
		t.Errorf("FindCatalinaHome = %q, want %q", result, home)
	}
}

// ── ResolveCatalinaHome ──────────────────────────────────

func TestResolveCatalinaHome(t *testing.T) {
	home := createFakeCatalinaHome(t)
	t.Setenv("KAIRO_TOMCAT6_HOME", home)
	result, err := ResolveCatalinaHome("/nonexistent/bundled")
	if err != nil {
		t.Fatalf("ResolveCatalinaHome failed: %v", err)
	}
	if result != home {
		t.Errorf("ResolveCatalinaHome = %q, want %q", result, home)
	}
}

// TestFetchCatalinaHomeOrDownload_DeprecatedAlias verifies backward
// compatibility: the deprecated alias must still resolve the same way.
func TestFetchCatalinaHomeOrDownload_DeprecatedAlias(t *testing.T) {
	home := createFakeCatalinaHome(t)
	t.Setenv("KAIRO_TOMCAT6_HOME", home)
	result, err := FetchCatalinaHomeOrDownload("/nonexistent/bundled")
	if err != nil {
		t.Fatalf("FetchCatalinaHomeOrDownload (deprecated alias) failed: %v", err)
	}
	if result != home {
		t.Errorf("FetchCatalinaHomeOrDownload (deprecated alias) = %q, want %q", result, home)
	}
}

// ── Instance getter methods ──────────────────────────────────────

func TestInstance_State(t *testing.T) {
	inst := &Instance{state: "running"}
	if inst.State() != "running" {
		t.Errorf("State = %q, want running", inst.State())
	}
}

func TestInstance_PID(t *testing.T) {
	inst := &Instance{pid: 12345}
	if inst.PID() != 12345 {
		t.Errorf("PID = %d, want 12345", inst.PID())
	}
}

func TestInstance_StartedAt(t *testing.T) {
	now := time.Now()
	inst := &Instance{startedAt: now}
	if !inst.StartedAt().Equal(now) {
		t.Errorf("StartedAt = %v, want %v", inst.StartedAt(), now)
	}
}

func TestInstance_Ports(t *testing.T) {
	inst := &Instance{ports: Ports{HTTP: 8080, Shutdown: 8005, AJP: 8009, Debug: 5005}}
	ports := inst.Ports()
	if ports.HTTP != 8080 {
		t.Errorf("HTTP port = %d, want 8080", ports.HTTP)
	}
	if ports.Debug != 5005 {
		t.Errorf("Debug port = %d, want 5005", ports.Debug)
	}
}

func TestInstance_LogPath(t *testing.T) {
	inst := &Instance{logPath: "/var/log/tomcat.log"}
	if inst.LogPath() != "/var/log/tomcat.log" {
		t.Errorf("LogPath = %q, want /var/log/tomcat.log", inst.LogPath())
	}
}

func TestInstance_Stopped(t *testing.T) {
	inst := &Instance{stopped: make(chan struct{})}
	select {
	case <-inst.Stopped():
		t.Error("Stopped channel should not be closed yet")
	default:
	}
	close(inst.stopped)
	select {
	case <-inst.Stopped():
		// ok
	default:
		t.Error("Stopped channel should be closed")
	}
}

// ── TailLog tests ────────────────────────────────────────────────

func TestInstance_TailLog_NoPath(t *testing.T) {
	inst := &Instance{}
	lines, err := inst.TailLog(10)
	if err != nil {
		t.Fatalf("TailLog failed: %v", err)
	}
	if lines != nil {
		t.Errorf("TailLog with no path should return nil, got %v", lines)
	}
}

func TestInstance_TailLog_FileNotFound(t *testing.T) {
	inst := &Instance{logPath: "/nonexistent/tomcat.log"}
	lines, err := inst.TailLog(10)
	if err != nil {
		t.Fatalf("TailLog should not error on missing file: %v", err)
	}
	if lines != nil {
		t.Errorf("TailLog missing file should return nil, got %v", lines)
	}
}

func TestInstance_TailLog_WithContent(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "test.log")
	content := "line1\nline2\nline3\nline4\nline5\n"
	os.WriteFile(logPath, []byte(content), 0644)

	inst := &Instance{logPath: logPath}
	lines, err := inst.TailLog(3)
	if err != nil {
		t.Fatalf("TailLog failed: %v", err)
	}
	if len(lines) != 3 {
		t.Fatalf("len(lines) = %d, want 3", len(lines))
	}
	if lines[0] != "line3" {
		t.Errorf("lines[0] = %q, want line3", lines[0])
	}
}

// ── FileSHA256 error path ────────────────────────────────────────

func TestFileSHA256_ReadError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "unreadable")
	// Create a directory to make Open succeed but Read fail
	os.MkdirAll(path, 0755)
	_, err := fileSHA256(path)
	if err == nil {
		t.Error("Expected error when hashing a directory")
	}
}

// ── BuildCommand with DebugSuspend=n ─────────────────────────────

func TestBuildCommand_DebugSuspendFalse(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	javaHome := t.TempDir()
	os.MkdirAll(filepath.Join(javaHome, "bin"), 0755)

	cfg := Config{
		JavaHome:     javaHome,
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
		DebugPort:    5005,
		DebugSuspend: false,
	}
	_, args, _, err := BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "suspend=n") {
		t.Error("expected suspend=n when DebugSuspend is false")
	}
}

// ── writeServerXML with empty context path ───────────────────────

func TestWriteServerXML_EmptyContextPath(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()

	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
		ContextPath:  "", // empty -> defaults to "/"
	}
	if err := writeServerXML(cfg); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(base, "conf", "server.xml"))
	if err != nil {
		t.Fatal(err)
	}
	var srv ServerConfig
	xml.Unmarshal(data, &srv)
	if len(srv.Services) == 0 || len(srv.Services[0].Engines) == 0 || len(srv.Services[0].Engines[0].Hosts) == 0 {
		t.Fatal("expected Engine with Host")
	}
	ctx := srv.Services[0].Engines[0].Hosts[0].Contexts[0]
	if ctx.Path != "/" {
		t.Errorf("empty context path should default to '/', got %q", ctx.Path)
	}
}

// ── copyMinimalConf error paths ──────────────────────────────────

func TestCopyMinimalConf_ReadError(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	// Make a conf file unreadable
	confDir := filepath.Join(home, "conf")
	os.Chmod(filepath.Join(confDir, "web.xml"), 0000)
	defer os.Chmod(filepath.Join(confDir, "web.xml"), 0644)

	err := copyMinimalConf(home, base)
	if runtime.GOOS == "windows" {
		// Windows doesn't respect chmod in the same way
		if err != nil {
			t.Logf("copyMinimalConf error on Windows: %v", err)
		}
	} else {
		if err == nil {
			t.Error("Expected error when reading unreadable file")
		}
	}
}

func TestCopyMinimalConf_NonExistentFile(t *testing.T) {
	home := t.TempDir()
	// Create bin dir but no conf dir
	os.MkdirAll(filepath.Join(home, "bin"), 0755)
	os.WriteFile(filepath.Join(home, "bin", "bootstrap.jar"), []byte("fake"), 0644)

	base := t.TempDir()
	err := copyMinimalConf(home, base)
	if err != nil {
		t.Fatalf("copyMinimalConf should not error on missing conf files: %v", err)
	}
}

// ── PrepareCatalinaBase error path ───────────────────────────────

func TestPrepareCatalinaBase_WriteServerXMLError(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	// Create conf as a file (not dir) to make mkdir fail
	os.MkdirAll(base, 0755)
	os.WriteFile(filepath.Join(base, "conf"), []byte{}, 0644)

	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}
	err := PrepareCatalinaBase(cfg)
	if err == nil {
		t.Error("Expected error when conf is a file not a directory")
	}
}

// ── BuildCommand with env vars ───────────────────────────────────

func TestBuildCommand_WithCustomEnv(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	javaHome := t.TempDir()
	os.MkdirAll(filepath.Join(javaHome, "bin"), 0755)

	cfg := Config{
		JavaHome:     javaHome,
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
		Env:          []string{"MY_VAR=test", "ANOTHER=value"},
	}
	_, _, env, err := BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}
	envMap := make(map[string]string)
	for _, e := range env {
		if idx := strings.IndexByte(e, '='); idx > 0 {
			envMap[e[:idx]] = e[idx+1:]
		}
	}
	if envMap["MY_VAR"] != "test" {
		t.Errorf("MY_VAR = %q, want test", envMap["MY_VAR"])
	}
}

// ── Config struct defaults ───────────────────────────────────────

func TestConfig_Defaults(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/tomcat",
		CatalinaBase: "/base",
		WebappDir:    "/webapp",
		HTTPPort:     8080,
		ShutdownPort: 8005,
	}
	if cfg.DebugPort != 0 {
		t.Errorf("DebugPort default = %d, want 0", cfg.DebugPort)
	}
	if cfg.DebugSuspend {
		t.Error("DebugSuspend default should be false")
	}
	if cfg.ContextPath != "" {
		t.Errorf("ContextPath default = %q, want empty", cfg.ContextPath)
	}
}

// ── Ports struct ─────────────────────────────────────────────────

func TestPorts_Struct(t *testing.T) {
	p := Ports{HTTP: 8080, Shutdown: 8005, AJP: 8009, Debug: 5005}
	if p.HTTP != 8080 {
		t.Errorf("HTTP = %d, want 8080", p.HTTP)
	}
	if p.AJP != 8009 {
		t.Errorf("AJP = %d, want 8009", p.AJP)
	}
}

// ── Spec struct ──────────────────────────────────────────────────

func TestSpec_Defaults(t *testing.T) {
	spec := Spec{
		ID:           "test",
		JavaHome:     "/jdk",
		CatalinaHome: "/tomcat",
		CatalinaBase: "/base",
		HTTPPort:     8080,
		ShutdownPort: 8005,
	}
	if spec.StartTimeout != 0 {
		t.Errorf("StartTimeout default = %v, want 0", spec.StartTimeout)
	}
	if spec.DebugSuspend {
		t.Error("DebugSuspend should default to false")
	}
}


// BuildCommand: Encoding field

func TestBuildCommand_Encoding_DefaultUTF8(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	javaHome := t.TempDir()
	os.MkdirAll(filepath.Join(javaHome, "bin"), 0755)

	cfg := Config{
		JavaHome:     javaHome,
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
		// Encoding left empty -- should default to UTF-8
	}

	_, args, _, err := BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, ' ')
	for _, want := range []string{'-Dfile.encoding=UTF-8', '-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8'} {
		if !strings.Contains(joined, want) {
			t.Errorf('expected %q in args, got: %v', want, args)
		}
	}
}

func TestBuildCommand_Encoding_GBK(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	javaHome := t.TempDir()
	os.MkdirAll(filepath.Join(javaHome, "bin"), 0755)

	cfg := Config{
		JavaHome:     javaHome,
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
		Encoding:     "GBK",
	}

	_, args, _, err := BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, ' ')
	for _, want := range []string{'-Dfile.encoding=GBK', '-Dsun.stdout.encoding=GBK', '-Dsun.stderr.encoding=GBK'} {
		if !strings.Contains(joined, want) {
			t.Errorf('expected %q in args, got: %v', want, args)
		}
	}
}
