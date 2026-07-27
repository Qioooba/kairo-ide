package jdkmanager

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

var (
	jdkLogger = log.New("jdkmanager")
)

const (
	JDKVersion = "17"
)

func (m *Manager) EnsureJDK17(ctx context.Context, progress func(percent int, message string)) (*HostJDK, error) {
	if progress == nil {
		progress = func(int, string) {}
	}

	progress(0, "Checking for existing JDK 17...")
	status := m.Detect()
	if status.Available {
		progress(100, "JDK 17 already available")
		return status.JDK, nil
	}

	progress(5, "Preparing JDK 17 installation...")

	targetDir := filepath.Join(m.BundledDir, "jdk17")
	if err := os.MkdirAll(m.BundledDir, 0755); err != nil {
		return nil, fmt.Errorf("create bundled directory: %w", err)
	}

	archivePath, archiveType, err := m.resolveJDKArchive(ctx, progress)
	if err != nil {
		return nil, fmt.Errorf("resolve JDK archive: %w (set KAIRO_JDK_HOME to an existing JDK 17 installation, or KAIRO_JDK_ARCHIVE to a local JDK archive, or place a pre-extracted JDK 17 at %s)", err, targetDir)
	}
	defer func() {
		if archivePath != "" {
			os.Remove(archivePath)
		}
	}()

	progress(75, "Extracting JDK...")
	if err := m.extractAndMove(archivePath, archiveType, targetDir); err != nil {
		return nil, fmt.Errorf("extract JDK: %w", err)
	}

	progress(90, "Setting file permissions...")
	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "java.exe"
	}
	javaPath := filepath.Join(targetDir, "bin", javaExe)
	if _, err := os.Stat(javaPath); err != nil {
		return nil, fmt.Errorf("java executable not found at %s after extraction: %w", javaPath, err)
	}

	if runtime.GOOS != "windows" {
		binDir := filepath.Join(targetDir, "bin")
		_ = filepath.Walk(binDir, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				_ = os.Chmod(path, 0755)
			}
			return nil
		})
	}

	progress(95, "Verifying JDK version...")
	jdk, ok := checkJava(javaPath)
	if !ok || jdk.Major < 17 {
		return nil, fmt.Errorf("extracted JDK version check failed at %s", javaPath)
	}

	progress(100, "JDK 17 installation complete")
	return jdk, nil
}

func (m *Manager) resolveJDKArchive(ctx context.Context, progress func(percent int, message string)) (string, string, error) {
	if archPath := os.Getenv("KAIRO_JDK_ARCHIVE"); archPath != "" {
		if _, err := os.Stat(archPath); err != nil {
			return "", "", fmt.Errorf("KAIRO_JDK_ARCHIVE not found at %s: %w", archPath, err)
		}
		ext := archiveTypeFromPath(archPath)
		if ext == "" {
			return "", "", fmt.Errorf("KAIRO_JDK_ARCHIVE has unsupported extension (expected .tar.gz, .tgz, or .zip): %s", archPath)
		}
		progress(20, "Using local JDK archive from KAIRO_JDK_ARCHIVE...")
		if expectedHash := os.Getenv("KAIRO_JDK_SHA256"); expectedHash != "" {
			progress(30, "Verifying JDK archive SHA-256...")
			if err := verifySHA256(archPath, expectedHash); err != nil {
				return "", "", fmt.Errorf("KAIRO_JDK_ARCHIVE SHA-256 verification failed: %w", err)
			}
		} else {
			jdkLogger.Warn("JDK archive SHA-256 verification skipped (KAIRO_JDK_SHA256 not set)")
		}
		return archPath, ext, nil
	}

	cachedPatterns := []string{
		filepath.Join(m.BundledDir, "jdk17.tar.gz"),
		filepath.Join(m.BundledDir, "jdk17.tgz"),
		filepath.Join(m.BundledDir, "jdk17.zip"),
	}
	for _, cached := range cachedPatterns {
		if st, err := os.Stat(cached); err == nil && st.Size() > 0 {
			ext := archiveTypeFromPath(cached)
			if ext != "" {
				progress(20, "Using cached JDK archive from bundled directory...")
				return cached, ext, nil
			}
		}
	}

	progress(10, "JDK 17 not available offline")
	return "", "", fmt.Errorf("no JDK 17 found and no local archive available; Kairo IDE is designed for offline/air-gapped environments and will not download from the internet. Please either:\n" +
		"  1. Install JDK 17+ on the system and set JAVA_HOME,\n" +
		"  2. Set KAIRO_JDK_HOME to point to an existing JDK 17+ installation,\n" +
		"  3. Place a JDK 17 archive (.tar.gz or .zip) at bundled/jdk17.tar.gz or bundled/jdk17.zip,\n" +
		"  4. Set KAIRO_JDK_ARCHIVE to the path of a local JDK 17 archive,\n" +
		"  5. Run pnpm bundled:prepare to pre-package dependencies during build")
}

func archiveTypeFromPath(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		return ".tar.gz"
	case strings.HasSuffix(lower, ".zip"):
		return ".zip"
	}
	return ""
}

func verifySHA256(path, expected string) error {
	expected = strings.TrimSpace(strings.ToLower(expected))
	expected = strings.TrimPrefix(expected, "sha256:")
	if expected == "" {
		return nil
	}

	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if actual != expected {
		return fmt.Errorf("sha256 mismatch: expected=%s actual=%s", expected, actual)
	}
	return nil
}

func (m *Manager) extractAndMove(archivePath, archiveType, targetDir string) error {
	tmpExtract, err := os.MkdirTemp("", "jdk17-extract-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpExtract)

	if err := extractArchive(archivePath, archiveType, tmpExtract); err != nil {
		return err
	}

	srcDir, err := findJDKContentDir(tmpExtract)
	if err != nil {
		return err
	}

	if err := os.RemoveAll(targetDir); err != nil {
		return err
	}
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return err
	}

	return moveDirContents(srcDir, targetDir)
}

func extractArchive(archivePath, archiveType, destDir string) error {
	if archiveType == ".zip" {
		return extractZip(archivePath, destDir)
	}
	return extractTarGz(archivePath, destDir)
}

func extractTarGz(archivePath, destDir string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		fpath := filepath.Join(destDir, filepath.FromSlash(hdr.Name))

		if !strings.HasPrefix(fpath, filepath.Clean(destDir)+string(os.PathSeparator)) && fpath != filepath.Clean(destDir) {
			continue
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(fpath, 0755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(fpath), 0755); err != nil {
				return err
			}
			outFile, err := os.OpenFile(fpath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(hdr.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(outFile, tr); err != nil {
				outFile.Close()
				return err
			}
			outFile.Close()
		case tar.TypeSymlink:
			if err := os.MkdirAll(filepath.Dir(fpath), 0755); err != nil {
				return err
			}
			_ = os.Remove(fpath)
			_ = os.Symlink(hdr.Linkname, fpath)
		}
	}

	return nil
}

func extractZip(archivePath, destDir string) error {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		fpath := filepath.Join(destDir, filepath.FromSlash(f.Name))

		if !strings.HasPrefix(fpath, filepath.Clean(destDir)+string(os.PathSeparator)) && fpath != filepath.Clean(destDir) {
			continue
		}

		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(fpath, 0755); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(fpath), 0755); err != nil {
			return err
		}

		outFile, err := os.OpenFile(fpath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		rc.Close()
		outFile.Close()
		if err != nil {
			return err
		}
	}

	return nil
}

func findJDKContentDir(extractRoot string) (string, error) {
	entries, err := os.ReadDir(extractRoot)
	if err != nil {
		return "", err
	}

	var topLevel string
	for _, e := range entries {
		if e.IsDir() {
			topLevel = filepath.Join(extractRoot, e.Name())
			break
		}
	}

	if topLevel == "" {
		return extractRoot, nil
	}

	contentsHome := filepath.Join(topLevel, "Contents", "Home")
	if info, err := os.Stat(contentsHome); err == nil && info.IsDir() {
		javaBin := filepath.Join(contentsHome, "bin", "java")
		if _, err := os.Stat(javaBin); err == nil {
			return contentsHome, nil
		}
		javaExe := filepath.Join(contentsHome, "bin", "java.exe")
		if _, err := os.Stat(javaExe); err == nil {
			return contentsHome, nil
		}
	}

	binDir := filepath.Join(topLevel, "bin")
	if info, err := os.Stat(binDir); err == nil && info.IsDir() {
		return topLevel, nil
	}

	return extractRoot, nil
}

func moveDirContents(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, e := range entries {
		srcPath := filepath.Join(src, e.Name())
		dstPath := filepath.Join(dst, e.Name())

		if err := atomicfile.Rename(srcPath, dstPath); err != nil {
			if e.IsDir() {
				if err := copyDir(srcPath, dstPath); err != nil {
					return err
				}
			} else {
				if err := copyFile(srcPath, dstPath); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		return err
	}

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, e := range entries {
		srcPath := filepath.Join(src, e.Name())
		dstPath := filepath.Join(dst, e.Name())

		if e.IsDir() {
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	return nil
}
