package runtime

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/catalinabase"
	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/proc"
	"github.com/kairo-ide/runtime-agent/internal/tomcat6"
)

type fakePreparer struct {
	mu        sync.Mutex
	plans     []*catalinabase.Plan
	prepareFn func(*catalinabase.Plan) error
}

func (f *fakePreparer) Prepare(plan *catalinabase.Plan) error {
	f.mu.Lock()
	f.plans = append(f.plans, plan)
	fn := f.prepareFn
	f.mu.Unlock()
	for _, dir := range plan.Layout.RequiredDirs() {
		os.MkdirAll(dir, 0755)
	}
	if fn != nil {
		return fn(plan)
	}
	return nil
}

func createTestCatalinaHome(t *testing.T) string {
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
	if err := os.WriteFile(filepath.Join(binDir, "bootstrap.jar"), []byte("fake"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "tomcat-juli.jar"), []byte("fake-juli"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"web.xml", "context.xml", "tomcat-users.xml", "catalina.policy"} {
		if err := os.WriteFile(filepath.Join(confDir, f), []byte("<!-- "+f+" -->"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

func startFakeTomcatListener(t *testing.T) (port int, shutdownPort int, cleanup func()) {
	t.Helper()

	shutdownLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	shutdownPort = shutdownLn.Addr().(*net.TCPAddr).Port

	httpLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		shutdownLn.Close()
		t.Fatal(err)
	}
	port = httpLn.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Server", "Apache-Coyote/1.1")
		w.WriteHeader(200)
		w.Write([]byte("OK"))
	})

	srv := &http.Server{Handler: mux}

	shutdownCh := make(chan struct{})
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		srv.Serve(httpLn)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			conn, err := shutdownLn.Accept()
			if err != nil {
				return
			}
			buf := make([]byte, 100)
			n, _ := conn.Read(buf)
			if strings.Contains(string(buf[:n]), "SHUTDOWN") {
				close(shutdownCh)
			}
			conn.Close()
		}
	}()

	cleanup = func() {
		srv.Close()
		shutdownLn.Close()
		httpLn.Close()
		wg.Wait()
	}

	_ = shutdownCh
	return port, shutdownPort, cleanup
}

func testRuntimePlan(t *testing.T, home, base string, httpPort, shutdownPort int) domain.RuntimePlan {
	t.Helper()
	webappDir := filepath.Join(base, "webapps", "ROOT")
	os.MkdirAll(webappDir, 0755)
	os.MkdirAll(filepath.Join(base, "conf"), 0755)

	return domain.RuntimePlan{
		WorkspaceID:  "ws-test",
		ProjectID:    "prj-test",
		ServerID:     "srv-test",
		RuntimeID:    "tomcat6",
		JavaHome:     "/fake-jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    webappDir,
		ContextPath:  "/",
		HTTPPort:     httpPort,
		ShutdownPort: shutdownPort,
		JVMOptions:   []string{"-Xmx256m"},
		Generation:   1,
	}
}

func TestTomcat6Provider_ID(t *testing.T) {
	p := NewTomcat6Provider(nil, nil, nil, Tomcat6ProviderConfig{})
	if p.ID() != "tomcat6" {
		t.Errorf("expected ID 'tomcat6', got %s", p.ID())
	}
}

func TestTomcat6Provider_Prepare_ValidatesPlan(t *testing.T) {
	prep := &fakePreparer{}
	p := NewTomcat6Provider(nil, prep, nil, Tomcat6ProviderConfig{})

	invalidPlan := domain.RuntimePlan{
		WorkspaceID: "ws",
		ProjectID:   "prj",
		ServerID:    "srv",
	}
	err := p.Prepare(context.Background(), invalidPlan)
	if err == nil {
		t.Error("expected error for invalid plan")
	}
}

func TestTomcat6Provider_Prepare_CreatesLayoutAndConfig(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()
	webappDir := filepath.Join(base, "webapps", "ROOT")

	prep := &fakePreparer{}
	p := NewTomcat6Provider(nil, prep, nil, Tomcat6ProviderConfig{})

	plan := domain.RuntimePlan{
		WorkspaceID:  "ws",
		ProjectID:    "prj",
		ServerID:     "srv",
		RuntimeID:    "tomcat6",
		JavaHome:     "/fake-jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    webappDir,
		ContextPath:  "/test",
		HTTPPort:     18080,
		ShutdownPort: 18005,
		Generation:   1,
	}

	err := p.Prepare(context.Background(), plan)
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}

	prep.mu.Lock()
	if len(prep.plans) != 1 {
		t.Fatalf("expected preparer to be called once, got %d", len(prep.plans))
	}
	prep.mu.Unlock()

	serverXML := filepath.Join(base, "conf", "server.xml")
	if _, err := os.Stat(serverXML); err != nil {
		t.Errorf("expected server.xml to exist: %v", err)
	}

	for _, dir := range []string{"logs", "temp", "work", "webapps", "conf"} {
		d := filepath.Join(base, dir)
		if _, err := os.Stat(d); err != nil {
			t.Errorf("expected dir %s to exist: %v", dir, err)
		}
	}
}

func TestTomcat6Provider_Start_InvalidPlan(t *testing.T) {
	p := NewTomcat6Provider(nil, nil, nil, Tomcat6ProviderConfig{StartTimeout: 1 * time.Second})

	_, err := p.Start(context.Background(), domain.RuntimePlan{}, nil)
	if err == nil {
		t.Error("expected error for invalid plan")
	}
}

func TestTomcat6Provider_Start_Success(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()

	httpPort, shutdownPort, cleanup := startFakeTomcatListener(t)
	defer cleanup()

	prep := &fakePreparer{}

	var startedProcess *proc.FakeProcess
	processFactory := func() proc.ManagedProcess {
		fp := proc.NewFakeProcess(proc.FakeProcessBehavior{
			ExitAfter: 10 * time.Second,
		})
		startedProcess = fp
		return fp
	}

	cfg := Tomcat6ProviderConfig{
		StartTimeout: 5 * time.Second,
		StopTimeout:  5 * time.Second,
		GraceTimeout: 2 * time.Second,
	}
	p := NewTomcat6Provider(processFactory, prep, nil, cfg)

	plan := testRuntimePlan(t, home, base, httpPort, shutdownPort)

	var capturedLogs []domain.LogLine
	logSink := func(line domain.LogLine) {
		capturedLogs = append(capturedLogs, line)
	}

	identity, err := p.Start(context.Background(), plan, logSink)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	if identity == nil {
		t.Fatal("expected non-nil identity")
	}
	if identity.PID <= 0 {
		t.Errorf("expected positive PID, got %d", identity.PID)
	}

	obs, err := p.Inspect(context.Background(), *identity)
	if err != nil {
		t.Fatalf("Inspect failed: %v", err)
	}
	if !obs.Running {
		t.Error("expected process to be running")
	}

	readyCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	deadline := time.Now().Add(2 * time.Second)
	err = p.IsReady(readyCtx, plan, *identity, deadline)
	if err != nil {
		t.Errorf("IsReady should succeed: %v", err)
	}

	err = p.GracefulStop(context.Background(), *identity)
	if err != nil {
		t.Errorf("GracefulStop failed: %v", err)
	}

	if startedProcess != nil && startedProcess.IsRunning() {
		t.Error("process should be stopped after GracefulStop")
	}
}

func TestTomcat6Provider_Start_AlreadyRunning(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()

	httpPort, shutdownPort, cleanup := startFakeTomcatListener(t)
	defer cleanup()

	prep := &fakePreparer{}
	processFactory := func() proc.ManagedProcess {
		return proc.NewFakeProcess(proc.FakeProcessBehavior{ExitAfter: 10 * time.Second})
	}

	p := NewTomcat6Provider(processFactory, prep, nil, Tomcat6ProviderConfig{StartTimeout: 5 * time.Second})
	plan := testRuntimePlan(t, home, base, httpPort, shutdownPort)

	_, err := p.Start(context.Background(), plan, nil)
	if err != nil {
		t.Fatalf("first Start failed: %v", err)
	}

	_, err = p.Start(context.Background(), plan, nil)
	if err != domain.ErrServerAlreadyRunning {
		t.Errorf("expected ErrServerAlreadyRunning, got %v", err)
	}
}

func TestTomcat6Provider_Start_ReadinessTimeout(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()

	prep := &fakePreparer{}
	processFactory := func() proc.ManagedProcess {
		return proc.NewFakeProcess(proc.FakeProcessBehavior{
			ExitAfter: 10 * time.Second,
		})
	}

	p := NewTomcat6Provider(processFactory, prep, nil, Tomcat6ProviderConfig{
		StartTimeout: 300 * time.Millisecond,
		GraceTimeout: 200 * time.Millisecond,
	})

	plan := testRuntimePlan(t, home, base, 1, 2)

	_, err := p.Start(context.Background(), plan, nil)
	if err == nil {
		t.Fatal("expected readiness timeout error")
	}
	if !strings.Contains(err.Error(), "readiness") {
		t.Errorf("expected readiness error, got %v", err)
	}
}

func TestTomcat6Provider_ForceStop(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()

	httpPort, shutdownPort, cleanup := startFakeTomcatListener(t)
	defer cleanup()

	prep := &fakePreparer{}
	var fp *proc.FakeProcess
	processFactory := func() proc.ManagedProcess {
		fp = proc.NewFakeProcess(proc.FakeProcessBehavior{
			ExitAfter:      10 * time.Second,
			IgnoreGraceful: true,
		})
		return fp
	}

	p := NewTomcat6Provider(processFactory, prep, nil, Tomcat6ProviderConfig{
		StartTimeout: 5 * time.Second,
		GraceTimeout: 100 * time.Millisecond,
	})

	plan := testRuntimePlan(t, home, base, httpPort, shutdownPort)
	identity, err := p.Start(context.Background(), plan, nil)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	err = p.GracefulStop(context.Background(), *identity)
	if err != nil {
		t.Errorf("GracefulStop (fallback to force) should succeed: %v", err)
	}

	if fp.ForceCount() == 0 {
		t.Error("expected ForceStop to be called when graceful fails")
	}
}

func TestTomcat6Provider_Stop_NotFound(t *testing.T) {
	p := NewTomcat6Provider(nil, nil, nil, Tomcat6ProviderConfig{})
	badIdentity := domain.ProcessIdentity{PID: 99999}
	err := p.GracefulStop(context.Background(), badIdentity)
	if err != domain.ErrServerNotFound {
		t.Errorf("expected ErrServerNotFound, got %v", err)
	}
	err = p.ForceStop(context.Background(), badIdentity)
	if err != domain.ErrServerNotFound {
		t.Errorf("expected ErrServerNotFound, got %v", err)
	}
	_, err = p.Inspect(context.Background(), badIdentity)
	if err != domain.ErrServerNotFound {
		t.Errorf("expected ErrServerNotFound, got %v", err)
	}
}

func TestTomcat6Provider_ProcessExitsBeforeReady(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()

	prep := &fakePreparer{}
	processFactory := func() proc.ManagedProcess {
		return proc.NewFakeProcess(proc.FakeProcessBehavior{
			Crash:     true,
			ExitAfter: 50 * time.Millisecond,
		})
	}

	p := NewTomcat6Provider(processFactory, prep, nil, Tomcat6ProviderConfig{
		StartTimeout: 500 * time.Millisecond,
	})

	plan := testRuntimePlan(t, home, base, 1, 2)
	_, err := p.Start(context.Background(), plan, nil)
	if err == nil {
		t.Fatal("expected error when process exits before ready")
	}
}

func TestTomcat6Provider_CleanupBase(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()

	httpPort, shutdownPort, cleanup := startFakeTomcatListener(t)
	defer cleanup()

	prep := &fakePreparer{}
	processFactory := func() proc.ManagedProcess {
		return proc.NewFakeProcess(proc.FakeProcessBehavior{ExitAfter: 10 * time.Second})
	}

	p := NewTomcat6Provider(processFactory, prep, nil, Tomcat6ProviderConfig{StartTimeout: 5 * time.Second})
	plan := testRuntimePlan(t, home, base, httpPort, shutdownPort)

	_, err := p.Start(context.Background(), plan, nil)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	err = p.CleanupBase(context.Background(), plan)
	if err == nil {
		t.Error("expected error when cleaning up running server")
	}
}

func TestTomcat6Provider_LogsCapture(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()

	httpPort, shutdownPort, cleanup := startFakeTomcatListener(t)
	defer cleanup()

	prep := &fakePreparer{}
	processFactory := func() proc.ManagedProcess {
		return proc.NewFakeProcess(proc.FakeProcessBehavior{
			ExitAfter: 10 * time.Second,
			LogLines:  []string{"Starting Servlet Engine", "Server startup in 1234 ms"},
		})
	}

	p := NewTomcat6Provider(processFactory, prep, nil, Tomcat6ProviderConfig{StartTimeout: 5 * time.Second})
	plan := testRuntimePlan(t, home, base, httpPort, shutdownPort)

	var mu sync.Mutex
	var logs []domain.LogLine
	logSink := func(l domain.LogLine) {
		mu.Lock()
		logs = append(logs, l)
		mu.Unlock()
	}

	identity, err := p.Start(context.Background(), plan, logSink)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	count := len(logs)
	mu.Unlock()

	if count < 2 {
		t.Errorf("expected at least 2 log lines, got %d", count)
	}

	_ = p.ForceStop(context.Background(), *identity)
}

func TestTomcat6Provider_BuildCommandUsesDirectJavaBootstrap(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()

	cfg := tomcat6.Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}

	exe, args, _, err := tomcat6.BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(exe, "java") {
		t.Errorf("expected java executable, got %s", exe)
	}

	foundBootstrap := false
	for _, a := range args {
		if a == "org.apache.catalina.startup.Bootstrap" {
			foundBootstrap = true
		}
	}
	if !foundBootstrap {
		t.Error("expected org.apache.catalina.startup.Bootstrap in args")
	}
}

func TestTomcat6Provider_CrossPlatformCommandContract(t *testing.T) {
	home := createTestCatalinaHome(t)
	base := t.TempDir()

	cfg := tomcat6.Config{
		JavaHome:     "/jdk",
		CatalinaHome: home,
		CatalinaBase: base,
		WebappDir:    filepath.Join(base, "webapps", "ROOT"),
		HTTPPort:     18080,
		ShutdownPort: 18005,
	}

	exe, args, env, err := tomcat6.BuildCommand(cfg)
	if err != nil {
		t.Fatal(err)
	}

	hasJavaHome := false
	hasCatalinaHome := false
	hasCatalinaBase := false
	for _, e := range env {
		if strings.HasPrefix(e, "JAVA_HOME=") {
			hasJavaHome = true
		}
		if strings.HasPrefix(e, "CATALINA_HOME=") {
			hasCatalinaHome = true
		}
		if strings.HasPrefix(e, "CATALINA_BASE=") {
			hasCatalinaBase = true
		}
	}
	if !hasJavaHome {
		t.Error("expected JAVA_HOME in env")
	}
	if !hasCatalinaHome {
		t.Error("expected CATALINA_HOME in env")
	}
	if !hasCatalinaBase {
		t.Error("expected CATALINA_BASE in env")
	}

	foundClasspath := false
	for i, a := range args {
		if a == "-classpath" && i+1 < len(args) {
			cp := args[i+1]
			if !strings.Contains(cp, "bootstrap.jar") {
				t.Error("classpath should contain bootstrap.jar")
			}
			foundClasspath = true
		}
	}
	if !foundClasspath {
		t.Error("expected -classpath argument")
	}

	if exe == "" {
		t.Error("expected non-empty executable")
	}
}
