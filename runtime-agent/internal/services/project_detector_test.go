package services

import (
	"os"
	"path/filepath"
	"testing"
)

// TestProjectDetector_EmptyDir 检测空目录
func TestProjectDetector_EmptyDir(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	d, err := DetectProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if d.Confidence < 0.4 {
		t.Errorf("confidence = %f, want >= 0.4", d.Confidence)
	}
	if len(d.SourceDirs) > 0 {
		t.Errorf("empty dir should have no source dirs, got %v", d.SourceDirs)
	}
	if d.WebRoot != "" {
		t.Errorf("empty dir should have no web root, got %q", d.WebRoot)
	}
}

// TestProjectDetector_AntProject 检测 Ant 项目（含 build.xml）
func TestProjectDetector_AntProject(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// 创建 build.xml
	mustWriteFile(t, filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project name="test" default="compile">
  <target name="compile">
    <javac srcdir="src" destdir="build/classes" source="1.6" target="1.6"/>
  </target>
</project>`))
	// 创建源码目录
	mustMkdirAll(t, filepath.Join(dir, "src", "main", "java"))
	mustWriteFile(t, filepath.Join(dir, "src", "main", "java", "Hello.java"), []byte("public class Hello {}"))

	d, err := DetectProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if d.BuildScript != "build.xml" {
		t.Errorf("BuildScript = %q, want build.xml", d.BuildScript)
	}
	if d.BuildSystem != "ant" {
		t.Errorf("BuildSystem = %q, want ant", d.BuildSystem)
	}
	if d.Confidence < 0.6 {
		t.Errorf("confidence = %f, want >= 0.6", d.Confidence)
	}
}

// TestProjectDetector_JavaProject 检测 Java 项目（含 .java 文件）
func TestProjectDetector_JavaProject(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// 创建 Java 源文件
	mustMkdirAll(t, filepath.Join(dir, "src", "main", "java"))
	mustWriteFile(t, filepath.Join(dir, "src", "main", "java", "Hello.java"), []byte("public class Hello {}"))
	mustWriteFile(t, filepath.Join(dir, "src", "main", "java", "World.java"), []byte("public class World {}"))

	d, err := DetectProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.SourceDirs) == 0 {
		t.Errorf("expected source dirs, got none")
	}
	if d.Confidence < 0.5 {
		t.Errorf("confidence = %f, want >= 0.5", d.Confidence)
	}
}

// TestProjectDetector_WebProject 检测 Web 项目（含 web.xml）
func TestProjectDetector_WebProject(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// 创建 WebRoot 目录结构
	mustMkdirAll(t, filepath.Join(dir, "WebRoot", "WEB-INF"))
	mustWriteFile(t, filepath.Join(dir, "WebRoot", "WEB-INF", "web.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
  <display-name>TestApp</display-name>
</web-app>`))
	// 创建源码目录
	mustMkdirAll(t, filepath.Join(dir, "src", "main", "java"))
	mustWriteFile(t, filepath.Join(dir, "src", "main", "java", "Hello.java"), []byte("public class Hello {}"))

	d, err := DetectProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if d.WebRoot != "WebRoot" {
		t.Errorf("WebRoot = %q, want WebRoot", d.WebRoot)
	}
	if d.Confidence < 0.6 {
		t.Errorf("confidence = %f, want >= 0.6", d.Confidence)
	}
}

// TestProjectDetector_NoProject 检测非项目目录
func TestProjectDetector_NoProject(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// 只创建一些非项目文件
	mustWriteFile(t, filepath.Join(dir, "README.txt"), []byte("hello"))
	mustWriteFile(t, filepath.Join(dir, "notes.md"), []byte("notes"))

	d, err := DetectProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if d.Confidence > 0.6 {
		t.Errorf("confidence = %f, should be <= 0.6 for non-project", d.Confidence)
	}
	if d.BuildSystem != "none" {
		t.Errorf("BuildSystem = %q, want none", d.BuildSystem)
	}
}

// TestProjectDetector_EmptyPath 检测空路径
func TestProjectDetector_EmptyPath(t *testing.T) {
	t.Parallel()
	_, err := DetectProject("")
	if err == nil {
		t.Fatal("expected error for empty path")
	}
}

// TestProjectDetector_NonExistentPath 检测不存在的路径
func TestProjectDetector_NonExistentPath(t *testing.T) {
	t.Parallel()
	_, err := DetectProject(filepath.Join(t.TempDir(), "does-not-exist"))
	if err == nil {
		t.Fatal("expected error for nonexistent path")
	}
}

// TestProjectDetector_NotDirectory 检测非目录路径
func TestProjectDetector_NotDirectory(t *testing.T) {
	t.Parallel()
	file := filepath.Join(t.TempDir(), "test.txt")
	mustWriteFile(t, file, []byte("hello"))
	_, err := DetectProject(file)
	if err == nil {
		t.Fatal("expected error for non-directory path")
	}
}

// TestProjectDetector_WebappDir 检测 webapp 目录
func TestProjectDetector_WebappDir(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// 创建 webapp 目录结构
	mustMkdirAll(t, filepath.Join(dir, "webapp", "WEB-INF"))
	mustWriteFile(t, filepath.Join(dir, "webapp", "WEB-INF", "web.xml"), []byte(`<?xml version="1.0"?><web-app/>`))

	d, err := DetectProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if d.WebRoot != "webapp" {
		t.Errorf("WebRoot = %q, want webapp", d.WebRoot)
	}
}

// TestProjectDetector_LibDirs 检测 lib 目录
func TestProjectDetector_LibDirs(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// 创建 lib 目录
	mustMkdirAll(t, filepath.Join(dir, "lib"))
	mustWriteFile(t, filepath.Join(dir, "lib", "servlet.jar"), []byte("dummy"))

	// 创建 WebRoot/WEB-INF/lib
	mustMkdirAll(t, filepath.Join(dir, "WebRoot", "WEB-INF", "lib"))
	mustWriteFile(t, filepath.Join(dir, "WebRoot", "WEB-INF", "lib", "jstl.jar"), []byte("dummy"))

	d, err := DetectProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.LibDirs) < 1 {
		t.Errorf("expected at least 1 lib dir, got %d", len(d.LibDirs))
	}
}

// TestProjectDetector_BuildXMLEncoding 检测 build.xml 中的编码声明
func TestProjectDetector_BuildXMLEncoding(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0" encoding="GBK"?>
<project name="test" default="compile">
  <target name="compile"/>
</project>`))

	d, err := DetectProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if d.DefaultEncoding != "gbk" {
		t.Errorf("DefaultEncoding = %q, want gbk", d.DefaultEncoding)
	}
}

// TestProjectDetector_JavaVersionsFromBuildXML 从 build.xml 检测 Java 版本
func TestProjectDetector_JavaVersionsFromBuildXML(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project name="test" default="compile">
  <property name="javac.source" value="1.6"/>
  <property name="javac.target" value="1.6"/>
  <target name="compile">
    <javac srcdir="src" destdir="build/classes" source="1.6" target="1.6"/>
  </target>
</project>`))

	d, err := DetectProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	if d.SourceVersion != "1.6" {
		t.Errorf("SourceVersion = %q, want 1.6", d.SourceVersion)
	}
	if d.TargetVersion != "1.6" {
		t.Errorf("TargetVersion = %q, want 1.6", d.TargetVersion)
	}
}

func mustWriteFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}