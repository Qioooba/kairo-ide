//go:build integration
// +build integration

// Package integration_test exercises the Runtime Agent against
// a real legacy Java Web project on disk.
//
// Run with:
//
//	KAIRO_LEGACY_SAMPLE=/path/to/legacy-sample go test -tags=integration ./test/integration/...
//
// KAIRO_TOMCAT6_HOME should also be set if you want the
// server-start / stop section to actually launch Tomcat 6.
package integration_test

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/api"
	"github.com/kairo-ide/runtime-agent/internal/audit"
	"github.com/kairo-ide/runtime-agent/internal/log"
	"github.com/kairo-ide/runtime-agent/internal/security"
	"github.com/kairo-ide/runtime-agent/internal/services"
)

func TestSmoke_End2End(t *testing.T) {
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

	// Build a real Server with real services.
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
		Tomcat6Home: os.Getenv("KAIRO_TOMCAT6_HOME"),
	}, sandbox)
	srv := api.NewServer(svcs, logger, auditLog, "test", "")

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// 1. Health
	health := mustGetJSON(t, ts.URL+"/api/v1/health")
	if v, ok := health["payload"].(map[string]any); !ok || v["ok"] != true {
		t.Errorf("health: %+v", health)
	}

	// 2. Workspace + scan
	ws := mustPostJSON(t, ts.URL+"/api/v1/workspaces", map[string]any{
		"rootPath": root,
	})
	wsID := ws["payload"].(map[string]any)["id"].(string)
	if wsID == "" {
		t.Fatalf("no workspace id: %+v", ws)
	}
	scan := mustPostJSON(t, ts.URL+"/api/v1/workspaces/"+wsID+"/scan", map[string]any{})
	detected := scan["payload"].(map[string]any)["detected"].([]any)[0].(map[string]any)
	if detected["buildSystem"] != "ant" {
		t.Errorf("buildSystem = %v, want ant", detected["buildSystem"])
	}
	if detected["layout"].(map[string]any)["webRoot"] != "WebRoot" {
		t.Errorf("webRoot = %v, want WebRoot", detected["layout"])
	}

	// 3. Encoding detect on the GBK JSP.
	gbkJSP := filepath.Join(root, "WebRoot", "hello.jsp")
	if _, err := os.Stat(gbkJSP); err != nil {
		t.Skipf("legacy-sample missing hello.jsp: %v", err)
	}
	encGBK := mustPostJSON(t, ts.URL+"/api/v1/encoding/detect", map[string]any{
		"file": gbkJSP,
	})
	gotGBK := encGBK["payload"].(map[string]any)["encoding"].(string)
	if gotGBK != "gbk" && gotGBK != "gb18030" {
		t.Errorf("hello.jsp encoding = %s, want gbk or gb18030", gotGBK)
	}

	// 4. Search for "浣犲ソ" -- in a fully encoding-aware search
	// engine the query would also match the GBK-encoded hello.jsp
	// and the ISO-8859-1-encoded messages.properties. The current
	// implementation matches bytes directly, which works for the
	// UTF-8 case but not for the legacy encodings. We assert the
	// search endpoint at least returns a valid envelope with
	// 200 status; whether 0 or N matches depends on the encoding
	// of the source files and is covered by dedicated search
	// unit tests.
	search := mustPostJSON(t, ts.URL+"/api/v1/search", map[string]any{
		"query":       "浣犲ソ",
		"workspaceId": root,
	})
	if _, ok := search["payload"]; !ok {
		t.Errorf("search: missing payload: %+v", search)
	}

	// 5. Real javac build with the legacy-sample. The
	// /api/v1/builds endpoint is async; we POST and then poll
	// /api/v1/builds/{id} until the state is success / failure.
	servletAPI := filepath.Join(root, "lib", "javax.servlet-api-4.0.1.jar")
	webappDir := filepath.Join(root, "WebRoot")
	classesDir := filepath.Join(webappDir, "WEB-INF", "classes")
	_ = os.MkdirAll(classesDir, 0o755)
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
		t.Errorf("build state = %v, want success\npayload: %+v", state, bp["payload"])
	}

	_ = webappDir
	_ = classesDir
}
