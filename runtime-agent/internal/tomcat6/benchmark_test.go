package tomcat6

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// --- Config validation benchmarks ---

func BenchmarkConfig_Validate(b *testing.B) {
	dir := b.TempDir()
	home := filepath.Join(dir, "catalina-home")
	base := filepath.Join(dir, "catalina-base")
	os.MkdirAll(filepath.Join(home, "bin"), 0755)
	os.WriteFile(filepath.Join(home, "bin", "bootstrap.jar"), []byte("dummy"), 0644)
	os.MkdirAll(base, 0755)

	cfg := Config{
		CatalinaHome: home,
		CatalinaBase: base,
		JavaHome:     "/usr/lib/jvm/java-6",
		HTTPPort:     18080,
		ShutdownPort: 8005,
		WebappDir:    filepath.Join(dir, "webapp"),
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cfg.Validate()
	}
}

func BenchmarkConfig_Validate_MissingBootstrap(b *testing.B) {
	cfg := Config{
		CatalinaHome: "/nonexistent/path",
		CatalinaBase: "/tmp/base",
		JavaHome:     "/usr/lib/jvm/java-6",
		HTTPPort:     18080,
		ShutdownPort: 8005,
		WebappDir:    "/tmp/webapp",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cfg.Validate()
	}
}

// --- BootstrapClasspath benchmark ---

func BenchmarkBootstrapClasspath(b *testing.B) {
	dir := b.TempDir()
	binDir := filepath.Join(dir, "bin")
	os.MkdirAll(binDir, 0755)
	os.WriteFile(filepath.Join(binDir, "bootstrap.jar"), []byte("dummy"), 0644)
	os.WriteFile(filepath.Join(binDir, "tomcat-juli.jar"), []byte("dummy"), 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		BootstrapClasspath(dir)
	}
}

// --- BuildCommand benchmarks ---

func BenchmarkBuildCommand(b *testing.B) {
	dir := b.TempDir()
	home := filepath.Join(dir, "catalina-home")
	base := filepath.Join(dir, "catalina-base")
	binDir := filepath.Join(home, "bin")
	os.MkdirAll(binDir, 0755)
	os.WriteFile(filepath.Join(binDir, "bootstrap.jar"), []byte("dummy"), 0644)
	os.MkdirAll(base, 0755)

	cfg := Config{
		CatalinaHome: home,
		CatalinaBase: base,
		JavaHome:     "/usr/lib/jvm/java-6",
		HTTPPort:     18080,
		ShutdownPort: 8005,
		DebugPort:    5005,
		WebappDir:    filepath.Join(dir, "webapp"),
		JVMOptions:   []string{"-Xmx512m", "-Xms256m"},
		Env:          []string{"PATH=/usr/bin", "LANG=en_US.UTF-8"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		BuildCommand(cfg)
	}
}

func BenchmarkBuildCommand_NoDebug(b *testing.B) {
	dir := b.TempDir()
	home := filepath.Join(dir, "catalina-home")
	base := filepath.Join(dir, "catalina-base")
	binDir := filepath.Join(home, "bin")
	os.MkdirAll(binDir, 0755)
	os.WriteFile(filepath.Join(binDir, "bootstrap.jar"), []byte("dummy"), 0644)
	os.MkdirAll(base, 0755)

	cfg := Config{
		CatalinaHome: home,
		CatalinaBase: base,
		JavaHome:     "/usr/lib/jvm/java-6",
		HTTPPort:     18080,
		ShutdownPort: 8005,
		WebappDir:    filepath.Join(dir, "webapp"),
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		BuildCommand(cfg)
	}
}

// --- BuildEnv benchmarks ---

func BenchmarkBuildEnv(b *testing.B) {
	cfg := Config{
		JavaHome:     "/usr/lib/jvm/java-6",
		CatalinaHome: "/opt/tomcat6",
		CatalinaBase: "/tmp/catalina-base",
		Env:          []string{"PATH=/usr/bin", "LANG=en_US.UTF-8", "CUSTOM_VAR=value"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		buildEnv(cfg)
	}
}

func BenchmarkBuildEnv_DuplicateOverride(b *testing.B) {
	cfg := Config{
		JavaHome:     "/usr/lib/jvm/java-6",
		CatalinaHome: "/opt/tomcat6",
		CatalinaBase: "/tmp/catalina-base",
		Env:          []string{"JAVA_HOME=/custom/java", "JRE_HOME=/custom/jre", "CATALINA_HOME=/custom/tomcat"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		buildEnv(cfg)
	}
}

// --- Server XML benchmarks ---

func BenchmarkDefaultServerXML(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		defaultServerXML()
	}
}

func BenchmarkWriteServerXML(b *testing.B) {
	dir := b.TempDir()
	base := filepath.Join(dir, "catalina-base")
	os.MkdirAll(filepath.Join(base, "conf"), 0755)

	cfg := Config{
		CatalinaHome: "/opt/tomcat6",
		CatalinaBase: base,
		HTTPPort:     18080,
		ShutdownPort: 8005,
		ContextPath:  "/myapp",
		WebappDir:    "/tmp/webapp",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		writeServerXML(cfg)
	}
}

// --- PrepareCatalinaBase benchmarks ---

func BenchmarkPrepareCatalinaBase(b *testing.B) {
	dir := b.TempDir()
	home := filepath.Join(dir, "catalina-home")
	homeConf := filepath.Join(home, "conf")
	os.MkdirAll(homeConf, 0755)
	for _, f := range []string{"web.xml", "context.xml", "tomcat-users.xml", "catalina.policy"} {
		os.WriteFile(filepath.Join(homeConf, f), []byte("<xml/>"), 0644)
	}

	cfg := Config{
		CatalinaHome: home,
		CatalinaBase: filepath.Join(dir, "catalina-base"),
		HTTPPort:     18080,
		ShutdownPort: 8005,
		WebappDir:    filepath.Join(dir, "webapp"),
	}

	b.ResetTimer()
	// Use a fresh base each iteration to avoid skipping existing files
	for i := 0; i < b.N; i++ {
		iterBase := filepath.Join(dir, "catalina-base", itoa(i))
		cfg.CatalinaBase = iterBase
		PrepareCatalinaBase(cfg)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// --- String utilities benchmarks ---

func BenchmarkTailLines(b *testing.B) {
	data := "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tailLines(data, 5)
	}
}

func BenchmarkTailLines_Large(b *testing.B) {
	data := ""
	for j := 0; j < 1000; j++ {
		data += "this is a log line with some content number " + itoa(j) + "\n"
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tailLines(data, 20)
	}
}

func BenchmarkSplitLines(b *testing.B) {
	data := "line1\nline2\nline3\nline4\nline5\n"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		splitLines(data)
	}
}

func BenchmarkSplitLines_Large(b *testing.B) {
	data := ""
	for j := 0; j < 1000; j++ {
		data += "this is a log line with some content number " + itoa(j) + "\n"
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		splitLines(data)
	}
}

// --- Utility benchmarks ---

func BenchmarkBoolYN(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		boolYN(true)
	}
}

func BenchmarkFileSHA256(b *testing.B) {
	dir := b.TempDir()
	path := filepath.Join(dir, "test.txt")
	os.WriteFile(path, []byte("hello world this is a test file for sha256 hashing"), 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		fileSHA256(path)
	}
}

func BenchmarkFileSHA256_Large(b *testing.B) {
	dir := b.TempDir()
	path := filepath.Join(dir, "large.txt")
	data := make([]byte, 1024*1024) // 1MB
	for j := range data {
		data[j] = byte(j % 256)
	}
	os.WriteFile(path, data, 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		fileSHA256(path)
	}
}

// --- FindCatalinaHome benchmarks ---

func BenchmarkFindCatalinaHome(b *testing.B) {
	dir := b.TempDir()
	tomcatDir := filepath.Join(dir, "bundled", "tomcat6", "apache-tomcat-6.0.53")
	binDir := filepath.Join(tomcatDir, "bin")
	os.MkdirAll(binDir, 0755)
	os.WriteFile(filepath.Join(binDir, "bootstrap.jar"), []byte("dummy"), 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		FindCatalinaHome(filepath.Join(dir, "bundled"))
	}
}

// --- WaitForReady (stub, no actual server) benchmarks ---

func BenchmarkSendShutdown(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Will fail quickly since no server is listening
		SendShutdown(19999, 10*time.Millisecond)
	}
}

// --- LogTail benchmarks ---

func BenchmarkLogTail(b *testing.B) {
	tail := newLogTail(40)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tail.add("this is a log message with some content")
	}
}

func BenchmarkLogTail_String(b *testing.B) {
	tail := newLogTail(40)
	for j := 0; j < 40; j++ {
		tail.add("log message " + itoa(j))
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = tail.String()
	}
}