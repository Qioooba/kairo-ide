package build

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"regexp"
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

func New(javaHome string) *Compiler {
	return &Compiler{javaHome: javaHome}
}

func (c *Compiler) Compile(ctx context.Context, req Request) (*Result, error) {
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
	}
	args = append(args, req.Sources...)

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

	p.Wait()

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
