package runtime

import (
	"context"
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/proc"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

// AntBuildXML represents a parsed build.xml for Ant.
type AntBuildXML struct {
	XMLName    xml.Name         `xml:"project"`
	Name       string           `xml:"name,attr"`
	Default    string           `xml:"default,attr"`
	Basedir    string           `xml:"basedir,attr"`
	Properties []AntProperty    `xml:"property"`
	Targets    []AntTarget      `xml:"target"`
	Imports    []AntImport      `xml:"import"`
}

// AntProperty is a <property> in build.xml.
type AntProperty struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value,attr"`
}

// AntTarget is a <target> in build.xml.
type AntTarget struct {
	Name     string `xml:"name,attr"`
	Depends  string `xml:"depends,attr"`
	Tasks    []AntTask
}

// AntImport is an <import> in build.xml.
type AntImport struct {
	File string `xml:"file,attr"`
}

// AntTask is a generic task inside a target.
type AntTask struct {
	Name     string
	Attrs    map[string]string
}

// UnmarshalXML decodes an AntTarget that contains arbitrary XML elements.
func (t *AntTarget) UnmarshalXML(d *xml.Decoder, start xml.StartElement) error {
	for _, attr := range start.Attr {
		switch attr.Name.Local {
		case "name":
			t.Name = attr.Value
		case "depends":
			t.Depends = attr.Value
		}
	}
	for {
		tok, err := d.Token()
		if err != nil {
			return err
		}
		switch elem := tok.(type) {
		case xml.StartElement:
			task := AntTask{Name: elem.Name.Local, Attrs: make(map[string]string)}
			for _, attr := range elem.Attr {
				task.Attrs[attr.Name.Local] = attr.Value
			}
			if err := d.Skip(); err != nil {
				return err
			}
			t.Tasks = append(t.Tasks, task)
		case xml.EndElement:
			return nil
		}
	}
}

// AntProvider executes Ant builds using the system ant command.
type AntProvider struct {
	mu         sync.RWMutex
	eventHub   *events.EventHub
	antHome    string
	javaHome   string
}

// AntProviderConfig configures the Ant provider.
type AntProviderConfig struct {
	AntHome  string
	JavaHome string
}

// NewAntProvider creates a new AntProvider.
func NewAntProvider(cfg AntProviderConfig, eventHub *events.EventHub) *AntProvider {
	return &AntProvider{
		eventHub: eventHub,
		antHome:  cfg.AntHome,
		javaHome: cfg.JavaHome,
	}
}

// ID returns the provider identifier.
func (p *AntProvider) ID() domain.BuildToolID {
	return domain.BuildToolAnt
}

// Validate checks that the build plan is valid for Ant.
func (p *AntProvider) Validate(ctx context.Context, plan domain.BuildPlan) error {
	if plan.BuildFile == "" {
		return fmt.Errorf("build file is required for Ant")
	}
	buildFilePath := filepath.Join(plan.ProjectRoot, plan.BuildFile)
	if _, err := os.Stat(buildFilePath); os.IsNotExist(err) {
		return fmt.Errorf("build file %s not found", buildFilePath)
	}
	return nil
}

// Build executes an Ant build.
func (p *AntProvider) Build(ctx context.Context, plan domain.BuildPlan, sink func(event domain.BuildEvent), logLine func(stream domain.LogStream, line string)) (*domain.BuildOutput, error) {
	if err := p.Validate(ctx, plan); err != nil {
		return nil, err
	}

	startTime := domain.UTCNow()

	args := p.buildArgs(plan)
	exe := p.resolveAntExecutable()

	spec := proc.ProcessSpec{
		Executable: exe,
		Args:       args,
		Dir:        plan.ProjectRoot,
		Env:        p.buildEnv(),
	}

	process := proc.New()
	var logMu sync.Mutex
	var logLines []string

	process.SubscribeLogs(func(line domain.LogLine) {
		logMu.Lock()
		defer logMu.Unlock()
		logLines = append(logLines, line.Text)
		if logLine != nil {
			logLine(line.Stream, line.Text)
		}
	})

	buildCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	obs, err := process.Start(buildCtx, spec)
	if err != nil {
		return nil, fmt.Errorf("start ant: %w", err)
	}

	waitDone := make(chan struct{})
	go func() {
		process.Wait()
		close(waitDone)
	}()

	select {
	case <-waitDone:
	case <-buildCtx.Done():
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = process.ForceStop(stopCtx, obs.Identity)
		stopCancel()
		select {
		case <-waitDone:
		case <-time.After(5 * time.Second):
		}
		return nil, fmt.Errorf("ant build %w", buildCtx.Err())
	}

	var exitCode int
	inspectCtx, inspectCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer inspectCancel()
	inspection, err := process.Inspect(inspectCtx, obs.Identity)
	if err == nil && inspection.ExitCode != nil {
		exitCode = *inspection.ExitCode
	} else {
		exitCode = -1
	}

	logMu.Lock()
	output := strings.Join(logLines, "\n")
	logMu.Unlock()

	endTime := domain.UTCNow()

	buildOutput := &domain.BuildOutput{
		ExitCode:    exitCode,
		StartTime:   startTime,
		EndTime:     endTime,
		Diagnostics: parseAntDiagnostics(output, plan.ProjectRoot),
	}

	return buildOutput, nil
}

func (p *AntProvider) buildArgs(plan domain.BuildPlan) []string {
	var args []string

	if plan.BuildFile != "" {
		args = append(args, "-buildfile", plan.BuildFile)
	}

	if plan.Clean {
		args = append(args, "clean")
	}

	for _, target := range plan.Targets {
		if target != "" {
			args = append(args, target)
		}
	}

	if len(plan.Targets) == 0 && !plan.Clean {
		args = append(args, "compile")
	}

	return args
}

func (p *AntProvider) buildEnv() []string {
	env := os.Environ()
	if p.antHome != "" {
		env = append(env, "ANT_HOME="+p.antHome)
	}
	if p.javaHome != "" {
		env = append(env, "JAVA_HOME="+p.javaHome)
	}
	return env
}

func (p *AntProvider) resolveAntExecutable() string {
	if p.antHome != "" {
		antBin := filepath.Join(p.antHome, "bin", "ant")
		if _, err := exec.LookPath(antBin); err == nil {
			return antBin
		}
	}
	return "ant"
}

// ParseBuildXML parses an Ant build.xml file.
func ParseBuildXML(path string) (*AntBuildXML, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read build.xml: %w", err)
	}

	var build AntBuildXML
	if err := xml.Unmarshal(data, &build); err != nil {
		return nil, fmt.Errorf("parse build.xml: %w", err)
	}

	return &build, nil
}

// GetTarget returns a target by name, or nil if not found.
func (b *AntBuildXML) GetTarget(name string) *AntTarget {
	for i := range b.Targets {
		if b.Targets[i].Name == name {
			return &b.Targets[i]
		}
	}
	return nil
}

// ResolveProperties resolves all properties from the build file.
func (b *AntBuildXML) ResolveProperties() map[string]string {
	props := make(map[string]string)
	for _, p := range b.Properties {
		props[p.Name] = p.Value
	}
	return props
}

// ResolveTargetDeps returns the ordered list of targets to execute
// based on the dependency chain, starting from the given target.
func (b *AntBuildXML) ResolveTargetDeps(targetName string) ([]string, error) {
	target := b.GetTarget(targetName)
	if target == nil {
		return nil, fmt.Errorf("target %q not found in build.xml", targetName)
	}

	visited := make(map[string]bool)
	var order []string
	if err := b.resolveDeps(targetName, visited, &order, make(map[string]bool)); err != nil {
		return nil, err
	}
	return order, nil
}

func (b *AntBuildXML) resolveDeps(name string, visited map[string]bool, order *[]string, inStack map[string]bool) error {
	if inStack[name] {
		return fmt.Errorf("circular dependency detected at target %q", name)
	}
	if visited[name] {
		return nil
	}
	inStack[name] = true
	target := b.GetTarget(name)
	if target == nil {
		delete(inStack, name)
		return fmt.Errorf("target %q not found", name)
	}
	if target.Depends != "" {
		deps := strings.Split(target.Depends, ",")
		for _, dep := range deps {
			dep = strings.TrimSpace(dep)
			if dep == "" {
				continue
			}
			if err := b.resolveDeps(dep, visited, order, inStack); err != nil {
				return err
			}
		}
	}
	delete(inStack, name)
	visited[name] = true
	*order = append(*order, name)
	return nil
}

// parseAntDiagnostics parses Ant build output for error messages.
func parseAntDiagnostics(output, projectRoot string) []domain.BuildDiagnostic {
	var diags []domain.BuildDiagnostic
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Match Ant error patterns like:
		// [javac] /path/to/File.java:10: error: message
		// BUILD FAILED
		lower := strings.ToLower(line)
		if strings.Contains(lower, "error") || strings.Contains(lower, "build failed") {
			diags = append(diags, domain.BuildDiagnostic{
				File:     projectRoot,
				Line:     0,
				Column:   0,
				Severity: "error",
				Message:  line,
			})
		}
	}
	return diags
}