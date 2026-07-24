package maven

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewLifecycleRegistry(t *testing.T) {
	reg := NewLifecycleRegistry()
	if reg == nil {
		t.Fatal("expected non-nil registry")
	}
	if len(reg.Lifecycles) != 3 {
		t.Errorf("expected 3 lifecycles, got %d", len(reg.Lifecycles))
	}

	// Check clean lifecycle
	clean, ok := reg.Lifecycles["clean"]
	if !ok {
		t.Fatal("expected clean lifecycle")
	}
	if len(clean.Phases) != 3 {
		t.Errorf("expected 3 clean phases, got %d", len(clean.Phases))
	}

	// Check default lifecycle
	def, ok := reg.Lifecycles["default"]
	if !ok {
		t.Fatal("expected default lifecycle")
	}
	if len(def.Phases) != 23 {
		t.Errorf("expected 23 default phases, got %d", len(def.Phases))
	}

	// Check site lifecycle
	site, ok := reg.Lifecycles["site"]
	if !ok {
		t.Fatal("expected site lifecycle")
	}
	if len(site.Phases) != 4 {
		t.Errorf("expected 4 site phases, got %d", len(site.Phases))
	}
}

func TestGetLifecycle(t *testing.T) {
	reg := NewLifecycleRegistry()

	lc, ok := reg.GetLifecycle("clean")
	if !ok {
		t.Fatal("expected clean lifecycle")
	}
	if lc.ID != "clean" {
		t.Errorf("ID = %q, want clean", lc.ID)
	}

	_, ok = reg.GetLifecycle("nonexistent")
	if ok {
		t.Error("expected false for nonexistent lifecycle")
	}
}

func TestGetPhase(t *testing.T) {
	reg := NewLifecycleRegistry()

	phase, ok := reg.GetPhase("default", "compile")
	if !ok {
		t.Fatal("expected compile phase")
	}
	if phase.ID != "compile" {
		t.Errorf("ID = %q, want compile", phase.ID)
	}
	if phase.Order != 6 {
		t.Errorf("Order = %d, want 6", phase.Order)
	}

	_, ok = reg.GetPhase("default", "nonexistent")
	if ok {
		t.Error("expected false for nonexistent phase")
	}

	_, ok = reg.GetPhase("nonexistent", "compile")
	if ok {
		t.Error("expected false for nonexistent lifecycle")
	}
}

func TestGetPhasesUpTo(t *testing.T) {
	reg := NewLifecycleRegistry()

	phases := reg.GetPhasesUpTo("default", "compile")
	if len(phases) != 7 {
		t.Errorf("expected 7 phases up to compile, got %d", len(phases))
	}
	if phases[len(phases)-1].ID != "compile" {
		t.Errorf("last phase = %q, want compile", phases[len(phases)-1].ID)
	}

	// Nonexistent lifecycle
	phases = reg.GetPhasesUpTo("nonexistent", "compile")
	if len(phases) != 0 {
		t.Errorf("expected 0 phases for nonexistent lifecycle, got %d", len(phases))
	}
}

func TestDefaultPluginBindings(t *testing.T) {
	bindings := DefaultPluginBindings()

	jarBindings, ok := bindings["jar"]
	if !ok {
		t.Fatal("expected jar bindings")
	}
	if len(jarBindings) < 7 {
		t.Errorf("expected at least 7 jar bindings, got %d", len(jarBindings))
	}

	warBindings, ok := bindings["war"]
	if !ok {
		t.Fatal("expected war bindings")
	}
	if len(warBindings) < 7 {
		t.Errorf("expected at least 7 war bindings, got %d", len(warBindings))
	}

	pomBindings, ok := bindings["pom"]
	if !ok {
		t.Fatal("expected pom bindings")
	}
	if len(pomBindings) < 2 {
		t.Errorf("expected at least 2 pom bindings, got %d", len(pomBindings))
	}
}

func TestGetBindingsForPackaging(t *testing.T) {
	bindings := GetBindingsForPackaging("jar")
	if len(bindings) == 0 {
		t.Error("expected non-empty jar bindings")
	}

	bindings = GetBindingsForPackaging("unknown")
	if len(bindings) == 0 {
		t.Error("expected fallback to jar bindings")
	}
}

func TestGetPhaseOrder(t *testing.T) {
	order := GetPhaseOrder("compile")
	if order != 6 {
		t.Errorf("Order = %d, want 6", order)
	}

	order = GetPhaseOrder("nonexistent")
	if order != -1 {
		t.Errorf("Order = %d, want -1", order)
	}
}

func TestGetActiveProfilesFromPom(t *testing.T) {
	profiles := []BuildProfile{
		{ID: "default-profile", Activation: ProfileActivation{ActiveByDefault: true}},
		{ID: "jdk-profile", Activation: ProfileActivation{JDK: "1.8"}},
		{ID: "os-profile", Activation: ProfileActivation{OS: &ProfileOSActivation{Name: "linux"}}},
		{ID: "property-profile", Activation: ProfileActivation{Property: &ProfilePropertyActivation{Name: "env", Value: "dev"}}},
	}

	active := GetActiveProfiles(profiles, "linux", "amd64", "1.8.0_202", map[string]string{"env": "dev"})
	if len(active) != 4 {
		t.Errorf("expected 4 active profiles, got %d", len(active))
	}

	// Test with no matching OS
	active = GetActiveProfiles(profiles, "windows", "amd64", "1.8.0_202", map[string]string{"env": "dev"})
	if len(active) != 3 {
		t.Errorf("expected 3 active profiles (os not matching), got %d", len(active))
	}

	// Test with no matching JDK
	active = GetActiveProfiles(profiles, "linux", "amd64", "11", map[string]string{"env": "dev"})
	if len(active) != 3 {
		t.Errorf("expected 3 active profiles (jdk not matching), got %d", len(active))
	}

	// Test with no matching property
	active = GetActiveProfiles(profiles, "linux", "amd64", "1.8.0_202", map[string]string{})
	if len(active) != 3 {
		t.Errorf("expected 3 active profiles (property not matching), got %d", len(active))
	}
}

func TestGetActiveProfiles_Empty(t *testing.T) {
	active := GetActiveProfiles(nil, "linux", "amd64", "11", nil)
	if len(active) != 0 {
		t.Errorf("expected 0 active profiles, got %d", len(active))
	}
}

func TestGetActiveProfiles_FileActivation(t *testing.T) {
	dir := t.TempDir()
	existingFile := filepath.Join(dir, "exists.txt")
	os.WriteFile(existingFile, []byte("test"), 0o644)

	profiles := []BuildProfile{
		{
			ID: "file-exists",
			Activation: ProfileActivation{
				File: &ProfileFileActivation{Exists: existingFile},
			},
		},
		{
			ID: "file-missing",
			Activation: ProfileActivation{
				File: &ProfileFileActivation{Missing: filepath.Join(dir, "nonexistent.txt")},
			},
		},
	}

	active := GetActiveProfiles(profiles, "linux", "amd64", "11", nil)
	if len(active) != 2 {
		t.Errorf("expected 2 active profiles, got %d", len(active))
	}
}

func TestMergeProfiles(t *testing.T) {
	baseDeps := []Dependency{
		{GroupID: "com.example", ArtifactID: "lib", Version: "1.0", Scope: "compile"},
	}
	basePlugins := []Plugin{
		{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-compiler-plugin", Version: "3.8.1"},
	}

	profiles := []BuildProfile{
		{
			ID: "override",
			Dependencies: []Dependency{
				{GroupID: "com.example", ArtifactID: "lib", Version: "2.0", Scope: "compile"},
			},
			Plugins: []Plugin{
				{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-compiler-plugin", Version: "3.9.0"},
			},
		},
	}

	deps, plugins := MergeProfiles(baseDeps, basePlugins, profiles)

	if len(deps) != 1 {
		t.Fatalf("expected 1 dep, got %d", len(deps))
	}
	if deps[0].Version != "2.0" {
		t.Errorf("dep version = %q, want 2.0 (profile override)", deps[0].Version)
	}

	if len(plugins) != 1 {
		t.Fatalf("expected 1 plugin, got %d", len(plugins))
	}
	if plugins[0].Version != "3.9.0" {
		t.Errorf("plugin version = %q, want 3.9.0 (profile override)", plugins[0].Version)
	}
}

func TestMergeProfiles_Empty(t *testing.T) {
	deps, plugins := MergeProfiles(nil, nil, nil)
	if len(deps) != 0 {
		t.Errorf("expected 0 deps, got %d", len(deps))
	}
	if len(plugins) != 0 {
		t.Errorf("expected 0 plugins, got %d", len(plugins))
	}
}

func TestParseProfilesFromPOM(t *testing.T) {
	pomData := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <profiles>
    <profile>
      <id>dev</id>
      <activation>
        <activeByDefault>true</activeByDefault>
      </activation>
      <properties>
        <env>development</env>
      </properties>
      <dependencies>
        <dependency>
          <groupId>com.h2database</groupId>
          <artifactId>h2</artifactId>
          <version>1.4.200</version>
          <scope>runtime</scope>
        </dependency>
      </dependencies>
    </profile>
    <profile>
      <id>production</id>
      <activation>
        <property>
          <name>env</name>
          <value>prod</value>
        </property>
      </activation>
      <modules>
        <module>extra-module</module>
      </modules>
    </profile>
  </profiles>
</project>`)

	profiles, err := ParseProfilesFromPOM(pomData)
	if err != nil {
		t.Fatalf("ParseProfilesFromPOM: %v", err)
	}
	if len(profiles) != 2 {
		t.Fatalf("expected 2 profiles, got %d", len(profiles))
	}

	if profiles[0].ID != "dev" {
		t.Errorf("profile[0].ID = %q, want dev", profiles[0].ID)
	}
	if !profiles[0].Activation.ActiveByDefault {
		t.Error("profile[0] should be active by default")
	}
	if len(profiles[0].Dependencies) != 1 {
		t.Errorf("profile[0] should have 1 dep, got %d", len(profiles[0].Dependencies))
	}
	if profiles[1].ID != "production" {
		t.Errorf("profile[1].ID = %q, want production", profiles[1].ID)
	}
	if len(profiles[1].Modules) != 1 {
		t.Errorf("profile[1] should have 1 module, got %d", len(profiles[1].Modules))
	}
}

func TestParseProfilesFromPOM_InvalidXml(t *testing.T) {
	_, err := ParseProfilesFromPOM([]byte("not xml"))
	if err == nil {
		t.Fatal("expected error for invalid XML")
	}
}

func TestParseProfilesFromPOM_Empty(t *testing.T) {
	profiles, err := ParseProfilesFromPOM([]byte(`<project></project>`))
	if err != nil {
		t.Fatalf("ParseProfilesFromPOM: %v", err)
	}
	if len(profiles) != 0 {
		t.Errorf("expected 0 profiles, got %d", len(profiles))
	}
}

func TestBuildLifecycleTree(t *testing.T) {
	tree := BuildLifecycleTree("jar")
	if len(tree) != 3 {
		t.Fatalf("expected 3 lifecycle trees, got %d", len(tree))
	}

	// Check default lifecycle has phases
	if tree[1].ID != "default" {
		t.Errorf("tree[1].ID = %q, want default", tree[1].ID)
	}
	if len(tree[1].Children) == 0 {
		t.Error("default lifecycle should have phases")
	}

	// Check compile phase has bindings
	var compileNode *LifecycleTreeItem
	for i := range tree[1].Children {
		if tree[1].Children[i].ID == "compile" {
			compileNode = &tree[1].Children[i]
			break
		}
	}
	if compileNode == nil {
		t.Fatal("expected compile phase")
	}
	if len(compileNode.Bindings) == 0 {
		t.Error("compile phase should have bindings")
	}
}

func TestBuildLifecycleTree_WarPackaging(t *testing.T) {
	tree := BuildLifecycleTree("war")
	if len(tree) != 3 {
		t.Fatalf("expected 3 lifecycle trees, got %d", len(tree))
	}

	// Check package phase has war plugin binding
	var packageNode *LifecycleTreeItem
	for i := range tree[1].Children {
		if tree[1].Children[i].ID == "package" {
			packageNode = &tree[1].Children[i]
			break
		}
	}
	if packageNode == nil {
		t.Fatal("expected package phase")
	}
	foundWar := false
	for _, b := range packageNode.Bindings {
		if b.ArtifactID == "maven-war-plugin" {
			foundWar = true
			break
		}
	}
	if !foundWar {
		t.Error("package phase should have maven-war-plugin binding")
	}
}

func TestLifecycleRegistry_PhasesOrder(t *testing.T) {
	reg := NewLifecycleRegistry()
	lc := reg.Lifecycles["default"]

	for i := 1; i < len(lc.Phases); i++ {
		if lc.Phases[i].Order <= lc.Phases[i-1].Order {
			t.Errorf("phase %q (order %d) should come after %q (order %d)",
				lc.Phases[i].ID, lc.Phases[i].Order,
				lc.Phases[i-1].ID, lc.Phases[i-1].Order)
		}
	}
}