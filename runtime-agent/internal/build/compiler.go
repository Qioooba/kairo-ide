package build

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/proc"
)

type Request struct {
	ProjectRoot string
	Toolchain   string
	SourceLevel string
	TargetLevel string
	Sources     []string
	Classpath   []string
	OutputDir   string
	WebappDir   string
	Encoding    string
	Args        []string
	Timeout     time.Duration
	WorkingDir  string
}

type Result struct {
	Success       bool         `json:"success"`
	Diagnostics   []Diagnostic `json:"diagnostics"`
	Output        string       `json:"output"`
	FilesCompiled int          `json:"filesCompiled"`
	ElapsedMs     int64        `json:"elapsedMs"`
	ExitCode      int          `json:"exitCode"`
}

type Diagnostic struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

type Compiler struct {
	mu       sync.Mutex
	javaHome string
}

const compilerStopTimeout = 5 * time.Second

func New(javaHome string) *Compiler {
	return &Compiler{javaHome: javaHome}
}

func (c *Compiler) Compile(ctx context.Context, req Request) (*Result, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c.javaHome == "" {
		return nil, errors.New("compiler toolchain not set")
	}
	if len(req.Sources) == 0 {
		return &Result{Success: true}, nil
	}
	if req.Timeout <= 0 {
		req.Timeout = 5 * time.Minute
	}

	args := []string{}
	if req.Args != nil {
		args = append(args, req.Args...)
	} else {
		args = append(args,
			"-source", req.SourceLevel,
			"-target", req.TargetLevel,
		)
		if req.Encoding != "" {
			args = append(args, "-encoding", req.Encoding)
		}
		if len(req.Classpath) > 0 {
			args = append(args, "-classpath", strings.Join(req.Classpath, string(filepath.ListSeparator)))
		}
		if req.OutputDir != "" {
			args = append(args, "-d", req.OutputDir)
		}
		args = append(args, "-Xlint:all")
		if shouldUseJavacArgFile(args, req.Sources) {
			argFile, err := writeJavacArgFile(req.ProjectRoot, req.Sources)
			if err != nil {
				return nil, fmt.Errorf("write javac argfile: %w", err)
			}
			defer os.Remove(argFile)
			args = append(args, "@"+argFile)
		} else {
			args = append(args, req.Sources...)
		}
	}

	bin := filepath.Join(c.javaHome, "bin", "javac")
	if _, err := exec.LookPath(bin); err != nil {
		bin = "javac"
	}
	dir := req.WorkingDir
	if dir == "" {
		dir = req.ProjectRoot
	}
	started := time.Now()

	p := proc.New()
	var logMu sync.Mutex
	var logLines []string

	p.SubscribeLogs(func(line domain.LogLine) {
		logMu.Lock()
		defer logMu.Unlock()
		logLines = append(logLines, line.Text)
	})

	spec := proc.ProcessSpec{
		Executable: bin,
		Args:       args,
		Dir:        dir,
	}

	cctx, cancel := context.WithTimeout(ctx, req.Timeout)
	defer cancel()

	obs, err := p.Start(cctx, spec)
	if err != nil {
		return nil, err
	}

	// ManagedProcess intentionally outlives the context passed to Start
	// because server processes use the same abstraction. A compiler is
	// different: cancellation and the build timeout must terminate the
	// complete javac process tree. Wait through a channel so this call is
	// bounded even when javac or one of its children hangs.
	waitDone := make(chan struct{})
	go func() {
		p.Wait()
		close(waitDone)
	}()
	select {
	case <-waitDone:
	case <-cctx.Done():
		stopCtx, stopCancel := context.WithTimeout(context.Background(), compilerStopTimeout)
		stopErr := p.ForceStop(stopCtx, obs.Identity)
		stopCancel()
		if stopErr != nil {
			return nil, fmt.Errorf("javac %w; force-stop process tree: %v", cctx.Err(), stopErr)
		}
		select {
		case <-waitDone:
		case <-time.After(compilerStopTimeout):
			return nil, fmt.Errorf("javac %w; process tree did not exit within %s", cctx.Err(), compilerStopTimeout)
		}
		return nil, fmt.Errorf("javac %w", cctx.Err())
	}

	var exitCode int
	inspectCtx, inspectCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer inspectCancel()
	inspection, err := p.Inspect(inspectCtx, obs.Identity)
	if err == nil && inspection.ExitCode != nil {
		exitCode = *inspection.ExitCode
	} else {
		exitCode = -1
	}

	logMu.Lock()
	output := strings.Join(logLines, "\n")
	logMu.Unlock()

	res := &Result{
		Output:    output,
		ElapsedMs: time.Since(started).Milliseconds(),
		ExitCode:  exitCode,
	}
	res.Diagnostics = parseDiagnostics(res.Output, req.ProjectRoot)
	if res.Diagnostics == nil {
		res.Diagnostics = []Diagnostic{}
	}
	res.Success = res.ExitCode == 0
	// KAIRO-RC-WEB-238 follow-up: modern javac prints no
	// "Note: N files" line, so countCompiled always returned 0
	// even for successful builds. A zero exit means every source
	// passed to javac compiled — report that honestly.
	if res.Success {
		res.FilesCompiled = len(req.Sources)
	} else {
		res.FilesCompiled = countCompiled(res.Output)
	}
	return res, nil
}

func shouldUseJavacArgFile(args, sources []string) bool {
	if runtime.GOOS == "windows" && len(sources) > 50 {
		return true
	}
	length := 0
	for _, arg := range args {
		length += len(arg) + 1
	}
	for _, source := range sources {
		length += len(source) + 1
	}
	return length > 24*1024
}

func writeJavacArgFile(projectRoot string, sources []string) (string, error) {
	if projectRoot == "" {
		return "", errors.New("project root is required for javac argfile")
	}
	file, err := os.CreateTemp(projectRoot, ".kairo-javac-*.args")
	if err != nil {
		return "", err
	}
	name := file.Name()
	ok := false
	defer func() {
		_ = file.Close()
		if !ok {
			_ = os.Remove(name)
		}
	}()
	bw := bufio.NewWriter(file)
	for _, source := range sources {
		escaped := strings.ReplaceAll(source, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `"`, `\"`)
		if _, err := bw.WriteString("\""); err != nil {
			return "", err
		}
		if _, err := bw.WriteString(escaped); err != nil {
			return "", err
		}
		if _, err := bw.WriteString("\"\n"); err != nil {
			return "", err
		}
	}
	if err := bw.Flush(); err != nil {
		return "", err
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	ok = true
	return name, nil
}

var (
	// Locale-tolerant javac diagnostic line. The <path>:<line>: prefix
	// is universal; the severity word is localized by the JDK, so match
	// both English (error/warning) and Chinese (错误/警告) markers, with
	// either an ASCII or a fullwidth colon after the marker.
	javacLineRE = regexp.MustCompile(`^(.+?):(\d+):(?:\s*(\d+):)?\s*(error|warning|错误|警告)[:：]\s*(.*)$`)
	javacCodeRE = regexp.MustCompile(`\[(\w+\.\w+(?:\.\w+)*)\]`)
)

// normalizeSeverity maps localized javac severity markers to the
// canonical English severities used in Diagnostic.
func normalizeSeverity(s string) string {
	switch s {
	case "错误":
		return "error"
	case "警告":
		return "warning"
	}
	return s
}

func parseDiagnostics(output, projectRoot string) []Diagnostic {
	var out []Diagnostic
	scanner := bufio.NewScanner(bytes.NewReader([]byte(output)))
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	var current *Diagnostic
	for scanner.Scan() {
		line := scanner.Text()
		m := javacLineRE.FindStringSubmatch(line)
		if m != nil {
			if current != nil {
				out = append(out, *current)
			}
			file := m[1]
			if !filepath.IsAbs(file) && projectRoot != "" {
				file = filepath.Join(projectRoot, file)
			}
			ln, _ := strconv.Atoi(m[2])
			col, _ := strconv.Atoi(m[3])
			if col == 0 {
				col = 1
			}
			current = &Diagnostic{
				File:     file,
				Line:     ln,
				Column:   col,
				Severity: normalizeSeverity(m[4]),
				Message:  m[5],
			}
			if cm := javacCodeRE.FindStringSubmatch(m[5]); cm != nil {
				current.Code = cm[1]
			}
			continue
		}
		if current != nil && strings.HasPrefix(line, " ") {
			current.Message += "\n" + strings.TrimSpace(line)
			continue
		}
		if current != nil {
			out = append(out, *current)
			current = nil
		}
	}
	if current != nil {
		out = append(out, *current)
	}
	return out
}

var compiledCountRE = regexp.MustCompile(`(?m)^Note:\s*(\d+)\s+files? (use|recompile|to recompile)`)

func countCompiled(output string) int {
	m := compiledCountRE.FindStringSubmatch(output)
	if len(m) >= 2 {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	return 0
}

// defaultExcludeDirs contains directories commonly excluded from builds.
var defaultExcludeDirs = []string{".git", ".svn", "node_modules", "target", "build", ".kairo"}

// defaultExcludeSet is a pre-built lookup set for defaultExcludeDirs.
var defaultExcludeSet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(defaultExcludeDirs))
	for _, d := range defaultExcludeDirs {
		m[d] = struct{}{}
	}
	return m
}()

// CollectSources walks source roots and collects all .java files.
// It skips directories commonly excluded from builds.
func CollectSources(sourceRoots []string, excludeDirs []string) ([]string, error) {
	excludeSet := defaultExcludeSet
	if len(excludeDirs) > 0 {
		excludeSet = make(map[string]struct{}, len(excludeDirs))
		for _, d := range excludeDirs {
			excludeSet[d] = struct{}{}
		}
	}

	var sources []string
	for _, root := range sourceRoots {
		root = filepath.Clean(root)
		err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if _, excluded := excludeSet[d.Name()]; excluded {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.EqualFold(filepath.Ext(d.Name()), ".java") {
				sources = append(sources, path)
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("walk source root %s: %w", root, err)
		}
	}
	return sources, nil
}

// ResolveClasspath resolves classpath entries from a list of library directories
// and individual jar files. It walks library directories recursively to find .jar files.
func ResolveClasspath(libDirs []string, extraJars []string) ([]string, error) {
	var classpath []string

	for _, dir := range libDirs {
		dir = filepath.Clean(dir)
		info, err := os.Stat(dir)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, fmt.Errorf("stat lib dir %s: %w", dir, err)
		}
		if !info.IsDir() {
			classpath = append(classpath, dir)
			continue
		}
		err = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if strings.EqualFold(filepath.Ext(d.Name()), ".jar") {
				classpath = append(classpath, path)
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("walk lib dir %s: %w", dir, err)
		}
	}

	for _, jar := range extraJars {
		classpath = append(classpath, jar)
	}

	return classpath, nil
}

// IncrementalSources filters the given sources to only those that are newer
// than their corresponding .class files in the output directory. If the output
// directory doesn't exist or the .class file is missing, the source is included.
func IncrementalSources(sources []string, outputDir string) []string {
	incremental := make([]string, 0, len(sources))
	for _, src := range sources {
		classFile := sourceToClassFile(src, outputDir)
		if classFile == "" {
			incremental = append(incremental, src)
			continue
		}
		srcInfo, srcErr := os.Stat(src)
		if srcErr != nil {
			incremental = append(incremental, src)
			continue
		}
		classInfo, classErr := os.Stat(classFile)
		if classErr != nil {
			incremental = append(incremental, src)
			continue
		}
		if srcInfo.ModTime().After(classInfo.ModTime()) {
			incremental = append(incremental, src)
		}
	}
	return incremental
}

// sourceToClassFile converts a .java source path to its corresponding .class
// file path in the output directory. It preserves the package directory structure.
func sourceToClassFile(sourcePath, outputDir string) string {
	base := filepath.Base(sourcePath)
	if !strings.HasSuffix(strings.ToLower(base), ".java") {
		return ""
	}
	className := base[:len(base)-5] + ".class"
	// Try to find the package structure from the source file
	// The simplest approach: look for the package declaration and use the parent dir
	dir := filepath.Dir(sourcePath)
	// For a simple flat structure, just use the output dir
	if filepath.Dir(dir) == filepath.Dir(outputDir) || dir == filepath.Dir(outputDir) {
		return filepath.Join(outputDir, className)
	}

	// Try to read the package declaration from the source file
	pkg := readPackageDeclaration(sourcePath)
	if pkg != "" {
		pkgPath := filepath.Join(strings.Split(pkg, ".")...)
		return filepath.Join(outputDir, pkgPath, className)
	}

	// Fallback: use the directory structure relative to a common ancestor
	return filepath.Join(outputDir, className)
}

// readPackageDeclaration reads the package declaration from a Java source file.
func readPackageDeclaration(sourcePath string) string {
	f, err := os.Open(sourcePath)
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "package ") {
			pkg := strings.TrimPrefix(line, "package ")
			pkg = strings.TrimSuffix(pkg, ";")
			pkg = strings.TrimSpace(pkg)
			return pkg
		}
		// Stop at the first non-comment, non-empty line that isn't a package declaration
		if line != "" && !strings.HasPrefix(line, "//") && !strings.HasPrefix(line, "/*") && !strings.HasPrefix(line, "*") {
			break
		}
	}
	return ""
}

// DetermineEncoding resolves the encoding to use for compilation.
// It checks the request encoding first, then falls back to the default.
func DetermineEncoding(reqEncoding string) string {
	if reqEncoding != "" {
		return reqEncoding
	}
	return "UTF-8"
}

// BuildClasspathString joins classpath entries using the platform path separator.
func BuildClasspathString(entries []string) string {
	return strings.Join(entries, string(filepath.ListSeparator))
}
