package antpath

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveProperty(t *testing.T) {
	props := map[string]string{
		"basedir": "/tmp/project",
		"lib.dir": "${basedir}/lib",
		"webroot": "WebRoot",
		"webinf":  "${webroot}/WEB-INF",
	}
	result := resolveProp("${webinf}/lib", props)
	if result != "WebRoot/WEB-INF/lib" {
		t.Errorf("resolveProp = %q, want WebRoot/WEB-INF/lib", result)
	}
}

func TestResolveProperty_Unresolved(t *testing.T) {
	props := map[string]string{"basedir": "/tmp"}
	result := resolveProp("${unknown}/lib", props)
	if result != "${unknown}/lib" {
		t.Errorf("resolveProp = %q, want ${unknown}/lib", result)
	}
}

func TestResolveWithImport(t *testing.T) {
	dir := t.TempDir()
	// Create parent build.xml
	parentXML := `<?xml version="1.0"?>
<project name="parent" default="build">
    <property name="parent.dir" value="parent-lib"/>
    <path id="parent.classpath">
        <fileset dir="${parent.dir}" includes="*.jar"/>
    </path>
</project>`
	os.WriteFile(filepath.Join(dir, "parent.xml"), []byte(parentXML), 0644)

	// Create main build.xml that imports parent
	mainXML := `<?xml version="1.0"?>
<project name="main" default="build">
    <import file="parent.xml"/>
    <path id="compile.classpath">
        <fileset dir="lib" includes="*.jar"/>
    </path>
    <target name="build">
        <javac srcdir="src" destdir="build/classes" classpathref="compile.classpath"/>
    </target>
</project>`
	os.WriteFile(filepath.Join(dir, "build.xml"), []byte(mainXML), 0644)

	// Create lib dir
	libDir := filepath.Join(dir, "lib")
	os.MkdirAll(libDir, 0755)
	os.WriteFile(filepath.Join(libDir, "test.jar"), []byte("fake"), 0644)

	result, err := Resolve(filepath.Join(dir, "build.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Classpath) == 0 {
		t.Error("expected classpath entries from main build.xml")
	}
}

func TestResolve_MissingFile(t *testing.T) {
	_, err := Resolve("/nonexistent/build.xml")
	if err == nil {
		t.Error("expected error for missing file")
	}
}