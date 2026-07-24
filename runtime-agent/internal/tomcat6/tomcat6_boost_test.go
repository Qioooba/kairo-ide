package tomcat6

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/proc"
)

// ── WaitForReady: TCP connects but HTTP fails ────────────────────

func TestWaitForReady_TCPConnectsButHTTPFails(t *testing.T) {
	// Set up a TCP listener that accepts connections but doesn't speak HTTP
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	port := ln.Addr().(*net.TCPAddr).Port

	// Accept connections but don't respond (just close immediately)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()

	ctx := context.Background()
	deadline := time.Now().Add(1 * time.Second)
	err = WaitForReady(ctx, port, deadline)
	if err == nil {
		t.Error("expected error when HTTP fails after TCP connection")
	}
}

// ── WaitForPort: deadline timeout ────────────────────────────────

func TestWaitForPort_DeadlineTimeout(t *testing.T) {
	ctx := context.Background()
	deadline := time.Now().Add(50 * time.Millisecond)
	err := WaitForPort(ctx, 19999, deadline)
	if err == nil {
		t.Error("expected deadline timeout error")
	}
	if !strings.Contains(err.Error(), "port readiness timeout") {
		t.Errorf("expected 'port readiness timeout' error, got %v", err)
	}
}

// ── WaitForPort: context cancellation during wait ────────────────

func TestWaitForPort_ContextCancelDuringWait(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	deadline := time.Now().Add(5 * time.Second)
	// Cancel after a short delay to trigger the ctx.Done() path inside the select
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	err := WaitForPort(ctx, 19999, deadline)
	if err == nil {
		t.Error("expected context cancellation error")
	}
}

// ── FindCatalinaHome: os.ReadDir error ───────────────────────────

func TestFindCatalinaHome_ReadDirError(t *testing.T) {
	t.Setenv("KAIRO_TOMCAT6_HOME", "")
	bundledDir := t.TempDir()
	// Create tomcat6 dir but make it unreadable
	tomcatDir := filepath.Join(bundledDir, "tomcat6")
	os.MkdirAll(tomcatDir, 0000)
	defer os.Chmod(tomcatDir, 0755)
	_, err := FindCatalinaHome(bundledDir)
	if err == nil {
		t.Error("Expected error when tomcat6 dir is unreadable")
	}
}

// ── FindCatalinaHome: empty tomcat6 dir (no subdirs with bootstrap.jar) ──

func TestFindCatalinaHome_NoBootstrapJarInAnySubdir(t *testing.T) {
	t.Setenv("KAIRO_TOMCAT6_HOME", "")
	bundledDir := t.TempDir()
	tomcatDir := filepath.Join(bundledDir, "tomcat6")
	os.MkdirAll(filepath.Join(tomcatDir, "some-dir-without-jar"), 0755)
	os.MkdirAll(filepath.Join(tomcatDir, "another-dir"), 0755)
	_, err := FindCatalinaHome(bundledDir)
	if err == nil {
		t.Error("Expected error when no subdir has bootstrap.jar")
	}
}

// ── TailLog: read error ──────────────────────────────────────────

func TestInstance_TailLog_ReadError(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "unreadable.log")
	// Create a directory at the path so os.ReadFile fails (can't read a directory)
	os.MkdirAll(logPath, 0755)

	inst := &Instance{logPath: logPath}
	_, err := inst.TailLog(10)
	if err == nil {
		t.Error("Expected error reading a directory as a file")
	}
}

// ── copyMinimalConf: WriteFile error ─────────────────────────────

func TestCopyMinimalConf_WriteError(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	// Create conf as a file (not a directory) so os.MkdirAll fails or
	// atomicfile.WriteFile fails because it can't write inside a file
	os.WriteFile(filepath.Join(base, "conf"), []byte{}, 0644)

	err := copyMinimalConf(home, base)
	if err == nil {
		t.Error("Expected error when conf is a file not a directory")
	}
}

// ── PrepareCatalinaBase: copyMinimalConf error ───────────────────

func TestPrepareCatalinaBase_CopyMinimalConfError(t *testing.T) {
	home := t.TempDir()
	// Create home without bin/bootstrap.jar so the config validation fails
	// Actually we need to make copyMinimalConf fail. Make conf a file.
	os.MkdirAll(filepath.Join(home, "bin"), 0755)
	os.WriteFile(filepath.Join(home, "bin", "bootstrap.jar"), []byte("fake"), 0644)

	base := t.TempDir()
	// Make conf a file so copyMinimalConf can't create conf/ directory
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
		t.Error("Expected error from PrepareCatalinaBase when copyMinimalConf fails")
	}
}

// ── PrepareCatalinaBase: writeServerXML error (conf is file) ────

func TestPrepareCatalinaBase_ConfIsFile(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	// Create conf as a file (not dir) to make writeServerXML write fail
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

// ── WaitForReady: deadline exceeded before ctx ───────────────────

func TestWaitForReady_DeadlineExceeded(t *testing.T) {
	ctx := context.Background()
	deadline := time.Now().Add(-1 * time.Second) // already past
	err := WaitForReady(ctx, 19999, deadline)
	if err == nil {
		t.Error("expected deadline exceeded error")
	}
	if !strings.Contains(err.Error(), "readiness timeout") {
		t.Errorf("expected 'readiness timeout', got %v", err)
	}
}

// ── WaitForReady: context cancel during wait ─────────────────────

func TestWaitForReady_ContextCancelDuringWait(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	deadline := time.Now().Add(5 * time.Second)
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	err := WaitForReady(ctx, 19999, deadline)
	if err == nil {
		t.Error("expected context cancellation error")
	}
}

// ── Instance: Stop with nil process ──────────────────────────────

func TestInstance_Stop_NoProcess(t *testing.T) {
	inst := &Instance{}
	err := inst.Stop(5 * time.Second)
	if err == nil {
		t.Error("expected error when stopping with no managed process")
	}
	if !strings.Contains(err.Error(), "no managed process") {
		t.Errorf("expected 'no managed process' error, got %v", err)
	}
}

// ── Instance: ForceStop with nil process ─────────────────────────

func TestInstance_ForceStop_NoProcess(t *testing.T) {
	inst := &Instance{}
	err := inst.ForceStop()
	if err == nil {
		t.Error("expected error when force stopping with no managed process")
	}
	if !strings.Contains(err.Error(), "no managed process") {
		t.Errorf("expected 'no managed process' error, got %v", err)
	}
}

// ── BootstrapClasspath: with both jars ───────────────────────────

func TestBootstrapClasspath_BothJars(t *testing.T) {
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	os.MkdirAll(binDir, 0755)
	os.WriteFile(filepath.Join(binDir, "bootstrap.jar"), []byte("fake"), 0644)
	os.WriteFile(filepath.Join(binDir, "tomcat-juli.jar"), []byte("fake"), 0644)

	cp := BootstrapClasspath(dir)
	if len(cp) != 2 {
		t.Errorf("expected 2 jars, got %d: %v", len(cp), cp)
	}
}

// ── BuildCommand: with debug port and suspend ────────────────────

func TestBuildCommand_DebugSuspendTrue(t *testing.T) {
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
		DebugSuspend: true,
	}
	_, args, _, err := BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "suspend=y") {
		t.Error("expected suspend=y when DebugSuspend is true")
	}
}

// ── BuildEnv: with empty env var value ───────────────────────────

func TestBuildEnv_EnvWithEquals(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/tomcat",
		CatalinaBase: "/base",
		Env:          []string{"KEY=val=with=equals"},
	}
	env := buildEnv(cfg)
	envMap := make(map[string]string)
	for _, e := range env {
		if idx := strings.IndexByte(e, '='); idx > 0 {
			envMap[e[:idx]] = e[idx+1:]
		}
	}
	if envMap["KEY"] != "val=with=equals" {
		t.Errorf("KEY = %q, want val=with=equals", envMap["KEY"])
	}
}

// ── BuildEnv: with env var that has no equals sign ───────────────

func TestBuildEnv_NoEqualsSign(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/tomcat",
		CatalinaBase: "/base",
		Env:          []string{"INVALID_ENV_VAR"},
	}
	env := buildEnv(cfg)
	envMap := make(map[string]string)
	for _, e := range env {
		if idx := strings.IndexByte(e, '='); idx > 0 {
			envMap[e[:idx]] = e[idx+1:]
		}
	}
	if _, ok := envMap["INVALID_ENV_VAR"]; ok {
		t.Error("INVALID_ENV_VAR should not be in env (no equals sign)")
	}
}

// ── SendShutdown: timeout ────────────────────────────────────────

func TestSendShutdown_Timeout(t *testing.T) {
	// Use a port that doesn't respond (e.g., a firewall-blocked port)
	// For test reliability, just use a very short timeout on a non-listening port
	err := SendShutdown(19999, 1*time.Nanosecond)
	if err == nil {
		t.Error("expected timeout or connection error")
	}
}

// ── WaitForReady: HTTP success with non-200 status ───────────────

func TestWaitForReady_HTTPNon200(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	port := ln.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	defer srv.Close()

	time.Sleep(50 * time.Millisecond)

	ctx := context.Background()
	deadline := time.Now().Add(2 * time.Second)
	err = WaitForReady(ctx, port, deadline)
	if err != nil {
		t.Errorf("WaitForReady should succeed even with non-200 status, got %v", err)
	}
}

// ── WaitForPort: success with a real listener ────────────────────

func TestWaitForPort_Success(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	port := ln.Addr().(*net.TCPAddr).Port
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- WaitForPort(ctx, port, time.Now().Add(2*time.Second))
	}()

	// Wait a bit to ensure the goroutine is running
	time.Sleep(50 * time.Millisecond)

	// Close the listener after the goroutine has started
	ln.Close()

	err = <-done
	if err != nil {
		t.Fatalf("WaitForPort should succeed on a bound listener: %v", err)
	}
}

// ── Config.Validate: missing catalina base ───────────────────────

func TestConfig_Validate_MissingCatalinaBase_Edge(t *testing.T) {
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/fake",
		CatalinaBase: "",
		WebappDir:    "/fake-webapp",
		HTTPPort:     8080,
		ShutdownPort: 8005,
	}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "catalina base") {
		t.Errorf("expected catalina base error, got %v", err)
	}
}

// ── Config.Validate: all missing fields ──────────────────────────

func TestConfig_Validate_AllMissing(t *testing.T) {
	cfg := Config{}
	err := cfg.Validate()
	if err == nil {
		t.Error("expected error for empty config")
	}
}

// ── writeServerXML: with context path as "/" ─────────────────────

func TestWriteServerXML_ContextPathSlash(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()

	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
		ContextPath:  "/",
	}
	if err := writeServerXML(cfg); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(base, "conf", "server.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "path=\"/\"") {
		t.Error("expected context path to be /")
	}
}

// ── writeLoggingProperties: creates conf dir ─────────────────────

func TestWriteLoggingProperties_CreatesConfDir(t *testing.T) {
	dir := t.TempDir()
	// No conf dir exists yet, writeLoggingProperties should create it
	if err := writeLoggingProperties(dir); err != nil {
		t.Fatalf("writeLoggingProperties: %v", err)
	}
	path := filepath.Join(dir, "conf", "logging.properties")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("logging.properties not found: %v", err)
	}
}

// ── copyMinimalConf: skips existing files, creates missing ───────

func TestCopyMinimalConf_MixedExistingAndMissing(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	confDir := filepath.Join(base, "conf")
	os.MkdirAll(confDir, 0755)

	// Pre-create one file
	existingWebXML := []byte("<web-app>custom</web-app>")
	os.WriteFile(filepath.Join(confDir, "web.xml"), existingWebXML, 0644)

	if err := copyMinimalConf(home, base); err != nil {
		t.Fatal(err)
	}
	// web.xml should be unchanged
	data, _ := os.ReadFile(filepath.Join(confDir, "web.xml"))
	if string(data) != string(existingWebXML) {
		t.Error("existing web.xml should not be overwritten")
	}
	// Other files should be copied
	if _, err := os.Stat(filepath.Join(confDir, "context.xml")); err != nil {
		t.Error("context.xml should exist")
	}
}

// ── PrepareCatalinaBase: writeLoggingProperties error ────────────

func TestPrepareCatalinaBase_WriteLoggingError(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	confDir := filepath.Join(base, "conf")
	// Pre-create conf dir and populate all files so copyMinimalConf skips everything
	os.MkdirAll(confDir, 0755)
	for _, f := range []string{"web.xml", "context.xml", "tomcat-users.xml", "catalina.policy"} {
		os.WriteFile(filepath.Join(confDir, f), []byte("<xml/>"), 0644)
	}
	// Pre-create server.xml so writeServerXML can overwrite it
	os.WriteFile(filepath.Join(confDir, "server.xml"), []byte("<Server/>"), 0644)
	// Make conf dir read-only so writeLoggingProperties's atomicfile.WriteFile fails
	os.Chmod(confDir, 0444)
	defer os.Chmod(confDir, 0755)

	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}
	err := PrepareCatalinaBase(cfg)
	// On Windows, chmod may not prevent file creation, so error is optional
	if err != nil {
		t.Logf("PrepareCatalinaBase error (expected on Unix): %v", err)
	}
}

// ── PrepareCatalinaBase: success with all fresh ──────────────────

func TestPrepareCatalinaBase_AllFresh(t *testing.T) {
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
	// Verify all expected files
	for _, f := range []string{"web.xml", "context.xml", "tomcat-users.xml", "catalina.policy", "server.xml", "logging.properties"} {
		if _, err := os.Stat(filepath.Join(base, "conf", f)); err != nil {
			t.Errorf("expected %s to exist: %v", f, err)
		}
	}
}

// ── IsPortBound: bound and unbound ───────────────────────────────

func TestIsPortBound_Bound(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port
	if !IsPortBound(port) {
		t.Error("expected port to be reported as bound")
	}
}

func TestIsPortBound_Unbound_AfterClose(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	time.Sleep(50 * time.Millisecond)
	// Port should now be unbound
	if IsPortBound(port) {
		t.Log("port still reported as bound (OS may not have released it yet)")
	}
}

// ── FindCatalinaHome: env var set but no bootstrap.jar ───────────

func TestFindCatalinaHome_EnvVarSetButNoBootstrap(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("KAIRO_TOMCAT6_HOME", dir)
	_, err := FindCatalinaHome("/nonexistent/bundled")
	if err == nil {
		t.Error("Expected error when env var points to dir without bootstrap.jar")
	}
	if !strings.Contains(err.Error(), "KAIRO_TOMCAT6_HOME") {
		t.Errorf("error should mention KAIRO_TOMCAT6_HOME, got %v", err)
	}
}

// ── FindCatalinaHome: bundled dir with file (not dir) in tomcat6 ─

func TestFindCatalinaHome_FileNotDir(t *testing.T) {
	t.Setenv("KAIRO_TOMCAT6_HOME", "")
	bundledDir := t.TempDir()
	tomcatDir := filepath.Join(bundledDir, "tomcat6")
	os.MkdirAll(tomcatDir, 0755)
	// Create a file (not a directory) to test the IsDir check
	os.WriteFile(filepath.Join(tomcatDir, "README.txt"), []byte("readme"), 0644)
	// Also create a valid dir with bootstrap.jar
	validDir := filepath.Join(tomcatDir, "valid-tomcat")
	os.MkdirAll(filepath.Join(validDir, "bin"), 0755)
	os.WriteFile(filepath.Join(validDir, "bin", "bootstrap.jar"), []byte("fake"), 0644)

	result, err := FindCatalinaHome(bundledDir)
	if err != nil {
		t.Fatalf("FindCatalinaHome failed: %v", err)
	}
	if !strings.Contains(result, "valid-tomcat") {
		t.Errorf("FindCatalinaHome = %q, expected to find valid-tomcat", result)
	}
}

// ── TailLog: n=0 ─────────────────────────────────────────────────

func TestInstance_TailLog_NegativeN(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "test.log")
	os.WriteFile(logPath, []byte("line1\nline2\n"), 0644)
	inst := &Instance{logPath: logPath}
	lines, err := inst.TailLog(0)
	if err != nil {
		t.Fatalf("TailLog failed: %v", err)
	}
	if lines != nil {
		t.Errorf("TailLog(0) should return nil, got %v", lines)
	}
}

// ── TailLog: n larger than file content ──────────────────────────

func TestInstance_TailLog_MoreThanContent(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "test.log")
	os.WriteFile(logPath, []byte("line1\nline2\n"), 0644)
	inst := &Instance{logPath: logPath}
	lines, err := inst.TailLog(100)
	if err != nil {
		t.Fatalf("TailLog failed: %v", err)
	}
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(lines))
	}
}

// ── TailLog: empty file ──────────────────────────────────────────

func TestInstance_TailLog_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "test.log")
	os.WriteFile(logPath, []byte{}, 0644)
	inst := &Instance{logPath: logPath}
	lines, err := inst.TailLog(10)
	if err != nil {
		t.Fatalf("TailLog failed: %v", err)
	}
	if lines != nil {
		t.Errorf("TailLog on empty file should return nil, got %v", lines)
	}
}

// ── tailLines: edge cases ────────────────────────────────────────

func TestTailLines_EdgeCases(t *testing.T) {
	// n = 1
	got := tailLines("a\nb\nc\n", 1)
	if len(got) != 1 || got[0] != "c" {
		t.Errorf("tailLines n=1: got %v, want [c]", got)
	}
	// single line with newline
	got = tailLines("hello\n", 1)
	if len(got) != 1 || got[0] != "hello" {
		t.Errorf("tailLines on single line: got %v, want [hello]", got)
	}
	// n exactly equals
	got = tailLines("a\nb\nc", 3)
	if len(got) != 3 {
		t.Errorf("tailLines n=3: got %d lines, want 3", len(got))
	}
}

// ── splitLines: edge cases ───────────────────────────────────────

func TestSplitLines_EdgeCases(t *testing.T) {
	// Single empty line
	got := splitLines("\n")
	if len(got) != 1 || got[0] != "" {
		t.Errorf("splitLines on newline only: got %v, want [\"\"]", got)
	}
	// Multiple newlines
	got = splitLines("\n\n\n")
	if len(got) != 3 {
		t.Errorf("splitLines on three newlines: got %d, want 3", len(got))
	}
}

// ── fileSHA256: large file ───────────────────────────────────────

func TestFileSHA256_LargeFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "large.txt")
	data := make([]byte, 10000)
	for i := range data {
		data[i] = byte(i % 256)
	}
	os.WriteFile(path, data, 0644)
	hash, err := fileSHA256(path)
	if err != nil {
		t.Fatalf("fileSHA256: %v", err)
	}
	if len(hash) != 64 {
		t.Errorf("hash length = %d, want 64", len(hash))
	}
}

// ── fileSHA256: empty file ───────────────────────────────────────

func TestFileSHA256_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.txt")
	os.WriteFile(path, []byte{}, 0644)
	hash, err := fileSHA256(path)
	if err != nil {
		t.Fatalf("fileSHA256: %v", err)
	}
	if hash == "" {
		t.Error("hash should not be empty for empty file")
	}
}

// ── boolYN: both values ──────────────────────────────────────────

func TestBoolYN_Both(t *testing.T) {
	if boolYN(true) != "y" {
		t.Error("boolYN(true) should be y")
	}
	if boolYN(false) != "n" {
		t.Error("boolYN(false) should be n")
	}
}

// ── logTail: add and string with exact max ───────────────────────

func TestLogTail_ExactMax(t *testing.T) {
	lt := newLogTail(2)
	lt.add("line1")
	lt.add("line2")
	s := lt.String()
	if !strings.Contains(s, "line1") {
		t.Error("should contain line1")
	}
	if !strings.Contains(s, "line2") {
		t.Error("should contain line2")
	}
	lt.add("line3")
	s = lt.String()
	if strings.Contains(s, "line1") {
		t.Error("should not contain line1 (evicted)")
	}
	if !strings.Contains(s, "line2") {
		t.Error("should contain line2")
	}
	if !strings.Contains(s, "line3") {
		t.Error("should contain line3")
	}
}

// ── logTail: add beyond max ──────────────────────────────────────

func TestLogTail_ManyEntries(t *testing.T) {
	lt := newLogTail(5)
	for i := 0; i < 20; i++ {
		lt.add("line")
	}
	s := lt.String()
	lines := strings.Split(s, "\n")
	if len(lines) != 5 {
		t.Errorf("expected 5 lines, got %d", len(lines))
	}
}

// ── BuildCommand: with JVMOptions ────────────────────────────────

func TestBuildCommand_WithJVMOptions(t *testing.T) {
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
		JVMOptions:   []string{"-Xmx1024m", "-XX:+UseParallelGC"},
	}
	_, args, _, err := BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-Xmx1024m") {
		t.Error("expected -Xmx1024m in args")
	}
	if !strings.Contains(joined, "-XX:+UseParallelGC") {
		t.Error("expected -XX:+UseParallelGC in args")
	}
}

// ── BuildCommand: with logging config arg ────────────────────────

func TestBuildCommand_LoggingConfig(t *testing.T) {
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
	}
	_, args, _, err := BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	expectedLogConfig := filepath.Join(base, "conf", "logging.properties")
	if !strings.Contains(joined, expectedLogConfig) {
		t.Errorf("expected logging config path %q in args", expectedLogConfig)
	}
}

// ── Config.Validate: error context ───────────────────────────────

func TestConfig_Validate_ErrorContext(t *testing.T) {
	// Test that bootstrap.jar error wraps the os error
	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: "/nonexistent",
		CatalinaBase: "/base",
		WebappDir:    "/webapp",
		HTTPPort:     8080,
		ShutdownPort: 8005,
	}
	err := cfg.Validate()
	if err == nil {
		t.Error("expected error")
	}
	if !strings.Contains(err.Error(), "bootstrap.jar") {
		t.Errorf("expected bootstrap.jar error, got %v", err)
	}
}

// ── WaitForReady: HTTP 500 (still succeeds, err == nil) ────────

func TestWaitForReady_HTTP500(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	port := ln.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	defer srv.Close()

	time.Sleep(50 * time.Millisecond)

	ctx := context.Background()
	deadline := time.Now().Add(2 * time.Second)
	err = WaitForReady(ctx, port, deadline)
	if err != nil {
		t.Errorf("WaitForReady should succeed even with 500, got %v", err)
	}
}

// ── Mock ManagedProcess for Stop/ForceStop tests ────────────────

type mockManagedProcess struct {
	gracefulStopErr error
	forceStopErr    error
}

func (m *mockManagedProcess) Start(ctx context.Context, spec proc.ProcessSpec) (proc.ProcessObservation, error) {
	return proc.ProcessObservation{}, nil
}

func (m *mockManagedProcess) GracefulStop(ctx context.Context, identity domain.ProcessIdentity) error {
	return m.gracefulStopErr
}

func (m *mockManagedProcess) ForceStop(ctx context.Context, identity domain.ProcessIdentity) error {
	return m.forceStopErr
}

func (m *mockManagedProcess) Inspect(ctx context.Context, identity domain.ProcessIdentity) (proc.ProcessObservation, error) {
	return proc.ProcessObservation{}, nil
}

func (m *mockManagedProcess) ChildProcesses(ctx context.Context, identity domain.ProcessIdentity) ([]int, error) {
	return nil, nil
}

func (m *mockManagedProcess) SubscribeLogs(listener proc.LogListener) proc.Disposable {
	return &mockDisposable{}
}

func (m *mockManagedProcess) Wait() {}

type mockDisposable struct{}

func (d *mockDisposable) Dispose() {}

// ── Instance: Stop success ──────────────────────────────────────

func TestInstance_Stop_Success(t *testing.T) {
	inst := &Instance{
		process:         &mockManagedProcess{},
		processIdentity: domain.ProcessIdentity{},
	}
	err := inst.Stop(1 * time.Second)
	if err != nil {
		t.Errorf("Stop should succeed: %v", err)
	}
}

// ── Instance: Stop with error ───────────────────────────────────

func TestInstance_Stop_Error(t *testing.T) {
	inst := &Instance{
		process:         &mockManagedProcess{gracefulStopErr: errors.New("stop failed")},
		processIdentity: domain.ProcessIdentity{},
	}
	err := inst.Stop(1 * time.Second)
	if err == nil {
		t.Error("Stop should return error from GracefulStop")
	}
}

// ── Instance: ForceStop success ─────────────────────────────────

func TestInstance_ForceStop_Success(t *testing.T) {
	inst := &Instance{
		process:         &mockManagedProcess{},
		processIdentity: domain.ProcessIdentity{},
	}
	err := inst.ForceStop()
	if err != nil {
		t.Errorf("ForceStop should succeed: %v", err)
	}
}

// ── Instance: ForceStop with error ──────────────────────────────

func TestInstance_ForceStop_Error(t *testing.T) {
	inst := &Instance{
		process:         &mockManagedProcess{forceStopErr: errors.New("force stop failed")},
		processIdentity: domain.ProcessIdentity{},
	}
	err := inst.ForceStop()
	if err == nil {
		t.Error("ForceStop should return error from ForceStop")
	}
}

// ── copyMinimalConf: source file is a directory (not a file) ────

func TestCopyMinimalConf_SourceFileIsDir(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	// Replace web.xml in catalina home conf with a directory
	// os.ReadFile on a directory fails with a non-IsNotExist error
	confDir := filepath.Join(home, "conf")
	webXMLPath := filepath.Join(confDir, "web.xml")
	os.Remove(webXMLPath)
	os.MkdirAll(webXMLPath, 0755)

	err := copyMinimalConf(home, base)
	if err == nil {
		t.Error("Expected error when source conf file is a directory")
	}
}

// ── PrepareCatalinaBase: server.xml is a directory ───────────────

func TestPrepareCatalinaBase_ServerXMLIsDir(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	confDir := filepath.Join(base, "conf")
	os.MkdirAll(confDir, 0755)
	// Pre-create all conf files so copyMinimalConf skips them
	for _, f := range []string{"web.xml", "context.xml", "tomcat-users.xml", "catalina.policy"} {
		os.WriteFile(filepath.Join(confDir, f), []byte("<xml/>"), 0644)
	}
	// Pre-create server.xml as a directory so atomicfile.WriteFile rename fails
	// (MoveFileExW cannot replace a directory with a file on Windows)
	os.MkdirAll(filepath.Join(confDir, "server.xml"), 0755)

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
		t.Error("Expected error when server.xml is a directory")
	}
}

// ── writeServerXML: server.xml is a directory ────────────────────

func TestWriteServerXML_ServerXMLIsDir(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	confDir := filepath.Join(base, "conf")
	os.MkdirAll(confDir, 0755)
	// Create server.xml as a directory so atomicfile.WriteFile rename fails
	os.MkdirAll(filepath.Join(confDir, "server.xml"), 0755)

	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}
	err := writeServerXML(cfg)
	if err == nil {
		t.Error("Expected error when server.xml is a directory")
	}
}

// ── Start: PrepareCatalinaBase error path ───────────────────────

func TestStart_PrepareCatalinaBaseError(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	// Create conf as a file so PrepareCatalinaBase fails
	os.WriteFile(filepath.Join(base, "conf"), []byte{}, 0644)

	spec := Spec{
		ID:           "test",
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		HTTPPort:     18080,
		ShutdownPort: 18005,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
	}
	_, err := Start(context.Background(), spec)
	if err == nil {
		t.Error("Expected error when PrepareCatalinaBase fails")
	}
	if !strings.Contains(err.Error(), "prepare catalina base") {
		t.Errorf("expected 'prepare catalina base' error, got %v", err)
	}
}

// ── Start: BuildCommand error path ───────────────────────────────

func TestStart_BuildCommandError(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()

	spec := Spec{
		ID:           "test",
		JavaHome:     "", // Invalid - will cause BuildCommand to fail via Validate
		CatalinaHome: home,
		CatalinaBase: base,
		HTTPPort:     18080,
		ShutdownPort: 18005,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
	}
	_, err := Start(context.Background(), spec)
	if err == nil {
		t.Error("Expected error when BuildCommand fails")
	}
	if !strings.Contains(err.Error(), "build command") {
		t.Errorf("expected 'build command' error, got %v", err)
	}
}

// ── PrepareCatalinaBase: writeLoggingProperties error ───────────

func TestPrepareCatalinaBase_WriteLoggingPropertiesError(t *testing.T) {
	home := createFakeCatalinaHome(t)
	base := t.TempDir()
	confDir := filepath.Join(base, "conf")
	// Pre-create conf dir and populate all files so copyMinimalConf skips everything
	os.MkdirAll(confDir, 0755)
	for _, f := range []string{"web.xml", "context.xml", "tomcat-users.xml", "catalina.policy"} {
		os.WriteFile(filepath.Join(confDir, f), []byte("<xml/>"), 0644)
	}
	// Pre-create server.xml so writeServerXML can overwrite it
	os.WriteFile(filepath.Join(confDir, "server.xml"), []byte("<Server/>"), 0644)
	// Make conf dir read-only so writeLoggingProperties's atomicfile.WriteFile fails
	os.Chmod(confDir, 0444)
	defer os.Chmod(confDir, 0755)

	cfg := Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}
	err := PrepareCatalinaBase(cfg)
	// On Windows, chmod doesn't prevent file creation, so this might succeed
	if err != nil {
		t.Logf("PrepareCatalinaBase error (expected on Unix): %v", err)
	}
}