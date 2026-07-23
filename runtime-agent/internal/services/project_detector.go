package services

import (
	"bufio"
	"encoding/xml"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// ProjectDetection holds the result of auto-detecting a
// legacy Java web project structure from a directory.
type ProjectDetection struct {
	// Source directories found (e.g. ["src", "src/main/java"]).
	SourceDirs []string `json:"sourceDirs"`
	// Web root directory (e.g. "WebRoot", "webapp").
	WebRoot string `json:"webRoot"`
	// Library directories (e.g. ["lib", "WebRoot/WEB-INF/lib"]).
	LibDirs []string `json:"libDirs"`
	// Build script file (e.g. "build.xml").
	BuildScript string `json:"buildScript"`
	// Default encoding detected from source files.
	DefaultEncoding string `json:"defaultEncoding"`
	// JDK version detected from javac or build.xml.
	JDKVersion string `json:"jdkVersion"`
	// Source Java version (e.g. "1.6").
	SourceVersion string `json:"sourceVersion"`
	// Target Java version (e.g. "1.6").
	TargetVersion string `json:"targetVersion"`
	// Output directory (e.g. "build/classes").
	OutputDir string `json:"outputDir"`
	// Build system type.
	BuildSystem string `json:"buildSystem"`
	// Confidence score 0-1.
	Confidence float64 `json:"confidence"`
	// Warnings for the user.
	Warnings []string `json:"warnings"`
}

// DetectProject scans a directory and returns a ProjectDetection
// with all inferred project structure information.
func DetectProject(rootPath string) (*ProjectDetection, error) {
	if rootPath == "" {
		return nil, os.ErrNotExist
	}
	info, err := os.Stat(rootPath)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, os.ErrInvalid
	}

	d := &ProjectDetection{
		Confidence: 0.5,
		Warnings:   []string{},
	}

	// Detect source directories
	d.detectSourceDirs(rootPath)

	// Detect web root
	d.detectWebRoot(rootPath)

	// Detect library directories
	d.detectLibDirs(rootPath)

	// Detect build script
	d.detectBuildScript(rootPath)

	// Detect encoding
	d.detectEncoding(rootPath)

	// Detect JDK version
	d.detectJDKVersion(rootPath)

	// Detect source/target version from build.xml
	d.detectJavaVersions(rootPath)

	// Detect output directory
	d.detectOutputDir(rootPath)

	// Boost confidence
	if d.WebRoot != "" {
		d.Confidence += 0.15
	}
	if d.BuildScript != "" {
		d.Confidence += 0.1
	}
	if len(d.SourceDirs) > 0 {
		d.Confidence += 0.1
	}
	if d.JDKVersion != "" {
		d.Confidence += 0.05
	}
	if d.Confidence > 1.0 {
		d.Confidence = 1.0
	}

	return d, nil
}

func (d *ProjectDetection) detectSourceDirs(root string) {
	// Common Java source directory patterns
	candidates := []string{
		"src",
		"src/main/java",
		"java",
		"source",
		"src/java",
	}
	for _, dir := range candidates {
		path := filepath.Join(root, dir)
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			d.SourceDirs = append(d.SourceDirs, dir)
		}
	}
	if len(d.SourceDirs) == 0 {
		// Try to find any directory containing .java files
		entries, err := os.ReadDir(root)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			if hasJavaFiles(filepath.Join(root, entry.Name())) {
				d.SourceDirs = append(d.SourceDirs, entry.Name())
			}
		}
	}
}

func (d *ProjectDetection) detectWebRoot(root string) {
	candidates := []string{
		"WebRoot",
		"webapp",
		"WebContent",
		"web",
		"src/main/webapp",
	}
	for _, dir := range candidates {
		path := filepath.Join(root, dir)
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			// Prefer WebRoot for legacy projects
			d.WebRoot = dir
			return
		}
	}
}

func (d *ProjectDetection) detectLibDirs(root string) {
	// Check top-level lib
	if info, err := os.Stat(filepath.Join(root, "lib")); err == nil && info.IsDir() {
		d.LibDirs = append(d.LibDirs, "lib")
	}

	// Check WEB-INF/lib relative to web root
	webRoot := d.WebRoot
	if webRoot == "" {
		// Try common web roots even if not detected
		for _, wr := range []string{"WebRoot", "webapp", "WebContent", "src/main/webapp"} {
			libPath := filepath.Join(root, wr, "WEB-INF", "lib")
			if info, err := os.Stat(libPath); err == nil && info.IsDir() {
				d.LibDirs = append(d.LibDirs, filepath.Join(wr, "WEB-INF", "lib"))
				break
			}
		}
	} else {
		libPath := filepath.Join(root, webRoot, "WEB-INF", "lib")
		if info, err := os.Stat(libPath); err == nil && info.IsDir() {
			d.LibDirs = append(d.LibDirs, filepath.Join(webRoot, "WEB-INF", "lib"))
		}
	}
}

func (d *ProjectDetection) detectBuildScript(root string) {
	candidates := []string{
		"build.xml",
		"pom.xml",
		"build.gradle",
	}
	for _, file := range candidates {
		path := filepath.Join(root, file)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			d.BuildScript = file
			switch file {
			case "build.xml":
				d.BuildSystem = "ant"
			case "pom.xml":
				d.BuildSystem = "maven"
			case "build.gradle":
				d.BuildSystem = "gradle"
			}
			return
		}
	}
	d.BuildSystem = "none"
}

// detectEncoding scans Java files for BOM, XML declaration
// encoding, or charset-related comments.
func (d *ProjectDetection) detectEncoding(root string) {
	// Scan Java files in source directories
	sourceDirs := d.SourceDirs
	if len(sourceDirs) == 0 {
		sourceDirs = []string{"src"}
	}

	encodings := map[string]int{}
	for _, srcDir := range sourceDirs {
		dir := filepath.Join(root, srcDir)
		files, err := findJavaFiles(dir, 5)
		if err != nil {
			continue
		}
		for _, f := range files {
			enc := detectFileEncoding(f)
			if enc != "" {
				encodings[enc]++
			}
		}
	}

	// Also check web.xml for encoding declaration
	if d.WebRoot != "" {
		webXMLPath := filepath.Join(root, d.WebRoot, "WEB-INF", "web.xml")
		enc := detectXMLEncoding(webXMLPath)
		if enc != "" {
			encodings[enc]++
		}
	}

	// Also check build.xml
	if d.BuildScript == "build.xml" {
		enc := detectXMLEncoding(filepath.Join(root, "build.xml"))
		if enc != "" {
			encodings[enc]++
		}
	}

	// Pick the most common encoding
	var bestEnc string
	bestCount := 0
	for enc, count := range encodings {
		if count > bestCount {
			bestEnc = enc
			bestCount = count
		}
	}

	if bestEnc != "" {
		d.DefaultEncoding = bestEnc
	} else {
		// Default to GBK for Chinese legacy projects
		d.DefaultEncoding = "gbk"
	}
}

func (d *ProjectDetection) detectJDKVersion(root string) {
	// Try javac -version first
	javac, err := exec.LookPath("javac")
	if err == nil {
		cmd := exec.Command(javac, "-version")
		// javac writes version to stderr
		output, err := cmd.CombinedOutput()
		if err == nil {
			version := string(output)
			if v := extractJDKVersion(version); v != "" {
				d.JDKVersion = v
				return
			}
		}
	}

	// Try JAVA_HOME
	if home := os.Getenv("JAVA_HOME"); home != "" {
		// Try to read the release file
		releaseFile := filepath.Join(home, "release")
		if data, err := os.ReadFile(releaseFile); err == nil {
			version := extractVersionFromRelease(string(data))
			if version != "" {
				d.JDKVersion = version
				return
			}
		}
	}

	// Try build.xml for javac target
	if d.BuildScript == "build.xml" {
		buildPath := filepath.Join(root, "build.xml")
		if data, err := os.ReadFile(buildPath); err == nil {
			if v := extractBuildXMLJDKVersion(string(data)); v != "" {
				d.JDKVersion = v
				return
			}
		}
	}
}

func (d *ProjectDetection) detectJavaVersions(root string) {
	if d.BuildScript == "build.xml" {
		buildPath := filepath.Join(root, "build.xml")
		data, err := os.ReadFile(buildPath)
		if err != nil {
			return
		}
		content := string(data)

		// Look for source attribute in javac task
		srcRe := regexp.MustCompile(`(?i)source\s*=\s*["']([\d.]+)["']`)
		if match := srcRe.FindStringSubmatch(content); match != nil {
			d.SourceVersion = match[1]
		}

		// Look for target attribute in javac task
		tgtRe := regexp.MustCompile(`(?i)target\s*=\s*["']([\d.]+)["']`)
		if match := tgtRe.FindStringSubmatch(content); match != nil {
			d.TargetVersion = match[1]
		}

		// If both are empty, try from property
		if d.SourceVersion == "" {
			propRe := regexp.MustCompile(`(?i)<property\s+name\s*=\s*["']javac\.source["']\s+value\s*=\s*["']([\d.]+)["']`)
			if match := propRe.FindStringSubmatch(content); match != nil {
				d.SourceVersion = match[1]
			}
		}
		if d.TargetVersion == "" {
			propRe := regexp.MustCompile(`(?i)<property\s+name\s*=\s*["']javac\.target["']\s+value\s*=\s*["']([\d.]+)["']`)
			if match := propRe.FindStringSubmatch(content); match != nil {
				d.TargetVersion = match[1]
			}
		}
	}

	// Default to 1.6 if not detected
	if d.SourceVersion == "" {
		d.SourceVersion = "1.6"
	}
	if d.TargetVersion == "" {
		d.TargetVersion = "1.6"
	}
}

func (d *ProjectDetection) detectOutputDir(root string) {
	if d.BuildScript == "build.xml" {
		buildPath := filepath.Join(root, "build.xml")
		data, err := os.ReadFile(buildPath)
		if err == nil {
			content := string(data)

			// Look for destdir attribute in javac task
			re := regexp.MustCompile(`(?i)destdir\s*=\s*["']([^"']+)["']`)
			if match := re.FindStringSubmatch(content); match != nil {
				d.OutputDir = match[1]
				return
			}

			// Look for a property named build.dir or build.classes.dir
			propRe := regexp.MustCompile(`(?i)<property\s+name\s*=\s*["'](build\.dir|build\.classes\.dir|classes\.dir)["']\s+value\s*=\s*["']([^"']+)["']`)
			if match := propRe.FindStringSubmatch(content); match != nil {
				d.OutputDir = match[2]
				return
			}
		}
	}

	// Default output directory
	if d.OutputDir == "" {
		if d.BuildSystem == "ant" {
			d.OutputDir = "build/classes"
		} else {
			// Check if bin or target/classes exists
			for _, dir := range []string{"bin", "target/classes", "build/classes", "out"} {
				if info, err := os.Stat(filepath.Join(root, dir)); err == nil && info.IsDir() {
					d.OutputDir = dir
					return
				}
			}
			d.OutputDir = "bin"
		}
	}
}

// Helper functions

func hasJavaFiles(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".java") {
			return true
		}
	}
	return false
}

func findJavaFiles(dir string, maxFiles int) ([]string, error) {
	var files []string
	err := filepath.WalkDir(dir, func(path string, info os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(info.Name()), ".java") {
			files = append(files, path)
			if len(files) >= maxFiles {
				return filepath.SkipAll
			}
		}
		return nil
	})
	return files, err
}

// detectFileEncoding detects encoding from a file by checking BOM
// and scanning for encoding-related comments.
func detectFileEncoding(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()

	// Check for BOM
	bom := make([]byte, 4)
	n, _ := f.Read(bom)
	if n >= 3 {
		if bom[0] == 0xEF && bom[1] == 0xBB && bom[2] == 0xBF {
			return "utf-8-bom"
		}
	}
	if n >= 2 {
		if bom[0] == 0xFE && bom[1] == 0xFF {
			return "utf-16be"
		}
		if bom[0] == 0xFF && bom[1] == 0xFE {
			return "utf-16le"
		}
	}

	// Reset and scan for charset comments
	f.Seek(0, 0)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	charsetRe := regexp.MustCompile(`(?i)(?:charset|encoding)\s*[=:]\s*["']?([A-Za-z0-9_-]+)["']?`)
	linesRead := 0
	for scanner.Scan() && linesRead < 20 {
		line := scanner.Text()
		if match := charsetRe.FindStringSubmatch(line); match != nil {
			return normalizeEncodingName(match[1])
		}
		linesRead++
	}
	return ""
}

func detectXMLEncoding(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	// Parse XML declaration
	var decl struct {
		XMLName  xml.Name `xml:"xml"`
		Encoding string   `xml:"encoding,attr"`
	}
	if err := xml.Unmarshal(data, &decl); err == nil && decl.Encoding != "" {
		return normalizeEncodingName(decl.Encoding)
	}
	// Regex fallback
	re := regexp.MustCompile(`(?i)<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']`)
	if match := re.FindStringSubmatch(string(data)); match != nil {
		return normalizeEncodingName(match[1])
	}
	return ""
}

func normalizeEncodingName(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	switch lower {
	case "utf8", "utf-8":
		return "utf-8"
	case "utf-8-bom":
		return "utf-8-bom"
	case "gbk", "cp936", "ms936":
		return "gbk"
	case "gb18030":
		return "gb18030"
	case "gb2312":
		return "gbk"
	case "iso-8859-1", "iso8859-1", "latin1":
		return "iso-8859-1"
	case "us-ascii", "ascii":
		return "us-ascii"
	case "utf-16le", "utf-16":
		return "utf-16le"
	case "utf-16be":
		return "utf-16be"
	default:
		return lower
	}
}

func extractJDKVersion(output string) string {
	// javac output: "javac 1.8.0_292" or "javac 11.0.2"
	re := regexp.MustCompile(`(\d+\.\d+[\d._]*)`)
	match := re.FindString(output)
	if match != "" {
		// Normalize to major version
		parts := strings.SplitN(match, ".", 3)
		if len(parts) >= 2 {
			// 1.8 -> 1.8, 11.0 -> 11
			if parts[0] == "1" {
				return parts[0] + "." + parts[1]
			}
			return parts[0]
		}
		return match
	}
	return ""
}

func extractVersionFromRelease(content string) string {
	re := regexp.MustCompile(`(?i)JAVA_VERSION\s*=\s*["']([\d._]+)["']`)
	if match := re.FindStringSubmatch(content); match != nil {
		v := match[1]
		parts := strings.SplitN(v, ".", 3)
		if len(parts) >= 2 && parts[0] == "1" {
			return parts[0] + "." + parts[1]
		}
		return parts[0]
	}
	return ""
}

func extractBuildXMLJDKVersion(content string) string {
	// Look for javac executable path or source/target attributes
	// that hint at JDK version
	re := regexp.MustCompile(`(?i)(?:executable|fork)\s*=\s*["']([^"']*javac[^"']*)["']`)
	if match := re.FindStringSubmatch(content); match != nil {
		path := match[1]
		// Try to resolve javac at that path for version
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			cmd := exec.Command(path, "-version")
			output, err := cmd.CombinedOutput()
			if err == nil {
				if v := extractJDKVersion(string(output)); v != "" {
					return v
				}
			}
		}
	}
	return ""
}