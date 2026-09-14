// Package jdkmanager detects and manages the host JDK used by the
// Kairo JDI Debug Bridge. The bridge requires JDK 17+ to run its
// JDI-to-DAP translation, while the target (debuggee) JVM may be
// JDK 6 running inside Tomcat 6.
package jdkmanager

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

// HostJDK represents a detected JDK installation.
type HostJDK struct {
	Path    string `json:"path"`    // Path to java executable
	Home    string `json:"home"`    // JAVA_HOME equivalent
	Version string `json:"version"` // e.g., "17.0.9"
	Major   int    `json:"major"`   // e.g., 17
}

// Status represents the host JDK availability status.
type Status struct {
	Available   bool     `json:"available"`
	JDK         *HostJDK `json:"jdk,omitempty"`
	Message     string   `json:"message,omitempty"`
	SearchPaths []string `json:"searchPaths"`
}

// Manager detects and provides info about the host JDK.
type Manager struct {
	BundledDir string // Path to bundled/ directory containing jdk17/
}

// NewManager creates a new JDK Manager.
func NewManager(bundledDir string) *Manager {
	return &Manager{BundledDir: bundledDir}
}

// Detect finds the best available JDK 17+ on the system.
// Priority: KAIRO_JDK_HOME > host-jdk.json (Electron persist) >
// bundled/jdk21/jdk17 > KAIRO_JDT_LS_JRE > JAVA_HOME > PATH
func (m *Manager) Detect() Status {
	searchPaths := make([]string, 0)
	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "java.exe"
	}

	// 1. KAIRO_JDK_HOME environment variable (explicit override)
	if jdkHome := os.Getenv("KAIRO_JDK_HOME"); jdkHome != "" {
		homeJava := filepath.Join(jdkHome, "bin", javaExe)
		searchPaths = append(searchPaths, homeJava)
		if jdk, ok := checkJava(homeJava); ok && jdk.Major >= 17 {
			return Status{Available: true, JDK: jdk, SearchPaths: searchPaths}
		}
	}

	// 1b. Persisted Electron host JDK (userData/host-jdk.json)
	for _, persistedHome := range loadPersistedJDKHomes() {
		homeJava := filepath.Join(persistedHome, "bin", javaExe)
		searchPaths = append(searchPaths, homeJava)
		if jdk, ok := checkJava(homeJava); ok && jdk.Major >= 17 {
			return Status{Available: true, JDK: jdk, SearchPaths: searchPaths}
		}
	}

	// 2. Bundled JDK (prefer 21 when packaged, fall back to 17)
	for _, name := range []string{"jdk21", "jdk17"} {
		bundledJava := filepath.Join(m.BundledDir, name, "bin", javaExe)
		searchPaths = append(searchPaths, bundledJava)
		if jdk, ok := checkJava(bundledJava); ok && jdk.Major >= 17 {
			return Status{Available: true, JDK: jdk, SearchPaths: searchPaths}
		}
	}

	// 3. KAIRO_JDT_LS_JRE environment variable
	if jre := os.Getenv("KAIRO_JDT_LS_JRE"); jre != "" {
		jreJava := filepath.Join(jre, "bin", javaExe)
		searchPaths = append(searchPaths, jreJava)
		if jdk, ok := checkJava(jreJava); ok && jdk.Major >= 17 {
			return Status{Available: true, JDK: jdk, SearchPaths: searchPaths}
		}
	}

	// 4. JAVA_HOME
	if javaHome := os.Getenv("JAVA_HOME"); javaHome != "" {
		homeJava := filepath.Join(javaHome, "bin", javaExe)
		searchPaths = append(searchPaths, homeJava)
		if jdk, ok := checkJava(homeJava); ok && jdk.Major >= 17 {
			return Status{Available: true, JDK: jdk, SearchPaths: searchPaths}
		}
	}

	// 5. Search PATH
	if pathJava, err := exec.LookPath(javaExe); err == nil {
		searchPaths = append(searchPaths, pathJava)
		if jdk, ok := checkJava(pathJava); ok && jdk.Major >= 17 {
			return Status{Available: true, JDK: jdk, SearchPaths: searchPaths}
		}
	}

	// 6. Common install locations
	commonPaths := commonJDKPaths()
	for _, p := range commonPaths {
		searchPaths = append(searchPaths, p)
		if jdk, ok := checkJava(p); ok && jdk.Major >= 17 {
			return Status{Available: true, JDK: jdk, SearchPaths: searchPaths}
		}
	}

	return Status{
		Available:   false,
		Message:     "No JDK 17+ found. Please install a JDK 17 or later, or set JAVA_HOME.",
		SearchPaths: searchPaths,
	}
}

// ResolveJavaHome returns the best available JDK 17+ home for running
// Tomcat and other Java workloads. It mirrors Detect() and is used when
// callers do not supply an explicit javaHome (e.g. POST /api/v1/servers
// with only projectId).
func ResolveJavaHome(bundledDir string) (string, error) {
	status := NewManager(bundledDir).Detect()
	if status.Available && status.JDK != nil {
		return status.JDK.Home, nil
	}
	return "", fmt.Errorf(
		"no JDK 17+ found for Tomcat: install a JDK, set JAVA_HOME, or run `pnpm bundled:prepare` to materialize bundled/jdk17 (searched: %v)",
		status.SearchPaths,
	)
}

// persistedJDKConfig is the on-disk shape written by Electron jdk-check.ts.
type persistedJDKConfig struct {
	JavaHome string `json:"javaHome"`
}

// loadPersistedJDKHomes returns JDK homes from host-jdk.json candidates.
// Electron writes <userData>/host-jdk.json; agent dataDir is typically
// <userData>/kairo-data. KAIRO_JDK_CONFIG / KAIRO_DATA_DIR override paths.
func loadPersistedJDKHomes() []string {
	candidates := make([]string, 0, 4)
	if cfg := strings.TrimSpace(os.Getenv("KAIRO_JDK_CONFIG")); cfg != "" {
		candidates = append(candidates, cfg)
	}
	dataDir := strings.TrimSpace(os.Getenv("KAIRO_DATA_DIR"))
	if dataDir != "" {
		candidates = append(candidates,
			filepath.Join(dataDir, "host-jdk.json"),
			filepath.Join(filepath.Dir(dataDir), "host-jdk.json"),
		)
	}
	// Only probe Electron userData defaults when no explicit data dir/config
	// is provided (avoids tests accidentally picking up a developer install).
	if dataDir == "" && strings.TrimSpace(os.Getenv("KAIRO_JDK_CONFIG")) == "" {
		if runtime.GOOS == "windows" {
			if appData := os.Getenv("APPDATA"); appData != "" {
				for _, name := range []string{"Kairo", "kairo-ide", "@kairo/desktop"} {
					candidates = append(candidates, filepath.Join(appData, name, "host-jdk.json"))
				}
			}
		} else if runtime.GOOS == "darwin" {
			home, _ := os.UserHomeDir()
			if home != "" {
				for _, name := range []string{"Kairo", "kairo-ide"} {
					candidates = append(candidates, filepath.Join(home, "Library", "Application Support", name, "host-jdk.json"))
				}
			}
		} else {
			home, _ := os.UserHomeDir()
			if home != "" {
				for _, name := range []string{"Kairo", "kairo-ide"} {
					candidates = append(candidates, filepath.Join(home, ".config", name, "host-jdk.json"))
				}
			}
		}
	}

	seen := make(map[string]struct{})
	homes := make([]string, 0, len(candidates))
	for _, cfgPath := range candidates {
		home := readPersistedJDKHome(cfgPath)
		if home == "" {
			continue
		}
		key := strings.ToLower(filepath.Clean(home))
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		homes = append(homes, home)
	}
	return homes
}

func readPersistedJDKHome(cfgPath string) string {
	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		return ""
	}
	var cfg persistedJDKConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return ""
	}
	home := strings.TrimSpace(cfg.JavaHome)
	if home == "" {
		return ""
	}
	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "java.exe"
	}
	if _, err := os.Stat(filepath.Join(home, "bin", javaExe)); err != nil {
		return ""
	}
	return home
}

// checkJava runs "java -version" and parses the output.
// Returns the JDK info and whether it's suitable.
func checkJava(javaPath string) (*HostJDK, bool) {
	if _, err := os.Stat(javaPath); err != nil {
		return nil, false
	}

	cmd := exec.Command(javaPath, "-version")
	output, err := cmd.CombinedOutput()
	if err != nil {
		content, readErr := os.ReadFile(javaPath)
		if readErr == nil {
			version := parseJavaVersion(string(content))
			if version != "" {
				major := parseMajorVersion(version)
				home := filepath.Dir(filepath.Dir(javaPath))
				return &HostJDK{
					Path:    javaPath,
					Home:    home,
					Version: version,
					Major:   major,
				}, major >= 17
			}
		}
		return nil, false
	}

	// Parse version from stderr (java -version writes to stderr)
	versionOutput := string(output)
	version := parseJavaVersion(versionOutput)
	if version == "" {
		return nil, false
	}

	major := parseMajorVersion(version)

	home := filepath.Dir(filepath.Dir(javaPath)) // javaPath/bin/java -> home
	return &HostJDK{
		Path:    javaPath,
		Home:    home,
		Version: version,
		Major:   major,
	}, true
}

// javaVersionRE matches Java version strings like:
// - openjdk version "17.0.9" 2023-10-17
// - java version "1.8.0_391"
// - openjdk version "21.0.1" 2023-10-17 LTS
var javaVersionRE = regexp.MustCompile(`version\s+"([^"]+)"`)

func parseJavaVersion(output string) string {
	matches := javaVersionRE.FindStringSubmatch(output)
	if len(matches) >= 2 {
		return matches[1]
	}
	return ""
}

func parseMajorVersion(version string) int {
	// Handle "1.8.0_391" -> 8
	if strings.HasPrefix(version, "1.") {
		parts := strings.Split(version, ".")
		if len(parts) >= 2 {
			if v, err := strconv.Atoi(parts[1]); err == nil {
				return v
			}
		}
	}
	// Handle "17.0.9" -> 17
	parts := strings.Split(version, ".")
	if len(parts) >= 1 {
		if v, err := strconv.Atoi(parts[0]); err == nil {
			return v
		}
	}
	return 0
}

// commonJDKPaths returns common JDK installation paths for the current OS.
// It is a variable so tests can override it.
var commonJDKPaths = func() []string {
	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "java.exe"
	}

	var paths []string
	switch runtime.GOOS {
	case "darwin":
		paths = []string{
			"/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home/bin/" + javaExe,
			"/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/" + javaExe,
			"/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin/" + javaExe,
			"/usr/local/opt/openjdk@17/bin/" + javaExe,
			"/opt/homebrew/opt/openjdk@17/bin/" + javaExe,
		}
	case "linux":
		paths = []string{
			"/usr/lib/jvm/java-17-openjdk/bin/" + javaExe,
			"/usr/lib/jvm/java-21-openjdk/bin/" + javaExe,
			"/usr/lib/jvm/java-17-oracle/bin/" + javaExe,
			"/usr/lib/jvm/jdk-17/bin/" + javaExe,
		}
	case "windows":
		paths = []string{
			`C:\Program Files\Java\jdk-17\bin\` + javaExe,
			`C:\Program Files\Java\jdk-21\bin\` + javaExe,
			`C:\Program Files\Eclipse Adoptium\jdk-17\bin\` + javaExe,
		}
	}
	return paths
}

// GetBridgeJarPath returns the path to kairo-jdi-bridge.jar in the bundled directory.
func (m *Manager) GetBridgeJarPath() string {
	return filepath.Join(m.BundledDir, "kairo-jdi-bridge.jar")
}

// IsBridgeJarAvailable checks if the bridge jar exists.
func (m *Manager) IsBridgeJarAvailable() bool {
	path := m.GetBridgeJarPath()
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() > 0
}

// FullStatus returns a comprehensive debug status suitable for the API.
type FullStatus struct {
	JDK17Available bool     `json:"jdk17Available"`
	JDK17Path      string   `json:"jdk17Path,omitempty"`
	JDK17Version   string   `json:"jdk17Version,omitempty"`
	BridgeJarFound bool     `json:"bridgeJarFound"`
	BridgeJarPath  string   `json:"bridgeJarPath,omitempty"`
	Message        string   `json:"message,omitempty"`
	Limitations    []string `json:"limitations,omitempty"`
}

// GetFullStatus returns a comprehensive debug adapter status.
func (m *Manager) GetFullStatus() FullStatus {
	status := m.Detect()
	bridgeAvail := m.IsBridgeJarAvailable()

	result := FullStatus{
		JDK17Available: status.Available,
		BridgeJarFound: bridgeAvail,
		BridgeJarPath:  m.GetBridgeJarPath(),
		Limitations: []string{
			"Java 6: Instance filters not supported",
			"Java 6: Lambda step not supported (no lambdas)",
			"Java 6: Method exit breakpoints limited",
		},
	}

	if status.JDK != nil {
		result.JDK17Path = status.JDK.Path
		result.JDK17Version = status.JDK.Version
	}

	if !status.Available {
		if !bridgeAvail {
			result.Message = "Both JDK 17 and JDI Bridge jar are missing"
		} else {
			result.Message = status.Message
		}
	} else if !bridgeAvail {
		result.Message = fmt.Sprintf("JDI Bridge jar not found at %s", m.GetBridgeJarPath())
	} else {
		result.Message = "Debug adapter is ready"
	}

	return result
}

func (m *Manager) NeedsDownload() bool {
	return !m.Detect().Available
}