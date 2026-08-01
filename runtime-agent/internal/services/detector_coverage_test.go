package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
)

func TestExtractBuildXMLJDKVersion(t *testing.T) {
	// No executable/fork attribute -> no version.
	if got := extractBuildXMLJDKVersion(`<project><javac srcdir="src"/></project>`); got != "" {
		t.Errorf("expected no version, got %q", got)
	}

	// executable points to a non-existent path -> no version.
	xml := `<project><javac executable="/nonexistent/javac" srcdir="src"/></project>`
	if got := extractBuildXMLJDKVersion(xml); got != "" {
		t.Errorf("expected no version for missing javac, got %q", got)
	}
}

func TestDetectJDKVersion_FromJavaHomeRelease(t *testing.T) {
	// Prevent the javac PATH probe from interfering.
	t.Setenv("PATH", t.TempDir())

	jdkHome := t.TempDir()
	release := `JAVA_VERSION="17.0.1"`
	if err := os.WriteFile(filepath.Join(jdkHome, "release"), []byte(release), 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("JAVA_HOME", jdkHome)

	d := &ProjectDetection{}
	d.detectJDKVersion(t.TempDir())
	if d.JDKVersion != "17" {
		t.Errorf("JDKVersion = %q, want 17", d.JDKVersion)
	}
}

func TestDetectJDKVersion_BuildXMLBranch(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	root := t.TempDir()
	buildXML := `<project name="p"><target name="compile">
<javac srcdir="src" destdir="classes" executable="/nonexistent/bin/javac"/>
</target></project>`
	if err := os.WriteFile(filepath.Join(root, "build.xml"), []byte(buildXML), 0644); err != nil {
		t.Fatal(err)
	}
	d := &ProjectDetection{BuildScript: "build.xml"}
	d.detectJDKVersion(root)
	// The executable does not exist so no version is resolved; this
	// exercises the build.xml branch.
	_ = d.JDKVersion
}

func TestDetectJavaVersions_FromBuildXML(t *testing.T) {
	root := t.TempDir()
	buildXML := `<project><property name="javac.source" value="1.7"/>
<target name="build"><javac source="1.8" target="1.8" srcdir="src"/></target></project>`
	if err := os.WriteFile(filepath.Join(root, "build.xml"), []byte(buildXML), 0644); err != nil {
		t.Fatal(err)
	}
	d := &ProjectDetection{BuildScript: "build.xml"}
	d.detectJavaVersions(root)
	if d.SourceVersion != "1.8" {
		t.Errorf("SourceVersion = %q, want 1.8", d.SourceVersion)
	}
	if d.TargetVersion != "1.8" {
		t.Errorf("TargetVersion = %q, want 1.8", d.TargetVersion)
	}
}

func TestDetectJavaVersions_PropertyFallback(t *testing.T) {
	root := t.TempDir()
	buildXML := `<project><property name="javac.source" value="1.7"/>
<property name="javac.target" value="1.7"/></project>`
	if err := os.WriteFile(filepath.Join(root, "build.xml"), []byte(buildXML), 0644); err != nil {
		t.Fatal(err)
	}
	d := &ProjectDetection{BuildScript: "build.xml"}
	d.detectJavaVersions(root)
	if d.SourceVersion != "1.7" || d.TargetVersion != "1.7" {
		t.Errorf("got source=%q target=%q, want 1.7/1.7", d.SourceVersion, d.TargetVersion)
	}
}

func TestDetectJavaVersions_DefaultFallback(t *testing.T) {
	d := &ProjectDetection{BuildScript: "none"}
	d.detectJavaVersions(t.TempDir())
	if d.SourceVersion != "1.6" || d.TargetVersion != "1.6" {
		t.Errorf("got source=%q target=%q, want 1.6/1.6", d.SourceVersion, d.TargetVersion)
	}
}

func TestDiskDeployer_LoadFromDisk(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "deployments")
	os.MkdirAll(dir, 0755)
	items := []*api.DeployResult{{ID: "dep_1", State: "complete", What: "war"}}
	data, _ := json.Marshal(items)
	if err := os.WriteFile(filepath.Join(dir, "deployments.json"), data, 0600); err != nil {
		t.Fatal(err)
	}

	d := newDiskDeployer(filepath.Dir(dir), log.New("test"))
	if _, ok := d.items["dep_1"]; !ok {
		t.Errorf("expected dep_1 loaded from disk, items=%v", d.items)
	}
}

func TestDiskDeployer_LoadCorruptJSON(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "deployments")
	os.MkdirAll(dir, 0755)
	if err := os.WriteFile(filepath.Join(dir, "deployments.json"), []byte("{not json"), 0600); err != nil {
		t.Fatal(err)
	}
	d := newDiskDeployer(filepath.Dir(dir), log.New("test"))
	if len(d.items) != 0 {
		t.Errorf("expected no items for corrupt json, got %v", d.items)
	}
}

func TestDiskWorkspaceStore_LoadFromDisk(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "workspaces")
	os.MkdirAll(dir, 0755)
	records := []api.WorkspaceRecord{
		{ID: "ws_1", Name: "demo", RootPath: t.TempDir(), LastOpened: "2026-01-01T00:00:00Z"},
	}
	data, _ := json.Marshal(records)
	if err := os.WriteFile(filepath.Join(dir, "workspaces.json"), data, 0600); err != nil {
		t.Fatal(err)
	}

	root, err := security.NewWorkspaceRoots()
	if err != nil {
		t.Fatal(err)
	}
	s := newDiskWorkspaceStore(filepath.Dir(dir), root)
	if _, ok := s.data["ws_1"]; !ok {
		t.Errorf("expected ws_1 loaded from disk")
	}
}

func TestDiskWorkspaceStore_LoadCorruptJSON(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "workspaces")
	os.MkdirAll(dir, 0755)
	if err := os.WriteFile(filepath.Join(dir, "workspaces.json"), []byte("oops"), 0600); err != nil {
		t.Fatal(err)
	}
	s := newDiskWorkspaceStore(filepath.Dir(dir), nil)
	if len(s.data) != 0 {
		t.Errorf("expected no workspaces for corrupt json")
	}
}

func TestDiskWorkspaceStore_LoadRegistersSandbox(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "workspaces")
	os.MkdirAll(dir, 0755)
	wsRoot := t.TempDir()
	records := []api.WorkspaceRecord{{ID: "ws_1", Name: "demo", RootPath: wsRoot}}
	data, _ := json.Marshal(records)
	if err := os.WriteFile(filepath.Join(dir, "workspaces.json"), data, 0600); err != nil {
		t.Fatal(err)
	}

	root, err := security.NewWorkspaceRoots()
	if err != nil {
		t.Fatal(err)
	}
	s := newDiskWorkspaceStore(filepath.Dir(dir), root)
	if _, err := root.AuthorizeReadAbs(wsRoot); err != nil {
		t.Errorf("expected wsRoot to be authorized after load: %v", err)
	}
	_ = s
}
