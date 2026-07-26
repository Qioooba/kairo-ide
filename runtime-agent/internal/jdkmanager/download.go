package jdkmanager

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

var (
	jdkLogger     = log.New("jdkmanager")
	adoptiumBase  = "https://api.adoptium.net/v3/binary/latest/17/ga"
	httpClient    = &http.Client{Timeout: 10 * time.Minute}
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

	progress(5, "Preparing JDK 17 download...")

	targetDir := filepath.Join(m.BundledDir, "jdk17")
	if err := os.MkdirAll(m.BundledDir, 0755); err != nil {
		return nil, fmt.Errorf("create bundled directory: %w", err)
	}

	archivePath, archiveType, err := m.downloadJDK(ctx, progress)
	if err != nil {
		return nil, fmt.Errorf("download JDK: %w", err)
	}
	defer os.Remove(archivePath)

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

func (m *Manager) downloadURL() (string, string) {
	osName := runtime.GOOS
	arch := runtime.GOARCH

	var adoptiumOS, adoptiumArch, ext string
	switch osName {
	case "darwin":
		adoptiumOS = "mac"
		ext = ".tar.gz"
	case "linux":
		adoptiumOS = "linux"
		ext = ".tar.gz"
	case "windows":
		adoptiumOS = "windows"
		ext = ".zip"
	default:
		adoptiumOS = osName
		ext = ".tar.gz"
	}

	switch arch {
	case "amd64":
		adoptiumArch = "x64"
	case "arm64":
		adoptiumArch = "aarch64"
	default:
		adoptiumArch = arch
	}

	url := fmt.Sprintf("%s/%s/%s/jdk/hotspot/normal/eclipse", adoptiumBase, adoptiumOS, adoptiumArch)
	return url, ext
}

type progressReader struct {
	reader   io.Reader
	total    int64
	received int64
	progress func(percent int, message string)
	ctx      context.Context
	lastPct  int
}

func (pr *progressReader) Read(p []byte) (int, error) {
	select {
	case <-pr.ctx.Done():
		return 0, pr.ctx.Err()
	default:
	}

	n, err := pr.reader.Read(p)
	pr.received += int64(n)

	if pr.total > 0 {
		pct := int(float64(pr.received) / float64(pr.total) * 65)
		if pct > pr.lastPct {
			pr.lastPct = pct
			pr.progress(pct+10, fmt.Sprintf("Downloading JDK 17... %d%%", pct))
		}
	}

	return n, err
}

func (m *Manager) downloadJDK(ctx context.Context, progress func(percent int, message string)) (string, string, error) {
	url, ext := m.downloadURL()
	jdkLogger.Info("downloading JDK 17", log.Fields{"url": url})

	client := *httpClient
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) > 10 {
			return fmt.Errorf("too many redirects")
		}
		return nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", "", err
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	tmpFile, err := os.CreateTemp("", "jdk17-*"+ext)
	if err != nil {
		return "", "", err
	}
	tmpPath := tmpFile.Name()

	pr := &progressReader{
		reader:   resp.Body,
		total:    resp.ContentLength,
		progress: progress,
		ctx:      ctx,
	}

	if _, err := io.Copy(tmpFile, pr); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return "", "", err
	}

	tmpFile.Close()
	return tmpPath, ext, nil
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

		if err := os.Rename(srcPath, dstPath); err != nil {
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

