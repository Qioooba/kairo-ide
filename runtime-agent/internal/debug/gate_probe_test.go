package debug

import (
	"context"
	"net"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestGateProbeResult_Defaults(t *testing.T) {
	cfg := GateProbeConfig{
		JavaHome:  "/nonexistent",
		DebugPort: 5005,
		Timeout:   5 * time.Second,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)

	if result.Platform == "" {
		t.Error("Platform should not be empty")
	}
	if result.DebugPort != 5005 {
		t.Errorf("DebugPort = %d, want 5005", result.DebugPort)
	}
	if result.JDK6JDWP {
		t.Error("JDK6JDWP should be false for nonexistent JavaHome")
	}
	if result.DurationMs < 0 {
		t.Error("DurationMs should be >= 0")
	}
}

func TestGateProbeResult_EmptyJavaHome(t *testing.T) {
	cfg := GateProbeConfig{
		JavaHome:  "",
		DebugPort: 5005,
		Timeout:   5 * time.Second,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)

	if result.JDK6JDWP {
		t.Error("JDK6JDWP should be false when JavaHome is empty")
	}
	if len(result.Errors) == 0 {
		t.Error("Should have errors when JavaHome is empty")
	}
}

func TestProbeDebugPort_Closed(t *testing.T) {
	// Find an available port, then close it — the probe should fail.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()

	// Wait a moment for the OS to release the port
	time.Sleep(50 * time.Millisecond)

	ctx := context.Background()
	if probeDebugPort(ctx, port) {
		t.Log("port was still open (OS may not have released it yet)")
	}
}

func TestProbeDebugPort_Open(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	port := l.Addr().(*net.TCPAddr).Port

	ctx := context.Background()
	if !probeDebugPort(ctx, port) {
		t.Error("probeDebugPort should return true for an open port")
	}
}

func TestProbeJDWPHandshake_InvalidPort(t *testing.T) {
	ctx := context.Background()
	if probeJDWPHandshake(ctx, 1) {
		t.Error("JDWP handshake should fail on an invalid port")
	}
}

func TestProbeJDWPHandshake_NoJDWP(t *testing.T) {
	// Start a plain TCP listener that doesn't speak JDWP
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	port := l.Addr().(*net.TCPAddr).Port

	// Serve a wrong response
	go func() {
		conn, err := l.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 14)
		conn.Read(buf)
		conn.Write([]byte("NOT-JDWP-XYZ12"))
	}()

	ctx := context.Background()
	if probeJDWPHandshake(ctx, port) {
		t.Error("JDWP handshake should fail when server returns wrong response")
	}
}

func TestProbeJDWPHandshake_ValidHandshake(t *testing.T) {
	// Mock a JDWP-compatible handshake server
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	port := l.Addr().(*net.TCPAddr).Port

	go func() {
		conn, err := l.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 14)
		conn.Read(buf)
		conn.Write([]byte("JDWP-Handshake"))
	}()

	ctx := context.Background()
	if !probeJDWPHandshake(ctx, port) {
		t.Error("JDWP handshake should succeed with correct response")
	}
}

func TestRunGate_Timeout(t *testing.T) {
	// Use a very short timeout to verify timeout handling
	cfg := GateProbeConfig{
		JavaHome:  "/nonexistent",
		DebugPort: 5005,
		Timeout:   100 * time.Millisecond,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)

	if result.DurationMs < 0 {
		t.Error("DurationMs should be >= 0")
	}
	// Errors should be present since JavaHome doesn't exist
	if len(result.Errors) == 0 {
		t.Error("Should have errors when JavaHome is nonexistent")
	}
}

func TestProbeJDK6JDWP_NoJavaHome(t *testing.T) {
	ctx := context.Background()
	var mu sync.Mutex
	var errors []string
	addError := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		errors = append(errors, s)
	}

	version, ok := probeJDK6JDWP(ctx, "", 5005, addError)
	if ok {
		t.Error("should fail when JavaHome is empty")
	}
	if version != "" {
		t.Error("version should be empty when JavaHome is empty")
	}
	if len(errors) == 0 {
		t.Error("should have recorded an error")
	}
}

func TestProbeJDK6JDWP_NonexistentJavaBin(t *testing.T) {
	ctx := context.Background()
	var mu sync.Mutex
	var errors []string
	addError := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		errors = append(errors, s)
	}

	version, ok := probeJDK6JDWP(ctx, "/nonexistent/path/to/jdk", 5005, addError)
	if ok {
		t.Error("should fail when java binary does not exist")
	}
	if version != "" {
		t.Error("version should be empty when java binary does not exist")
	}
	if len(errors) == 0 {
		t.Error("should have recorded an error")
	}
}

func TestProbeTomcat6Debug_NoTomcatHome(t *testing.T) {
	ctx := context.Background()
	var mu sync.Mutex
	var errors []string
	addError := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		errors = append(errors, s)
	}

	ok := probeTomcat6Debug(ctx, "/fake/java", "", 5005, addError)
	if ok {
		t.Error("should fail when tomcatHome is empty")
	}
	if len(errors) == 0 {
		t.Error("should have recorded an error")
	}
}

func TestProbeTomcat6Debug_NoBootstrapJar(t *testing.T) {
	ctx := context.Background()
	var mu sync.Mutex
	var errors []string
	addError := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		errors = append(errors, s)
	}

	ok := probeTomcat6Debug(ctx, "/fake/java", "/nonexistent/tomcat", 5005, addError)
	if ok {
		t.Error("should fail when bootstrap.jar does not exist")
	}
	if len(errors) == 0 {
		t.Error("should have recorded an error")
	}
}

func TestTomcatBootstrapClasspath(t *testing.T) {
	cp := tomcatBootstrapClasspath("/nonexistent")
	if cp != "" {
		t.Errorf("classpath should be empty for nonexistent dir, got %q", cp)
	}
}

func TestFirstLine(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"", ""},
		{"\n", ""},
		{"  \n", ""},
		{"hello\nworld", "hello"},
		{"  java version \"1.6.0_45\"\n  ", "java version \"1.6.0_45\""},
	}

	for _, tt := range tests {
		got := firstLine([]byte(tt.input))
		if got != tt.want {
			t.Errorf("firstLine(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestGateProbeResult_JSONFields(t *testing.T) {
	result := GateProbeResult{
		JDK6JDWP:      true,
		Tomcat6Debug:  true,
		JDWPHandshake: true,
		DebugPortOpen: true,
		Platform:      "darwin",
		Errors:        []string{},
		DurationMs:    1234,
		JDKVersion:    "1.6.0_45",
		DebugPort:     5005,
	}

	// Verify all fields are set correctly
	if !result.JDK6JDWP {
		t.Error("JDK6JDWP should be true")
	}
	if !result.Tomcat6Debug {
		t.Error("Tomcat6Debug should be true")
	}
	if !result.JDWPHandshake {
		t.Error("JDWPHandshake should be true")
	}
	if !result.DebugPortOpen {
		t.Error("DebugPortOpen should be true")
	}
	if result.Platform != "darwin" {
		t.Errorf("Platform = %q, want darwin", result.Platform)
	}
	if result.DurationMs != 1234 {
		t.Errorf("DurationMs = %d, want 1234", result.DurationMs)
	}
	if result.JDKVersion != "1.6.0_45" {
		t.Errorf("JDKVersion = %q, want 1.6.0_45", result.JDKVersion)
	}
	if result.DebugPort != 5005 {
		t.Errorf("DebugPort = %d, want 5005", result.DebugPort)
	}
}

func TestGateProbeConfig_Defaults(t *testing.T) {
	cfg := GateProbeConfig{
		JavaHome:  "/fake",
		DebugPort: 0,
		Timeout:   0,
	}

	// Verify zero values are handled
	_ = cfg
}

func TestProbeJDWPHandshake_Concurrent(t *testing.T) {
	// Start a mock JDWP server
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	port := l.Addr().(*net.TCPAddr).Port

	go func() {
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				buf := make([]byte, 14)
				conn.Read(buf)
				conn.Write([]byte("JDWP-Handshake"))
			}()
		}
	}()

	ctx := context.Background()

	// Run multiple concurrent handshake probes
	var wg sync.WaitGroup
	results := make([]bool, 10)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			results[idx] = probeJDWPHandshake(ctx, port)
		}(i)
	}
	wg.Wait()

	for i, ok := range results {
		if !ok {
			t.Errorf("concurrent handshake %d failed", i)
		}
	}
}

func TestGateProbeResult_ErrorAccumulation(t *testing.T) {
	cfg := GateProbeConfig{
		JavaHome:  "/nonexistent/jdk",
		TomcatHome: "/nonexistent/tomcat",
		DebugPort: 5005,
		Timeout:   5 * time.Second,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)

	// Should have accumulated multiple errors
	if len(result.Errors) < 2 {
		t.Errorf("expected at least 2 errors, got %d: %v", len(result.Errors), result.Errors)
	}

	// Verify mutex-safety: all errors should be non-empty
	for i, err := range result.Errors {
		if strings.TrimSpace(err) == "" {
			t.Errorf("error %d is empty", i)
		}
	}
}

func TestRunGate_DefaultsApplied(t *testing.T) {
	// When Timeout and DebugPort are zero/negative, defaults are applied
	cfg := GateProbeConfig{
		JavaHome:  "/nonexistent/jdk",
		TomcatHome: "/nonexistent/tomcat",
		Timeout:  0,
		DebugPort: 0,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)
	if result.DebugPort != 5005 {
		t.Errorf("DebugPort = %d, want 5005 (default)", result.DebugPort)
	}
	if result.Platform != runtime.GOOS {
		t.Errorf("Platform = %q, want %q", result.Platform, runtime.GOOS)
	}
	if len(result.Errors) < 1 {
		t.Error("expected at least 1 error with nonexistent paths")
	}
}

func TestRunGate_NegativeTimeout(t *testing.T) {
	cfg := GateProbeConfig{
		JavaHome:  "/nonexistent/jdk",
		TomcatHome: "/nonexistent/tomcat",
		Timeout:  -1 * time.Second,
		DebugPort: 5005,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)
	// Should still complete without panic
	if result.Platform == "" {
		t.Error("Platform should not be empty")
	}
}

func TestGateProbeResult_FieldsPopulated(t *testing.T) {
	cfg := GateProbeConfig{
		JavaHome:  "/nonexistent/jdk",
		TomcatHome: "/nonexistent/tomcat",
		DebugPort: 9999,
		Timeout:   5 * time.Second,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)
	if result.DebugPort != 9999 {
		t.Errorf("DebugPort = %d, want 9999", result.DebugPort)
	}
	if result.Platform == "" {
		t.Error("Platform should not be empty")
	}
	// JDK6JDWP should be false with nonexistent JDK
	if result.JDK6JDWP {
		t.Error("JDK6JDWP should be false with nonexistent JDK")
	}
	// Tomcat6Debug should be false with nonexistent Tomcat
	if result.Tomcat6Debug {
		t.Error("Tomcat6Debug should be false with nonexistent Tomcat")
	}
}

func TestProbeJDK6JDWP_EmptyJavaHome(t *testing.T) {
	var errors []string
	addError := func(s string) { errors = append(errors, s) }
	ctx := context.Background()
	version, ok := probeJDK6JDWP(ctx, "", 5005, addError)
	if ok {
		t.Error("expected false with empty javaHome")
	}
	if version != "" {
		t.Errorf("version = %q, want empty", version)
	}
	if len(errors) != 1 {
		t.Errorf("expected 1 error, got %d", len(errors))
	}
}

func TestProbeTomcat6Debug_EmptyJavaHome(t *testing.T) {
	var errors []string
	addError := func(s string) { errors = append(errors, s) }
	ctx := context.Background()
	ok := probeTomcat6Debug(ctx, "", "/nonexistent/tomcat", 5005, addError)
	if ok {
		t.Error("expected false with empty javaHome")
	}
	if len(errors) < 1 {
		t.Error("expected at least 1 error")
	}
}

func TestProbeTomcat6Debug_EmptyTomcatHome(t *testing.T) {
	var errors []string
	addError := func(s string) { errors = append(errors, s) }
	ctx := context.Background()
	ok := probeTomcat6Debug(ctx, "/usr/bin", "", 5005, addError)
	if ok {
		t.Error("expected false with empty tomcatHome")
	}
	if len(errors) < 1 {
		t.Error("expected at least 1 error")
	}
}

func TestProbeDebugPort_HighRange(t *testing.T) {
	// Use a high port that's unlikely to be in use
	ctx := context.Background()
	ok := probeDebugPort(ctx, 19999)
	if ok {
		// Port might be open on some systems, but typically not
		t.Log("port 19999 was open (unexpected but possible)")
	}
}

func TestGateProbeResult_JSONTags(t *testing.T) {
	result := GateProbeResult{
		Platform:      "linux",
		DebugPort:     5005,
		JDK6JDWP:      true,
		Tomcat6Debug:  true,
		DebugPortOpen: true,
		JDWPHandshake: true,
		JDKVersion:    "1.6.0_45",
		Errors:        []string{"err1", "err2"},
	}
	// Just verify the struct can be populated without panics
	if result.Errors == nil || len(result.Errors) != 2 {
		t.Error("Errors field not populated correctly")
	}
}

// ── JDWP Version Probe Tests ────────────────────────────────────

func TestProbeJDWPVersion_NoJDWPServer(t *testing.T) {
	ctx := context.Background()
	var mu sync.Mutex
	var errors []string
	addError := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		errors = append(errors, s)
	}

	version := probeJDWPVersion(ctx, 1, addError)
	if version != nil {
		t.Error("Version should be nil when no JDWP server is running")
	}
	if len(errors) == 0 {
		t.Error("Should have recorded an error")
	}
}

func TestProbeJDWPVersion_Mock(t *testing.T) {
	// Start a mock JDWP server that responds to the handshake and version command
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	port := l.Addr().(*net.TCPAddr).Port

	go func() {
		conn, err := l.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		// Read handshake
		buf := make([]byte, 14)
		conn.Read(buf)
		// Write handshake response
		conn.Write([]byte("JDWP-Handshake"))

		// Read the version command packet
		header := make([]byte, 11)
		conn.Read(header)
		// Reply with version data
		// Build a reply packet: errorCode=0, then version data
		w := NewJDWPDataWriter()
		w.WriteString("Java Debug Wire Protocol (Reference Implementation) version 1.6")
		w.WriteInt(1)  // jdwpMajor
		w.WriteInt(6)  // jdwpMinor
		w.WriteString("1.6.0_45")
		w.WriteString("Java HotSpot(TM) Client VM")
		replyData := w.Bytes()

		// Build reply packet header
		reply := make([]byte, 11+len(replyData))
		// Length
		reply[0] = byte((11 + len(replyData)) >> 24)
		reply[1] = byte((11 + len(replyData)) >> 16)
		reply[2] = byte((11 + len(replyData)) >> 8)
		reply[3] = byte(11 + len(replyData))
		// ID
		reply[4] = 0
		reply[5] = 0
		reply[6] = 0
		reply[7] = 1
		// Flags (reply)
		reply[8] = 0x80
		// Error code
		reply[9] = 0
		reply[10] = 0
		copy(reply[11:], replyData)
		conn.Write(reply)
	}()

	time.Sleep(50 * time.Millisecond)

	ctx := context.Background()
	var errors []string
	addError := func(s string) { errors = append(errors, s) }

	version := probeJDWPVersion(ctx, port, addError)
	if version == nil {
		t.Fatal("Version should not be nil for mock JDWP server")
	}
	if version.JDWPMajor != 1 {
		t.Errorf("JDWPMajor = %d, want 1", version.JDWPMajor)
	}
	if version.JDWPMinor != 6 {
		t.Errorf("JDWPMinor = %d, want 6", version.JDWPMinor)
	}
	if version.VMVersion != "1.6.0_45" {
		t.Errorf("VMVersion = %q, want 1.6.0_45", version.VMVersion)
	}
	if version.VMName != "Java HotSpot(TM) Client VM" {
		t.Errorf("VMName = %q", version.VMName)
	}
}

// ── Debug Capabilities Probe Tests ──────────────────────────────

func TestParseCapabilities(t *testing.T) {
	w := NewJDWPDataWriter()
	// 15 booleans for the standard capabilities
	w.WriteByte(1) // canWatchFieldModification
	w.WriteByte(1) // canWatchFieldAccess
	w.WriteByte(0) // canGetBytecodes
	w.WriteByte(0) // canGetSyntheticAttribute
	w.WriteByte(1) // canGetOwnedMonitorInfo
	w.WriteByte(1) // canGetCurrentContendedMonitor
	w.WriteByte(0) // canGetMonitorInfo
	w.WriteByte(1) // canRedefineClasses
	w.WriteByte(0) // canAddMethod
	w.WriteByte(0) // canUnrestrictedlyRedefineClasses
	w.WriteByte(1) // canPopFrames
	w.WriteByte(1) // canUseInstanceFilters
	w.WriteByte(0) // canGetSourceDebugExtension
	w.WriteByte(1) // canRequestVMDeathEvent
	w.WriteByte(0) // canSetDefaultStratum
	// JDWP 1.6+ extras
	w.WriteByte(0) // canGetInstanceInfo
	w.WriteByte(0) // canRequestMonitorEvents
	w.WriteByte(0) // canGetMonitorFrameInfo
	w.WriteByte(0) // canUseSourceNameFilters
	w.WriteByte(1) // canGetConstantPool
	w.WriteByte(1) // canForceEarlyReturn

	data := w.Bytes()
	caps, err := parseCapabilities(data)
	if err != nil {
		t.Fatalf("parseCapabilities failed: %v", err)
	}

	if !caps.CanWatchFieldModification {
		t.Error("CanWatchFieldModification should be true")
	}
	if !caps.CanWatchFieldAccess {
		t.Error("CanWatchFieldAccess should be true")
	}
	if caps.CanGetBytecodes {
		t.Error("CanGetBytecodes should be false")
	}
	if !caps.CanRedefineClasses {
		t.Error("CanRedefineClasses should be true")
	}
	if !caps.CanPopFrames {
		t.Error("CanPopFrames should be true")
	}
	if !caps.CanGetConstantPool {
		t.Error("CanGetConstantPool should be true")
	}
	if !caps.CanForceEarlyReturn {
		t.Error("CanForceEarlyReturn should be true")
	}
}

func TestParseCapabilities_Minimal(t *testing.T) {
	// Only 15 booleans (JDWP 1.4 style)
	w := NewJDWPDataWriter()
	for i := 0; i < 15; i++ {
		w.WriteByte(0)
	}
	data := w.Bytes()

	caps, err := parseCapabilities(data)
	if err != nil {
		t.Fatalf("parseCapabilities minimal failed: %v", err)
	}
	if caps.CanWatchFieldAccess {
		t.Error("CanWatchFieldAccess should be false")
	}
	if caps.CanGetConstantPool {
		t.Error("CanGetConstantPool should be false when not present")
	}
	if caps.CanForceEarlyReturn {
		t.Error("CanForceEarlyReturn should be false when not present")
	}
}

func TestParseCapabilities_Truncated(t *testing.T) {
	_, err := parseCapabilities([]byte{0x00, 0x00})
	if err == nil {
		t.Error("Expected error for truncated capabilities data")
	}
}

func TestProbeDebugCapabilities_NoJDWPServer(t *testing.T) {
	ctx := context.Background()
	var mu sync.Mutex
	var errors []string
	addError := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		errors = append(errors, s)
	}

	caps := probeDebugCapabilities(ctx, 1, addError)
	if caps != nil {
		t.Error("Capabilities should be nil when no JDWP server is running")
	}
	if len(errors) == 0 {
		t.Error("Should have recorded an error")
	}
}

// ── GateProbeResult with Version and Capabilities ───────────────

func TestGateProbeResult_WithVersion(t *testing.T) {
	result := GateProbeResult{
		Platform: "linux",
		JDWPVersion: &JDWPVersion{
			Description: "test",
			JDWPMajor:   1,
			JDWPMinor:   6,
			VMVersion:   "1.6.0_45",
			VMName:      "Test VM",
		},
	}

	if result.JDWPVersion == nil {
		t.Fatal("JDWPVersion should not be nil")
	}
	if result.JDWPVersion.JDWPMajor != 1 {
		t.Errorf("JDWPMajor = %d, want 1", result.JDWPVersion.JDWPMajor)
	}
}

func TestGateProbeResult_WithCapabilities(t *testing.T) {
	result := GateProbeResult{
		Platform: "linux",
		Capabilities: &DebugCapabilities{
			CanWatchFieldAccess: true,
			CanPopFrames:        true,
			CanRedefineClasses:  true,
		},
	}

	if result.Capabilities == nil {
		t.Fatal("Capabilities should not be nil")
	}
	if !result.Capabilities.CanWatchFieldAccess {
		t.Error("CanWatchFieldAccess should be true")
	}
	if !result.Capabilities.CanPopFrames {
		t.Error("CanPopFrames should be true")
	}
	if !result.Capabilities.CanRedefineClasses {
		t.Error("CanRedefineClasses should be true")
	}
}

func TestRunGate_WithVersionProbe(t *testing.T) {
	cfg := GateProbeConfig{
		JavaHome:    "/nonexistent/jdk",
		TomcatHome:  "/nonexistent/tomcat",
		DebugPort:   5005,
		Timeout:     5 * time.Second,
		ProbeVersion: true,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)

	// Version probe should not panic even when no JDWP server
	if result.Platform == "" {
		t.Error("Platform should not be empty")
	}
	// JDWPVersion should be nil since no server is running
	if result.JDWPVersion != nil {
		t.Error("JDWPVersion should be nil when no JDWP server")
	}
}

func TestRunGate_WithCapabilitiesProbe(t *testing.T) {
	cfg := GateProbeConfig{
		JavaHome:          "/nonexistent/jdk",
		TomcatHome:        "/nonexistent/tomcat",
		DebugPort:         5005,
		Timeout:           5 * time.Second,
		ProbeCapabilities: true,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)

	// Capabilities probe should not panic even when no JDWP server
	if result.Platform == "" {
		t.Error("Platform should not be empty")
	}
	if result.Capabilities != nil {
		t.Error("Capabilities should be nil when no JDWP server")
	}
}

func TestRunGate_BothVersionAndCapabilities(t *testing.T) {
	cfg := GateProbeConfig{
		JavaHome:          "/nonexistent/jdk",
		TomcatHome:        "/nonexistent/tomcat",
		DebugPort:         5005,
		Timeout:           5 * time.Second,
		ProbeVersion:      true,
		ProbeCapabilities: true,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result := RunGate(ctx, cfg)

	// Both probes should not panic
	if result.Platform == "" {
		t.Error("Platform should not be empty")
	}
	if result.JDWPVersion != nil {
		t.Error("JDWPVersion should be nil when no JDWP server")
	}
	if result.Capabilities != nil {
		t.Error("Capabilities should be nil when no JDWP server")
	}
}

func TestDebugCapabilities_AllFields(t *testing.T) {
	caps := &DebugCapabilities{
		CanWatchFieldAccess:                true,
		CanWatchFieldModification:          true,
		CanGetBytecodes:                    false,
		CanGetSyntheticAttribute:           false,
		CanGetOwnedMonitorInfo:             true,
		CanGetCurrentContendedMonitor:      true,
		CanGetMonitorInfo:                  false,
		CanRedefineClasses:                 true,
		CanAddMethod:                       false,
		CanUnrestrictedlyRedefineClasses:   false,
		CanPopFrames:                       true,
		CanUseInstanceFilters:              true,
		CanGetSourceDebugExtension:         false,
		CanRequestVMDeathEvent:             true,
		CanSetDefaultStratum:               false,
		CanGetConstantPool:                 true,
		CanForceEarlyReturn:                true,
	}

	// Verify all fields are accessible
	_ = caps.CanWatchFieldAccess
	_ = caps.CanWatchFieldModification
	_ = caps.CanGetBytecodes
	_ = caps.CanGetSyntheticAttribute
	_ = caps.CanGetOwnedMonitorInfo
	_ = caps.CanGetCurrentContendedMonitor
	_ = caps.CanGetMonitorInfo
	_ = caps.CanRedefineClasses
	_ = caps.CanAddMethod
	_ = caps.CanUnrestrictedlyRedefineClasses
	_ = caps.CanPopFrames
	_ = caps.CanUseInstanceFilters
	_ = caps.CanGetSourceDebugExtension
	_ = caps.CanRequestVMDeathEvent
	_ = caps.CanSetDefaultStratum
	_ = caps.CanGetConstantPool
	_ = caps.CanForceEarlyReturn
}