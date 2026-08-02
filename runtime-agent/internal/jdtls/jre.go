package jdtls

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

// JDTLSRequiredJREMajor is the minimum host JRE major version
// needed to run the pinned JDT LS distribution. JDT LS 1.55.0
// declares Require-Capability: osgi.ee; filter:="(&(osgi.ee=JavaSE)(version=21))"
// and exits with code 13 when launched on JDK 17.
const JDTLSRequiredJREMajor = 21

var jreVersionRE = regexp.MustCompile(`version\s+"([^"]+)"`)

// resolveHostJRE picks a JDK/JRE home suitable for spawning JDT LS.
//
// Priority:
//  1. Explicit manager path (constructor / SetJREPath), if major >= required
//  2. KAIRO_JDT_LS_JRE
//  3. KAIRO_JRE17_HOME (legacy name; may point at JDK 21+)
//  4. bundled/jdk21 under KAIRO_BUNDLED_DIR or manager bundled dir
//  5. KAIRO_JDK_HOME / JAVA_HOME when major >= required
//  6. Common install locations with major >= required
//
// Candidates below JDTLSRequiredJREMajor are skipped so a stale
// KAIRO_JRE17_HOME=JDK17 no longer silently produces exit-13 loops.
func resolveHostJRE(configured string, bundledDir string) (string, error) {
	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "java.exe"
	}

	tried := make([]string, 0, 8)
	tryHome := func(home string) (string, bool) {
		home = strings.TrimSpace(home)
		if home == "" {
			return "", false
		}
		bin := filepath.Join(home, "bin", javaExe)
		tried = append(tried, bin)
		major, ok := probeJavaMajor(bin)
		if !ok || major < JDTLSRequiredJREMajor {
			return "", false
		}
		return home, true
	}

	if home, ok := tryHome(configured); ok {
		return home, nil
	}
	if home, ok := tryHome(os.Getenv("KAIRO_JDT_LS_JRE")); ok {
		return home, nil
	}
	if home, ok := tryHome(os.Getenv("KAIRO_JRE17_HOME")); ok {
		return home, nil
	}

	// Bundled JDK 21 (optional product layout).
	candidates := []string{
		filepath.Join(bundledDir, "jdk21"),
		filepath.Join(os.Getenv("KAIRO_BUNDLED_DIR"), "jdk21"),
	}
	for _, c := range candidates {
		if home, ok := tryHome(c); ok {
			return home, nil
		}
	}

	if home, ok := tryHome(os.Getenv("KAIRO_JDK_HOME")); ok {
		return home, nil
	}
	if home, ok := tryHome(os.Getenv("JAVA_HOME")); ok {
		return home, nil
	}

	for _, p := range commonJDTLSJREPathsFn(javaExe) {
		tried = append(tried, p)
		major, ok := probeJavaMajor(p)
		if !ok || major < JDTLSRequiredJREMajor {
			continue
		}
		return filepath.Dir(filepath.Dir(p)), nil
	}

	return "", fmt.Errorf(
		"JDT LS %s requires a JDK/JRE %d+ host runtime (osgi.ee JavaSE %d); set KAIRO_JDT_LS_JRE to a JDK %d+ install (project JAVA_HOME may stay on 17). searched=%v",
		JDTLSVersion, JDTLSRequiredJREMajor, JDTLSRequiredJREMajor, JDTLSRequiredJREMajor, tried,
	)
}

func probeJavaMajor(javaBin string) (int, bool) {
	if _, err := os.Stat(javaBin); err != nil {
		return 0, false
	}
	cmd := exec.Command(javaBin, "-version")
	out, err := cmd.CombinedOutput()
	if err == nil {
		m := jreVersionRE.FindStringSubmatch(string(out))
		if len(m) >= 2 {
			return parseJavaMajor(m[1]), true
		}
	}
	// Unit tests stub a non-executable java binary; allow an
	// explicit assumed major so BuildLaunchDescriptor can be
	// exercised without a real JDK 21 on the builder.
	if raw := strings.TrimSpace(os.Getenv("KAIRO_JDTLS_ASSUME_JRE_MAJOR")); raw != "" {
		if n, convErr := strconv.Atoi(raw); convErr == nil && n > 0 {
			return n, true
		}
	}
	return 0, false
}

func parseJavaMajor(version string) int {
	if strings.HasPrefix(version, "1.") {
		parts := strings.Split(version, ".")
		if len(parts) >= 2 {
			if v, err := strconv.Atoi(parts[1]); err == nil {
				return v
			}
		}
		return 0
	}
	parts := strings.Split(version, ".")
	if len(parts) >= 1 {
		if v, err := strconv.Atoi(parts[0]); err == nil {
			return v
		}
	}
	return 0
}

// commonJDTLSJREPathsFn is overridable in tests so machines with a
// real JDK 21 installed do not mask "no suitable JRE" cases.
var commonJDTLSJREPathsFn = commonJDTLSJREPaths

func commonJDTLSJREPaths(javaExe string) []string {
	switch runtime.GOOS {
	case "windows":
		roots := []string{
			`C:\Program Files\Eclipse Adoptium`,
			`C:\Program Files\Java`,
			`C:\Program Files\Microsoft`,
			`E:\Tools`,
		}
		var out []string
		for _, root := range roots {
			entries, err := os.ReadDir(root)
			if err != nil {
				continue
			}
			for _, e := range entries {
				if !e.IsDir() {
					continue
				}
				name := strings.ToLower(e.Name())
				// Skip obvious JDK 8/11/17 trees; probe anything that looks like 21+.
				if strings.Contains(name, "jdk-8") || strings.Contains(name, "jdk-11") ||
					strings.Contains(name, "jdk-17") || name == "jdk17" {
					continue
				}
				if !(strings.Contains(name, "jdk") || strings.Contains(name, "jre") ||
					strings.Contains(name, "temurin") || strings.Contains(name, "openjdk")) {
					continue
				}
				out = append(out, filepath.Join(root, e.Name(), "bin", javaExe))
			}
		}
		return out
	case "darwin":
		return []string{
			"/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/" + javaExe,
			"/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/" + javaExe,
			"/opt/homebrew/opt/openjdk@21/bin/" + javaExe,
			"/usr/local/opt/openjdk@21/bin/" + javaExe,
		}
	default:
		return []string{
			"/usr/lib/jvm/java-21-openjdk/bin/" + javaExe,
			"/usr/lib/jvm/java-21-openjdk-amd64/bin/" + javaExe,
			"/usr/lib/jvm/temurin-21-jdk/bin/" + javaExe,
		}
	}
}
