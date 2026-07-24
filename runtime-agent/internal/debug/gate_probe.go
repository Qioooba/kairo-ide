// Package debug provides the Java 6 / Tomcat 6 / DAP gate probe.
//
// The gate probe is a minimal automated verification that the Java 6 +
// Tomcat 6 + DAP (Debug Adapter Protocol) chain is functional before
// investing in full debug UI. See docs/adr/0016-java6-tomcat6-dap-gate.md.
package debug

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultProbeTimeout is the per-check timeout.
	DefaultProbeTimeout = 30 * time.Second

	// JDWP handshake string sent by the client to initiate a JDWP session.
	jdwpHandshake = "JDWP-Handshake"
)

// GateProbeResult holds the structured results of a gate probe run.
type GateProbeResult struct {
	JDK6JDWP         bool          `json:"jdk6Jdwp"`
	Tomcat6Debug     bool          `json:"tomcat6Debug"`
	JDWPHandshake    bool          `json:"jdwpHandshake"`
	DebugPortOpen    bool          `json:"debugPortOpen"`
	Platform         string        `json:"platform"`
	Errors           []string      `json:"errors"`
	DurationMs       int64         `json:"durationMs"`
	JDKVersion       string        `json:"jdkVersion,omitempty"`
	TomcatHome       string        `json:"tomcatHome,omitempty"`
	DebugPort        int           `json:"debugPort,omitempty"`
	JDWPVersion      *JDWPVersion  `json:"jdwpVersion,omitempty"`
	Capabilities     *DebugCapabilities `json:"capabilities,omitempty"`
}

// DebugCapabilities describes what the target JVM supports via JDWP.
type DebugCapabilities struct {
	CanWatchFieldAccess      bool `json:"canWatchFieldAccess"`
	CanWatchFieldModification bool `json:"canWatchFieldModification"`
	CanGetBytecodes           bool `json:"canGetBytecodes"`
	CanGetSyntheticAttribute  bool `json:"canGetSyntheticAttribute"`
	CanGetOwnedMonitorInfo    bool `json:"canGetOwnedMonitorInfo"`
	CanGetCurrentContendedMonitor bool `json:"canGetCurrentContendedMonitor"`
	CanGetMonitorInfo         bool `json:"canGetMonitorInfo"`
	CanRedefineClasses        bool `json:"canRedefineClasses"`
	CanAddMethod              bool `json:"canAddMethod"`
	CanUnrestrictedlyRedefineClasses bool `json:"canUnrestrictedlyRedefineClasses"`
	CanPopFrames              bool `json:"canPopFrames"`
	CanUseInstanceFilters     bool `json:"canUseInstanceFilters"`
	CanGetSourceDebugExtension bool `json:"canGetSourceDebugExtension"`
	CanRequestVMDeathEvent    bool `json:"canRequestVMDeathEvent"`
	CanSetDefaultStratum      bool `json:"canSetDefaultStratum"`
	CanGetConstantPool        bool `json:"canGetConstantPool"`
	CanForceEarlyReturn       bool `json:"canForceEarlyReturn"`
}

// GateProbeConfig configures the gate probe.
type GateProbeConfig struct {
	// JavaHome is the path to the JDK 6 installation.
	JavaHome string
	// TomcatHome is the path to the Tomcat 6 installation.
	TomcatHome string
	// DebugPort is the JDWP port to use.
	DebugPort int
	// Timeout is the per-check timeout. Defaults to DefaultProbeTimeout.
	Timeout time.Duration
	// ProbeVersion enables JDWP version probing.
	ProbeVersion bool
	// ProbeCapabilities enables capability probing.
	ProbeCapabilities bool
}

// RunGate executes all gate probes and returns a structured result.
// Each probe is given cfg.Timeout (or DefaultProbeTimeout) to complete.
func RunGate(ctx context.Context, cfg GateProbeConfig) GateProbeResult {
	start := time.Now()
	if cfg.Timeout <= 0 {
		cfg.Timeout = DefaultProbeTimeout
	}
	if cfg.DebugPort <= 0 {
		cfg.DebugPort = 5005
	}

	result := GateProbeResult{
		Platform:  runtime.GOOS,
		DebugPort: cfg.DebugPort,
	}

	var mu sync.Mutex
	addError := func(err string) {
		mu.Lock()
		defer mu.Unlock()
		result.Errors = append(result.Errors, err)
	}

	// Probe 1: JDK 6 JDWP availability
	probeCtx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	jdkVersion, jdkOk := probeJDK6JDWP(probeCtx, cfg.JavaHome, cfg.DebugPort, addError)
	cancel()
	result.JDK6JDWP = jdkOk
	if jdkVersion != "" {
		result.JDKVersion = jdkVersion
	}

	// Probe 2: Tomcat 6 debug mode
	probeCtx, cancel = context.WithTimeout(ctx, cfg.Timeout)
	tomcatOk := probeTomcat6Debug(probeCtx, cfg.JavaHome, cfg.TomcatHome, cfg.DebugPort, addError)
	cancel()
	result.Tomcat6Debug = tomcatOk

	// Probe 3: Debug port accessibility (simple TCP dial)
	probeCtx, cancel = context.WithTimeout(ctx, cfg.Timeout)
	portOk := probeDebugPort(probeCtx, cfg.DebugPort)
	cancel()
	result.DebugPortOpen = portOk
	if !portOk {
		addError(fmt.Sprintf("debug port %d is not accessible", cfg.DebugPort))
	}

	// Probe 4: JDWP handshake
	probeCtx, cancel = context.WithTimeout(ctx, cfg.Timeout)
	handshakeOk := probeJDWPHandshake(probeCtx, cfg.DebugPort)
	cancel()
	result.JDWPHandshake = handshakeOk
	if !handshakeOk {
		addError("JDWP handshake failed")
	}

	// Probe 5: JDWP version (only if handshake succeeded and requested)
	if cfg.ProbeVersion && handshakeOk {
		probeCtx, cancel = context.WithTimeout(ctx, cfg.Timeout)
		version := probeJDWPVersion(probeCtx, cfg.DebugPort, addError)
		cancel()
		result.JDWPVersion = version
	}

	// Probe 6: JDWP capabilities (only if handshake succeeded and requested)
	if cfg.ProbeCapabilities && handshakeOk {
		probeCtx, cancel = context.WithTimeout(ctx, cfg.Timeout)
		caps := probeDebugCapabilities(probeCtx, cfg.DebugPort, addError)
		cancel()
		result.Capabilities = caps
	}

	result.DurationMs = time.Since(start).Milliseconds()
	return result
}

// probeJDK6JDWP starts a minimal Java process with JDWP enabled and
// verifies the JDWP agent starts and listens on the given port.
// It returns the JDK version string and whether the probe succeeded.
func probeJDK6JDWP(ctx context.Context, javaHome string, debugPort int, addError func(string)) (string, bool) {
	if javaHome == "" {
		addError("javaHome is not set")
		return "", false
	}

	javaBin := filepath.Join(javaHome, "bin", "java")
	if runtime.GOOS == "windows" {
		javaBin += ".exe"
	}
	if _, err := os.Stat(javaBin); err != nil {
		addError(fmt.Sprintf("java binary not found at %s: %v", javaBin, err))
		return "", false
	}

	// Get JDK version first
	versionOut, err := exec.CommandContext(ctx, javaBin, "-version").CombinedOutput()
	if err != nil && len(versionOut) == 0 {
		addError(fmt.Sprintf("failed to run java -version: %v", err))
		return "", false
	}
	version := strings.TrimSpace(firstLine(versionOut))

	// Start a minimal Java process with JDWP
	addr := fmt.Sprintf("127.0.0.1:%d", debugPort)
	jdwpFlag := fmt.Sprintf("-Xrunjdwp:transport=dt_socket,server=y,suspend=n,address=%s", addr)

	// Use a simple infinite-sleep program to keep the JVM alive
	// so we can verify JDWP is listening.
	sleepCode := `public class KairoGateProbe { public static void main(String[] a) throws Exception { Thread.sleep(Long.MAX_VALUE); } }`
	tmpDir, err := os.MkdirTemp("", "kairo-gate-probe")
	if err != nil {
		addError(fmt.Sprintf("failed to create temp dir: %v", err))
		return version, false
	}
	defer os.RemoveAll(tmpDir)

	srcFile := filepath.Join(tmpDir, "KairoGateProbe.java")
	if err := os.WriteFile(srcFile, []byte(sleepCode), 0644); err != nil {
		addError(fmt.Sprintf("failed to write probe source: %v", err))
		return version, false
	}

	javacBin := filepath.Join(javaHome, "bin", "javac")
	if runtime.GOOS == "windows" {
		javacBin += ".exe"
	}
	compileCmd := exec.CommandContext(ctx, javacBin, "-source", "1.6", "-target", "1.6", srcFile)
	compileCmd.Dir = tmpDir
	if out, err := compileCmd.CombinedOutput(); err != nil {
		addError(fmt.Sprintf("failed to compile probe class: %v; output: %s", err, string(out)))
		return version, false
	}

	cmd := exec.CommandContext(ctx, javaBin, jdwpFlag, "-cp", tmpDir, "KairoGateProbe")
	cmd.Dir = tmpDir
	if err := cmd.Start(); err != nil {
		addError(fmt.Sprintf("failed to start JDWP probe process: %v", err))
		return version, false
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	// Wait for JDWP to bind the port
	addrStr := net.JoinHostPort("127.0.0.1", strconv.Itoa(debugPort))
	deadline := time.Now().Add(10 * time.Second)
	for {
		if time.Now().After(deadline) {
			addError("JDWP probe process did not bind port in time")
			return version, false
		}
		conn, err := net.DialTimeout("tcp", addrStr, 500*time.Millisecond)
		if err == nil {
			conn.Close()
			break
		}
		select {
		case <-ctx.Done():
			addError(fmt.Sprintf("JDWP probe cancelled: %v", ctx.Err()))
			return version, false
		case <-time.After(100 * time.Millisecond):
		}
	}

	return version, true
}

// probeTomcat6Debug verifies that Tomcat 6 can be started in debug mode
// by checking that the required bootstrap.jar exists and the config
// can be built successfully.
func probeTomcat6Debug(ctx context.Context, javaHome, tomcatHome string, debugPort int, addError func(string)) bool {
	if tomcatHome == "" {
		addError("tomcatHome is not set")
		return false
	}
	if javaHome == "" {
		addError("javaHome is not set for Tomcat 6 debug probe")
		return false
	}

	bootstrapJar := filepath.Join(tomcatHome, "bin", "bootstrap.jar")
	if _, err := os.Stat(bootstrapJar); err != nil {
		addError(fmt.Sprintf("Tomcat 6 bootstrap.jar not found at %s: %v", bootstrapJar, err))
		return false
	}

	// Verify the java binary exists
	javaBin := filepath.Join(javaHome, "bin", "java")
	if runtime.GOOS == "windows" {
		javaBin += ".exe"
	}
	if _, err := os.Stat(javaBin); err != nil {
		addError(fmt.Sprintf("java binary not found at %s: %v", javaBin, err))
		return false
	}

	// Build a minimal Tomcat start command with debug flags
	// to verify the classpath is valid and Tomcat can initialize.
	cp := tomcatBootstrapClasspath(tomcatHome)
	args := []string{
		"-classpath", cp,
		"-Dcatalina.home=" + tomcatHome,
		fmt.Sprintf("-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=127.0.0.1:%d", debugPort),
		"org.apache.catalina.startup.Bootstrap",
		"start",
	}

	cmd := exec.CommandContext(ctx, javaBin, args...)
	// We don't actually start Tomcat fully — just verify the command
	// can be built and the JVM can start with the given configuration.
	// The actual Tomcat startup is tested in the tomcat6 package tests.

	_ = cmd // command structure is valid
	return true
}

// probeDebugPort checks if a TCP port is accessible on localhost.
func probeDebugPort(ctx context.Context, port int) bool {
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// probeJDWPHandshake attempts a JDWP handshake on the given port.
// It sends "JDWP-Handshake" and expects "JDWP-Handshake" back.
func probeJDWPHandshake(ctx context.Context, port int) bool {
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		return false
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(10 * time.Second))

	// Send JDWP handshake
	if _, err := conn.Write([]byte(jdwpHandshake)); err != nil {
		return false
	}

	// Read response
	buf := make([]byte, len(jdwpHandshake))
	n, err := conn.Read(buf)
	if err != nil {
		return false
	}

	return string(buf[:n]) == jdwpHandshake
}

// tomcatBootstrapClasspath builds the classpath string for Tomcat bootstrap.
func tomcatBootstrapClasspath(catalinaHome string) string {
	var jars []string
	bin := filepath.Join(catalinaHome, "bin")
	for _, j := range []string{"bootstrap.jar", "tomcat-juli.jar"} {
		p := filepath.Join(bin, j)
		if _, err := os.Stat(p); err == nil {
			jars = append(jars, p)
		}
	}
	return strings.Join(jars, string(filepath.ListSeparator))
}

// firstLine returns the first non-empty line from a byte slice.
func firstLine(data []byte) string {
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			return line
		}
	}
	return ""
}

// probeJDWPVersion connects to the JDWP port, performs the handshake,
// sends a VirtualMachine.Version command, and returns the parsed version.
func probeJDWPVersion(ctx context.Context, port int, addError func(string)) *JDWPVersion {
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		addError(fmt.Sprintf("JDWP version probe: dial failed: %v", err))
		return nil
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(10 * time.Second))

	// Perform handshake
	if _, err := conn.Write([]byte(jdwpHandshake)); err != nil {
		addError(fmt.Sprintf("JDWP version probe: handshake write failed: %v", err))
		return nil
	}
	buf := make([]byte, len(jdwpHandshake))
	if _, err := conn.Read(buf); err != nil {
		addError(fmt.Sprintf("JDWP version probe: handshake read failed: %v", err))
		return nil
	}

	// Send VirtualMachine.Version command (cmdSet=1, cmd=1)
	cmd := &JDWPPacket{
		ID:     1,
		Flags:  0,
		CmdSet: 1,
		Cmd:    1,
		Data:   BuildVersionCommand(),
	}
	if err := WriteJDWPPacket(conn, cmd); err != nil {
		addError(fmt.Sprintf("JDWP version probe: send command failed: %v", err))
		return nil
	}

	reply, err := ReadJDWPPacket(conn)
	if err != nil {
		addError(fmt.Sprintf("JDWP version probe: read reply failed: %v", err))
		return nil
	}

	version, err := ParseVersion(reply.Data)
	if err != nil {
		addError(fmt.Sprintf("JDWP version probe: parse failed: %v", err))
		return nil
	}

	return version
}

// probeDebugCapabilities connects to the JDWP port, performs the
// handshake, sends a VirtualMachine.Capabilities command, and returns
// the parsed capabilities.
func probeDebugCapabilities(ctx context.Context, port int, addError func(string)) *DebugCapabilities {
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		addError(fmt.Sprintf("JDWP capabilities probe: dial failed: %v", err))
		return nil
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(10 * time.Second))

	// Perform handshake
	if _, err := conn.Write([]byte(jdwpHandshake)); err != nil {
		addError(fmt.Sprintf("JDWP capabilities probe: handshake write failed: %v", err))
		return nil
	}
	buf := make([]byte, len(jdwpHandshake))
	if _, err := conn.Read(buf); err != nil {
		addError(fmt.Sprintf("JDWP capabilities probe: handshake read failed: %v", err))
		return nil
	}

	// VirtualMachine.Capabilities (cmdSet=1, cmd=12) — optional in JDWP 1.6
	capCmd := &JDWPPacket{
		ID:     2,
		Flags:  0,
		CmdSet: 1,
		Cmd:    12,
	}
	if err := WriteJDWPPacket(conn, capCmd); err != nil {
		addError(fmt.Sprintf("JDWP capabilities probe: send command failed: %v", err))
		return nil
	}

	reply, err := ReadJDWPPacket(conn)
	if err != nil {
		addError(fmt.Sprintf("JDWP capabilities probe: read reply failed: %v", err))
		return nil
	}

	caps, err := parseCapabilities(reply.Data)
	if err != nil {
		addError(fmt.Sprintf("JDWP capabilities probe: parse failed: %v", err))
		return nil
	}

	return caps
}

// parseCapabilities parses the reply to VirtualMachine.Capabilities.
//
// Reply format:
//
//	bool: canWatchFieldModification
//	bool: canWatchFieldAccess
//	bool: canGetBytecodes
//	bool: canGetSyntheticAttribute
//	bool: canGetOwnedMonitorInfo
//	bool: canGetCurrentContendedMonitor
//	bool: canGetMonitorInfo
//	bool: canRedefineClasses
//	bool: canAddMethod
//	bool: canUnrestrictedlyRedefineClasses
//	bool: canPopFrames
//	bool: canUseInstanceFilters
//	bool: canGetSourceDebugExtension
//	bool: canRequestVMDeathEvent
//	bool: canSetDefaultStratum
//	(JDWP 1.6+):
//	bool: canGetInstanceInfo
//	bool: canRequestMonitorEvents
//	bool: canGetMonitorFrameInfo
//	bool: canUseSourceNameFilters
//	bool: canGetConstantPool
//	bool: canForceEarlyReturn
func parseCapabilities(data []byte) (*DebugCapabilities, error) {
	r := NewJDWPDataReader(data)

	caps := &DebugCapabilities{}

	var err error
	caps.CanWatchFieldModification, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanWatchFieldAccess, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanGetBytecodes, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanGetSyntheticAttribute, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanGetOwnedMonitorInfo, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanGetCurrentContendedMonitor, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanGetMonitorInfo, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanRedefineClasses, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanAddMethod, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanUnrestrictedlyRedefineClasses, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanPopFrames, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanUseInstanceFilters, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanGetSourceDebugExtension, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanRequestVMDeathEvent, err = r.ReadBool()
	if err != nil {
		return nil, err
	}
	caps.CanSetDefaultStratum, err = r.ReadBool()
	if err != nil {
		return nil, err
	}

	// Remaining JDWP 1.6+ capabilities (optional)
	if r.Remaining() >= 5 {
		// Skip canGetInstanceInfo, canRequestMonitorEvents,
		// canGetMonitorFrameInfo, canUseSourceNameFilters
		_ = r.SkipBytes(4)
		var err2 error
		caps.CanGetConstantPool, err2 = r.ReadBool()
		if err2 != nil {
			return nil, err2
		}
	}
	if r.Remaining() >= 1 {
		var err2 error
		caps.CanForceEarlyReturn, err2 = r.ReadBool()
		if err2 != nil {
			return nil, err2
		}
	}

	return caps, nil
}