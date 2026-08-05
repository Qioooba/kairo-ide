package services

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/tomcat6"
)

func newTestRealServerRunner(t *testing.T) *realServerRunner {
	t.Helper()
	return newRealServerRunner(t.TempDir(), t.TempDir(), "", log.New("test"), 0, 0)
}

func TestRealServerRunner_Start_NoTomcat(t *testing.T) {
	r := newTestRealServerRunner(t)
	_, err := r.Start(api.StartServerRequest{})
	if err == nil {
		t.Fatal("expected error when Tomcat home is empty")
	}
	if !strings.Contains(err.Error(), "Tomcat 6 not bundled") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRealServerRunner_Start_Validation(t *testing.T) {
	tomcatHome := filepath.Join(t.TempDir(), "tomcat6")
	r := newRealServerRunner(t.TempDir(), t.TempDir(), tomcatHome, log.New("test"), 0, 0)

	_, err := r.Start(api.StartServerRequest{})
	if err == nil || !strings.Contains(err.Error(), "webappDir is required") {
		t.Errorf("expected webappDir error, got: %v", err)
	}

	_, err = r.Start(api.StartServerRequest{WebappDir: filepath.Join(t.TempDir(), "missing")})
	if err == nil || !strings.Contains(err.Error(), "webappDir not found") {
		t.Errorf("expected webappDir not found error, got: %v", err)
	}
}

func TestRealServerRunner_Start_ResolvesBundledJDK(t *testing.T) {
	t.Setenv("JAVA_HOME", "")
	t.Setenv("KAIRO_JDK_HOME", "")
	t.Setenv("KAIRO_JDT_LS_JRE", "")

	bundledDir := t.TempDir()
	javaHome := filepath.Join(bundledDir, "jdk17")
	binDir := filepath.Join(javaHome, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "java.exe"
	}
	javaPath := filepath.Join(binDir, javaExe)
	javaContent := "#!/bin/sh\necho 'openjdk version \"17.0.9\" 2023-10-17' >&2\nexit 0\n"
	if runtime.GOOS == "windows" {
		javaContent = "@echo off\r\necho openjdk version \"17.0.9\" 2023-10-17 1>&2\r\nexit /b 0\r\n"
	}
	if err := os.WriteFile(javaPath, []byte(javaContent), 0o755); err != nil {
		t.Fatal(err)
	}

	webapp := t.TempDir()
	tomcatHome := filepath.Join(t.TempDir(), "tomcat6")
	r := newRealServerRunner(t.TempDir(), bundledDir, tomcatHome, log.New("test"), 0, 0)

	_, err := r.Start(api.StartServerRequest{WebappDir: webapp})
	if err == nil {
		t.Fatal("expected downstream Tomcat error, not success")
	}
	if strings.Contains(err.Error(), "JAVA_HOME") || strings.Contains(err.Error(), "javaHome is required") {
		t.Fatalf("should resolve bundled JDK before Tomcat start, got: %v", err)
	}
}

func TestRealServerRunner_GetAndList(t *testing.T) {
	r := newTestRealServerRunner(t)
	if _, err := r.Get("missing"); err == nil {
		t.Error("expected not found error")
	}
	if got := r.List(); len(got) != 0 {
		t.Errorf("expected empty list, got %v", got)
	}

	r.meta["srv_1"] = &serverMeta{
		ID: "srv_1", ProjectID: "p1", Type: "tomcat6", State: "running",
		ContextPath: "/app", Ports: &tomcat6.Ports{HTTP: 18080},
	}
	resp, err := r.Get("srv_1")
	if err != nil {
		t.Fatal(err)
	}
	if resp.ID != "srv_1" || resp.State != "running" {
		t.Errorf("resp = %+v", resp)
	}
	if resp.URL == "" {
		t.Error("expected URL for running server with http port")
	}
	if got := r.List(); len(got) != 1 {
		t.Errorf("expected 1 server in list, got %d", len(got))
	}
}

func TestRealServerRunner_DeploymentTarget(t *testing.T) {
	r := newTestRealServerRunner(t)
	if _, err := r.DeploymentTarget("p1"); err == nil {
		t.Error("expected error when no running server for project")
	}

	r.meta["srv_1"] = &serverMeta{
		ID: "srv_1", ProjectID: "p1", State: "running", ContextPath: "/app",
		CatalinaBase: filepath.Join(t.TempDir(), "base"),
	}
	target, err := r.DeploymentTarget("p1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(target, filepath.Join("webapps", "app")) {
		t.Errorf("target = %q", target)
	}

	// Empty context path maps to ROOT.
	r.meta["srv_2"] = &serverMeta{
		ID: "srv_2", ProjectID: "p2", State: "running", ContextPath: "",
		CatalinaBase: filepath.Join(t.TempDir(), "base"),
	}
	target, err = r.DeploymentTarget("p2")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(target, filepath.Join("webapps", "ROOT")) {
		t.Errorf("target = %q", target)
	}
}

func TestRealServerRunner_Stop_NotFound(t *testing.T) {
	r := newTestRealServerRunner(t)
	if _, err := r.Stop("missing", false); err == nil {
		t.Error("expected not found error")
	}
}

func TestRealServerRunner_Restart_MetadataErrors(t *testing.T) {
	r := newTestRealServerRunner(t)
	if _, err := r.Restart("missing"); err == nil {
		t.Error("expected not found error")
	}

	r.meta["srv_1"] = &serverMeta{ID: "srv_1", State: "crashed"}
	if _, err := r.Restart("srv_1"); err == nil {
		t.Error("expected missing metadata error")
	}
}

func TestRealServerRunner_Debug_MetadataErrors(t *testing.T) {
	r := newTestRealServerRunner(t)
	if _, err := r.Debug("missing"); err == nil {
		t.Error("expected not found error")
	}

	r.meta["srv_1"] = &serverMeta{ID: "srv_1", State: "crashed"}
	if _, err := r.Debug("srv_1"); err == nil {
		t.Error("expected missing metadata error")
	}

	r.meta["srv_1"] = &serverMeta{ID: "srv_1", JavaHome: "/jdk", CatalinaBase: "/base"}
	if _, err := r.Debug("srv_1"); err == nil {
		t.Error("expected missing ports error")
	}
}

func TestRealServerRunner_RecoverableAndRecoverErrors(t *testing.T) {
	r := newTestRealServerRunner(t)
	if got := r.Recoverable(); len(got) != 0 {
		t.Errorf("expected no recoverable servers, got %v", got)
	}

	r.meta["srv_1"] = &serverMeta{ID: "srv_1", State: "crashed", WasRunning: true}
	if got := r.Recoverable(); len(got) != 1 {
		t.Errorf("expected 1 recoverable server, got %d", len(got))
	}

	// Not crashed -> cannot recover.
	if _, err := r.Recover("srv_1"); err == nil || !strings.Contains(err.Error(), "not in crashed state") {
		// srv_1 is crashed, so this should actually pass metadata checks
		// and fail later at tomcat start. Assert the crashed-state error
		// against a running server instead:
	}
	r.meta["srv_2"] = &serverMeta{ID: "srv_2", State: "running"}
	if _, err := r.Recover("srv_2"); err == nil || !strings.Contains(err.Error(), "not in crashed state") {
		t.Errorf("expected not-crashed error, got: %v", err)
	}

	// Missing metadata after crash state check.
	r.meta["srv_3"] = &serverMeta{ID: "srv_3", State: "crashed"}
	if _, err := r.Recover("srv_3"); err == nil {
		t.Error("expected missing recovery metadata error")
	}
}

func TestRealServerRunner_ReloadContext(t *testing.T) {
	r := newTestRealServerRunner(t)
	if err := r.ReloadContext("missing"); err == nil {
		t.Error("expected not found error")
	}

	r.meta["srv_1"] = &serverMeta{ID: "srv_1", State: "stopped"}
	if err := r.ReloadContext("srv_1"); err == nil || !strings.Contains(err.Error(), "not running") {
		t.Errorf("expected not-running error, got: %v", err)
	}

	// Running server with a real webapp dir: touch succeeds.
	webapp := t.TempDir()
	os.MkdirAll(filepath.Join(webapp, "WEB-INF"), 0755)
	webXML := filepath.Join(webapp, "WEB-INF", "web.xml")
	os.WriteFile(webXML, []byte("<web-app/>"), 0644)
	r.meta["srv_2"] = &serverMeta{ID: "srv_2", State: "running", WebappDir: webapp}
	if err := r.ReloadContext("srv_2"); err != nil {
		t.Errorf("expected successful reload, got: %v", err)
	}

	// Running server but web.xml missing -> error.
	empty := t.TempDir()
	r.meta["srv_3"] = &serverMeta{ID: "srv_3", State: "running", WebappDir: empty}
	if err := r.ReloadContext("srv_3"); err == nil {
		t.Error("expected error when web.xml is missing")
	}
}
