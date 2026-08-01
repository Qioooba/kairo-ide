package antpath

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestLoadPropertyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "build.properties")
	content := "# comment line\n! also comment\n\nkey1=value1\n key2 = value2 \nkey3=value with = sign\n"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	props, err := loadPropertyFile(path)
	if err != nil {
		t.Fatalf("loadPropertyFile failed: %v", err)
	}
	expected := map[string]string{
		"key1": "value1",
		"key2": "value2",
		"key3": "value with = sign",
	}
	if !reflect.DeepEqual(props, expected) {
		t.Errorf("props = %v, want %v", props, expected)
	}
}

func TestLoadPropertyFile_Missing(t *testing.T) {
	if _, err := loadPropertyFile(filepath.Join(t.TempDir(), "missing.properties")); err == nil {
		t.Fatal("expected error for missing properties file")
	}
}

func TestSplitPath(t *testing.T) {
	tests := []struct {
		in   string
		want []string
	}{
		{"a:b:c", []string{"a", "b", "c"}},
		{"a;b;c", []string{"a", "b", "c"}},
		{" a : b ", []string{"a", "b"}},
		{"", nil},
		{"a", []string{"a"}},
		{"a::b", []string{"a", "b"}},
	}
	for _, tc := range tests {
		if got := splitPath(tc.in); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("splitPath(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestMergeIncludesExcludes(t *testing.T) {
	got := mergeIncludesExcludes("*.jar, *.zip  other", []string{"  extra  ", ""})
	want := []string{"*.jar", "*.zip", "other", "extra"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("mergeIncludesExcludes = %v, want %v", got, want)
	}

	if got := mergeIncludesExcludes("", nil); len(got) != 0 {
		t.Errorf("expected empty result, got %v", got)
	}
}

func TestToAbs(t *testing.T) {
	absPath := filepath.Join(t.TempDir(), "x")
	if got := toAbs(absPath, "/base"); got != absPath {
		t.Errorf("toAbs absolute = %q, want %q", got, absPath)
	}
	got := toAbs("rel/path", "/base")
	want := filepath.Join("/base", "rel/path")
	if got != want {
		t.Errorf("toAbs relative = %q, want %q", got, want)
	}
}

func TestGlobWithDoubleStar_SimplePattern(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.jar"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b"), 0644)

	matches, err := globWithDoubleStar(dir, "*.jar")
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 || filepath.Base(matches[0]) != "a.jar" {
		t.Errorf("matches = %v, want [a.jar]", matches)
	}
}

func TestGlobWithDoubleStar_RecursivePattern(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "sub"), 0755)
	os.WriteFile(filepath.Join(dir, "root.jar"), []byte("r"), 0644)
	os.WriteFile(filepath.Join(dir, "sub", "nested.jar"), []byte("n"), 0644)
	os.WriteFile(filepath.Join(dir, "sub", "not-jar.txt"), []byte("t"), 0644)

	// filepath.Match treats ** like * (no separator crossing), so only
	// one level of nesting matches. The pattern separator must match the
	// platform separator used by filepath.Rel.
	pattern := strings.ReplaceAll("**/*.jar", "/", string(os.PathSeparator))
	matches, err := globWithDoubleStar(dir, pattern)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 || filepath.Base(matches[0]) != "nested.jar" {
		t.Errorf("matches = %v, want [nested.jar]", matches)
	}
}

func TestDetectCompileClasspath_PriorityJavacRef(t *testing.T) {
	p := &BuildProject{
		Paths: map[string]*AntPath{
			"compile.classpath": {ID: "compile.classpath", Location: []string{"lib/a.jar"}},
		},
		Targets: map[string]*Target{
			"build": {
				Name: "build",
				JavacTasks: []JavacTask{
					{ClasspathRef: "compile.classpath", SrcDir: "src", DestDir: "classes"},
				},
			},
		},
	}
	got := detectCompileClasspath(p)
	if got == nil || got.ID != "compile.classpath" {
		t.Fatalf("expected compile.classpath, got %+v", got)
	}
}

func TestDetectCompileClasspath_InlineClasspath(t *testing.T) {
	p := &BuildProject{
		Targets: map[string]*Target{
			"build": {
				JavacTasks: []JavacTask{
					{InlineClasspath: &AntPath{Location: []string{"lib/x.jar"}}},
				},
			},
		},
	}
	got := detectCompileClasspath(p)
	if got == nil || len(got.Location) != 1 || got.Location[0] != "lib/x.jar" {
		t.Fatalf("expected inline classpath, got %+v", got)
	}
}

func TestDetectCompileClasspath_NameMatch(t *testing.T) {
	p := &BuildProject{
		Paths: map[string]*AntPath{
			"classpath": {ID: "classpath", Path: []string{"lib"}},
		},
	}
	got := detectCompileClasspath(p)
	if got == nil || got.ID != "classpath" {
		t.Fatalf("expected classpath match, got %+v", got)
	}
}

func TestDetectCompileClasspath_PartialNameMatch(t *testing.T) {
	p := &BuildProject{
		Paths: map[string]*AntPath{
			"my.classpath.extra": {ID: "my.classpath.extra"},
		},
	}
	got := detectCompileClasspath(p)
	if got == nil || got.ID != "my.classpath.extra" {
		t.Fatalf("expected partial classpath match, got %+v", got)
	}
}

func TestDetectCompileClasspath_WebInfLib(t *testing.T) {
	p := &BuildProject{
		Paths: map[string]*AntPath{
			"app.path": {ID: "app.path", FileSets: []FileSet{{Dir: "WebRoot/WEB-INF/lib", Includes: []string{"*.jar"}}}},
		},
	}
	got := detectCompileClasspath(p)
	if got == nil || got.ID != "app.path" {
		t.Fatalf("expected web-inf/lib match, got %+v", got)
	}
}

func TestDetectCompileClasspath_None(t *testing.T) {
	p := &BuildProject{
		Paths: map[string]*AntPath{"p1": {ID: "p1"}},
	}
	if got := detectCompileClasspath(p); got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
}

func TestResolveProperties_EnvAndNested(t *testing.T) {
	t.Setenv("KAIRO_TEST_ENV_VAR", "env-value")
	p := &BuildProject{
		Properties: map[string]string{
			"env.prop":   "${env.KAIRO_TEST_ENV_VAR}",
			"a":          "A",
			"b":          "${a}B",
			"c":          "${b}C",
		},
	}
	resolveProperties(p)
	if p.Properties["env.prop"] != "env-value" {
		t.Errorf("env.prop = %q, want env-value", p.Properties["env.prop"])
	}
	if p.Properties["c"] != "ABC" {
		t.Errorf("c = %q, want ABC", p.Properties["c"])
	}
}

func TestResolveProperties_UnresolvableStays(t *testing.T) {
	p := &BuildProject{
		Properties: map[string]string{
			"x": "${missing.ref}",
		},
	}
	resolveProperties(p)
	if p.Properties["x"] != "${missing.ref}" {
		t.Errorf("x = %q, want ${missing.ref}", p.Properties["x"])
	}
}

func TestProcessImports_MergesAndWarns(t *testing.T) {
	dir := t.TempDir()
	importedXML := `<?xml version="1.0"?>
<project name="imp">
    <property name="imported.prop" value="from-import"/>
    <path id="imported.path"><pathelement location="lib/y.jar"/></path>
    <target name="imported-target"><javac srcdir="src"/></target>
</project>`
	os.WriteFile(filepath.Join(dir, "shared.xml"), []byte(importedXML), 0644)

	project := &BuildProject{
		Basedir:    dir,
		Properties: make(map[string]string),
		Paths:      make(map[string]*AntPath),
		Targets:    make(map[string]*Target),
		Imports: []Import{
			{File: "shared.xml"},
			{File: "missing-optional.xml", Optional: true},
			{File: "missing-required.xml"},
		},
	}
	processImports(project, dir, 0, 5)

	if project.Properties["imported.prop"] != "from-import" {
		t.Errorf("imported.prop = %q, want from-import", project.Properties["imported.prop"])
	}
	if _, ok := project.Paths["imported.path"]; !ok {
		t.Error("imported.path not merged")
	}
	if _, ok := project.Targets["imported-target"]; !ok {
		t.Error("imported target not merged")
	}
	if len(project.Warnings) != 1 {
		t.Errorf("expected 1 warning for missing required import, got %d", len(project.Warnings))
	}
}

func TestProcessImports_MaxDepth(t *testing.T) {
	project := &BuildProject{
		Imports: []Import{{File: "x.xml"}},
	}
	// Depth >= maxDepth returns immediately without attempting to read files.
	processImports(project, t.TempDir(), 5, 5)
	if len(project.Warnings) != 0 {
		t.Errorf("expected no warnings at max depth, got %v", project.Warnings)
	}
}

func TestExpandAntPath_LocationsAndPathEntries(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.jar"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(dir, "b.jar"), []byte("b"), 0644)

	ap := &AntPath{
		Location: []string{"a.jar"},
		Path:     []string{"b.jar"},
	}
	project := &BuildProject{Basedir: dir}
	got := expandAntPath(ap, project)
	sort.Strings(got)
	want := []string{filepath.Join(dir, "a.jar"), filepath.Join(dir, "b.jar")}
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expandAntPath = %v, want %v", got, want)
	}
}

func TestExpandAntPath_FileSetWithExcludes(t *testing.T) {
	dir := t.TempDir()
	lib := filepath.Join(dir, "lib")
	os.MkdirAll(lib, 0755)
	os.WriteFile(filepath.Join(lib, "keep.jar"), []byte("k"), 0644)
	os.WriteFile(filepath.Join(lib, "skip.jar"), []byte("s"), 0644)

	ap := &AntPath{
		FileSets: []FileSet{
			{Dir: "lib", Includes: []string{"*.jar"}, Excludes: []string{"skip.jar"}},
		},
	}
	project := &BuildProject{Basedir: dir}
	got := expandAntPath(ap, project)
	if len(got) != 1 || filepath.Base(got[0]) != "keep.jar" {
		t.Errorf("expandAntPath = %v, want [keep.jar]", got)
	}
}

func TestExpandAntPath_PathRefs(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "ref.jar"), []byte("r"), 0644)

	referenced := &AntPath{ID: "base", Location: []string{"ref.jar"}}
	project := &BuildProject{
		Basedir: dir,
		Paths:   map[string]*AntPath{"base": referenced},
	}
	ap := &AntPath{ID: "derived", PathRefs: []string{"base"}}
	got := expandAntPath(ap, project)
	if len(got) != 1 || filepath.Base(got[0]) != "ref.jar" {
		t.Errorf("expandAntPath with refs = %v, want [ref.jar]", got)
	}
}

func TestExpandAntPath_MissingFileSkipped(t *testing.T) {
	ap := &AntPath{Location: []string{"nonexistent.jar"}}
	project := &BuildProject{Basedir: t.TempDir()}
	if got := expandAntPath(ap, project); len(got) != 0 {
		t.Errorf("expected no entries for missing file, got %v", got)
	}
}

func TestParse_WithPropertyFileAndFileset(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "build.properties"), []byte("lib.dir=lib\n"), 0644)
	lib := filepath.Join(dir, "lib")
	os.MkdirAll(lib, 0755)
	os.WriteFile(filepath.Join(lib, "x.jar"), []byte("x"), 0644)

	xml := `<?xml version="1.0"?>
<project name="demo" default="build">
    <property file="build.properties"/>
    <path id="compile.classpath">
        <fileset dir="${lib.dir}" includes="*.jar"/>
    </path>
    <target name="build">
        <javac srcdir="src" destdir="classes" classpathref="compile.classpath"/>
    </target>
</project>`
	project, err := Parse([]byte(xml), dir)
	if err != nil {
		t.Fatal(err)
	}
	if project.Name != "demo" {
		t.Errorf("name = %q", project.Name)
	}
	if project.Properties["lib.dir"] != "lib" {
		t.Errorf("lib.dir = %q", project.Properties["lib.dir"])
	}
	cp := detectCompileClasspath(project)
	if cp == nil {
		t.Fatal("expected compile classpath detection")
	}
	classpath := expandAntPath(cp, project)
	if len(classpath) != 1 || !strings.HasSuffix(classpath[0], "x.jar") {
		t.Errorf("classpath = %v, want [x.jar]", classpath)
	}
}
