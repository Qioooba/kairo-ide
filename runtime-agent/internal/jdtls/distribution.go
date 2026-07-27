// Package jdtls — distribution installer.
//
// Real Eclipse JDT Language Server is shipped as a tar.gz or zip
// containing a "config_linux / config_win / config_mac" folder
// tree, a "plugins" folder, and (newer releases) a
// "bin/jdtls" launcher. The Manager resolves a FIXED version from
// a pre-bundled location or operator-provided override, verifies
// the SHA-256, then unpacks into the Kairo data directory. There
// is no public-internet fallback: a moving target is exactly the
// failure mode the previous round's release notes captured, and
// Kairo IDE is designed for offline / air-gapped deployment.
//
// Path-traversal (zip-slip / tar-slip) is rejected at extract
// time. The launcher JAR is selected by reading the
// org.eclipse.equinox.launcher plugin coordinate out of the
// plugins/ folder, NOT by globbing for a known version, so a
// version bump in the JDT LS release does not break the
// installer.
//
// Resolution order (see ensureInstalled):
//   1. KAIRO_JDTLS_HOME       — existing installation
//   2. KAIRO_JDTLS_ARCHIVE    — pre-staged local file
//   3. <DataDir>/bundled/jdtls/<archive>  — pre-bundled at build time
//   4. KAIRO_JDTLS_ARCHIVE_URL — intranet mirror URL or file:// path
//
// If none of the above yield an archive, the installer returns
// ErrNotInstalled and refuses to fall back to a public URL.
package jdtls

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
)

// Distribution files & verification pins.
//
// We pin to a FIXED version and SHA-256 of the Eclipse JDT
// Language Server. The previous "latest" snapshot URL was a
// moving target: Eclipse rotates the timestamped snapshot
// every CI build, so the SHA-256 check would fail on a
// different build. Pinning a specific dated snapshot
// prevents silent breakage.
//
// If the URL ever moves, the user can override it (and the
// SHA-256) with:
//
//   - drop a pre-staged .tar.gz / .zip at the path
//     KAIRO_JDTLS_ARCHIVE points at, OR
//   - override the URL via KAIRO_JDTLS_ARCHIVE_URL
const (
	// JDTLSVersion is the JDT LS release the agent supports.
	// Bump together with JDTLSReleaseDate + JDTLSArchiveFile + JDTLSExpectedSHA256.
	//
	// History:
	//   1.35.0 (2024-06-27) — original pin, removed by Eclipse 2025
	//   1.55.0 (2026-01-13) — current pin; verified 2026-07-20
	JDTLSVersion = "1.55.0"
	// JDTLSReleaseDate is the date tag of the pinned artefact.
	JDTLSReleaseDate = "2026-01-13"
	// JDTLSBuildTag is kept for backward compatibility with install reports.
	JDTLSBuildTag = "20260113"
	// JDTLSArchiveFile is the canonical archive name for caching.
	// OFFLINE MODE: Kairo IDE will NOT automatically download from the
	// public internet. The JDT LS archive must be provided via:
	//   - Pre-bundling during build (pnpm bundled:prepare)
	//   - KAIRO_JDTLS_ARCHIVE environment variable (local file)
	//   - KAIRO_JDTLS_ARCHIVE_URL environment variable (intranet mirror)
	//   - KAIRO_JDTLS_HOME environment variable (existing installation)
	JDTLSArchiveFile = "jdt-language-server-1.55.0-202601131729.tar.gz"
	// JDTLSArchiveURL is the public Eclipse URL the archive was originally
	// sourced from during development. It is intentionally NOT exposed as a
	// Go constant that code can fall back to at runtime, because Kairo IDE
	// is designed for offline / air-gapped deployments. Production
	// resolution order (see ensureInstalled below):
	//   1. KAIRO_JDTLS_HOME       — existing installation
	//   2. KAIRO_JDTLS_ARCHIVE    — pre-staged local file
	//   3. <DataDir>/bundled/jdtls/<archive>  — pre-bundled
	//   4. KAIRO_JDTLS_ARCHIVE_URL — intranet mirror (HTTP/HTTPS or file://)
	// If none of the above yield an archive, the installer returns
	// ErrNotInstalled and refuses to contact the public internet.
	// JDTLSArchiveURL string = "https://download.eclipse.org/jdtls/milestones/1.55.0/jdt-language-server-1.55.0-202601131729.tar.gz" // OFFLINE: not used at runtime
	JDTLSExpectedSHA256 = "90627c9f03704dbb404f37651625d0751c078ab7534246023d53adcea1411b91"
	// JDTLSLaunchMinVersion is the minimum Equinox launcher version.
	JDTLSLaunchMinVersion = "1.6.400"
)

// InstallReport is the JSON we write under
// <DataDir>/bundled/jdtls/install.json so the UI / future
// invocations can see exactly what is on disk without re-running
// the installer.
type InstallReport struct {
	Version        string            `json:"version"`
	BuildTag       string            `json:"buildTag"`
	ArchiveName    string            `json:"archiveName"`
	ArchiveSHA256  string            `json:"archiveSha256"`
	InstalledAt    string            `json:"installedAt"`
	Home           string            `json:"home"`
	LauncherJAR    string            `json:"launcherJar"`
	PluginsDir     string            `json:"pluginsDir"`
	ConfigLinux    string            `json:"configLinux"`
	ConfigWin      string            `json:"configWin"`
	ConfigMac      string            `json:"configMac"`
	ExtraConfigs   map[string]string `json:"extraConfigs,omitempty"`
	LayoutVersion  int               `json:"layoutVersion"`
	LayoutWarnings []string          `json:"layoutWarnings,omitempty"`
}

// LayoutVersion is bumped when the JDT LS layout changes in a
// way the agent cares about. The installer only refuses to
// start the LS when the discovered layout is below
// LayoutMinSupported.
const (
	LayoutVersion = 1
	LayoutMinSupp = 1
)

// layout is the result of inspecting an unpacked JDT LS
// installation. The fields are absolute paths ready to feed to
// the Java launcher.
type layout struct {
	home        string
	launcherJAR string
	pluginsDir  string
	configLinux string
	configWin   string
	configMac   string
	warnings    []string
	launcherVer string
}

// DistributionStatus is the JSON returned by the /jdtls/status
// endpoint for the distribution side of the JDT LS.
type DistributionStatus struct {
	Installed   bool   `json:"installed"`
	Version     string `json:"version"`
	Home        string `json:"home"`
	LauncherJAR string `json:"launcherJar"`
	Source      string `json:"source"`
	Message     string `json:"message,omitempty"`
}

// ErrNotInstalled is returned by Install when no JDT LS is on
// disk and KAIRO_JDTLS_HOME / KAIRO_JDTLS_ARCHIVE are not set
// and the download failed. The caller turns this into a 5xx
// with a precise message.
var (
	ErrNotInstalled     = errors.New("jdtls is not installed and the archive could not be obtained")
	ErrChecksumMismatch = errors.New("jdtls archive sha256 mismatch")
	ErrUnsafePath       = errors.New("archive entry path escapes install root (zip-slip / tar-slip)")
	ErrCorruptArchive   = errors.New("jdtls archive is corrupt or truncated")
	ErrLayoutChanged    = errors.New("jdtls layout is below the minimum supported version")
)

// ensureInstalled brings a JDT LS installation to a usable
// state, returns the absolute paths the Manager needs to start
// the JVM, and writes the install report into the data dir.
//
// Resolution order:
//
//  1. KAIRO_JDTLS_HOME      → use the existing layout as-is,
//     validate, install-report, return.
//  2. KAIRO_JDTLS_ARCHIVE   → import a pre-staged archive,
//     verify SHA-256 (unless skipSHAVerify
//     is true), unpack.
//  3. <DataDir>/bundled/jdtls/<archive>
//     if it exists and matches the
//     pinned SHA-256, use it.
//  4. Download from customURL if set, or
//     KAIRO_JDTLS_ARCHIVE_URL (intranet mirror). The public
//     internet is NEVER contacted as a fallback.
//
// The function is idempotent: a second call with everything
// already on disk is a near-no-op (only the install-report is
// re-written).
//
// skipSHAVerify: when true, SHA-256 verification is skipped.
// Intended for development only; a warning is logged.
// customURL: when non-empty, overrides both the constant default
// (offline: there is no default) and KAIRO_JDTLS_ARCHIVE_URL.
// Useful for corporate mirrors and for tests.
func ensureInstalled(ctx context.Context, dataDir, bundledDir, jrePath string, skipSHAVerify bool, customURL string, logger func(string, map[string]any)) (InstallReport, error) {
	home := filepath.Join(bundledDir, "jdtls")
	_ = os.MkdirAll(home, 0o755)
	logger("jdtls distribution: resolving", map[string]any{"home": home, "version": JDTLSVersion})

	// 0) Pre-extracted bundled directory (highest priority for offline/air-gapped mode).
	// If the bundled/jdtls directory already contains a complete JDT LS layout
	// (plugins/ + OS-specific config/), use it directly without requiring an archive
	// or attempting any download. This is the production path for packaged EXE builds.
	if l, err := discoverLayout(home); err == nil && l.layoutVersion() >= LayoutMinSupp {
		rep := InstallReport{
			Version:       JDTLSVersion,
			BuildTag:      JDTLSBuildTag,
			ArchiveName:   "(pre-bundled)",
			ArchiveSHA256: "(pre-bundled)",
			InstalledAt:   time.Now().UTC().Format(time.RFC3339Nano),
			Home:          home,
			LauncherJAR:   l.launcherJAR,
			PluginsDir:    l.pluginsDir,
			ConfigLinux:   l.configLinux,
			ConfigWin:     l.configWin,
			ConfigMac:     l.configMac,
			LayoutVersion: l.layoutVersion(),
		}
		if len(l.warnings) > 0 {
			rep.LayoutWarnings = l.warnings
		}
		if err := writeInstallReport(dataDir, &rep); err != nil {
			logger("jdtls distribution: install report write failed", map[string]any{"err": err.Error()})
		}
		logger("jdtls distribution: using pre-bundled installation", map[string]any{
			"home":        home,
			"launcherJAR": l.launcherJAR,
		})
		return rep, nil
	}

	// 1) KAIRO_JDTLS_HOME override.
	if pre := os.Getenv("KAIRO_JDTLS_HOME"); pre != "" {
		rep, err := adoptExistingLayout(pre, dataDir, logger)
		if err != nil {
			return InstallReport{}, err
		}
		// Even when the layout is adopted, we verify the
		// existing folder has the structure we need; the
		// report carries the verdict to the API.
		rep.Version = JDTLSVersion
		if err := writeInstallReport(dataDir, &rep); err != nil {
			logger("jdtls distribution: install report write failed", map[string]any{"err": err.Error()})
		}
		return rep, nil
	}

	// 2) KAIRO_JDTLS_ARCHIVE override.
	if arch := os.Getenv("KAIRO_JDTLS_ARCHIVE"); arch != "" {
		// Offline archive override: if SHA-256 verification is
		// skipped (KAIRO_SKIP_SHA_VERIFY=true), emit a warning
		// that the archive is being used without verification.
		// Production deployments must either provide a checksum
		// or accept the risk of an unverified local artifact.
		if skipSHAVerify {
			logger("jdtls distribution: using unverified local artifact (KAIRO_SKIP_SHA_VERIFY=true)", map[string]any{
				"path":    arch,
				"warning": "unverified local artifact — checksum verification is disabled",
			})
		}
		// If the user is pointing us at the same file we
		// would have downloaded, skip the copy and just
		// verify + unpack.
		return installFromFile(ctx, arch, home, dataDir, skipSHAVerify, logger)
	}

	// 3) Already-cached archive.
	cached := filepath.Join(home, JDTLSArchiveFile)
	if st, err := os.Stat(cached); err == nil && st.Size() > 0 {
		if skipSHAVerify {
			logger("jdtls distribution: skipping SHA-256 verification for cached archive (KAIRO_SKIP_SHA_VERIFY=true)", map[string]any{"path": cached, "warning": "development only"})
			return installFromFile(ctx, cached, home, dataDir, skipSHAVerify, logger)
		}
		expected := effectiveArchiveSHA256()
		ok, sum, err := verifySHA256(cached, expected)
		if err != nil {
			return InstallReport{}, err
		}
		if ok {
			logger("jdtls distribution: cached archive matches", map[string]any{"path": cached, "sha256": sum})
			return installFromFile(ctx, cached, home, dataDir, skipSHAVerify, logger)
		}
		logger("jdtls distribution: cached archive sha256 mismatch; re-downloading", map[string]any{
			"expected": expected,
			"actual":   sum,
		})
		_ = os.Remove(cached)
	}

	// 4) Download from configured URL (offline mode: no hardcoded public URL fallback).
	// Kairo IDE is designed for offline/air-gapped environments. If no archive is
	// available locally and no intranet URL is configured, return a clear error
	// rather than attempting to reach the public internet.
	url := customURL
	if url == "" {
		url = os.Getenv("KAIRO_JDTLS_ARCHIVE_URL")
	}
	if url == "" {
		// Check if a pre-bundled archive exists from prepare-bundled (build-time packaging)
		bundledSearchPatterns := []string{
			filepath.Join(bundledDir, "jdtls", JDTLSArchiveFile),
			filepath.Join(bundledDir, JDTLSArchiveFile),
		}
		for _, candidate := range bundledSearchPatterns {
			if st, err := os.Stat(candidate); err == nil && st.Size() > 0 {
				logger("jdtls distribution: using pre-bundled archive", map[string]any{"path": candidate})
				return installFromFile(ctx, candidate, home, dataDir, skipSHAVerify, logger)
			}
		}
		return InstallReport{}, fmt.Errorf("jdt-language-server archive not available; Kairo IDE runs in offline/air-gapped mode and will not download from the public internet. Please either:\n"+
			"  1. Set KAIRO_JDTLS_HOME to an existing JDT LS installation directory,\n"+
			"  2. Set KAIRO_JDTLS_ARCHIVE to a local .tar.gz/.zip archive,\n"+
			"  3. Set KAIRO_JDTLS_ARCHIVE_URL to an intranet mirror URL,\n"+
			"  4. Run pnpm bundled:prepare to pre-package JDT LS during build")
	}

	// If URL is a local file path, use it directly
	if strings.HasPrefix(url, "file://") || !strings.Contains(url, "://") {
		localPath := url
		if strings.HasPrefix(url, "file://") {
			u, err := filepath.Abs(url[7:])
			if err == nil {
				localPath = u
			}
		} else if !filepath.IsAbs(localPath) {
			localPath = filepath.Join(bundledDir, localPath)
		}
		if _, err := os.Stat(localPath); err == nil {
			logger("jdtls distribution: using local archive", map[string]any{"path": localPath})
			return installFromFile(ctx, localPath, home, dataDir, skipSHAVerify, logger)
		}
	}

	logger("jdtls distribution: downloading from configured URL", map[string]any{"url": url})
	if skipSHAVerify {
		logger("jdtls distribution: SHA-256 verification will be skipped (KAIRO_SKIP_SHA_VERIFY=true)", map[string]any{"warning": "development only"})
	}
	if err := downloadTo(ctx, url, cached, logger); err != nil {
		return InstallReport{}, fmt.Errorf("download jdt-language-server: %w (set KAIRO_JDTLS_ARCHIVE to use a pre-staged local archive, or configure KAIRO_JDTLS_ARCHIVE_URL to your intranet mirror)", err)
	}
	return installFromFile(ctx, cached, home, dataDir, skipSHAVerify, logger)
}

// EnsureInstalledPublic is the exported wrapper around
// ensureInstalled. It is used by the app layer
// (app.JDTLSService) to trigger JDT LS distribution download
// and unpack without depending on the deprecated Manager.
func EnsureInstalledPublic(ctx context.Context, dataDir, bundledDir, jrePath string, skipSHAVerify bool, customURL string, logger func(string, map[string]any)) (InstallReport, error) {
	return ensureInstalled(ctx, dataDir, bundledDir, jrePath, skipSHAVerify, customURL, logger)
}

// installFromFile handles steps 2/3/4 of ensureInstalled: verify
// the archive, then unpack it into the install root, then
// re-discover the layout and return the report.
func installFromFile(ctx context.Context, archivePath, home, dataDir string, skipSHAVerify bool, logger func(string, map[string]any)) (InstallReport, error) {
	// Verify the SHA-256 of the archive itself. We treat the
	// archive as a single artifact: once it matches the pinned
	// hash, we trust the contents.
	if _, err := os.Stat(archivePath); err != nil {
		return InstallReport{}, fmt.Errorf("jdtls archive missing: %w", err)
	}
	var sum string
	if skipSHAVerify {
		logger("jdtls distribution: skipping SHA-256 verification (KAIRO_SKIP_SHA_VERIFY=true)", map[string]any{"path": archivePath, "warning": "development only"})
		sum = "(skipped)"
	} else {
		expected := effectiveArchiveSHA256()
		ok, s, err := verifySHA256(archivePath, expected)
		if err != nil {
			return InstallReport{}, err
		}
		if !ok {
			return InstallReport{}, fmt.Errorf("%w: expected=%s actual=%s", ErrChecksumMismatch, expected, s)
		}
		logger("jdtls distribution: archive sha256 ok", map[string]any{"path": archivePath, "sha256": s})
		sum = s
	}

	// KAIRO-RC-WEB-241: the archive cache lives INSIDE `home`
	// (cached := home/JDTLSArchiveFile), and the layout wipe below
	// would delete the archive itself before unpack — making every
	// install fail and the next run re-download. Move the archive
	// to a sibling dir (keeping its extension so the format
	// sniffer still works) and restore it afterwards.
	keepDir := home + ".keep"
	if err := os.MkdirAll(keepDir, 0o755); err != nil {
		return InstallReport{}, fmt.Errorf("preserve jdtls archive before layout wipe: %w", err)
	}
	keep := filepath.Join(keepDir, filepath.Base(archivePath))
	if err := os.Rename(archivePath, keep); err != nil {
		return InstallReport{}, fmt.Errorf("preserve jdtls archive before layout wipe: %w", err)
	}
	restored := false
	defer func() {
		if !restored {
			_ = os.Rename(keep, archivePath)
		}
		_ = os.RemoveAll(keepDir)
	}()

	// Wipe the existing layout so we never start the LS
	// against a half-upgraded tree. This is the same behaviour
	// as the .tar.gz installer in many Go projects: better to
	// fail loudly than to start the LS with a partial install.
	if err := os.RemoveAll(home); err != nil {
		return InstallReport{}, err
	}
	if err := os.MkdirAll(home, 0o755); err != nil {
		return InstallReport{}, err
	}

	// Unpack. The unpacking code is .tar.gz + .zip aware and
	// refuses to write outside `home` regardless of what the
	// archive contains.
	if err := unpackArchive(ctx, keep, home, logger); err != nil {
		return InstallReport{}, err
	}

	// Restore the archive into the wiped layout for the next
	// run's cache check (cached := home/JDTLSArchiveFile).
	if err := os.Rename(keep, archivePath); err != nil {
		return InstallReport{}, fmt.Errorf("restore jdtls archive after unpack: %w", err)
	}
	restored = true

	// Discover the layout.
	l, err := discoverLayout(home)
	if err != nil {
		return InstallReport{}, err
	}
	if l.layoutVersion() < LayoutMinSupp {
		return InstallReport{}, fmt.Errorf("%w: layoutVersion=%d", ErrLayoutChanged, l.layoutVersion())
	}
	rep := InstallReport{
		Version:       JDTLSVersion,
		BuildTag:      JDTLSBuildTag,
		ArchiveName:   filepath.Base(archivePath),
		ArchiveSHA256: sum,
		InstalledAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Home:          home,
		LauncherJAR:   l.launcherJAR,
		PluginsDir:    l.pluginsDir,
		ConfigLinux:   l.configLinux,
		ConfigWin:     l.configWin,
		ConfigMac:     l.configMac,
		LayoutVersion: l.layoutVersion(),
	}
	if len(l.warnings) > 0 {
		rep.LayoutWarnings = l.warnings
	}
	if err := writeInstallReport(dataDir, &rep); err != nil {
		logger("jdtls distribution: install report write failed", map[string]any{"err": err.Error()})
	}
	logger("jdtls distribution: installed", map[string]any{
		"home":        home,
		"launcherJAR": l.launcherJAR,
		"version":     l.layoutVersion(),
	})
	return rep, nil
}

// adoptExistingLayout validates a KAIRO_JDTLS_HOME directory.
// The user may point us at a hand-installed JDT LS, an older
// Kairo installation, or a pre-baked Docker layer; we cannot
// assume any of the artefacts exist.
func adoptExistingLayout(existing, dataDir string, logger func(string, map[string]any)) (InstallReport, error) {
	abs, err := filepath.Abs(existing)
	if err != nil {
		return InstallReport{}, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return InstallReport{}, fmt.Errorf("KAIRO_JDTLS_HOME %s: %w", abs, err)
	}
	if !st.IsDir() {
		return InstallReport{}, fmt.Errorf("KAIRO_JDTLS_HOME %s is not a directory", abs)
	}
	l, err := discoverLayout(abs)
	if err != nil {
		return InstallReport{}, err
	}
	if l.layoutVersion() < LayoutMinSupp {
		return InstallReport{}, fmt.Errorf("%w: KAIRO_JDTLS_HOME layout v%d", ErrLayoutChanged, l.layoutVersion())
	}
	logger("jdtls distribution: using KAIRO_JDTLS_HOME", map[string]any{"home": abs})
	return InstallReport{
		Version:       JDTLSVersion,
		BuildTag:      JDTLSBuildTag,
		ArchiveName:   "(KAIRO_JDTLS_HOME)",
		Home:          abs,
		LauncherJAR:   l.launcherJAR,
		PluginsDir:    l.pluginsDir,
		ConfigLinux:   l.configLinux,
		ConfigWin:     l.configWin,
		ConfigMac:     l.configMac,
		LayoutVersion: l.layoutVersion(),
	}, nil
}

// discoverLayout inspects an unpacked install root. It returns
// a `layout` value with all paths absolute, ready to feed to
// the JVM.
func discoverLayout(root string) (*layout, error) {
	root = filepath.Clean(root)
	l := &layout{home: root}

	// plugins/ — must exist.
	plugins := filepath.Join(root, "plugins")
	st, err := os.Stat(plugins)
	if err != nil || !st.IsDir() {
		return nil, fmt.Errorf("jdtls layout: missing plugins/ at %s", plugins)
	}
	l.pluginsDir = plugins

	// config_linux / config_win / config_mac — at least one
	// of them must exist. The current JDT LS release ships
	// all three; older releases only shipped the host's
	// config. We accept any combination as long as the
	// current OS's config is present.
	l.configLinux = filepath.Join(root, "config_linux")
	l.configWin = filepath.Join(root, "config_win")
	l.configMac = filepath.Join(root, "config_mac")
	hostConfig, err := hostConfigDir(root)
	if err != nil {
		return nil, err
	}
	// hostConfig must be a directory; if it doesn't exist, the
	// release does not support this OS at all.
	if st, err := os.Stat(hostConfig); err != nil || !st.IsDir() {
		return nil, fmt.Errorf("jdtls layout: missing config for this OS at %s", hostConfig)
	}

	// launcher JAR — find the org.eclipse.equinox.launcher_*
	// plugin and use that as the entrypoint. The Eclipse
	// launcher is shipped as a regular plugin since JDT LS
	// 1.0; the convention is consistent across releases.
	matches, err := filepath.Glob(filepath.Join(plugins, "org.eclipse.equinox.launcher_*.jar"))
	if err != nil {
		return nil, err
	}
	if len(matches) == 0 {
		return nil, fmt.Errorf("jdtls layout: no org.eclipse.equinox.launcher_*.jar in %s", plugins)
	}
	// Pick the highest version (lexicographic comparison of
	// the suffix). Stable because Equinox's version segments
	// are zero-padded.
	best := matches[0]
	bestVer := launcherVersionFromFilename(filepath.Base(matches[0]))
	for _, m := range matches[1:] {
		v := launcherVersionFromFilename(filepath.Base(m))
		if compareVersions(v, bestVer) > 0 {
			best = m
			bestVer = v
		}
	}
	if compareVersions(bestVer, JDTLSLaunchMinVersion) < 0 {
		l.warnings = append(l.warnings,
			fmt.Sprintf("equinox launcher %s is below the recommended minimum %s; behaviour may differ",
				bestVer, JDTLSLaunchMinVersion))
	}
	l.launcherJAR = best
	l.launcherVer = bestVer

	return l, nil
}

// layoutVersion returns the schema version this layout
// supports. Bump the constant when a future JDT LS release
// changes which directories we rely on.
func (l *layout) layoutVersion() int {
	return LayoutVersion
}

// hostConfigDir returns the absolute path to the JDT LS
// config directory for the OS this agent is running on.
func hostConfigDir(root string) (string, error) {
	switch runtime.GOOS {
	case "linux":
		return filepath.Join(root, "config_linux"), nil
	case "darwin":
		return filepath.Join(root, "config_mac"), nil
	case "windows":
		return filepath.Join(root, "config_win"), nil
	default:
		return "", fmt.Errorf("jdtls: unsupported OS %q", runtime.GOOS)
	}
}

// launcherVersionFromFilename extracts the version suffix from
// "org.eclipse.equinox.launcher_<ver>.jar". Empty string if the
// pattern does not match (we treat that as "0.0.0").
func launcherVersionFromFilename(name string) string {
	prefix := "org.eclipse.equinox.launcher_"
	if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".jar") {
		return ""
	}
	return strings.TrimSuffix(strings.TrimPrefix(name, prefix), ".jar")
}

// compareVersions compares two dotted version strings
// component-by-component. Returns -1, 0, +1. Missing components
// default to 0.
func compareVersions(a, b string) int {
	as := strings.Split(a, ".")
	bs := strings.Split(b, ".")
	n := len(as)
	if len(bs) > n {
		n = len(bs)
	}
	for i := 0; i < n; i++ {
		var av, bv int
		if i < len(as) {
			fmt.Sscanf(as[i], "%d", &av)
		}
		if i < len(bs) {
			fmt.Sscanf(bs[i], "%d", &bv)
		}
		if av < bv {
			return -1
		}
		if av > bv {
			return 1
		}
	}
	return 0
}

// unpackArchive dispatches to the right format-specific
// unpacker based on the file extension. Both .tar.gz and .zip
// are supported.
func unpackArchive(ctx context.Context, archive, dest string, logger func(string, map[string]any)) error {
	low := strings.ToLower(archive)
	switch {
	case strings.HasSuffix(low, ".tar.gz"), strings.HasSuffix(low, ".tgz"):
		return unpackTarGz(ctx, archive, dest, logger)
	case strings.HasSuffix(low, ".zip"):
		return unpackZip(ctx, archive, dest, logger)
	default:
		return fmt.Errorf("jdtls: unsupported archive format: %s", archive)
	}
}

// unpackTarGz streams a .tar.gz into dest. Each entry's
// destination is checked against `dest` before being created;
// an entry that would escape `dest` (tar-slip) is rejected with
// ErrUnsafePath and the unpack is aborted.
func unpackTarGz(ctx context.Context, archive, dest string, logger func(string, map[string]any)) error {
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	gr, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrCorruptArchive, err.Error())
	}
	tr := tar.NewReader(gr)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("%w: %s", ErrCorruptArchive, err.Error())
		}
		target, err := safeJoin(dest, hdr.Name)
		if err != nil {
			return err
		}
		mode := hdr.FileInfo().Mode()
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return fmt.Errorf("%w: %s", ErrCorruptArchive, err.Error())
			}
			if err := out.Close(); err != nil {
				return err
			}
		case tar.TypeSymlink, tar.TypeLink:
			// JDT LS archives do not ship symlinks today.
			// If a future release does, refuse rather than
			// risk linking to /etc/passwd or similar.
			logger("jdtls distribution: skipping link entry", map[string]any{"name": hdr.Name})
		default:
			logger("jdtls distribution: skipping unknown entry", map[string]any{"name": hdr.Name, "type": hdr.Typeflag})
		}
	}
}

// unpackZip streams a .zip into dest with the same
// path-traversal guard as unpackTarGz. JDT LS zips for Windows
// are sometimes distributed instead of the tar.gz.
func unpackZip(ctx context.Context, archive, dest string, logger func(string, map[string]any)) error {
	r, err := zip.OpenReader(archive)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrCorruptArchive, err.Error())
	}
	defer r.Close()
	for _, f := range r.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		target, err := safeJoin(dest, f.Name)
		if err != nil {
			return err
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("%w: %s", ErrCorruptArchive, err.Error())
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		if _, err := io.Copy(out, rc); err != nil {
			rc.Close()
			out.Close()
			return fmt.Errorf("%w: %s", ErrCorruptArchive, err.Error())
		}
		if err := out.Close(); err != nil {
			rc.Close()
			return err
		}
		if err := rc.Close(); err != nil {
			return err
		}
	}
	return nil
}

// safeJoin resolves a relative archive entry path against
// dest, rejects absolute paths, refuses to traverse upward
// ("../") beyond dest, and returns the cleaned absolute path.
// This is the central guard against zip-slip / tar-slip.
//
// Implementation note: the entry is checked on its own FIRST,
// before any filesystem-level path joining. We do not rely
// on filepath.Join to flag traversal because on Windows
// filepath.Join silently collapses ".." segments for relative
// paths, hiding an attacker-controlled "../escape" that
// actually intends to escape the install root in the
// archive-relative sense. The check below treats the
// archive-side cleaned path as the source of truth.
func safeJoin(dest, entry string) (string, error) {
	if entry == "" {
		return "", fmt.Errorf("%w: empty entry name", ErrUnsafePath)
	}
	if filepath.IsAbs(entry) || strings.HasPrefix(entry, "/") || strings.HasPrefix(entry, `\`) {
		return "", fmt.Errorf("%w: absolute entry %q", ErrUnsafePath, entry)
	}
	// Walk the raw path's components. If any component is
	// literally "..", the archive is attempting to traverse
	// up; we reject. The check is on the RAW entry, not the
	// cleaned one, because path.Clean collapses interior
	// "..foo/.." pairs to "" on some platforms, hiding the
	// intent. We do allow interior ".." pairs that resolve
	// to a no-op (e.g. "subdir/../subdir/file") because the
	// final destination is still inside the install root.
	if hasParentTraversal(entry) {
		return "", fmt.Errorf("%w: %q escapes install root", ErrUnsafePath, entry)
	}
	// Now also reject absolute paths that survived path.Clean.
	cleaned := path.Clean("/" + entry)
	cleaned = strings.TrimPrefix(cleaned, "/")
	target := filepath.Join(dest, filepath.FromSlash(cleaned))
	// Sanity: target should still be under dest, regardless of
	// the OS-specific path joining rules.
	absDest, err := filepath.Abs(dest)
	if err != nil {
		return "", err
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absDest, absTarget)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("%w: %q escapes %q", ErrUnsafePath, entry, dest)
	}
	return target, nil
}

// jdtlsArchiveSHA256ForTest is a test seam: the production
// constant JDTLSArchiveSHA256 is a `const` so tests cannot
// replace it directly. The test files swap the value via this
// package-level variable; the production code reads it through
// effectiveArchiveSHA256. When non-empty, the installer uses
// the override; otherwise it falls back to the const. This is
// the simplest way to keep both the production code path and
// the test path honest.
var jdtlsArchiveSHA256ForTest = ""

// downloadBaseBackoff is the base exponential backoff duration for
// download retries. Production uses 1s; tests override to a much
// shorter value to keep suite runtime predictable.
var downloadBaseBackoff = 1 * time.Second

// hasParentTraversal reports whether the given archive entry
// has a ".." path segment, i.e. it tries to climb out of the
// install root via a literal "..". We split on both forward
// and backward slashes so Windows-style archive paths are
// caught too.
func hasParentTraversal(entry string) bool {
	for _, sep := range []string{"/", `\`} {
		for _, p := range strings.Split(entry, sep) {
			if p == ".." {
				return true
			}
		}
	}
	return false
}

// verifySHA256 is duplicated here to avoid an import cycle
// with the manager's helpers; both files share the same
// semantics (empty expected = pass).
func verifySHA256(path, expected string) (bool, string, error) {
	if expected == "" {
		return true, "", nil
	}
	f, err := os.Open(path)
	if err != nil {
		return false, "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return false, "", err
	}
	sum := hex.EncodeToString(h.Sum(nil))
	return sum == expected, sum, nil
}

// downloadTo downloads the archive from url to dest with a
// tempfile + atomic rename. It uses a dedicated HTTP client with
// a 10-minute timeout and follows redirects. Progress is
// reported via the logger at 10 MB intervals.
//
// On transient failures (HTTP 5xx, DNS errors, connection
// resets), the download is retried up to 3 times with
// exponential backoff (1s, 2s, 4s).
func downloadTo(ctx context.Context, url, dest string, logger func(string, map[string]any)) error {
	const maxRetries = 3
	baseBackoff := downloadBaseBackoff
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			backoff := baseBackoff * (1 << (attempt - 1)) // 1s, 2s, 4s
			logger("jdtls distribution: retrying download", map[string]any{
				"attempt": attempt,
				"max":     maxRetries,
				"backoff": backoff.String(),
				"error":   lastErr.Error(),
			})
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		}

		err := downloadOnce(ctx, url, dest, logger)
		if err == nil {
			return nil
		}
		lastErr = err

		// Only retry on transient errors
		if !isTransientError(err) {
			return err
		}
	}
	return fmt.Errorf("download %s failed after %d attempts: %w", url, maxRetries+1, lastErr)
}

// isTransientError returns true for errors that are worth retrying
// (HTTP 5xx, DNS/network errors, timeouts). HTTP 4xx errors are
// not retried because they indicate a permanent client error
// (e.g. 404 Not Found, 403 Forbidden).
func isTransientError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	// HTTP 5xx server errors
	if strings.Contains(msg, "HTTP 5") {
		return true
	}
	// Common transient network errors
	transientMarkers := []string{
		"connection refused",
		"connection reset",
		"no such host",
		"dial tcp",
		"i/o timeout",
		"deadline exceeded",
		"TLS handshake timeout",
		"EOF",
		"broken pipe",
		"use of closed network connection",
	}
	for _, marker := range transientMarkers {
		if strings.Contains(strings.ToLower(msg), strings.ToLower(marker)) {
			return true
		}
	}
	return false
}

// downloadOnce performs a single download attempt.
func downloadOnce(ctx context.Context, url, dest string, logger func(string, map[string]any)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout: 10 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), "jdtls-*.part")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()

	// Progress-reporting wrapper: log every 10 MB.
	pr := &progressReader{inner: resp.Body, logger: logger, total: resp.ContentLength}
	if _, err := io.Copy(tmp, pr); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := atomicfile.Rename(tmpName, dest); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}

// progressReader wraps an io.Reader and logs progress every 10 MB.
type progressReader struct {
	inner  io.Reader
	logger func(string, map[string]any)
	total  int64
	read   int64
	next   int64 // next report threshold
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.inner.Read(b)
	p.read += int64(n)
	if p.read >= p.next {
		p.next = p.read + 10*1024*1024 // next report at +10 MB
		if p.total > 0 {
			pct := float64(p.read) / float64(p.total) * 100
			p.logger("jdtls distribution: download progress", map[string]any{
				"downloaded_mb": p.read / (1024 * 1024),
				"total_mb":      p.total / (1024 * 1024),
				"pct":           fmt.Sprintf("%.0f%%", pct),
			})
		} else {
			p.logger("jdtls distribution: download progress", map[string]any{
				"downloaded_mb": p.read / (1024 * 1024),
			})
		}
	}
	return n, err
}

// writeInstallReport writes the InstallReport JSON next to
// the data dir so a subsequent agent can read it without
// re-running the download.
func writeInstallReport(dataDir string, rep *InstallReport) error {
	dir := filepath.Join(dataDir, "bundled", "jdtls")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.WriteFile(filepath.Join(dir, "install.json"), body, 0o644)
}

// readInstallReport returns the report written by
// writeInstallReport, or nil if there is none on disk.
func readInstallReport(dataDir string) (*InstallReport, error) {
	p := filepath.Join(dataDir, "bundled", "jdtls", "install.json")
	st, err := os.Stat(p)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if st.Size() == 0 {
		return nil, nil
	}
	body, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var rep InstallReport
	if err := json.Unmarshal(body, &rep); err != nil {
		return nil, err
	}
	return &rep, nil
}

// effectiveArchiveSHA256 returns the test override when set,
// otherwise the production constant. The function is also
// defined in distribution_test.go's test seam; the value
// jdtlsArchiveSHA256ForTest is a package-level variable that
// the production code reads, the test code sets, and a t.Cleanup
// resets to "" so test runs cannot leak overrides into
// sibling tests.
func effectiveArchiveSHA256() string {
	if jdtlsArchiveSHA256ForTest != "" {
		return jdtlsArchiveSHA256ForTest
	}
	return JDTLSExpectedSHA256
}
