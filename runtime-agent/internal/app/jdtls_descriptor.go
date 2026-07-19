package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/jdtls"
)

// JavaToolingLaunchDescriptor describes how to launch JDT LS.
// The Theia backend reads this from the Go agent API and
// spawns the JDT LS process itself, owning the full lifecycle
// and LSP communication.
type JavaToolingLaunchDescriptor struct {
	Command    string   `json:"command"`    // java binary path
	Args       []string `json:"args"`       // JDT LS JVM arguments
	WorkingDir string   `json:"workingDir"` // working directory
	Env        []string `json:"env"`        // environment variables
}

// JDTLSService resolves the launch descriptor for JDT LS.
// The Go Agent resolves the project model (source roots,
// classpath, encoding, source level) but does NOT start the
// process or send LSP initialize.
type JDTLSService struct {
	dataDir string
}

// NewJDTLSService creates a new JDTLSService.
func NewJDTLSService(dataDir string) *JDTLSService {
	return &JDTLSService{dataDir: dataDir}
}

// GetLaunchDescriptor returns the launch descriptor for JDT LS.
// The Go Agent resolves the project model (source roots,
// classpath, encoding, source level) but does NOT start the
// process or send LSP initialize.
// projectRoot is the absolute canonical path to the project directory.
func (s *JDTLSService) GetLaunchDescriptor(ctx context.Context, project domain.Project, toolchain domain.Toolchain, projectRoot string) (*JavaToolingLaunchDescriptor, error) {
	javaBin := filepath.Join(toolchain.JavaHome, "bin", "java")

	jdtlsDir := filepath.Join(s.dataDir, "bundled", "jdtls")
	launcherJar := filepath.Join(jdtlsDir, "plugins", "org.eclipse.equinox.launcher_*.jar")

	// Find the actual launcher jar
	matches, err := filepath.Glob(launcherJar)
	if err != nil || len(matches) == 0 {
		return nil, fmt.Errorf("JDT LS launcher not found in %s. Please run prepare first.", jdtlsDir)
	}

	configDir := filepath.Join(s.dataDir, "runtime", "jdtls-config")
	os.MkdirAll(configDir, 0755)

	args := []string{
		"-Declipse.application=org.eclipse.jdt.ls.core.id1",
		"-Dosgi.bundles.defaultStartLevel=4",
		"-Declipse.product=org.eclipse.jdt.ls.core.product",
		"-Dlog.protocol=true",
		"-Dlog.level=ALL",
		"-Xmx256m",
		"-jar", matches[0],
		"-configuration", configDir,
		"-data", filepath.Join(s.dataDir, "runtime", "jdtls-workspace", string(project.ID)),
	}

	return &JavaToolingLaunchDescriptor{
		Command:    javaBin,
		Args:       args,
		WorkingDir: projectRoot,
		Env:        minimalEnv(toolchain.JavaHome),
	}, nil
}

// minimalEnv returns a minimal set of environment variables for
// the JDT LS process. We do NOT expose os.Environ() to avoid
// leaking secrets, host paths, and user-specific config.
// Only PATH, JAVA_HOME, and locale-related variables are allowed.
func minimalEnv(javaHome string) []string {
	allowed := map[string]bool{
		"PATH":      true,
		"JAVA_HOME": true,
		"LANG":      true,
		"LC_ALL":    true,
		"LC_CTYPE":  true,
		"HOME":      true,
		"USER":      true,
		"TMPDIR":    true,
		"TMP":       true,
		"TEMP":      true,
	}
	var env []string
	for _, e := range os.Environ() {
		kv := strings.SplitN(e, "=", 2)
		if len(kv) == 2 && allowed[kv[0]] {
			env = append(env, e)
		}
	}
	// Ensure JAVA_HOME is set to the resolved toolchain's JavaHome.
	env = append(env, "JAVA_HOME="+javaHome)
	return env
}

// EnsureJDTLSInstalled ensures the JDT LS distribution is
// downloaded and unpacked. Returns the install report.
func (s *JDTLSService) EnsureJDTLSInstalled(ctx context.Context, bundledDir string, jrePath string, skipSHAVerify bool, customURL string, logger func(string, map[string]any)) (jdtls.InstallReport, error) {
	return jdtls.EnsureInstalledPublic(ctx, s.dataDir, bundledDir, jrePath, skipSHAVerify, customURL, logger)
}
