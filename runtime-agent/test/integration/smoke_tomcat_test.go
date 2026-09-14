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
	"bytes"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
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

	webappDir := filepath.Join(root, "WebRoot")
	classesDir := filepath.Join(webappDir, "WEB-INF", "classes")
	_ = os.MkdirAll(classesDir, 0o755)

	// Register project in ProjectStore
	proj := domain.Project{
		ID:          domain.ProjectID("p1"),
		WorkspaceID: domain.WorkspaceID(wsID),
		Name:        "legacy-sample",
		RootPath:    root,
		WebappDir:   "WebRoot",
		OutputDir:   filepath.Join("WebRoot", "WEB-INF", "classes"),
		SourceLevel: "8",
		TargetLevel: "8",
		Encoding:    "utf-8",
		ContextPath: "/kairo",
	}
	if _, err := svcs.ProjectStore.Update("p1", &proj); err != nil {
		t.Fatal(err)
	}

	// Server start / stop -- verifies the process supervisor
	// end-to-end. /api/v1/servers requires webappDir + javaHome;
	// we point it at the deployed WebRoot.
	start := mustPostJSON(t, ts.URL+"/api/v1/servers", map[string]any{
		"projectId":   "p1",
		"webappDir":   webappDir,
		"javaHome":    javaHome,
		"httpPort":    61100,
		"debugPort":   61101,
		"debug":       true,
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
	r, err := http.Get("http://127.0.0.1:61100/kairo/hello?name=Kairo")
	if err != nil {
		t.Fatalf("HTTP GET /kairo/hello failed: %v", err)
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		t.Errorf("GET /kairo/hello = %d, want 200", r.StatusCode)
	}
	body, _ := io.ReadAll(r.Body)
	// HelloServlet writes text/html; charset=GBK with "\u4f60\u597d" (0xc4, 0xe3, 0xba, 0xc3)
	if !bytes.Contains(body, []byte("Kairo")) || !bytes.Contains(body, []byte{0xc4, 0xe3, 0xba, 0xc3}) {
		t.Errorf("GET /kairo/hello body missing expected text, got: %s", string(body))
	}

	// Connect to JDWP debug port and verify handshake
	jconn, err := net.DialTimeout("tcp", "127.0.0.1:61101", 5*time.Second)
	if err != nil {
		t.Fatalf("failed to connect to JDWP port 61101: %v", err)
	}
	defer jconn.Close()
	handshake := []byte("JDWP-Handshake")
	if _, err := jconn.Write(handshake); err != nil {
		t.Fatalf("failed to write JDWP handshake: %v", err)
	}
	reply := make([]byte, len(handshake))
	if _, err := io.ReadFull(jconn, reply); err != nil {
		t.Fatalf("failed to read JDWP handshake: %v", err)
	}
	if string(reply) != "JDWP-Handshake" {
		t.Fatalf("unexpected JDWP reply: %q, want %q", string(reply), "JDWP-Handshake")
	}

	// Stop.
	stop := mustDeleteJSON(t, ts.URL+"/api/v1/servers/"+srvID, map[string]any{})
	stopped := stop["payload"].(map[string]any)
	if s, _ := stopped["state"].(string); s != "stopped" && s != "stopping" {
		t.Errorf("after stop, state = %v, want stopped or stopping", stopped["state"])
	}
}
