package runtime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

func TestParseBuildXML(t *testing.T) {
	buildXML, err := ParseBuildXML("../../../test/fixtures/ant-project/build.xml")
	if err != nil {
		// Try relative path from test working directory
		buildXML, err = ParseBuildXML(filepath.Join("..", "..", "..", "test", "fixtures", "ant-project", "build.xml"))
	}
	if err != nil {
		t.Fatalf("ParseBuildXML failed: %v", err)
	}

	if buildXML.Name != "test-ant" {
		t.Errorf("expected name 'test-ant', got %q", buildXML.Name)
	}
	if buildXML.Default != "compile" {
		t.Errorf("expected default 'compile', got %q", buildXML.Default)
	}
	if len(buildXML.Targets) != 2 {
		t.Errorf("expected 2 targets, got %d", len(buildXML.Targets))
	}
	if len(buildXML.Properties) != 2 {
		t.Errorf("expected 2 properties, got %d", len(buildXML.Properties))
	}
}

func TestParseBuildXML_InlineXML(t *testing.T) {
	dir := t.TempDir()
	xmlPath := filepath.Join(dir, "build.xml")
	content := `<?xml version="1.0" encoding="UTF-8"?>
<project name="test" default="dist" basedir=".">
    <property name="src.dir" value="src"/>
    <property name="build.dir" value="build"/>
    <target name="init">
        <mkdir dir="${build.dir}"/>
    </target>
    <target name="compile" depends="init">
        <javac srcdir="${src.dir}" destdir="${build.dir}"/>
    </target>
    <target name="dist" depends="compile">
        <jar destfile="dist/app.jar" basedir="${build.dir}"/>
    </target>
</project>`
	if err := os.WriteFile(xmlPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	build, err := ParseBuildXML(xmlPath)
	if err != nil {
		t.Fatalf("ParseBuildXML failed: %v", err)
	}

	if build.Name != "test" {
		t.Errorf("expected name 'test', got %q", build.Name)
	}
	if build.Default != "dist" {
		t.Errorf("expected default 'dist', got %q", build.Default)
	}
	if len(build.Targets) != 3 {
		t.Errorf("expected 3 targets, got %d", len(build.Targets))
	}
	if len(build.Properties) != 2 {
		t.Errorf("expected 2 properties, got %d", len(build.Properties))
	}
}

func TestParseBuildXML_MissingFile(t *testing.T) {
	_, err := ParseBuildXML("/nonexistent/build.xml")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestAntBuildXML_GetTarget(t *testing.T) {
	build := &AntBuildXML{
		Targets: []AntTarget{
			{Name: "compile"},
			{Name: "dist", Depends: "compile"},
		},
	}

	target := build.GetTarget("compile")
	if target == nil {
		t.Fatal("expected to find 'compile' target")
	}
	if target.Name != "compile" {
		t.Errorf("expected name 'compile', got %q", target.Name)
	}

	target = build.GetTarget("dist")
	if target == nil {
		t.Fatal("expected to find 'dist' target")
	}
	if target.Depends != "compile" {
		t.Errorf("expected depends 'compile', got %q", target.Depends)
	}

	target = build.GetTarget("nonexistent")
	if target != nil {
		t.Error("expected nil for nonexistent target")
	}
}

func TestAntBuildXML_ResolveProperties(t *testing.T) {
	build := &AntBuildXML{
		Properties: []AntProperty{
			{Name: "src.dir", Value: "src"},
			{Name: "build.dir", Value: "build"},
		},
	}

	props := build.ResolveProperties()
	if len(props) != 2 {
		t.Errorf("expected 2 properties, got %d", len(props))
	}
	if props["src.dir"] != "src" {
		t.Errorf("expected src.dir='src', got %q", props["src.dir"])
	}
	if props["build.dir"] != "build" {
		t.Errorf("expected build.dir='build', got %q", props["build.dir"])
	}
}

func TestAntBuildXML_ResolveProperties_Empty(t *testing.T) {
	build := &AntBuildXML{}
	props := build.ResolveProperties()
	if len(props) != 0 {
		t.Errorf("expected 0 properties, got %d", len(props))
	}
}

func TestResolveTargetDeps(t *testing.T) {
	build := &AntBuildXML{
		Targets: []AntTarget{
			{Name: "init"},
			{Name: "compile", Depends: "init"},
			{Name: "dist", Depends: "compile"},
			{Name: "deploy", Depends: "dist"},
		},
	}

	tests := []struct {
		name     string
		target   string
		wantDeps []string
		wantErr  bool
	}{
		{"single target", "init", []string{"init"}, false},
		{"one dep", "compile", []string{"init", "compile"}, false},
		{"chain of deps", "dist", []string{"init", "compile", "dist"}, false},
		{"long chain", "deploy", []string{"init", "compile", "dist", "deploy"}, false},
		{"not found", "nonexistent", nil, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			order, err := build.ResolveTargetDeps(tt.target)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(order) != len(tt.wantDeps) {
				t.Fatalf("expected %d targets, got %d: %v", len(tt.wantDeps), len(order), order)
			}
			for i, name := range tt.wantDeps {
				if order[i] != name {
					t.Errorf("order[%d] = %q, want %q", i, order[i], name)
				}
			}
		})
	}
}

func TestResolveTargetDeps_Circular(t *testing.T) {
	build := &AntBuildXML{
		Targets: []AntTarget{
			{Name: "a", Depends: "b"},
			{Name: "b", Depends: "a"},
		},
	}

	_, err := build.ResolveTargetDeps("a")
	if err == nil {
		t.Fatal("expected circular dependency error")
	}
	if !strings.Contains(err.Error(), "circular") {
		t.Errorf("expected circular dependency message, got: %v", err)
	}
}

func TestResolveTargetDeps_MultipleDeps(t *testing.T) {
	build := &AntBuildXML{
		Targets: []AntTarget{
			{Name: "init"},
			{Name: "clean"},
			{Name: "compile", Depends: "init, clean"},
		},
	}

	order, err := build.ResolveTargetDeps("compile")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(order) != 3 {
		t.Fatalf("expected 3 targets, got %d: %v", len(order), order)
	}
	// Verify init comes before compile and clean comes before compile
	foundInit := false
	foundClean := false
	foundCompile := false
	for _, name := range order {
		switch name {
		case "init":
			foundInit = true
		case "clean":
			foundClean = true
		case "compile":
			if !foundInit || !foundClean {
				t.Errorf("compile should be after init and clean, got order: %v", order)
			}
			foundCompile = true
		}
	}
	if !foundCompile {
		t.Error("compile target not found in resolved order")
	}
}

func TestAntProvider_ID(t *testing.T) {
	p := NewAntProvider(AntProviderConfig{}, nil)
	if p.ID() != "ant" {
		t.Errorf("expected ID 'ant', got %q", p.ID())
	}
}

func TestAntProvider_Validate_NoBuildFile(t *testing.T) {
	p := NewAntProvider(AntProviderConfig{}, nil)
	err := p.Validate(context.Background(), domain.BuildPlan{
		ProjectRoot: "/tmp",
		BuildFile:   "",
	})
	if err == nil {
		t.Fatal("expected error for missing build file")
	}
}

func TestAntProvider_Validate_BuildFileNotFound(t *testing.T) {
	p := NewAntProvider(AntProviderConfig{}, nil)
	err := p.Validate(context.Background(), domain.BuildPlan{
		ProjectRoot: "/tmp",
		BuildFile:   "nonexistent.xml",
	})
	if err == nil {
		t.Fatal("expected error for non-existent build file")
	}
}

func TestAntProvider_Validate_Success(t *testing.T) {
	dir := t.TempDir()
	buildPath := filepath.Join(dir, "build.xml")
	if err := os.WriteFile(buildPath, []byte("<project name='test'/>"), 0644); err != nil {
		t.Fatal(err)
	}

	p := NewAntProvider(AntProviderConfig{}, nil)
	err := p.Validate(context.Background(), domain.BuildPlan{
		ProjectRoot: dir,
		BuildFile:   "build.xml",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestAntProvider_BuildArgs(t *testing.T) {
	p := NewAntProvider(AntProviderConfig{}, nil)

	tests := []struct {
		name string
		plan domain.BuildPlan
		want []string
	}{
		{
			name: "default target",
			plan: domain.BuildPlan{},
			want: []string{"compile"},
		},
		{
			name: "with build file",
			plan: domain.BuildPlan{BuildFile: "build.xml"},
			want: []string{"-buildfile", "build.xml", "compile"},
		},
		{
			name: "with specific targets",
			plan: domain.BuildPlan{BuildFile: "build.xml", Targets: []string{"dist", "deploy"}},
			want: []string{"-buildfile", "build.xml", "dist", "deploy"},
		},
		{
			name: "clean",
			plan: domain.BuildPlan{Clean: true},
			want: []string{"clean"},
		},
		{
			name: "clean with target",
			plan: domain.BuildPlan{Clean: true, Targets: []string{"compile"}},
			want: []string{"clean", "compile"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args := p.buildArgs(tt.plan)
			if len(args) != len(tt.want) {
				t.Fatalf("expected %d args, got %d: %v", len(tt.want), len(args), args)
			}
			for i, arg := range tt.want {
				if args[i] != arg {
					t.Errorf("args[%d] = %q, want %q", i, args[i], arg)
				}
			}
		})
	}
}

func TestAntProvider_BuildEnv(t *testing.T) {
	p := NewAntProvider(AntProviderConfig{
		AntHome:  "/opt/ant",
		JavaHome: "/opt/jdk",
	}, nil)

	env := p.buildEnv()

	hasAntHome := false
	hasJavaHome := false
	for _, e := range env {
		if e == "ANT_HOME=/opt/ant" {
			hasAntHome = true
		}
		if e == "JAVA_HOME=/opt/jdk" {
			hasJavaHome = true
		}
	}
	if !hasAntHome {
		t.Error("expected ANT_HOME in env")
	}
	if !hasJavaHome {
		t.Error("expected JAVA_HOME in env")
	}
}

func TestParseAntDiagnostics(t *testing.T) {
	output := `BUILD FAILED
/javac/src/test/File.java:10: error: cannot find symbol
[javac] symbol: variable foo
Build failed`

	diags := parseAntDiagnostics(output, "/project")
	if len(diags) == 0 {
		t.Fatal("expected at least one diagnostic")
	}
	hasBuildFailed := false
	hasFileLine := false
	for _, d := range diags {
		if strings.Contains(d.Message, "BUILD FAILED") || strings.Contains(strings.ToLower(d.Message), "build failed") {
			hasBuildFailed = true
		}
		if d.Line == 10 && strings.Contains(d.File, "File.java") && strings.Contains(d.Message, "cannot find symbol") {
			hasFileLine = true
		}
	}
	if !hasBuildFailed {
		t.Errorf("expected BUILD FAILED diagnostic, got: %+v", diags)
	}
	if !hasFileLine {
		t.Errorf("expected javac file:line diagnostic, got: %+v", diags)
	}
}

func TestParseAntDiagnostics_Empty(t *testing.T) {
	diags := parseAntDiagnostics("", "/project")
	if len(diags) != 0 {
		t.Errorf("expected 0 diagnostics, got %d", len(diags))
	}
}

func TestParseAntDiagnostics_Success(t *testing.T) {
	output := "BUILD SUCCESSFUL\nTotal time: 2 seconds"
	diags := parseAntDiagnostics(output, "/project")
	if len(diags) != 0 {
		t.Errorf("expected 0 diagnostics for successful build, got %d", len(diags))
	}
}

func TestAntTarget_UnmarshalXML(t *testing.T) {
	// Verify the struct is usable
	target := AntTarget{
		Name:    "compile",
		Depends: "init",
		Tasks: []AntTask{
			{Name: "javac", Attrs: map[string]string{"srcdir": "src", "destdir": "build"}},
		},
	}
	if target.Name != "compile" {
		t.Errorf("expected name 'compile', got %q", target.Name)
	}
	if len(target.Tasks) != 1 {
		t.Errorf("expected 1 task, got %d", len(target.Tasks))
	}
	if target.Tasks[0].Name != "javac" {
		t.Errorf("expected task name 'javac', got %q", target.Tasks[0].Name)
	}
}