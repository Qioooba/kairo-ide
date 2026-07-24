package debug

import (
	"testing"
)

// ── ModuleDebugDependencyResolver Tests ────────────────────────────

func TestNewModuleDebugDependencyResolver(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	if mdr == nil {
		t.Fatal("resolver should not be nil")
	}
	if mdr.ModuleCount() != 0 {
		t.Errorf("initial module count = %d, want 0", mdr.ModuleCount())
	}
}

func TestAddModule(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "web"})

	if mdr.ModuleCount() != 2 {
		t.Errorf("module count = %d, want 2", mdr.ModuleCount())
	}
}

func TestAddModuleNil(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(nil)
	if mdr.ModuleCount() != 0 {
		t.Errorf("module count = %d, want 0", mdr.ModuleCount())
	}
}

func TestGetModule(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{
		ModuleName:     "core",
		DebugPort:      5005,
		SourcePaths:    []string{"src/main/java"},
		ClassOutputDir: "target/classes",
	})

	mod, ok := mdr.GetModule("core")
	if !ok {
		t.Fatal("module not found")
	}
	if mod.DebugPort != 5005 {
		t.Errorf("DebugPort = %d, want 5005", mod.DebugPort)
	}
	if len(mod.SourcePaths) != 1 || mod.SourcePaths[0] != "src/main/java" {
		t.Errorf("SourcePaths = %v, want [src/main/java]", mod.SourcePaths)
	}
	if mod.ClassOutputDir != "target/classes" {
		t.Errorf("ClassOutputDir = %s, want target/classes", mod.ClassOutputDir)
	}
}

func TestGetModuleNotFound(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	_, ok := mdr.GetModule("nonexistent")
	if ok {
		t.Error("should not find nonexistent module")
	}
}

func TestRemoveModule(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core"})

	err := mdr.RemoveModule("core")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mdr.ModuleCount() != 0 {
		t.Errorf("module count = %d, want 0", mdr.ModuleCount())
	}
}

func TestRemoveModuleNotFound(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	err := mdr.RemoveModule("nonexistent")
	if err == nil {
		t.Error("removing nonexistent module should fail")
	}
}

func TestListModules(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "web"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "api"})

	modules := mdr.ListModules()
	if len(modules) != 3 {
		t.Errorf("modules count = %d, want 3", len(modules))
	}
}

func TestModuleDependencyClear(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "web"})

	mdr.Clear()
	if mdr.ModuleCount() != 0 {
		t.Errorf("module count after clear = %d, want 0", mdr.ModuleCount())
	}
}

func TestResolveDebugOrder_NoDependencies(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "web"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "api"})

	order, err := mdr.ResolveDebugOrder()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(order) != 3 {
		t.Errorf("order length = %d, want 3", len(order))
	}
}

func TestResolveDebugOrder_LinearDependency(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	// web depends on api depends on core
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "api", DependsOn: []string{"core"}})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "web", DependsOn: []string{"api"}})

	order, err := mdr.ResolveDebugOrder()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(order) != 3 {
		t.Fatalf("order length = %d, want 3", len(order))
	}

	// web should come first (no one depends on it), then api, then core
	if order[0] != "web" {
		t.Errorf("first in order = %s, want web", order[0])
	}
	if order[2] != "core" {
		t.Errorf("last in order = %s, want core", order[2])
	}
}

func TestResolveDebugOrder_DiamondDependency(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	// app depends on both core and web
	// core and web depend on common
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "common"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core", DependsOn: []string{"common"}})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "web", DependsOn: []string{"common"}})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "app", DependsOn: []string{"core", "web"}})

	order, err := mdr.ResolveDebugOrder()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(order) != 4 {
		t.Fatalf("order length = %d, want 4", len(order))
	}

	// app should be first, common should be last
	if order[0] != "app" {
		t.Errorf("first in order = %s, want app", order[0])
	}
	if order[3] != "common" {
		t.Errorf("last in order = %s, want common", order[3])
	}
}

func TestResolveDebugOrder_CircularDependency(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "a", DependsOn: []string{"b"}})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "b", DependsOn: []string{"a"}})

	_, err := mdr.ResolveDebugOrder()
	if err == nil {
		t.Error("circular dependency should return an error")
	}
}

func TestResolveDebugOrder_AssignsDebugOrder(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "web", DependsOn: []string{"core"}})

	_, err := mdr.ResolveDebugOrder()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	webMod, _ := mdr.GetModule("web")
	coreMod, _ := mdr.GetModule("core")

	if webMod.DebugOrder != 0 {
		t.Errorf("web DebugOrder = %d, want 0", webMod.DebugOrder)
	}
	if coreMod.DebugOrder != 1 {
		t.Errorf("core DebugOrder = %d, want 1", coreMod.DebugOrder)
	}
}

func TestGetModuleDependencies(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "common"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core", DependsOn: []string{"common"}})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "web", DependsOn: []string{"core"}})

	deps := mdr.GetModuleDependencies("web")
	if len(deps) != 2 {
		t.Errorf("dependencies count = %d, want 2", len(deps))
	}

	// Should include both direct and transitive
	foundCore := false
	foundCommon := false
	for _, d := range deps {
		if d == "core" {
			foundCore = true
		}
		if d == "common" {
			foundCommon = true
		}
	}
	if !foundCore {
		t.Error("core not found in dependencies")
	}
	if !foundCommon {
		t.Error("common not found in dependencies")
	}
}

func TestGetModuleDependencies_UnknownModule(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	deps := mdr.GetModuleDependencies("nonexistent")
	if len(deps) != 0 {
		t.Errorf("dependencies for unknown module = %d, want 0", len(deps))
	}
}

func TestValidateDependencies_NoIssues(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "common"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core", DependsOn: []string{"common"}})

	warnings := mdr.ValidateDependencies()
	if len(warnings) != 0 {
		t.Errorf("unexpected warnings: %v", warnings)
	}
}

func TestValidateDependencies_SelfReference(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core", DependsOn: []string{"core"}})

	warnings := mdr.ValidateDependencies()
	if len(warnings) == 0 {
		t.Error("self-reference should produce a warning")
	}
}

func TestValidateDependencies_UnknownDependency(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core", DependsOn: []string{"nonexistent"}})

	warnings := mdr.ValidateDependencies()
	if len(warnings) == 0 {
		t.Error("unknown dependency should produce a warning")
	}
}

func TestValidateDependencies_Circular(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "a", DependsOn: []string{"b"}})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "b", DependsOn: []string{"a"}})

	warnings := mdr.ValidateDependencies()
	if len(warnings) == 0 {
		t.Error("circular dependency should produce a warning")
	}
}

func TestAssignDebugPorts(t *testing.T) {
	mdr := NewModuleDebugDependencyResolver()
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "core"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "web"})
	mdr.AddModule(&ModuleDebugDependency{ModuleName: "api"})

	ports := mdr.AssignDebugPorts(5005)
	if len(ports) != 3 {
		t.Errorf("ports count = %d, want 3", len(ports))
	}

	// Verify no duplicate ports
	seen := make(map[int]bool)
	for _, port := range ports {
		if seen[port] {
			t.Errorf("duplicate port %d", port)
		}
		seen[port] = true
	}

	// Verify modules have their ports set
	coreMod, _ := mdr.GetModule("core")
	webMod, _ := mdr.GetModule("web")
	apiMod, _ := mdr.GetModule("api")

	if coreMod.DebugPort != ports["core"] {
		t.Errorf("core port mismatch")
	}
	if webMod.DebugPort != ports["web"] {
		t.Errorf("web port mismatch")
	}
	if apiMod.DebugPort != ports["api"] {
		t.Errorf("api port mismatch")
	}
}