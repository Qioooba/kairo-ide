package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/build"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/jdkmanager"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

func writeJavaFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestParseJavaFile_Basic(t *testing.T) {
	dir := t.TempDir()
	content := `package com.example.app;

import java.util.List;

public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("hi");
    }

    @Test
    public void testSomething() {
        assertTrue(true);
    }
}
`
	path := writeJavaFile(t, dir, "src/HelloWorld.java", content)
	info, err := parseJavaFile(path)
	if err != nil {
		t.Fatalf("parseJavaFile failed: %v", err)
	}
	if info.PackageName != "com.example.app" {
		t.Errorf("package = %q", info.PackageName)
	}
	if info.ClassName != "HelloWorld" {
		t.Errorf("class = %q", info.ClassName)
	}
	foundMain := false
	foundTest := false
	for _, m := range info.Methods {
		if m.IsMain && m.Name == "main" {
			foundMain = true
		}
		if m.IsTest && m.Name == "testSomething" {
			foundTest = true
		}
	}
	if !foundMain {
		t.Error("expected main method detected")
	}
	if !foundTest {
		t.Error("expected @Test method detected")
	}
}

func TestParseJavaFile_CacheAndMissing(t *testing.T) {
	dir := t.TempDir()
	path := writeJavaFile(t, dir, "A.java", "public class A { }\n")

	info1, err := parseJavaFile(path)
	if err != nil {
		t.Fatal(err)
	}
	info2, err := parseJavaFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if info1 != info2 {
		t.Error("expected cached instance to be returned")
	}

	if _, err := parseJavaFile(filepath.Join(dir, "missing.java")); err == nil {
		t.Error("expected error for missing file")
	}
}

func TestParseJavaFile_NoPackageNoClass(t *testing.T) {
	path := writeJavaFile(t, t.TempDir(), "X.java", "// just a comment\n")
	info, err := parseJavaFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.PackageName != "" || info.ClassName != "" {
		t.Errorf("expected empty package/class, got %+v", info)
	}
}

func TestCollectJavaSources(t *testing.T) {
	dir := t.TempDir()
	writeJavaFile(t, dir, "src/a/A.java", "class A {}")
	writeJavaFile(t, dir, "src/main/java/b/B.java", "class B {}")
	writeJavaFile(t, dir, "src/test/java/c/C.java", "class C {}")
	os.WriteFile(filepath.Join(dir, "src", "not-java.txt"), []byte("x"), 0644)

	files, err := (&Server{}).collectJavaSources(dir)
	if err != nil {
		t.Fatalf("collectJavaSources failed: %v", err)
	}
	// src/ walk already covers src/main/java and src/test/java, which are
	// then collected again as their own roots.
	if len(files) != 5 {
		t.Errorf("expected 5 java files, got %d: %v", len(files), files)
	}
}

func TestCollectJavaSources_MissingRoot(t *testing.T) {
	files, err := (&Server{}).collectJavaSources(filepath.Join(t.TempDir(), "missing"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Errorf("expected no files, got %v", files)
	}
}

func TestResolveJavaClasspath(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "lib"), 0755)
	os.MkdirAll(filepath.Join(dir, "WebRoot", "WEB-INF", "lib"), 0755)
	os.WriteFile(filepath.Join(dir, "lib", "a.jar"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(dir, "lib", "b.zip"), []byte("b"), 0644)
	os.WriteFile(filepath.Join(dir, "lib", "c.txt"), []byte("c"), 0644)
	os.WriteFile(filepath.Join(dir, "WebRoot", "WEB-INF", "lib", "web.jar"), []byte("w"), 0644)
	os.MkdirAll(filepath.Join(dir, "WebRoot", "WEB-INF", "classes"), 0755)
	os.MkdirAll(filepath.Join(dir, "build", "classes"), 0755)

	cp := (&Server{}).resolveJavaClasspath(dir)
	if cp == "" {
		t.Fatal("expected non-empty classpath")
	}
	parts := strings.Split(cp, string(os.PathListSeparator))
	if len(parts) != 5 {
		t.Errorf("expected 5 classpath entries, got %d: %v", len(parts), parts)
	}
}

func TestResolveJavaClasspath_Empty(t *testing.T) {
	if cp := (&Server{}).resolveJavaClasspath(filepath.Join(t.TempDir(), "empty")); cp != "" {
		t.Errorf("expected empty classpath, got %q", cp)
	}
}

func TestFindJUnitJar(t *testing.T) {
	dir := t.TempDir()
	if got := (&Server{}).findJUnitJar(dir); got != "" {
		t.Errorf("expected no junit jar, got %q", got)
	}

	os.MkdirAll(filepath.Join(dir, "lib"), 0755)
	os.WriteFile(filepath.Join(dir, "lib", "junit-4.13.2.jar"), []byte("x"), 0644)
	got := (&Server{}).findJUnitJar(dir)
	if got == "" || !strings.HasSuffix(got, "junit-4.13.2.jar") {
		t.Errorf("expected junit-4.13.2.jar, got %q", got)
	}

	// Fallback: any junit*.jar under lib
	dir2 := t.TempDir()
	os.MkdirAll(filepath.Join(dir2, "lib"), 0755)
	os.WriteFile(filepath.Join(dir2, "lib", "junit-5.8.0.jar"), []byte("x"), 0644)
	got2 := (&Server{}).findJUnitJar(dir2)
	if got2 == "" || !strings.HasSuffix(got2, "junit-5.8.0.jar") {
		t.Errorf("expected junit-5.8.0.jar via glob, got %q", got2)
	}

	// Fallback: WEB-INF/lib
	dir3 := t.TempDir()
	os.MkdirAll(filepath.Join(dir3, "WebRoot", "WEB-INF", "lib"), 0755)
	os.WriteFile(filepath.Join(dir3, "WebRoot", "WEB-INF", "lib", "junit.jar"), []byte("x"), 0644)
	got3 := (&Server{}).findJUnitJar(dir3)
	if got3 == "" || !strings.HasSuffix(got3, "junit.jar") {
		t.Errorf("expected junit.jar via web-inf, got %q", got3)
	}
}

func TestHandleDetectJava(t *testing.T) {
	srv := newTestServer(t, nil)
	dir := t.TempDir()
	path := writeJavaFile(t, dir, "Hello.java", "package demo; public class Hello { public static void main(String[] a) {} }")

	t.Run("success", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"filePath": path})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/java/detect", bytes.NewReader(body))
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, body=%s", rr.Code, rr.Body.String())
		}
		env, p := decodeOK(t, rr.Body.Bytes())
		if !env.OK {
			t.Fatalf("expected ok, got %+v", env)
		}
		if p["className"] != "Hello" {
			t.Errorf("className = %v, want Hello", p["className"])
		}
	})

	t.Run("missing filePath", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/java/detect", bytes.NewReader([]byte(`{}`)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s, want invalid_request", e.Code)
		}
	})

	t.Run("wrong method", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/java/detect", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("bad json", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/java/detect", bytes.NewReader([]byte(`{`)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("missing file returns error", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"filePath": filepath.Join(dir, "missing.java")})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/java/detect", bytes.NewReader(body))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInternal {
			t.Errorf("error code = %s, want internal", e.Code)
		}
	})
}

func TestHandleRunJava_ValidationErrors(t *testing.T) {
	srv := newTestServer(t, nil)

	t.Run("wrong method", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/java/run", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("missing required fields", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/java/run", bytes.NewReader([]byte(`{}`)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("bad json", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/java/run", bytes.NewReader([]byte(`nope`)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})
}

func TestHandleAntClasspathAnalyze(t *testing.T) {
	srv := newTestServer(t, nil)
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0"?>
<project name="p" default="build">
    <path id="compile.classpath"><fileset dir="lib" includes="*.jar"/></path>
    <target name="build"><javac srcdir="src" classpathref="compile.classpath"/></target>
</project>`), 0644)
	os.MkdirAll(filepath.Join(dir, "lib"), 0755)
	os.WriteFile(filepath.Join(dir, "lib", "x.jar"), []byte("x"), 0644)

	t.Run("wrong method", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/v1/ant/classpath/analyze", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("no projectRoot", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/ant/classpath/analyze", bytes.NewReader([]byte(`{}`)))
		srv.Handler().ServeHTTP(rr, req)
		_, p := decodeOK(t, rr.Body.Bytes())
		if p["success"] != false {
			t.Errorf("expected success=false, got %v", p["success"])
		}
	})

	t.Run("valid project", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"projectRoot": dir})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/ant/classpath/analyze", bytes.NewReader(body))
		srv.Handler().ServeHTTP(rr, req)
		_, p := decodeOK(t, rr.Body.Bytes())
		if p["success"] != true {
			t.Errorf("expected success=true, got %v", p["success"])
		}
		if p["classpathCount"] == nil {
			t.Errorf("expected classpathCount, got %v", p)
		}
	})

	t.Run("get with query", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/ant/classpath/analyze?projectRoot="+dir, nil)
		srv.Handler().ServeHTTP(rr, req)
		_, p := decodeOK(t, rr.Body.Bytes())
		if p["success"] != true {
			t.Errorf("expected success=true via GET, got %v", p["success"])
		}
	})

	t.Run("project without build.xml", func(t *testing.T) {
		empty := t.TempDir()
		body, _ := json.Marshal(map[string]string{"projectRoot": empty})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/ant/classpath/analyze", bytes.NewReader(body))
		srv.Handler().ServeHTTP(rr, req)
		_, p := decodeOK(t, rr.Body.Bytes())
		if p["success"] != false {
			t.Errorf("expected success=false, got %v", p["success"])
		}
	})

	t.Run("bad json", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/ant/classpath/analyze", bytes.NewReader([]byte(`{`)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})
}

func TestHandleDebugAdapterStatus(t *testing.T) {
	t.Run("jdkmanager not configured", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/debug/adapter/status", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInternal {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("wrong method", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/debug/adapter/status", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("configured", func(t *testing.T) {
		svcs := &Services{JDKManager: jdkmanager.NewManager(t.TempDir())}
		srv := newTestServerWithServices(t, svcs)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/debug/adapter/status", nil)
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, body=%s", rr.Code, rr.Body.String())
		}
		_, p := decodeOK(t, rr.Body.Bytes())
		if _, ok := p["bridgeJarFound"]; !ok {
			t.Errorf("expected bridgeJarFound in payload, got %v", p)
		}
	})
}

func TestHandleJDKDownload(t *testing.T) {
	t.Run("not configured", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/debug/jdk/download", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInternal {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("wrong method", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/debug/jdk/download", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("already available", func(t *testing.T) {
		javaExe := "java"
		jdkHome := t.TempDir()
		binDir := filepath.Join(jdkHome, "bin")
		os.MkdirAll(binDir, 0755)
		os.WriteFile(filepath.Join(binDir, javaExe), []byte(fakeJava17Content()), 0755)
		t.Setenv("KAIRO_JDK_HOME", jdkHome)

		svcs := &Services{JDKManager: jdkmanager.NewManager(t.TempDir())}
		srv := newTestServerWithServices(t, svcs)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/debug/jdk/download", nil)
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, body=%s", rr.Code, rr.Body.String())
		}
		_, p := decodeOK(t, rr.Body.Bytes())
		if p["status"] != "already_available" {
			t.Errorf("status = %v, want already_available", p["status"])
		}
	})
}

func TestHandleCustomBuild(t *testing.T) {
	t.Run("wrong method", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/build/custom", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("missing projectRoot", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/build/custom", bytes.NewReader([]byte(`{"command":"echo hi"}`)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("missing command", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/build/custom", bytes.NewReader([]byte(`{"projectRoot":"/tmp"}`)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("not configured", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/build/custom", bytes.NewReader([]byte(`{"projectRoot":"/tmp","command":"echo hi"}`)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInternal {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("start failure", func(t *testing.T) {
		exe := build.NewCustomBuildExecutor(func(build.BuildEvent) {})
		svcs := &Services{CustomBuild: exe}
		srv := newTestServerWithServices(t, svcs)
		body, _ := json.Marshal(map[string]string{
			"projectRoot": t.TempDir(),
			"command":     "definitely-not-a-real-command-xyz",
		})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/build/custom", bytes.NewReader(body))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInternal {
			t.Errorf("error code = %s, body=%s", e.Code, rr.Body.String())
		}
	})

	t.Run("success", func(t *testing.T) {
		exe := build.NewCustomBuildExecutor(func(build.BuildEvent) {})
		svcs := &Services{CustomBuild: exe}
		srv := newTestServerWithServices(t, svcs)
		body, _ := json.Marshal(map[string]string{
			"projectRoot": t.TempDir(),
			"command":     "cmd /c echo ok",
		})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/build/custom", bytes.NewReader(body))
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, body=%s", rr.Code, rr.Body.String())
		}
		_, p := decodeOK(t, rr.Body.Bytes())
		if p["status"] != "running" {
			t.Errorf("status = %v, want running", p["status"])
		}
	})
}

func TestHandleCustomBuildSub(t *testing.T) {
	t.Run("missing buildId", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/build/custom/", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("unknown sub-resource", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/build/custom/abc123/foo", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrNotFound {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("cancel wrong method", func(t *testing.T) {
		svcs := &Services{CustomBuild: build.NewCustomBuildExecutor(func(build.BuildEvent) {})}
		srv := newTestServerWithServices(t, svcs)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/build/custom/abc123/cancel", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("cancel not found", func(t *testing.T) {
		svcs := &Services{CustomBuild: build.NewCustomBuildExecutor(func(build.BuildEvent) {})}
		srv := newTestServerWithServices(t, svcs)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/build/custom/nonexistent/cancel", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrNotFound {
			t.Errorf("error code = %s", e.Code)
		}
	})
}

func TestHandleServerReload(t *testing.T) {
	t.Run("wrong method", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/servers/s1/reload", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("server runner not configured", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/s1/reload", nil)
		req.SetPathValue("serverId", "s1")
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInternal {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		runner := &fakeReloadRunner{}
		svcs := &Services{ServerRunner: runner}
		srv := newTestServerWithServices(t, svcs)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/s1/reload", nil)
		req.SetPathValue("serverId", "s1")
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, body=%s", rr.Code, rr.Body.String())
		}
		_, p := decodeOK(t, rr.Body.Bytes())
		if p["status"] != "reloaded" {
			t.Errorf("status = %v", p["status"])
		}
	})

	t.Run("reload error", func(t *testing.T) {
		runner := &fakeReloadRunner{reloadErr: errors.New("reload failed")}
		svcs := &Services{ServerRunner: runner}
		srv := newTestServerWithServices(t, svcs)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/s1/reload", nil)
		req.SetPathValue("serverId", "s1")
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInternal {
			t.Errorf("error code = %s", e.Code)
		}
	})
}

func TestHandleCompileIncremental(t *testing.T) {
	t.Run("wrong method", func(t *testing.T) {
		srv := newTestServer(t, nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/jvm/compile-incremental", nil)
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("missing projectId", func(t *testing.T) {
		srv := newTestServer(t, nil)
		payload := map[string]any{"files": []string{"a.java"}}
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/compile-incremental", bytes.NewReader(envelopeBody(t, payload)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInvalidRequest {
			t.Errorf("error code = %s", e.Code)
		}
	})

	t.Run("project store not configured", func(t *testing.T) {
		srv := newTestServer(t, nil)
		payload := map[string]any{"projectId": "p1"}
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jvm/compile-incremental", bytes.NewReader(envelopeBody(t, payload)))
		srv.Handler().ServeHTTP(rr, req)
		_, e := decodeErr(t, rr.Body.Bytes())
		if e.Code != protocol.ErrInternal {
			t.Errorf("error code = %s", e.Code)
		}
	})
}

// --- helpers ---

func fakeJava17Content() string {
	return "@echo off\r\necho openjdk version \"17.0.9\" 2023-10-17 1>&2\r\nexit /b 0\r\n"
}

func newTestServerWithServices(t *testing.T, svcs *Services) *Server {
	t.Helper()
	if svcs == nil {
		svcs = &Services{}
	}
	if svcs.JDTLS == nil {
		svcs.JDTLS = &fakeJDTLS{state: "stopped"}
	}
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	return NewServer(svcs, logger, auditLog, "test-0.1.0", "")
}

func envelopeBody(t *testing.T, payload any) []byte {
	t.Helper()
	env := struct {
		RequestID string          `json:"requestId"`
		Payload   json.RawMessage `json:"payload"`
	}{
		RequestID: "req-1",
		Payload:   mustRaw(t, payload),
	}
	data, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func mustRaw(t *testing.T, v any) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// fakeReloadRunner extends the existing fakeServerRunner with a
// configurable ReloadContext error.
type fakeReloadRunner struct {
	fakeServerRunner
	reloadErr error
}

func (f *fakeReloadRunner) ReloadContext(id string) error { return f.reloadErr }

var _ = context.Background
