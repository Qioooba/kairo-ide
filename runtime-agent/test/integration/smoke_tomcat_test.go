//go:build integration_tomcat
// +build integration_tomcat

// Package integration_test exercises the Tomcat 6 server start/stop
// against a real legacy Java Web project on disk.
//
// Run with:
//
//	KAIRO_LEGACY_SAMPLE=/path/to/legacy-sample \
//	KAIRO_TOMCAT6_HOME=/path/to/tomcat6 \
//	JAVA_HOME=/path/to/jdk \
//	go test -tags=integration_tomcat ./test/integration/...
package integration_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/services"
)

func TestTomcat_ServerStartStop(t *testing.T) {
	root := os.Getenv("KAIRO_LEGACY_SAMPLE")
	if root == "" {
		t.Skip("KAIRO_LEGACY_SAMPLE not set")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "build.xml")); err != nil {
		t.Fatalf("legacy-sample not found at %s: %v", root, err)
	}

	javaHome := os.Getenv("JAVA_HOME")
	if javaHome == "" {
		t.Skip("JAVA_HOME not set; skipping Tomcat 6 start/stop")
	}
	tomcatHome := os.Getenv("KAIRO_TOMCAT6_HOME")
	if tomcatHome == "" {
		t.Skip("KAIRO_TOMCAT6_HOME not set; skipping Tomcat 6 start/stop")
	}

	auditLog, err := audit.New(filepath.Join(t.TempDir(), "audit.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer auditLog.Close()

	dataDir := t.TempDir()
	bundled := t.TempDir()
	sandbox, err := security.NewWorkspaceRoots(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	logger := log.New("test").WithLevel(log.LevelWarn)
	svcs := services.NewMemoryServices(services.Config{
		DataDir:     dataDir,
		BundledDir:  bundled,
		Logger:      logger,
		Tomcat6Home: tomcatHome,
	}, sandbox)
	srv := api.NewServer(svcs, logger, auditLog, "test", "")

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// Open workspace and scan
	ws := mustPostJSON(t, ts.URL+"/api/v1/workspaces", map[string]any{
		"rootPath": root,
	})
	wsID := ws["payload"].(map[string]any)["id"].(string)
	if wsID == "" {
		t.Fatalf("no workspace id: %+v", ws)
	}

	// Build the project first so compiled classes are available
	webappDir := filepath.Join(root, "WebRoot")
	classesDir := filepath.Join(webappDir, "WEB-INF", "classes")
	_ = os.MkdirAll(classesDir, 0o755)
	servletAPI := filepath.Join(root, "lib", "javax.servlet-api-4.0.1.jar")
	buildPayload := map[string]any{
		"projectRoot": root,
		"sourceLevel": "8",
		"targetLevel": "8",
		"outputDir":   classesDir,
		"classpath":   []string{},
	}
	if _, err := os.Stat(servletAPI); err == nil {
		buildPayload["classpath"] = []string{servletAPI}
	}
	build := mustPostJSON(t, ts.URL+"/api/v1/builds", buildPayload)
	buildID, _ := build["payload"].(map[string]any)["id"].(string)
	if buildID == "" {
		t.Fatalf("no build id: %+v", build)
	}
	var bp map[string]any
	var state string
	for i := 0; i < 120; i++ {
		bp = mustGetJSON(t, ts.URL+"/api/v1/builds/"+buildID)
		state, _ = bp["payload"].(map[string]any)["state"].(string)
		if state == "success" || state == "failure" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if state != "success" {
		t.Fatalf("build state = %v, want success\npayload: %+v", state, bp["payload"])
	}

	// Server start / stop -- verifies the process supervisor
	// end-to-end. /api/v1/servers requires webappDir + javaHome;
	// we point it at the deployed WebRoot. The build above wrote
	// compiled classes into webappDir/WEB-INF/classes, so Tomcat 6
	// can load HelloServlet and I18nServlet on first request.
	start := mustPostJSON(t, ts.URL+"/api/v1/servers", map[string]any{
		"projectId":   "p1",
		"webappDir":   webappDir,
		"javaHome":    javaHome,
		"httpPort":    61100,
		"contextPath": "/kairo",
	})
	srv1 := start["payload"].(map[string]any)
	srvID := srv1["id"].(string)
	if srv1["state"] != "running" {
		t.Errorf("server state = %v, want running\npayload: %+v", srv1["state"], srv1)
	}
	if p, ok := srv1["pid"].(float64); !ok || p <= 0 {
		t.Errorf("server pid = %v, want > 0", srv1["pid"])
	}
	// Give Tomcat a moment to bind the port, then hit it.
	time.Sleep(2 * time.Second)
	if r, err := http.Get("http://127.0.0.1:61100/kairo/hello?name=Kairo"); err == nil {
		if r.StatusCode != 200 {
			t.Errorf("GET /kairo/hello = %d, want 200", r.StatusCode)
		}
		r.Body.Close()
	} else {
		t.Logf("skip HTTP smoke: %v (Tomcat may not have bound yet)", err)
	}
	// Stop.
	stop := mustDeleteJSON(t, ts.URL+"/api/v1/servers/"+srvID, map[string]any{})
	stopped := stop["payload"].(map[string]any)
	if s, _ := stopped["state"].(string); s != "stopped" && s != "stopping" {
		t.Errorf("after stop, state = %v, want stopped or stopping", stopped["state"])
	}
}
