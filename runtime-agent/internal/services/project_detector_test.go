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

// =========================================================================
// Pure Function Tests: normalizeEncodingName
// =========================================================================

func TestNormalizeEncodingName(t *testing.T) {
	tests := []struct {
		input, want string
	}{
		{"utf8", "utf-8"},
		{"UTF-8", "utf-8"},
		{"utf-8", "utf-8"},
		{"utf-8-bom", "utf-8-bom"},
		{"GBK", "gbk"},
		{"cp936", "gbk"},
		{"ms936", "gbk"},
		{"gb18030", "gb18030"},
		{"gb2312", "gbk"},
		{"ISO-8859-1", "iso-8859-1"},
		{"iso8859-1", "iso-8859-1"},
		{"latin1", "iso-8859-1"},
		{"us-ascii", "us-ascii"},
		{"ASCII", "us-ascii"},
		{"utf-16le", "utf-16le"},
		{"utf-16", "utf-16le"},
		{"utf-16be", "utf-16be"},
		{"  utf-8  ", "utf-8"},
		{"unknown-charset", "unknown-charset"},
	}
	for _, tt := range tests {
		got := normalizeEncodingName(tt.input)
		if got != tt.want {
			t.Errorf("normalizeEncodingName(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// =========================================================================
// Pure Function Tests: extractJDKVersion
// =========================================================================

func TestExtractJDKVersion(t *testing.T) {
	tests := []struct {
		input, want string
	}{
		{"javac 1.8.0_292", "1.8"},
		{"javac 11.0.2", "11"},
		{"javac 17.0.1", "17"},
		{"javac 1.7.0_80", "1.7"},
		{"javac 1.6.0_45", "1.6"},
		{"javac 21.0.5", "21"},
		{"no version here", ""},
		{"", ""},
		{"OpenJDK 1.8.0_362", "1.8"},
	}
	for _, tt := range tests {
		got := extractJDKVersion(tt.input)
		if got != tt.want {
			t.Errorf("extractJDKVersion(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// =========================================================================
// Pure Function Tests: extractVersionFromRelease
// =========================================================================

func TestExtractVersionFromRelease(t *testing.T) {
	tests := []struct {
		input, want string
	}{
		{`JAVA_VERSION="1.8.0_292"`, "1.8"},
		{`JAVA_VERSION="11.0.2"`, "11"},
		{`JAVA_VERSION="17.0.1"`, "17"},
		{`JAVA_VERSION="1.7.0_80"`, "1.7"},
		{`JAVA_VERSION="21"`, "21"},
		{`no version`, ""},
		{``, ""},
		{`JAVA_VERSION = "1.8.0"`, "1.8"},
	}
	for _, tt := range tests {
		got := extractVersionFromRelease(tt.input)
		if got != tt.want {
			t.Errorf("extractVersionFromRelease(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// =========================================================================
// Pure Function Tests: hasJavaFiles
// =========================================================================

func TestHasJavaFiles_True(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "Hello.java"), []byte("class Hello{}"))
	if !hasJavaFiles(dir) {
		t.Error("hasJavaFiles should return true")
	}
}

func TestHasJavaFiles_False(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "README.txt"), []byte("hello"))
	if hasJavaFiles(dir) {
		t.Error("hasJavaFiles should return false")
	}
}

func TestHasJavaFiles_Nonexistent(t *testing.T) {
	if hasJavaFiles("/nonexistent/path") {
		t.Error("hasJavaFiles should return false for nonexistent path")
	}
}

func TestHasJavaFiles_SubdirOnly(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "sub"))
	if hasJavaFiles(dir) {
		t.Error("hasJavaFiles should return false when only subdirectories exist")
	}
}

// =========================================================================
// Pure Function Tests: findJavaFiles
// =========================================================================

func TestFindJavaFiles(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "A.java"), []byte("class A{}"))
	mustWriteFile(t, filepath.Join(dir, "B.java"), []byte("class B{}"))
	mustWriteFile(t, filepath.Join(dir, "C.java"), []byte("class C{}"))
	mustWriteFile(t, filepath.Join(dir, "README.txt"), []byte("hello"))

	files, err := findJavaFiles(dir, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Errorf("len(files) = %d, want 2 (max=2)", len(files))
	}
}

func TestFindJavaFiles_Nonexistent(t *testing.T) {
	files, err := findJavaFiles("/nonexistent/path", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Errorf("len(files) = %d, want 0", len(files))
	}
}

func TestFindJavaFiles_NoJavaFiles(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "README.txt"), []byte("hello"))
	files, err := findJavaFiles(dir, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Errorf("len(files) = %d, want 0", len(files))
	}
}

// =========================================================================
// detectFileEncoding Tests
// =========================================================================

func TestDetectFileEncoding_UTF8BOM(t *testing.T) {
	dir := t.TempDir()
	// UTF-8 BOM: EF BB BF
	data := []byte{0xEF, 0xBB, 0xBF}
	data = append(data, []byte("// some java code\n")...)
	mustWriteFile(t, filepath.Join(dir, "Test.java"), data)
	got := detectFileEncoding(filepath.Join(dir, "Test.java"))
	if got != "utf-8-bom" {
		t.Errorf("detectFileEncoding = %q, want utf-8-bom", got)
	}
}

func TestDetectFileEncoding_UTF16BE(t *testing.T) {
	dir := t.TempDir()
	// UTF-16BE BOM: FE FF
	data := []byte{0xFE, 0xFF}
	data = append(data, []byte{0, 'c', 0, 'l', 0, 'a', 0, 's', 0, 's'}...)
	mustWriteFile(t, filepath.Join(dir, "Test.java"), data)
	got := detectFileEncoding(filepath.Join(dir, "Test.java"))
	if got != "utf-16be" {
		t.Errorf("detectFileEncoding = %q, want utf-16be", got)
	}
}

func TestDetectFileEncoding_UTF16LE(t *testing.T) {
	dir := t.TempDir()
	// UTF-16LE BOM: FF FE
	data := []byte{0xFF, 0xFE}
	data = append(data, []byte{'c', 0, 'l', 0, 'a', 0, 's', 0, 's', 0}...)
	mustWriteFile(t, filepath.Join(dir, "Test.java"), data)
	got := detectFileEncoding(filepath.Join(dir, "Test.java"))
	if got != "utf-16le" {
		t.Errorf("detectFileEncoding = %q, want utf-16le", got)
	}
}

func TestDetectFileEncoding_CharsetComment(t *testing.T) {
	dir := t.TempDir()
	// File with charset comment
	mustWriteFile(t, filepath.Join(dir, "Test.java"), []byte("// encoding: GBK\nclass Test{}"))
	got := detectFileEncoding(filepath.Join(dir, "Test.java"))
	if got != "gbk" {
		t.Errorf("detectFileEncoding = %q, want gbk", got)
	}
}

func TestDetectFileEncoding_NoEncoding(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "Test.java"), []byte("class Test{}"))
	got := detectFileEncoding(filepath.Join(dir, "Test.java"))
	if got != "" {
		t.Errorf("detectFileEncoding = %q, want empty", got)
	}
}

func TestDetectFileEncoding_Nonexistent(t *testing.T) {
	got := detectFileEncoding("/nonexistent/file.java")
	if got != "" {
		t.Errorf("detectFileEncoding = %q, want empty", got)
	}
}

// =========================================================================
// detectXMLEncoding Tests
// =========================================================================

func TestDetectXMLEncoding_Declaration(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0" encoding="GBK"?>
<project></project>`))
	got := detectXMLEncoding(filepath.Join(dir, "build.xml"))
	if got != "gbk" {
		t.Errorf("detectXMLEncoding = %q, want gbk", got)
	}
}

func TestDetectXMLEncoding_UTF8(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "web.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<web-app></web-app>`))
	got := detectXMLEncoding(filepath.Join(dir, "web.xml"))
	if got != "utf-8" {
		t.Errorf("detectXMLEncoding = %q, want utf-8", got)
	}
}

func TestDetectXMLEncoding_Nonexistent(t *testing.T) {
	got := detectXMLEncoding("/nonexistent/file.xml")
	if got != "" {
		t.Errorf("detectXMLEncoding = %q, want empty", got)
	}
}

func TestDetectXMLEncoding_NoEncoding(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0"?>
<project></project>`))
	got := detectXMLEncoding(filepath.Join(dir, "build.xml"))
	if got != "" {
		t.Errorf("detectXMLEncoding = %q, want empty", got)
	}
}

// =========================================================================
// detectJDKVersion with build.xml Tests
// =========================================================================

func TestDetectJDKVersion_FromBuildXML(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project name="test" default="compile">
  <target name="compile">
    <javac srcdir="src" destdir="build/classes" source="1.6" target="1.6"/>
  </target>
</project>`))
	d := &ProjectDetection{BuildScript: "build.xml", Warnings: []string{}}
	d.detectJDKVersion(dir)
	// If javac is not on PATH and JAVA_HOME is not set, JDKVersion should remain empty
	// But if build.xml has javac executable path, it might resolve
	// This test verifies the build.xml path is exercised
	if d.JDKVersion != "" {
		// If we got a version, it's from javac on PATH
		t.Logf("detected JDK version from build.xml: %s", d.JDKVersion)
	}
}

// =========================================================================
// detectSourceDirs Fallback Tests
// =========================================================================

func TestDetectSourceDirs_Fallback(t *testing.T) {
	dir := t.TempDir()
	// Create a directory with .java files but not matching common patterns
	javaDir := filepath.Join(dir, "custom-java")
	mustMkdirAll(t, javaDir)
	mustWriteFile(t, filepath.Join(javaDir, "Hello.java"), []byte("class Hello{}"))

	d := &ProjectDetection{Warnings: []string{}}
	d.detectSourceDirs(dir)
	if len(d.SourceDirs) == 0 {
		t.Error("detectSourceDirs should find custom-java via fallback")
	}
}

func TestDetectSourceDirs_NoJavaFiles(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "empty-dir"))
	mustWriteFile(t, filepath.Join(dir, "empty-dir", "README.txt"), []byte("hello"))

	d := &ProjectDetection{Warnings: []string{}}
	d.detectSourceDirs(dir)
	// Should not find any source dirs since no .java files
	if len(d.SourceDirs) > 0 {
		t.Errorf("detectSourceDirs should return empty, got %v", d.SourceDirs)
	}
}

// =========================================================================
// detectLibDirs without webroot Tests
// =========================================================================

func TestDetectLibDirs_NoWebRoot(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "WebRoot", "WEB-INF", "lib"))
	mustWriteFile(t, filepath.Join(dir, "WebRoot", "WEB-INF", "lib", "test.jar"), []byte("fake"))

	d := &ProjectDetection{WebRoot: "", Warnings: []string{}}
	d.detectLibDirs(dir)
	if len(d.LibDirs) == 0 {
		t.Error("detectLibDirs should find lib even without webroot")
	}
}

func TestDetectLibDirs_WebContent(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "WebContent", "WEB-INF", "lib"))
	mustWriteFile(t, filepath.Join(dir, "WebContent", "WEB-INF", "lib", "test.jar"), []byte("fake"))

	d := &ProjectDetection{WebRoot: "", Warnings: []string{}}
	d.detectLibDirs(dir)
	found := false
	for _, lib := range d.LibDirs {
		if lib == filepath.Join("WebContent", "WEB-INF", "lib") {
			found = true
		}
	}
	if !found {
		t.Errorf("detectLibDirs should find WebContent/WEB-INF/lib, got %v", d.LibDirs)
	}
}

// =========================================================================
// detectOutputDir Tests
// =========================================================================

func TestDetectOutputDir_ExistingDir(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "bin"))
	d := &ProjectDetection{BuildSystem: "none", Warnings: []string{}}
	d.detectOutputDir(dir)
	if d.OutputDir != "bin" {
		t.Errorf("OutputDir = %q, want bin", d.OutputDir)
	}
}

func TestDetectOutputDir_TargetClasses(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "target", "classes"))
	d := &ProjectDetection{BuildSystem: "none", Warnings: []string{}}
	d.detectOutputDir(dir)
	if d.OutputDir != "target/classes" {
		t.Errorf("OutputDir = %q, want target/classes", d.OutputDir)
	}
}

func TestDetectOutputDir_DefaultForAnt(t *testing.T) {
	dir := t.TempDir()
	d := &ProjectDetection{BuildSystem: "ant", Warnings: []string{}}
	d.detectOutputDir(dir)
	if d.OutputDir != "build/classes" {
		t.Errorf("OutputDir = %q, want build/classes", d.OutputDir)
	}
}

func TestDetectOutputDir_FromBuildXML(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project name="test" default="compile">
  <target name="compile">
    <javac srcdir="src" destdir="custom-out"/>
  </target>
</project>`))
	d := &ProjectDetection{BuildScript: "build.xml", Warnings: []string{}}
	d.detectOutputDir(dir)
	if d.OutputDir != "custom-out" {
		t.Errorf("OutputDir = %q, want custom-out", d.OutputDir)
	}
}

func TestDetectOutputDir_FromBuildXMLProperty(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project name="test" default="compile">
  <property name="build.classes.dir" value="web/WEB-INF/classes"/>
  <target name="compile">
    <javac srcdir="src"/>
  </target>
</project>`))
	d := &ProjectDetection{BuildScript: "build.xml", Warnings: []string{}}
	d.detectOutputDir(dir)
	if d.OutputDir != "web/WEB-INF/classes" {
		t.Errorf("OutputDir = %q, want web/WEB-INF/classes", d.OutputDir)
	}
}

// =========================================================================
// detectJavaVersions default Tests
// =========================================================================

func TestDetectJavaVersions_Defaults(t *testing.T) {
	dir := t.TempDir()
	d := &ProjectDetection{Warnings: []string{}}
	d.detectJavaVersions(dir)
	if d.SourceVersion != "1.6" {
		t.Errorf("SourceVersion = %q, want 1.6", d.SourceVersion)
	}
	if d.TargetVersion != "1.6" {
		t.Errorf("TargetVersion = %q, want 1.6", d.TargetVersion)
	}
}

func TestDetectJavaVersions_FromBuildXMLProperties(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "build.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project name="test" default="compile">
  <property name="javac.source" value="1.7"/>
  <property name="javac.target" value="1.7"/>
</project>`))
	d := &ProjectDetection{BuildScript: "build.xml", Warnings: []string{}}
	d.detectJavaVersions(dir)
	if d.SourceVersion != "1.7" {
		t.Errorf("SourceVersion = %q, want 1.7", d.SourceVersion)
	}
	if d.TargetVersion != "1.7" {
		t.Errorf("TargetVersion = %q, want 1.7", d.TargetVersion)
	}
}