package maven

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetect_NoPomXml(t *testing.T) {
	dir := t.TempDir()
	result, err := Detect(dir)
	if err != nil {
		t.Fatalf("Detect: %v", err)
	}
	if result.Found {
		t.Error("expected Found=false when no pom.xml")
	}
}

func TestDetect_WithPomXml(t *testing.T) {
	dir := t.TempDir()
	pomContent := `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>test-app</artifactId>
  <version>1.0.0</version>
  <packaging>war</packaging>
  <name>Test App</name>
  <dependencies>
    <dependency>
      <groupId>javax.servlet</groupId>
      <artifactId>servlet-api</artifactId>
      <version>2.5</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
      <optional>true</optional>
    </dependency>
  </dependencies>
  <build>
    <directory>target</directory>
    <outputDirectory>target/classes</outputDirectory>
  </build>
</project>`
	if err := os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(pomContent), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Detect(dir)
	if err != nil {
		t.Fatalf("Detect: %v", err)
	}
	if !result.Found {
		t.Fatal("expected Found=true")
	}
	if result.Project == nil {
		t.Fatal("expected Project to be non-nil")
	}
	if result.Project.GroupID != "com.example" {
		t.Errorf("GroupID = %q, want com.example", result.Project.GroupID)
	}
	if result.Project.ArtifactID != "test-app" {
		t.Errorf("ArtifactID = %q, want test-app", result.Project.ArtifactID)
	}
	if result.Project.Packaging != "war" {
		t.Errorf("Packaging = %q, want war", result.Project.Packaging)
	}
	if len(result.Dependencies) != 2 {
		t.Fatalf("expected 2 dependencies, got %d", len(result.Dependencies))
	}
	if result.Dependencies[0].Scope != "provided" {
		t.Errorf("dep[0].Scope = %q, want provided", result.Dependencies[0].Scope)
	}
	if !result.Dependencies[1].Optional {
		t.Error("dep[1] should be optional")
	}
	if len(result.Tasks) < 7 {
		t.Errorf("expected at least 7 lifecycle tasks, got %d", len(result.Tasks))
	}
	if len(result.Tree) != 2 {
		t.Errorf("expected 2 tree nodes, got %d", len(result.Tree))
	}
}

func TestDetect_InvalidXml(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "pom.xml"), []byte("not xml"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Detect(dir)
	if err == nil {
		t.Fatal("expected error for invalid XML")
	}
}

func TestBuildDependencyTree(t *testing.T) {
	deps := []Dependency{
		{GroupID: "a", ArtifactID: "b", Version: "1.0", Scope: "compile"},
		{GroupID: "c", ArtifactID: "d", Version: "2.0", Scope: "test"},
	}
	tree := buildDependencyTree(deps)
	if len(tree) != 2 {
		t.Fatalf("len = %d, want 2", len(tree))
	}
	if tree[0].GroupID != "a" || tree[0].ArtifactID != "b" {
		t.Errorf("tree[0] = %+v", tree[0])
	}
	if tree[1].GroupID != "c" || tree[1].ArtifactID != "d" {
		t.Errorf("tree[1] = %+v", tree[1])
	}
}

func TestBuildDependencyTree_Empty(t *testing.T) {
	tree := buildDependencyTree(nil)
	if len(tree) != 0 {
		t.Errorf("len = %d, want 0", len(tree))
	}
}

func TestParseMavenDependencyTree(t *testing.T) {
	output := `com.example:app:jar:1.0
+- com.example:lib1:jar:1.0:compile
|  \- com.example:lib2:jar:2.0:compile
\- com.example:lib3:jar:3.0:test`
	tree := parseMavenDependencyTree(output)
	if len(tree) != 1 {
		t.Fatalf("len = %d, want 1", len(tree))
	}
	if tree[0].ArtifactID != "app" {
		t.Errorf("root = %+v", tree[0])
	}
	if len(tree[0].Children) != 2 {
		t.Fatalf("children = %d, want 2", len(tree[0].Children))
	}
	if tree[0].Children[0].ArtifactID != "lib1" {
		t.Errorf("child[0] = %+v", tree[0].Children[0])
	}
	if len(tree[0].Children[0].Children) != 1 {
		t.Fatalf("grandchild = %d, want 1", len(tree[0].Children[0].Children))
	}
}

func TestParseMavenDependencyTree_Empty(t *testing.T) {
	tree := parseMavenDependencyTree("")
	if len(tree) != 0 {
		t.Errorf("len = %d, want 0", len(tree))
	}
}

func TestLifecycleTasks(t *testing.T) {
	if len(LifecycleTasks) < 7 {
		t.Errorf("expected at least 7 lifecycle tasks, got %d", len(LifecycleTasks))
	}
	seen := make(map[string]bool)
	for _, task := range LifecycleTasks {
		if task.ID == "" {
			t.Error("task ID should not be empty")
		}
		if seen[task.ID] {
			t.Errorf("duplicate task ID: %q", task.ID)
		}
		seen[task.ID] = true
	}
}

func TestDetect_WithParentPom(t *testing.T) {
	dir := t.TempDir()
	pomContent := `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <parent>
    <groupId>com.parent</groupId>
    <artifactId>parent-pom</artifactId>
    <version>2.0.0</version>
  </parent>
  <artifactId>child-app</artifactId>
</project>`
	if err := os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(pomContent), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Detect(dir)
	if err != nil {
		t.Fatalf("Detect: %v", err)
	}
	if !result.Found {
		t.Fatal("expected Found=true")
	}
	if result.Project.ArtifactID != "child-app" {
		t.Errorf("ArtifactID = %q, want child-app", result.Project.ArtifactID)
	}
	if result.Project.Packaging != "jar" {
		t.Errorf("Packaging = %q, want jar (default)", result.Project.Packaging)
	}
}

func TestGetDependencies_NoPomXml(t *testing.T) {
	dir := t.TempDir()
	_, err := GetDependencies(dir, false)
	if err != nil {
		t.Fatalf("GetDependencies: %v", err)
	}
}

func TestGetDependencies_Offline(t *testing.T) {
	dir := t.TempDir()
	pomContent := `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>test-app</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>javax.servlet</groupId>
      <artifactId>servlet-api</artifactId>
      <version>2.5</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>
</project>`
	if err := os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(pomContent), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := GetDependencies(dir, true)
	if err != nil {
		t.Fatalf("GetDependencies: %v", err)
	}
	if !result.Found {
		t.Fatal("expected Found=true")
	}
	if len(result.Tree) != 1 {
		t.Errorf("expected 1 tree node, got %d", len(result.Tree))
	}
}

func TestGetDependencies_Online(t *testing.T) {
	dir := t.TempDir()
	pomContent := `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>test-app</artifactId>
  <version>1.0.0</version>
</project>`
	if err := os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(pomContent), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := GetDependencies(dir, false)
	if err != nil {
		t.Fatalf("GetDependencies: %v", err)
	}
	if !result.Found {
		t.Fatal("expected Found=true")
	}
}

func TestParseMavenDependencyTree_WithInfoLines(t *testing.T) {
	output := `[INFO] Scanning for projects...
[INFO] Building app
com.example:app:jar:1.0
+- com.example:lib1:jar:1.0:compile
[INFO] BUILD SUCCESS
[WARNING] Some warning`
	tree := parseMavenDependencyTree(output)
	if len(tree) != 1 {
		t.Fatalf("len = %d, want 1", len(tree))
	}
	if tree[0].ArtifactID != "app" {
		t.Errorf("root = %+v", tree[0])
	}
}

func TestParseMavenDependencyTree_ShortLine(t *testing.T) {
	output := `short:line`
	tree := parseMavenDependencyTree(output)
	if len(tree) != 0 {
		t.Errorf("expected 0 nodes for short line, got %d", len(tree))
	}
}

func TestParseMavenDependencyTree_WithScope(t *testing.T) {
	output := `com.example:app:jar:1.0
+- com.example:lib1:jar:1.0:provided
\- com.example:lib2:jar:2.0:test`
	tree := parseMavenDependencyTree(output)
	if len(tree) != 1 {
		t.Fatalf("len = %d, want 1", len(tree))
	}
	if len(tree[0].Children) != 2 {
		t.Fatalf("children = %d, want 2", len(tree[0].Children))
	}
	if tree[0].Children[0].Scope != "provided" {
		t.Errorf("child[0].Scope = %q, want provided", tree[0].Children[0].Scope)
	}
	if tree[0].Children[1].Scope != "test" {
		t.Errorf("child[1].Scope = %q, want test", tree[0].Children[1].Scope)
	}
}

func TestParseMavenDependencyTree_MultipleRoots(t *testing.T) {
	output := `com.example:app1:jar:1.0
+- com.example:lib1:jar:1.0:compile
com.example:app2:jar:2.0
\- com.example:lib2:jar:2.0:compile`
	tree := parseMavenDependencyTree(output)
	if len(tree) != 2 {
		t.Fatalf("len = %d, want 2", len(tree))
	}
	if tree[0].ArtifactID != "app1" {
		t.Errorf("root[0] = %+v", tree[0])
	}
	if tree[1].ArtifactID != "app2" {
		t.Errorf("root[1] = %+v", tree[1])
	}
}

func TestParseMavenDependencyTree_DeepNesting(t *testing.T) {
	output := `com.example:app:jar:1.0
+- com.example:lib1:jar:1.0:compile
|  +- com.example:lib1a:jar:1.0:compile
|  |  \- com.example:lib1a1:jar:1.0:compile
|  \- com.example:lib1b:jar:1.0:compile
\- com.example:lib2:jar:2.0:test`
	tree := parseMavenDependencyTree(output)
	if len(tree) != 1 {
		t.Fatalf("len = %d, want 1", len(tree))
	}
	if len(tree[0].Children) != 2 {
		t.Fatalf("children = %d, want 2", len(tree[0].Children))
	}
	// Check deep nesting
	lib1 := tree[0].Children[0]
	if len(lib1.Children) != 2 {
		t.Fatalf("lib1 children = %d, want 2", len(lib1.Children))
	}
	if len(lib1.Children[0].Children) != 1 {
		t.Fatalf("lib1a children = %d, want 1", len(lib1.Children[0].Children))
	}
}

func TestParseMavenDependencyTree_EmptyLines(t *testing.T) {
	output := `

com.example:app:jar:1.0

+- com.example:lib1:jar:1.0:compile

`
	tree := parseMavenDependencyTree(output)
	if len(tree) != 1 {
		t.Fatalf("len = %d, want 1", len(tree))
	}
}

func TestDetect_MinimalPom(t *testing.T) {
	dir := t.TempDir()
	pomContent := `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>minimal</artifactId>
  <version>1.0</version>
</project>`
	if err := os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(pomContent), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Detect(dir)
	if err != nil {
		t.Fatalf("Detect: %v", err)
	}
	if !result.Found {
		t.Fatal("expected Found=true")
	}
	if result.Project.ArtifactID != "minimal" {
		t.Errorf("ArtifactID = %q, want minimal", result.Project.ArtifactID)
	}
	if result.Project.Packaging != "jar" {
		t.Errorf("Packaging = %q, want jar (default)", result.Project.Packaging)
	}
}

func TestDetect_BuildOutputDir(t *testing.T) {
	dir := t.TempDir()
	pomContent := `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>test-app</artifactId>
  <version>1.0</version>
  <build>
    <directory>custom-target</directory>
    <outputDirectory>custom-target/classes</outputDirectory>
  </build>
</project>`
	if err := os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(pomContent), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Detect(dir)
	if err != nil {
		t.Fatalf("Detect: %v", err)
	}
	if !result.Found {
		t.Fatal("expected Found=true")
	}
	if result.Project.BuildDir != "custom-target" {
		t.Errorf("BuildDir = %q, want custom-target", result.Project.BuildDir)
	}
	if result.Project.OutputDir != "custom-target/classes" {
		t.Errorf("OutputDir = %q, want custom-target/classes", result.Project.OutputDir)
	}
}