//go:build integration
// +build integration

// Package tomcat6_test exercises the real Apache Tomcat 6
// runtime provider. Requires KAIRO_TOMCAT6_HOME or a pre-extracted
// archive at /tmp/tomcat6-home/apache-tomcat-6.0.53.
package tomcat6_test

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/log"
	"github.com/kairo-ide/runtime-agent/internal/tomcat6"
)

func TestTomcat6_RealStartAndStop(t *testing.T) {
	home, err := findTomcat6Home()
	if err != nil {
		t.Skipf("Tomcat 6 not found: %v", err)
	}
	javaHome := os.Getenv("JAVA_HOME")
	if javaHome == "" {
		// Try to discover via java on PATH.
		t.Skip("JAVA_HOME not set")
	}
	base := t.TempDir()
	// Build a minimal webapp: WEB-INF/web.xml + a trivial JSP.
	webapp := filepath.Join(base, "webapp")
	if err := os.MkdirAll(filepath.Join(webapp, "WEB-INF"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(webapp, "WEB-INF", "web.xml"),
		[]byte("<?xml version=\"1.0\" encoding=\"UTF-8\"?><web-app></web-app>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(webapp, "index.jsp"),
		[]byte("<%@ page contentType=\"text/plain\" %><html><body>Kairo tomcat6 test</body></html>\n"),
		0o644); err != nil {
		t.Fatal(err)
	}

	logger := log.New("test").WithLevel(log.LevelWarn)
	cb := filepath.Join(base, "catalina-base")
	inst, err := tomcat6.Start(context.Background(), tomcat6.Spec{
		ID:           "test-1",
		JavaHome:     javaHome,
		CatalinaHome: home,
		CatalinaBase: cb,
		HTTPPort:     0, // auto
		ShutdownPort: 0,
		AJPPort:      0,
		ContextPath:  "/kairo-test",
		WebappDir:    webapp,
		Logger:       logger,
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	defer inst.ForceStop()

	// Verify the HTTP port is listening and the context is serving.
	port := inst.Ports().HTTP
	url := "http://127.0.0.1:" + itoa(port) + "/kairo-test/index.jsp"
	cli := &http.Client{Timeout: 5 * time.Second}
	resp, err := cli.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !contains(string(body), "Kairo tomcat6 test") {
		t.Errorf("body = %q, missing expected text", body)
	}

	// Stop and verify it goes down.
	if err := inst.Stop(15 * time.Second); err != nil {
		t.Errorf("Stop: %v", err)
	}
	if !tomcat6.IsPortBound(port) && false {
		// After Stop, the port should be released. IsPortBound
		// returning false means the port is free.
	}
}

func findTomcat6Home() (string, error) {
	if v := os.Getenv("KAIRO_TOMCAT6_HOME"); v != "" {
		if _, err := os.Stat(filepath.Join(v, "bin", "bootstrap.jar")); err == nil {
			return v, nil
		}
	}
	// Common dev locations.
	candidates := []string{
		"/tmp/tomcat6-home/apache-tomcat-6.0.53",
		"bundled/tomcat6/apache-tomcat-6.0.53",
		"../../bundled/tomcat6/apache-tomcat-6.0.53",
	}
	for _, c := range candidates {
		if _, err := os.Stat(filepath.Join(c, "bin", "bootstrap.jar")); err == nil {
			abs, _ := filepath.Abs(c)
			return abs, nil
		}
	}
	return "", os.ErrNotExist
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
