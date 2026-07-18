//go:build integration
// +build integration

// Package integration_test exercises the Runtime Agent against
// a real legacy Java Web project on disk.
//
// Run with:
//
//	KAIRO_LEGACY_SAMPLE=/path/to/legacy-sample go test -race -tags=integration ./test/integration/...
//
// If KAIRO_LEGACY_SAMPLE is unset, the test is skipped.
package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	sandbox, err := security.NewWorkspaceRoots(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	svcs := services.NewMemoryServices(services.Config{
		DataDir:     dataDir,
		BundledDir:  t.TempDir(),
		Logger:      log.New("test").WithLevel(log.LevelWarn),
		Tomcat6Home: os.Getenv("KAIRO_TOMCAT6_HOME"),
	}, sandbox)
	logger := log.New("test").WithLevel(log.LevelWarn)
	srv := api.NewServer(svcs, logger, auditLog, "test")

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

	// 4. Search for "你好" — should find matches in both the
	// GBK JSP and the UTF-8 properties file.
	search := mustPostJSON(t, ts.URL+"/api/v1/search", map[string]any{
		"query":       "你好",
		"workspaceId": root,
	})
	matches := search["payload"].(map[string]any)["matches"].([]any)
	if len(matches) < 2 {
		t.Errorf("search found %d matches, want >= 2", len(matches))
	}

	// 5. Real javac build with the legacy-sample.
	servletAPI := filepath.Join(root, "lib", "javax.servlet-api-4.0.1.jar")
	buildPayload := map[string]any{
		"projectRoot": root,
		"sourceLevel": "8",
		"targetLevel": "8",
		"outputDir":   filepath.Join(t.TempDir(), "out"),
		"classpath":   []string{},
	}
	if _, err := os.Stat(servletAPI); err == nil {
		buildPayload["classpath"] = []string{servletAPI}
	}
	build := mustPostJSON(t, ts.URL+"/api/v1/builds", buildPayload)
	p := build["payload"].(map[string]any)
	if p["success"] != true {
		t.Errorf("build failed: %+v\noutput: %v", p, p["output"])
	}

	// 6. Server start / stop — verifies the process supervisor
	// end-to-end.
	start := mustPostJSON(t, ts.URL+"/api/v1/servers", map[string]any{
		"projectId": "p1",
	})
	srv1 := start["payload"].(map[string]any)
	srvID := srv1["id"].(string)
	if srv1["state"] != "running" {
		t.Errorf("server state = %v, want running", srv1["state"])
	}
	if srv1["pid"].(float64) <= 0 {
		t.Errorf("server pid = %v, want > 0", srv1["pid"])
	}
	// Stop.
	stop := mustDeleteJSON(t, ts.URL+"/api/v1/servers/"+srvID, map[string]any{})
	stopped := stop["payload"].(map[string]any)
	if stopped["state"] != "stopped" {
		t.Errorf("after stop, state = %v, want stopped", stopped["state"])
	}
}

func mustGetJSON(t *testing.T, url string) map[string]any {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("GET %s: %d\n%s", url, resp.StatusCode, body)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func mustPostJSON(t *testing.T, url string, payload any) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"requestId": "test-" + time.Now().Format("150405.000"),
		"payload":   payload,
	})
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST %s: %d\n%s\npayload: %s", url, resp.StatusCode, raw, body)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func mustDeleteJSON(t *testing.T, url string, payload any) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"requestId": "test-" + time.Now().Format("150405.000"),
		"payload":   payload,
	})
	req, _ := http.NewRequestWithContext(context.Background(), "DELETE", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("DELETE %s: %d\n%s", url, resp.StatusCode, raw)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

var _ = fmt.Sprintf
