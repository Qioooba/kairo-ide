package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

type RunJavaRequest struct {
	ProjectRoot string `json:"projectRoot"`
	FilePath    string `json:"filePath"`
	ClassName   string `json:"className"`
	PackageName string `json:"packageName"`
	Line        int    `json:"line"`
	Debug       bool   `json:"debug"`
	MethodType  string `json:"methodType"` // "main" | "test"
}

type RunJavaResponse struct {
	OK          bool   `json:"ok"`
	ExitCode    int    `json:"exitCode"`
	Stdout      string `json:"stdout"`
	Stderr      string `json:"stderr"`
	BuildDir    string `json:"buildDir,omitempty"`
	Classpath   string `json:"classpath,omitempty"`
	Error       string `json:"error,omitempty"`
}

type JavaClassInfo struct {
	PackageName string           `json:"packageName"`
	ClassName   string           `json:"className"`
	Methods     []JavaMethodInfo `json:"methods"`
	Mtime       int64            `json:"-"`
}

type JavaMethodInfo struct {
	Name      string `json:"name"`
	Line      int    `json:"line"`
	IsMain    bool   `json:"isMain"`
	IsTest    bool   `json:"isTest"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
}

var (
	javaClassCache = make(map[string]*JavaClassInfo)
	javaCacheMu    sync.RWMutex
	maxScanBufSize = 1024 * 1024 // 1MB
)

func (s *Server) handleRunJava(w http.ResponseWriter, r *http.Request) {
	rid, cid, _, _ := log.FromContext(r.Context())
	env := protocol.RequestEnvelope{RequestID: rid, CorrelationID: cid}
	if err := requireMethod(r, http.MethodPost); err != nil {
		writeError(w, rid, cid, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	var req RunJavaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, rid, cid, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if req.ProjectRoot == "" || req.FilePath == "" || req.ClassName == "" {
		writeError(w, rid, cid, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "projectRoot, filePath, className are required"})
		return
	}

	resp, err := s.compileAndRunJava(r.Context(), req)
	if err != nil {
		writeError(w, rid, cid, protocol.KairoError{Code: protocol.ErrInternal, Message: err.Error()})
		return
	}
	writeOK(w, env, resp)
}

func (s *Server) handleDetectJava(w http.ResponseWriter, r *http.Request) {
	rid, cid, _, _ := log.FromContext(r.Context())
	env := protocol.RequestEnvelope{RequestID: rid, CorrelationID: cid}
	if err := requireMethod(r, http.MethodPost); err != nil {
		writeError(w, rid, cid, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	var req struct {
		FilePath string `json:"filePath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, rid, cid, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if req.FilePath == "" {
		writeError(w, rid, cid, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "filePath is required"})
		return
	}
	info, err := parseJavaFile(req.FilePath)
	if err != nil {
		writeError(w, rid, cid, protocol.KairoError{Code: protocol.ErrInternal, Message: err.Error()})
		return
	}
	writeOK(w, env, info)
}

func (s *Server) compileAndRunJava(ctx context.Context, req RunJavaRequest) (*RunJavaResponse, error) {
	javaExe, err := exec.LookPath("java")
	if err != nil {
		javaExe = "java"
	}
	javacExe, err := exec.LookPath("javac")
	if err != nil {
		javacExe = "javac"
	}

	buildDir := filepath.Join(req.ProjectRoot, "build", "classes")
	if err := os.MkdirAll(buildDir, 0755); err != nil {
		return nil, fmt.Errorf("create build dir: %w", err)
	}

	classpath := s.resolveJavaClasspath(req.ProjectRoot)

	var stdoutBuf, stderrBuf bytes.Buffer
	fullClassName := req.ClassName
	if req.PackageName != "" {
		fullClassName = req.PackageName + "." + req.ClassName
	}

	compilerCp := buildDir
	if classpath != "" {
		compilerCp = buildDir + string(os.PathListSeparator) + classpath
	}

	javacArgs := []string{
		"-d", buildDir,
		"-cp", compilerCp,
	}

	srcDir := filepath.Join(req.ProjectRoot, "src")
	sourcepath := req.ProjectRoot
	if _, err := os.Stat(srcDir); err == nil {
		sourcepath = srcDir
	}
	javacArgs = append(javacArgs, "-sourcepath", sourcepath)

	javaFiles, err := s.collectJavaSources(req.ProjectRoot)
	if err != nil {
		s.logger.Warn("collect java sources failed", log.Fields{"err": err.Error()})
		javacArgs = append(javacArgs, req.FilePath)
	} else if len(javaFiles) > 0 {
		javacArgs = append(javacArgs, javaFiles...)
	} else {
		javacArgs = append(javacArgs, req.FilePath)
	}

	javacCmd := exec.CommandContext(ctx, javacExe, javacArgs...)
	javacCmd.Dir = req.ProjectRoot
	javacCmd.Stdout = &stdoutBuf
	javacCmd.Stderr = &stderrBuf

	s.logger.Info("compiling java", log.Fields{"cmd": javacCmd.String()})
	if err := javacCmd.Run(); err != nil {
		return &RunJavaResponse{
			OK:        false,
			ExitCode:  1,
			Stdout:    stdoutBuf.String(),
			Stderr:    stderrBuf.String(),
			BuildDir:  buildDir,
			Classpath: compilerCp,
			Error:     fmt.Sprintf("compilation failed: %v\n%s", err, stderrBuf.String()),
		}, nil
	}

	stdoutBuf.Reset()
	stderrBuf.Reset()

	runCp := buildDir
	if classpath != "" {
		runCp = buildDir + string(os.PathListSeparator) + classpath
	}

	javaArgs := []string{
		"-cp", runCp,
	}

	if req.Debug {
		javaArgs = append(javaArgs,
			"-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=18400",
		)
	}

	javaArgs = append(javaArgs, fullClassName)

	if req.MethodType == "test" {
		testRunner := "org.junit.runner.JUnitCore"
		junitJar := s.findJUnitJar(req.ProjectRoot)
		if junitJar != "" {
			runCp = runCp + string(os.PathListSeparator) + junitJar
			javaArgs = []string{
				"-cp", runCp,
			}
			if req.Debug {
				javaArgs = append(javaArgs,
					"-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=18400",
				)
			}
			javaArgs = append(javaArgs, testRunner, fullClassName)
		} else {
			stdoutBuf.WriteString("Note: JUnit not found in classpath, running main method if exists\n")
			javaArgs = append(javaArgs, fullClassName)
		}
	}

	javaCmd := exec.CommandContext(ctx, javaExe, javaArgs...)
	javaCmd.Dir = req.ProjectRoot

	stdoutPipe, err := javaCmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderrPipe, err := javaCmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	s.logger.Info("running java", log.Fields{"cmd": javaCmd.String(), "debug": req.Debug})
	if err := javaCmd.Start(); err != nil {
		return &RunJavaResponse{
			OK:       false,
			ExitCode: 1,
			Stderr:   fmt.Sprintf("failed to start: %v", err),
			Error:    err.Error(),
		}, nil
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdoutPipe)
		scanner.Buffer(make([]byte, 0, 64*1024), maxScanBufSize)
		for scanner.Scan() {
			line := scanner.Text()
			stdoutBuf.WriteString(line + "\n")
		}
	}()

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderrPipe)
		scanner.Buffer(make([]byte, 0, 64*1024), maxScanBufSize)
		for scanner.Scan() {
			line := scanner.Text()
			stderrBuf.WriteString(line + "\n")
		}
	}()

	done := make(chan error, 1)
	go func() {
		wg.Wait()
		done <- javaCmd.Wait()
	}()

	select {
	case err := <-done:
		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = 1
			}
		}
		return &RunJavaResponse{
			OK:        err == nil,
			ExitCode:  exitCode,
			Stdout:    stdoutBuf.String(),
			Stderr:    stderrBuf.String(),
			BuildDir:  buildDir,
			Classpath: runCp,
		}, nil
	case <-ctx.Done():
		_ = javaCmd.Process.Kill()
		return &RunJavaResponse{
			OK:       false,
			ExitCode: -1,
			Stdout:   stdoutBuf.String(),
			Stderr:   "execution timeout or cancelled",
			Error:    ctx.Err().Error(),
		}, nil
	}
}

func (s *Server) resolveJavaClasspath(projectRoot string) string {
	var paths []string

	libDir := filepath.Join(projectRoot, "lib")
	if entries, err := os.ReadDir(libDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() && (strings.HasSuffix(e.Name(), ".jar") || strings.HasSuffix(e.Name(), ".zip")) {
				paths = append(paths, filepath.Join(libDir, e.Name()))
			}
		}
	}

	webInfLib := filepath.Join(projectRoot, "WebRoot", "WEB-INF", "lib")
	if entries, err := os.ReadDir(webInfLib); err == nil {
		for _, e := range entries {
			if !e.IsDir() && (strings.HasSuffix(e.Name(), ".jar") || strings.HasSuffix(e.Name(), ".zip")) {
				paths = append(paths, filepath.Join(webInfLib, e.Name()))
			}
		}
	}

	webInfClasses := filepath.Join(projectRoot, "WebRoot", "WEB-INF", "classes")
	if info, err := os.Stat(webInfClasses); err == nil && info.IsDir() {
		paths = append(paths, webInfClasses)
	}

	buildClasses := filepath.Join(projectRoot, "build", "classes")
	if info, err := os.Stat(buildClasses); err == nil && info.IsDir() {
		paths = append(paths, buildClasses)
	}

	buildLib := filepath.Join(projectRoot, "build", "lib")
	if entries, err := os.ReadDir(buildLib); err == nil {
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".jar") {
				paths = append(paths, filepath.Join(buildLib, e.Name()))
			}
		}
	}

	if javaHome := os.Getenv("JAVA_HOME"); javaHome != "" {
		rtJar := filepath.Join(javaHome, "jre", "lib", "rt.jar")
		if _, err := os.Stat(rtJar); err == nil {
			paths = append(paths, rtJar)
		}
	}

	return strings.Join(paths, string(os.PathListSeparator))
}

func (s *Server) findJUnitJar(projectRoot string) string {
	candidates := []string{
		filepath.Join(projectRoot, "lib", "junit-4.13.2.jar"),
		filepath.Join(projectRoot, "lib", "junit-4.13.jar"),
		filepath.Join(projectRoot, "lib", "junit-4.12.jar"),
		filepath.Join(projectRoot, "lib", "junit.jar"),
		filepath.Join(projectRoot, "WebRoot", "WEB-INF", "lib", "junit-4.13.2.jar"),
		filepath.Join(projectRoot, "WebRoot", "WEB-INF", "lib", "junit-4.12.jar"),
		filepath.Join(projectRoot, "WebRoot", "WEB-INF", "lib", "junit.jar"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	libDir := filepath.Join(projectRoot, "lib")
	if entries, err := os.ReadDir(libDir); err == nil {
		for _, e := range entries {
			name := strings.ToLower(e.Name())
			if strings.HasPrefix(name, "junit") && strings.HasSuffix(name, ".jar") {
				return filepath.Join(libDir, e.Name())
			}
		}
	}
	webInfLib := filepath.Join(projectRoot, "WebRoot", "WEB-INF", "lib")
	if entries, err := os.ReadDir(webInfLib); err == nil {
		for _, e := range entries {
			name := strings.ToLower(e.Name())
			if strings.HasPrefix(name, "junit") && strings.HasSuffix(name, ".jar") {
				return filepath.Join(webInfLib, e.Name())
			}
		}
	}
	return ""
}

func (s *Server) collectJavaSources(projectRoot string) ([]string, error) {
	var files []string
	srcDirs := []string{
		filepath.Join(projectRoot, "src"),
		filepath.Join(projectRoot, "src", "main", "java"),
		filepath.Join(projectRoot, "src", "test", "java"),
	}
	for _, srcDir := range srcDirs {
		if _, err := os.Stat(srcDir); err != nil {
			continue
		}
		err := filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if !info.IsDir() && strings.HasSuffix(path, ".java") {
				files = append(files, path)
			}
			return nil
		})
		if err != nil {
			return files, err
		}
	}
	return files, nil
}

var (
	packageRegex    = regexp.MustCompile(`^\s*package\s+([\w.]+)\s*;`)
	classRegex      = regexp.MustCompile(`(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)`)
	mainMethodRegex = regexp.MustCompile(`public\s+static\s+(?:final\s+)?void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]|\.\.\.)\s+\w+\s*\)`)
	testAnnotRegex  = regexp.MustCompile(`@Test`)
	methodRegex     = regexp.MustCompile(`(?:public\s+|protected\s+|private\s+|static\s+|final\s+|abstract\s+|synchronized\s+)*[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{?`)
)

func parseJavaFile(filePath string) (*JavaClassInfo, error) {
	stat, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}
	currentMtime := stat.ModTime().UnixMilli()

	javaCacheMu.RLock()
	if cached, ok := javaClassCache[filePath]; ok && cached.Mtime >= currentMtime {
		javaCacheMu.RUnlock()
		return cached, nil
	}
	javaCacheMu.RUnlock()

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	content := string(data)
	lines := strings.Split(content, "\n")

	info := &JavaClassInfo{Methods: []JavaMethodInfo{}, Mtime: currentMtime}

	if m := packageRegex.FindStringSubmatch(content); m != nil {
		info.PackageName = m[1]
	}

	if m := classRegex.FindStringSubmatch(content); m != nil {
		info.ClassName = m[1]
	}

	for i, line := range lines {
		lineNum := i + 1
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "//") {
			continue
		}

		isMain := mainMethodRegex.MatchString(trimmed)
		isTest := false
		if i > 0 {
			prevTrimmed := strings.TrimSpace(lines[i-1])
			isTest = testAnnotRegex.MatchString(prevTrimmed)
		}
		if testAnnotRegex.MatchString(trimmed) && i < len(lines)-1 {
			nextTrimmed := strings.TrimSpace(lines[i+1])
			if strings.Contains(nextTrimmed, "(") && strings.Contains(nextTrimmed, ")") {
				isTest = true
			}
		}

		if isMain || isTest {
			method := JavaMethodInfo{
				Line:      lineNum,
				StartLine: lineNum,
				EndLine:   lineNum,
				IsMain:    isMain,
				IsTest:    isTest,
			}
			if isMain {
				method.Name = "main"
			} else if mm := regexp.MustCompile(`(\w+)\s*\(`).FindStringSubmatch(trimmed); mm != nil {
				method.Name = mm[1]
			} else if i < len(lines)-1 {
				nextTrimmed := strings.TrimSpace(lines[i+1])
				if mm := regexp.MustCompile(`(\w+)\s*\(`).FindStringSubmatch(nextTrimmed); mm != nil {
					method.Name = mm[1]
					method.Line = lineNum + 1
					method.StartLine = lineNum + 1
				}
			}

			braceCount := 0
			foundStart := false
			for j := i; j < len(lines); j++ {
				l := lines[j]
				braceCount += strings.Count(l, "{") - strings.Count(l, "}")
				if !foundStart && strings.Contains(l, "{") {
					foundStart = true
				}
				if foundStart && braceCount <= 0 {
					method.EndLine = j + 1
					break
				}
			}
			if method.EndLine == method.StartLine {
				method.EndLine = lineNum + 10
			}
			info.Methods = append(info.Methods, method)
		}
	}

	javaCacheMu.Lock()
	javaClassCache[filePath] = info
	javaCacheMu.Unlock()

	return info, nil
}

func init() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			javaCacheMu.Lock()
			javaClassCache = make(map[string]*JavaClassInfo)
			javaCacheMu.Unlock()
		}
	}()
}
