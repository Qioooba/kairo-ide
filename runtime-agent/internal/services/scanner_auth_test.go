package services

import (
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// =========================================================================
// Scanner Tests
// =========================================================================

func TestDetectLayout_ClassicWebRoot(t *testing.T) {
	dir := t.TempDir()
	// Create classic legacy layout
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.MkdirAll(filepath.Join(dir, "WebRoot", "WEB-INF"), 0o755)
	os.WriteFile(filepath.Join(dir, "build.xml"), []byte("<project></project>"), 0o644)

	layout := detectLayout(dir)
	if layout["webRoot"] != "WebRoot" {
		t.Errorf("webRoot = %v, want WebRoot", layout["webRoot"])
	}
	if layout["buildXml"] != "build.xml" {
		t.Errorf("buildXml = %v, want build.xml", layout["buildXml"])
	}
}

func TestDetectLayout_WebContent(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.MkdirAll(filepath.Join(dir, "WebContent", "WEB-INF"), 0o755)

	layout := detectLayout(dir)
	if layout["webRoot"] != "WebContent" {
		t.Errorf("webRoot = %v, want WebContent", layout["webRoot"])
	}
}

func TestDetectLayout_MavenLike(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src", "main", "java"), 0o755)
	os.MkdirAll(filepath.Join(dir, "src", "main", "webapp"), 0o755)
	os.MkdirAll(filepath.Join(dir, "src", "main", "resources"), 0o755)

	layout := detectLayout(dir)
	if layout["webRoot"] != "src/main/webapp" {
		t.Errorf("webRoot = %v, want src/main/webapp", layout["webRoot"])
	}
	// src is detected as the top-level src directory
	srcs, ok := layout["src"].([]string)
	if !ok || len(srcs) == 0 {
		t.Errorf("src should be detected, got %v", layout["src"])
	}
	if layout["resources"] == nil {
		t.Error("resources should be detected")
	}
}

func TestDetectLayout_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	layout := detectLayout(dir)
	// Should still return defaults
	if layout["webRoot"] == nil {
		t.Error("webRoot should have a default")
	}
}

func TestDetectBuildSystem_Ant(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "build.xml"), []byte("<project></project>"), 0o644)
	sys := detectBuildSystem(dir)
	if sys != "ant" {
		t.Errorf("buildSystem = %q, want ant", sys)
	}
}

func TestDetectBuildSystem_Maven(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "pom.xml"), []byte("<project></project>"), 0o644)
	sys := detectBuildSystem(dir)
	if sys != "maven" {
		t.Errorf("buildSystem = %q, want maven", sys)
	}
}

func TestDetectBuildSystem_Gradle(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "build.gradle"), []byte(""), 0o644)
	sys := detectBuildSystem(dir)
	if sys != "gradle" {
		t.Errorf("buildSystem = %q, want gradle", sys)
	}
}

func TestDetectBuildSystem_None(t *testing.T) {
	dir := t.TempDir()
	sys := detectBuildSystem(dir)
	if sys != "none" {
		t.Errorf("buildSystem = %q, want none", sys)
	}
}

func TestDefaultEncodingByExt(t *testing.T) {
	m := defaultEncodingByExt()
	tests := []struct {
		ext, want string
	}{
		{".java", "utf-8"},
		{".jsp", "gbk"},
		{".xml", "utf-8"},
		{".properties", "iso-8859-1"},
		{".html", "utf-8"},
		{".css", "utf-8"},
		{".js", "utf-8"},
		{".tag", "utf-8"},
		{".tld", "utf-8"},
	}
	for _, tt := range tests {
		if got := m[tt.ext]; got != tt.want {
			t.Errorf("encoding for %s = %q, want %q", tt.ext, got, tt.want)
		}
	}
}

func TestReadWebXML_Valid(t *testing.T) {
	dir := t.TempDir()
	webInf := filepath.Join(dir, "WEB-INF")
	os.MkdirAll(webInf, 0o755)

	webXMLContent := `<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
	<servlet>
		<servlet-name>HelloServlet</servlet-name>
		<servlet-class>com.example.HelloServlet</servlet-class>
	</servlet>
	<servlet-mapping>
		<servlet-name>HelloServlet</servlet-name>
		<url-pattern>/hello</url-pattern>
	</servlet-mapping>
	<context-param>
		<param-name>db.url</param-name>
		<param-value>jdbc:oracle:thin:@localhost:1521:xe</param-value>
	</context-param>
</web-app>`
	os.WriteFile(filepath.Join(webInf, "web.xml"), []byte(webXMLContent), 0o644)

	result := readWebXML(dir)
	if result == nil {
		t.Fatal("readWebXML returned nil")
	}
	if result["servletCount"] != int(1) {
		t.Errorf("servletCount = %v, want 1", result["servletCount"])
	}
	urls, ok := result["urlPatterns"].([]string)
	if !ok || len(urls) != 1 || urls[0] != "/hello" {
		t.Errorf("urlPatterns = %v, want [/hello]", result["urlPatterns"])
	}
}

func TestReadWebXML_InvalidXML(t *testing.T) {
	dir := t.TempDir()
	webInf := filepath.Join(dir, "WEB-INF")
	os.MkdirAll(webInf, 0o755)
	os.WriteFile(filepath.Join(webInf, "web.xml"), []byte("not valid xml"), 0o644)

	result := readWebXML(dir)
	if result != nil {
		t.Errorf("readWebXML should return nil for invalid XML, got %v", result)
	}
}

func TestReadWebXML_NotFound(t *testing.T) {
	dir := t.TempDir()
	result := readWebXML(dir)
	if result != nil {
		t.Errorf("readWebXML should return nil when no web.xml found, got %v", result)
	}
}

func TestReadWebXML_WebRootPath(t *testing.T) {
	dir := t.TempDir()
	webInf := filepath.Join(dir, "WebRoot", "WEB-INF")
	os.MkdirAll(webInf, 0o755)

	webXMLContent := `<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
	<servlet>
		<servlet-name>TestServlet</servlet-name>
		<servlet-class>com.example.TestServlet</servlet-class>
	</servlet>
	<servlet-mapping>
		<servlet-name>TestServlet</servlet-name>
		<url-pattern>/test</url-pattern>
	</servlet-mapping>
</web-app>`
	os.WriteFile(filepath.Join(webInf, "web.xml"), []byte(webXMLContent), 0o644)

	result := readWebXML(dir)
	if result == nil {
		t.Fatal("readWebXML returned nil for WebRoot path")
	}
	if result["servletCount"] != int(1) {
		t.Errorf("servletCount = %v, want 1", result["servletCount"])
	}
}

func TestScanWorkspace_EmptyRoot(t *testing.T) {
	_, err := scanWorkspace("")
	if err == nil {
		t.Fatal("expected error for empty root")
	}
}

func TestScanWorkspace_NotADirectory(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "file.txt")
	os.WriteFile(f, []byte("hello"), 0o644)
	_, err := scanWorkspace(f)
	if err == nil {
		t.Fatal("expected error for non-directory path")
	}
}

func TestScanWorkspace_ValidDir(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.MkdirAll(filepath.Join(dir, "WebRoot", "WEB-INF"), 0o755)
	os.WriteFile(filepath.Join(dir, "build.xml"), []byte("<project></project>"), 0o644)

	results, err := scanWorkspace(dir)
	if err != nil {
		t.Fatalf("scanWorkspace: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	r := results[0]
	if r["rootPath"] != dir {
		t.Errorf("rootPath = %v, want %v", r["rootPath"], dir)
	}
	if r["buildSystem"] != "ant" {
		t.Errorf("buildSystem = %v, want ant", r["buildSystem"])
	}
}

func TestScanWorkspace_WithWebXML(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	webInf := filepath.Join(dir, "WEB-INF")
	os.MkdirAll(webInf, 0o755)
	os.WriteFile(filepath.Join(webInf, "web.xml"), []byte(`<?xml version="1.0"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
	<servlet><servlet-name>S</servlet-name><servlet-class>C</servlet-class></servlet>
	<servlet-mapping><servlet-name>S</servlet-name><url-pattern>/s</url-pattern></servlet-mapping>
</web-app>`), 0o644)

	results, err := scanWorkspace(dir)
	if err != nil {
		t.Fatalf("scanWorkspace: %v", err)
	}
	r := results[0]
	if r["webXml"] == nil {
		t.Error("webXml should be detected")
	}
	// confidence should be higher with web.xml
	conf, ok := r["confidence"].(float64)
	if !ok || conf < 0.8 {
		t.Errorf("confidence = %v, want >= 0.8", r["confidence"])
	}
}

func TestScanWorkspace_Nonexistent(t *testing.T) {
	_, err := scanWorkspace("/nonexistent/path/12345")
	if err == nil {
		t.Fatal("expected error for nonexistent path")
	}
}

// =========================================================================
// Auth Tests
// =========================================================================

func TestDiskAuthenticator_Login_NoCredentials(t *testing.T) {
	a := newDiskAuthenticator(t.TempDir(), log.New("test"))
	// Clear env vars
	os.Unsetenv("KAIRO_AUTH_USER")
	os.Unsetenv("KAIRO_AUTH_PASSWORD")
	os.Unsetenv("KAIRO_SECRET")

	payload, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "any",
	})
	resp, err := a.Login(payload, nil)
	if err != nil {
		t.Fatalf("Login should succeed in dev mode: %v", err)
	}
	var result map[string]any
	json.Unmarshal(resp, &result)
	if result["sessionToken"] == nil || result["sessionToken"] == "" {
		t.Error("sessionToken should be generated")
	}
	if result["csrfToken"] == nil || result["csrfToken"] == "" {
		t.Error("csrfToken should be generated")
	}
}

func TestDiskAuthenticator_Login_WithSharedSecret(t *testing.T) {
	a := newDiskAuthenticator(t.TempDir(), log.New("test"))
	os.Unsetenv("KAIRO_AUTH_USER")
	os.Unsetenv("KAIRO_AUTH_PASSWORD")
	os.Setenv("KAIRO_SECRET", "my-secret-key")
	defer os.Unsetenv("KAIRO_SECRET")

	// Correct password
	payload, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "my-secret-key",
	})
	resp, err := a.Login(payload, nil)
	if err != nil {
		t.Fatalf("Login with correct shared secret: %v", err)
	}
	var result map[string]any
	json.Unmarshal(resp, &result)
	if result["sessionToken"] == nil {
		t.Error("sessionToken should be generated")
	}

	// Wrong password
	payload2, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "wrong",
	})
	_, err = a.Login(payload2, nil)
	if err == nil {
		t.Fatal("Login with wrong shared secret should fail")
	}
}

func TestDiskAuthenticator_Login_WithUserAuth(t *testing.T) {
	a := newDiskAuthenticator(t.TempDir(), log.New("test"))
	os.Unsetenv("KAIRO_SECRET")
	// SHA-256 of "correct-password"
	os.Setenv("KAIRO_AUTH_USER", "admin")
	os.Setenv("KAIRO_AUTH_PASSWORD", "4a44bc153ac69d4b5b5e8f3e10c5e9cfc5b8f5e7c5e8f5e7c5e8f5e7c5e8f5e7")
	defer os.Unsetenv("KAIRO_AUTH_USER")
	defer os.Unsetenv("KAIRO_AUTH_PASSWORD")

	// Wrong username
	payload, _ := json.Marshal(map[string]string{
		"username": "wrong-user",
		"password": "any",
	})
	_, err := a.Login(payload, nil)
	if err == nil {
		t.Fatal("Login with wrong username should fail")
	}
}

func TestDiskAuthenticator_Login_EmptyCredentials(t *testing.T) {
	a := newDiskAuthenticator(t.TempDir(), log.New("test"))
	os.Unsetenv("KAIRO_AUTH_USER")
	os.Unsetenv("KAIRO_AUTH_PASSWORD")
	os.Unsetenv("KAIRO_SECRET")

	// Empty username
	payload, _ := json.Marshal(map[string]string{
		"username": "",
		"password": "something",
	})
	_, err := a.Login(payload, nil)
	if err == nil {
		t.Fatal("Login with empty username should fail")
	}

	// Empty password
	payload2, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "",
	})
	_, err = a.Login(payload2, nil)
	if err == nil {
		t.Fatal("Login with empty password should fail")
	}
}

func TestDiskAuthenticator_Login_InvalidJSON(t *testing.T) {
	a := newDiskAuthenticator(t.TempDir(), log.New("test"))
	_, err := a.Login([]byte("not json"), nil)
	if err == nil {
		t.Fatal("Login with invalid JSON should fail")
	}
}

func TestDiskAuthenticator_Login_ResponseFields(t *testing.T) {
	a := newDiskAuthenticator(t.TempDir(), log.New("test"))
	os.Unsetenv("KAIRO_AUTH_USER")
	os.Unsetenv("KAIRO_AUTH_PASSWORD")
	os.Unsetenv("KAIRO_SECRET")

	payload, _ := json.Marshal(map[string]string{
		"username": "testuser",
		"password": "testpass",
	})
	resp, err := a.Login(payload, nil)
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(resp, &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	// Check session token is 64 hex chars (32 bytes)
	token, ok := result["sessionToken"].(string)
	if !ok || len(token) != 64 {
		t.Errorf("sessionToken = %q (len=%d), want 64 hex chars", token, len(token))
	}

	// Check CSRF token is 32 hex chars (16 bytes)
	csrf, ok := result["csrfToken"].(string)
	if !ok || len(csrf) != 32 {
		t.Errorf("csrfToken = %q (len=%d), want 32 hex chars", csrf, len(csrf))
	}

	// Check user info
	user, ok := result["user"].(map[string]any)
	if !ok {
		t.Fatal("user field missing")
	}
	if user["username"] != "testuser" {
		t.Errorf("user.username = %v, want testuser", user["username"])
	}
	if user["role"] != "user" {
		t.Errorf("user.role = %v, want user", user["role"])
	}

	// Check expiresAt
	if _, ok := result["expiresAt"].(string); !ok {
		t.Error("expiresAt should be present")
	}
}

func TestDiskAuthenticator_Logout(t *testing.T) {
	a := newDiskAuthenticator(t.TempDir(), log.New("test"))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	rec := httptest.NewRecorder()
	err := a.Logout(req, rec)
	if err != nil {
		t.Errorf("Logout should not error: %v", err)
	}
}

// =========================================================================
// Services Construction Tests
// =========================================================================

func TestNewMemoryServices_BasicConstruction(t *testing.T) {
	l := log.New("test")
	cfg := Config{
		DataDir:    t.TempDir(),
		BundledDir: t.TempDir(),
		Logger:     l,
	}
	svc := NewMemoryServices(cfg, nil)
	if svc == nil {
		t.Fatal("NewMemoryServices returned nil")
	}
	if svc.WorkspaceStore == nil {
		t.Error("WorkspaceStore is nil")
	}
	if svc.ProjectStore == nil {
		t.Error("ProjectStore is nil")
	}
	if svc.RunConfigurationStore == nil {
		t.Error("RunConfigurationStore is nil")
	}
	if svc.Searcher == nil {
		t.Error("Searcher is nil")
	}
	if svc.Encoder == nil {
		t.Error("Encoder is nil")
	}
	if svc.BuildEngine == nil {
		t.Error("BuildEngine is nil")
	}
	if svc.Deployer == nil {
		t.Error("Deployer is nil")
	}
	if svc.ServerRunner == nil {
		t.Error("ServerRunner is nil")
	}
	if svc.Auth == nil {
		t.Error("Auth is nil")
	}
	if svc.JDTLS == nil {
		t.Error("JDTLS is nil")
	}
	if svc.JDTProjectGenerator == nil {
		t.Error("JDTProjectGenerator is nil")
	}
	if svc.Orchestrator == nil {
		t.Error("Orchestrator is nil")
	}
}

func TestNewMemoryServices_WithEnvVars(t *testing.T) {
	l := log.New("test")
	cfg := Config{
		DataDir:       t.TempDir(),
		BundledDir:    t.TempDir(),
		Logger:        l,
		SkipSHAVerify: true,
		JDTLSURL:      "https://example.com/jdtls.tar.gz",
	}
	svc := NewMemoryServices(cfg, nil)
	if svc == nil {
		t.Fatal("NewMemoryServices returned nil")
	}
	// With SkipSHAVerify=true, JDTLS should still be created
	if svc.JDTLS == nil {
		t.Error("JDTLS is nil with SkipSHAVerify")
	}
}

// =========================================================================
// Encoding Service Tests
// =========================================================================

func TestMemEncoder_GetEncoding_Empty(t *testing.T) {
	m := &memEncoder{}
	enc := m.GetEncoding("test.java")
	if enc != "" {
		t.Errorf("GetEncoding should return empty for unknown file, got %q", enc)
	}
}

func TestMemEncoder_GetEncoding_Cached(t *testing.T) {
	m := &memEncoder{
		fileEncoding: map[string]string{
			"test.java": "gbk",
		},
	}
	enc := m.GetEncoding("test.java")
	if enc != "gbk" {
		t.Errorf("GetEncoding = %q, want gbk", enc)
	}
}

func TestMemEncoder_Validate_EmptyText(t *testing.T) {
	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]string{
		"text":     "",
		"encoding": "gbk",
	})
	resp, err := m.Validate(payload)
	if err != nil {
		t.Fatalf("Validate empty text: %v", err)
	}
	var result map[string]any
	json.Unmarshal(resp, &result)
	if result["valid"] != true {
		t.Error("empty text should be valid")
	}
}

func TestMemEncoder_Validate_UTF8(t *testing.T) {
	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]string{
		"text":     "hello world",
		"encoding": "utf-8",
	})
	resp, err := m.Validate(payload)
	if err != nil {
		t.Fatalf("Validate UTF-8: %v", err)
	}
	var result map[string]any
	json.Unmarshal(resp, &result)
	if result["valid"] != true {
		t.Error("UTF-8 text should be valid")
	}
}

func TestMemEncoder_Validate_InvalidEncoding(t *testing.T) {
	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]string{
		"text":     "hello",
		"encoding": "nonexistent-encoding-xyz",
	})
	resp, err := m.Validate(payload)
	if err != nil {
		t.Fatalf("Validate should not error, just return invalid: %v", err)
	}
	var result map[string]any
	json.Unmarshal(resp, &result)
	// Should report invalid for unsupported encoding
	if result["valid"] != false {
		t.Error("unsupported encoding should report invalid")
	}
}

func TestMemEncoder_ResolveRead_NilSandbox(t *testing.T) {
	m := &memEncoder{sandbox: nil}
	path, err := m.resolveRead("/some/path")
	if err != nil {
		t.Fatalf("resolveRead with nil sandbox: %v", err)
	}
	if path != "/some/path" {
		t.Errorf("path = %q, want /some/path", path)
	}
}

func TestMemEncoder_ResolveWrite_NilSandbox(t *testing.T) {
	m := &memEncoder{sandbox: nil}
	path, err := m.resolveWrite("/some/path")
	if err != nil {
		t.Fatalf("resolveWrite with nil sandbox: %v", err)
	}
	if path != "/some/path" {
		t.Errorf("path = %q, want /some/path", path)
	}
}

// =========================================================================
// Config Tests
// =========================================================================

func TestConfig_Defaults(t *testing.T) {
	cfg := Config{
		DataDir:    "/tmp/test",
		BundledDir: "/tmp/bundled",
	}
	if cfg.Tomcat6Home != "" {
		t.Error("Tomcat6Home should default to empty")
	}
	if cfg.SkipSHAVerify != false {
		t.Error("SkipSHAVerify should default to false")
	}
	if cfg.JDTLSURL != "" {
		t.Error("JDTLSURL should default to empty")
	}
}

// =========================================================================
// WebXML Parsing Edge Cases
// =========================================================================

func TestReadWebXML_EmptyWebXML(t *testing.T) {
	dir := t.TempDir()
	webInf := filepath.Join(dir, "WEB-INF")
	os.MkdirAll(webInf, 0o755)
	os.WriteFile(filepath.Join(webInf, "web.xml"), []byte(`<?xml version="1.0"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
</web-app>`), 0o644)

	result := readWebXML(dir)
	if result == nil {
		t.Fatal("readWebXML returned nil for empty web.xml")
	}
	if result["servletCount"] != int(0) {
		t.Errorf("servletCount = %v, want 0", result["servletCount"])
	}
}

func TestReadWebXML_MultipleServletsAndMappings(t *testing.T) {
	dir := t.TempDir()
	webInf := filepath.Join(dir, "WEB-INF")
	os.MkdirAll(webInf, 0o755)

	webXMLContent := `<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
	<servlet>
		<servlet-name>A</servlet-name>
		<servlet-class>com.A</servlet-class>
	</servlet>
	<servlet>
		<servlet-name>B</servlet-name>
		<servlet-class>com.B</servlet-class>
	</servlet>
	<servlet-mapping>
		<servlet-name>A</servlet-name>
		<url-pattern>/a</url-pattern>
	</servlet-mapping>
	<servlet-mapping>
		<servlet-name>B</servlet-name>
		<url-pattern>/b</url-pattern>
	</servlet-mapping>
	<context-param>
		<param-name>app.name</param-name>
		<param-value>MyApp</param-value>
	</context-param>
	<context-param>
		<param-name>app.version</param-name>
		<param-value>1.0</param-value>
	</context-param>
</web-app>`
	os.WriteFile(filepath.Join(webInf, "web.xml"), []byte(webXMLContent), 0o644)

	result := readWebXML(dir)
	if result == nil {
		t.Fatal("readWebXML returned nil")
	}
	if result["servletCount"] != int(2) {
		t.Errorf("servletCount = %v, want 2", result["servletCount"])
	}
	urls := result["urlPatterns"].([]string)
	if len(urls) != 2 {
		t.Errorf("urlPatterns count = %d, want 2", len(urls))
	}
	params := result["contextParams"].(map[string]string)
	if len(params) != 2 {
		t.Errorf("contextParams count = %d, want 2", len(params))
	}
}

// =========================================================================
// XML Encoding/Decoding Tests
// =========================================================================

func TestWebXML_Unmarshal(t *testing.T) {
	data := `<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
	<servlet>
		<servlet-name>MainServlet</servlet-name>
		<servlet-class>com.example.MainServlet</servlet-class>
	</servlet>
	<servlet-mapping>
		<servlet-name>MainServlet</servlet-name>
		<url-pattern>/main</url-pattern>
	</servlet-mapping>
</web-app>`

	var w webXML
	if err := xml.Unmarshal([]byte(data), &w); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if len(w.Servlets) != 1 {
		t.Errorf("Servlets = %d, want 1", len(w.Servlets))
	}
	if w.Servlets[0].ServletName != "MainServlet" {
		t.Errorf("ServletName = %q", w.Servlets[0].ServletName)
	}
	if w.Servlets[0].ServletClass != "com.example.MainServlet" {
		t.Errorf("ServletClass = %q", w.Servlets[0].ServletClass)
	}
	if len(w.ServletMappings) != 1 {
		t.Errorf("ServletMappings = %d, want 1", len(w.ServletMappings))
	}
	if w.ServletMappings[0].URLPattern != "/main" {
		t.Errorf("URLPattern = %q", w.ServletMappings[0].URLPattern)
	}
}

// =========================================================================
// findJdkOnPath tests
// =========================================================================

func TestFindJdkOnPath_NoJavaHome(t *testing.T) {
	os.Unsetenv("JAVA_HOME")
	result := findJdkOnPath()
	if result != nil {
		t.Errorf("findJdkOnPath should return nil when JAVA_HOME is not set, got %v", result)
	}
}

func TestFindJdkOnPath_InvalidJavaHome(t *testing.T) {
	os.Setenv("JAVA_HOME", "/nonexistent/jdk/path")
	defer os.Unsetenv("JAVA_HOME")
	result := findJdkOnPath()
	if result != nil {
		t.Errorf("findJdkOnPath should return nil for invalid JAVA_HOME, got %v", result)
	}
}

func TestFindJdkOnPath_ValidJavaHome(t *testing.T) {
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	os.MkdirAll(binDir, 0o755)
	os.WriteFile(filepath.Join(binDir, "java"), []byte("fake java"), 0o755)

	os.Setenv("JAVA_HOME", dir)
	defer os.Unsetenv("JAVA_HOME")

	result := findJdkOnPath()
	if result == nil {
		t.Fatal("findJdkOnPath should find JDK")
	}
	if result["home"] != dir {
		t.Errorf("home = %v, want %v", result["home"], dir)
	}
	if result["version"] != "unknown" {
		t.Errorf("version = %v, want unknown", result["version"])
	}
}