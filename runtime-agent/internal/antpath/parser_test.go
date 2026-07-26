package antpath

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseSimple(t *testing.T) {
	xml := `<?xml version="1.0"?>
<project name="test" default="build">
    <property name="src.dir" value="src"/>
    <property name="lib.dir" value="lib"/>
    <path id="compile.classpath">
        <fileset dir="${lib.dir}" includes="*.jar"/>
    </path>
    <target name="build">
        <javac srcdir="${src.dir}" destdir="build/classes" classpathref="compile.classpath"/>
    </target>
</project>`
	project, err := Parse([]byte(xml), "/tmp/test")
	if err != nil {
		t.Fatal(err)
	}
	if project.Name != "test" {
		t.Errorf("name = %q, want test", project.Name)
	}
	if len(project.Properties) < 2 {
		t.Errorf("properties count = %d, want >= 2", len(project.Properties))
	}
	if v := project.Properties["src.dir"]; v != "src" {
		t.Errorf("src.dir = %q, want src", v)
	}
	if cp, ok := project.Paths["compile.classpath"]; !ok {
		t.Error("compile.classpath not found")
	} else {
		if len(cp.FileSets) != 1 {
			t.Errorf("filesets = %d, want 1", len(cp.FileSets))
		}
	}
	if target, ok := project.Targets["build"]; !ok {
		t.Error("build target not found")
	} else {
		if len(target.JavacTasks) != 1 {
			t.Errorf("javac tasks = %d, want 1", len(target.JavacTasks))
		}
	}
}

func TestParseWithProperties(t *testing.T) {
	xml := `<?xml version="1.0"?>
<project name="webapp" default="war">
    <property name="webroot" value="WebRoot"/>
    <property name="build.dir" value="build"/>
    <path id="classpath">
        <pathelement location="${webroot}/WEB-INF/classes"/>
        <pathelement path="${java.class.path}"/>
        <fileset dir="${webroot}/WEB-INF/lib" includes="**/*.jar"/>
    </path>
</project>`
	project, err := Parse([]byte(xml), "/tmp/webapp")
	if err != nil {
		t.Fatal(err)
	}
	if project.Name != "webapp" {
		t.Errorf("name = %q, want webapp", project.Name)
	}
	cp, ok := project.Paths["classpath"]
	if !ok {
		t.Fatal("classpath path not found")
	}
	if len(cp.Location) != 1 {
		t.Errorf("locations = %d, want 1", len(cp.Location))
	}
	if len(cp.FileSets) != 1 {
		t.Errorf("filesets = %d, want 1", len(cp.FileSets))
	}
}

func TestParseCorruptXML(t *testing.T) {
	xml := `<project><unclosed>`
	_, err := Parse([]byte(xml), "/tmp")
	if err == nil {
		t.Error("expected error for corrupt XML")
	}
}

func TestResolveSimple(t *testing.T) {
	dir := t.TempDir()
	// Create a lib directory with a fake jar
	libDir := filepath.Join(dir, "lib")
	os.MkdirAll(libDir, 0755)
	os.WriteFile(filepath.Join(libDir, "test.jar"), []byte("fake"), 0644)

	buildXML := `<?xml version="1.0"?>
<project name="test" default="build">
    <property name="src.dir" value="src"/>
    <path id="compile.classpath">
        <fileset dir="lib" includes="*.jar"/>
    </path>
    <target name="build">
        <javac srcdir="${src.dir}" destdir="build/classes" classpathref="compile.classpath"/>
    </target>
</project>`
	buildFile := filepath.Join(dir, "build.xml")
	os.WriteFile(buildFile, []byte(buildXML), 0644)

	result, err := Resolve(buildFile)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Classpath) == 0 {
		t.Error("expected classpath entries")
	}
	// Should find the test.jar
	found := false
	for _, cp := range result.Classpath {
		if filepath.Base(cp) == "test.jar" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("test.jar not found in classpath: %v", result.Classpath)
	}
}

func TestDetectCompileClasspath(t *testing.T) {
	project := &BuildProject{
		Paths: map[string]*AntPath{
			"compile.classpath": {ID: "compile.classpath", Location: []string{"lib/servlet-api.jar"}},
			"runtime.classpath": {ID: "runtime.classpath", Location: []string{"lib/runtime.jar"}},
		},
		Targets: map[string]*Target{},
	}
	cp := detectCompileClasspath(project)
	if cp == nil || cp.ID != "compile.classpath" {
		t.Errorf("detected = %v, want compile.classpath", cp)
	}
}

func TestDetectCompileClasspath_JavacRef(t *testing.T) {
	project := &BuildProject{
		Paths: map[string]*AntPath{
			"my.classpath": {ID: "my.classpath", Location: []string{"lib/servlet-api.jar"}},
		},
		Targets: map[string]*Target{
			"compile": {
				Name: "compile",
				JavacTasks: []JavacTask{
					{ClasspathRef: "my.classpath"},
				},
			},
		},
	}
	cp := detectCompileClasspath(project)
	if cp == nil || cp.ID != "my.classpath" {
		t.Errorf("detected = %v, want my.classpath", cp)
	}
}