// Package debug — module dependency resolver for multi-module debugging.
//
// Resolves the dependency order between modules in a multi-module
// project (e.g., Maven/Gradle) to determine the correct debug startup
// sequence. Handles topological sorting, circular dependency detection,
// and automatic debug port assignment.
package debug

import (
	"fmt"
	"sync"
)

// ModuleDebugDependency represents a module in a multi-module project
// with its debug configuration.
type ModuleDebugDependency struct {
	ModuleName     string   `json:"moduleName"`
	DependsOn      []string `json:"dependsOn"`      // modules this module depends on
	RequiredBy     []string `json:"requiredBy"`      // modules that depend on this module
	DebugPort      int      `json:"debugPort"`       // JDWP debug port for this module
	DebugOrder     int      `json:"debugOrder"`      // 0 = first, higher = later
	SourcePaths    []string `json:"sourcePaths"`     // source paths for this module
	ClassOutputDir string   `json:"classOutputDir"`  // where compiled classes go
}

// ModuleDebugDependencyResolver resolves debug startup order for
// multi-module projects.
type ModuleDebugDependencyResolver struct {
	mu      sync.RWMutex
	modules map[string]*ModuleDebugDependency
}

// NewModuleDebugDependencyResolver creates a new resolver.
func NewModuleDebugDependencyResolver() *ModuleDebugDependencyResolver {
	return &ModuleDebugDependencyResolver{
		modules: make(map[string]*ModuleDebugDependency),
	}
}

// AddModule adds a module to the resolver.
func (mdr *ModuleDebugDependencyResolver) AddModule(mod *ModuleDebugDependency) {
	mdr.mu.Lock()
	defer mdr.mu.Unlock()

	if mod == nil {
		return
	}
	mdr.modules[mod.ModuleName] = mod
}

// ResolveDebugOrder performs a topological sort to determine the
// correct debug startup order. Modules with no dependencies come first.
// Returns the module names in debug startup order.
func (mdr *ModuleDebugDependencyResolver) ResolveDebugOrder() ([]string, error) {
	mdr.mu.Lock()
	defer mdr.mu.Unlock()

	// Build adjacency list and in-degree map
	inDegree := make(map[string]int)
	adjList := make(map[string][]string)

	for name := range mdr.modules {
		inDegree[name] = 0
	}

	for name, mod := range mdr.modules {
		for _, dep := range mod.DependsOn {
			// Only count dependency if the module exists in our set
			if _, ok := mdr.modules[dep]; ok {
				adjList[name] = append(adjList[name], dep)
				inDegree[dep]++
			}
		}
	}

	// Kahn's algorithm for topological sort
	var queue []string
	for name, degree := range inDegree {
		if degree == 0 {
			queue = append(queue, name)
		}
	}

	var result []string
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		result = append(result, current)

		for _, dependent := range adjList[current] {
			inDegree[dependent]--
			if inDegree[dependent] == 0 {
				queue = append(queue, dependent)
			}
		}
	}

	// Check for cycles
	if len(result) != len(mdr.modules) {
		return nil, fmt.Errorf("circular dependency detected: %d modules in cycle", len(mdr.modules)-len(result))
	}

	// Assign debug order
	for i, name := range result {
		if mod, ok := mdr.modules[name]; ok {
			mod.DebugOrder = i
		}
	}

	return result, nil
}

// GetModuleDependencies returns all dependencies of a module
// (both direct and transitive).
func (mdr *ModuleDebugDependencyResolver) GetModuleDependencies(moduleName string) []string {
	mdr.mu.RLock()
	defer mdr.mu.RUnlock()

	visited := make(map[string]bool)
	var result []string
	mdr.collectDependencies(moduleName, visited, &result)
	return result
}

// collectDependencies recursively collects all transitive dependencies.
func (mdr *ModuleDebugDependencyResolver) collectDependencies(moduleName string, visited map[string]bool, result *[]string) {
	if visited[moduleName] {
		return
	}
	visited[moduleName] = true

	mod, ok := mdr.modules[moduleName]
	if !ok {
		return
	}

	for _, dep := range mod.DependsOn {
		if !visited[dep] {
			*result = append(*result, dep)
			mdr.collectDependencies(dep, visited, result)
		}
	}
}

// ValidateDependencies checks for issues in the dependency graph.
// Returns a list of warning messages. An empty list means no issues.
func (mdr *ModuleDebugDependencyResolver) ValidateDependencies() []string {
	mdr.mu.RLock()
	defer mdr.mu.RUnlock()

	var warnings []string

	// Check for self-references
	for name, mod := range mdr.modules {
		for _, dep := range mod.DependsOn {
			if dep == name {
				warnings = append(warnings, fmt.Sprintf("module %q depends on itself", name))
			}
		}
	}

	// Check for missing dependency modules
	for name, mod := range mdr.modules {
		for _, dep := range mod.DependsOn {
			if _, ok := mdr.modules[dep]; !ok {
				warnings = append(warnings, fmt.Sprintf("module %q depends on unknown module %q", name, dep))
			}
		}
	}

	// Check for circular dependencies via topological sort
	_, err := mdr.resolveOrderInternal()
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("circular dependency detected: %v", err))
	}

	return warnings
}

// resolveOrderInternal is the internal lock-free version for use within locked contexts.
func (mdr *ModuleDebugDependencyResolver) resolveOrderInternal() ([]string, error) {
	inDegree := make(map[string]int)
	adjList := make(map[string][]string)

	for name := range mdr.modules {
		inDegree[name] = 0
	}

	for name, mod := range mdr.modules {
		for _, dep := range mod.DependsOn {
			if _, ok := mdr.modules[dep]; ok {
				adjList[name] = append(adjList[name], dep)
				inDegree[dep]++
			}
		}
	}

	var queue []string
	for name, degree := range inDegree {
		if degree == 0 {
			queue = append(queue, name)
		}
	}

	var result []string
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		result = append(result, current)

		for _, dependent := range adjList[current] {
			inDegree[dependent]--
			if inDegree[dependent] == 0 {
				queue = append(queue, dependent)
			}
		}
	}

	if len(result) != len(mdr.modules) {
		return nil, fmt.Errorf("%d modules in cycle", len(mdr.modules)-len(result))
	}

	return result, nil
}

// AssignDebugPorts automatically assigns unique debug ports to all
// modules, starting from the given base port.
// Returns a map of module name → assigned port.
func (mdr *ModuleDebugDependencyResolver) AssignDebugPorts(basePort int) map[string]int {
	mdr.mu.Lock()
	defer mdr.mu.Unlock()

	result := make(map[string]int)
	port := basePort

	for name, mod := range mdr.modules {
		mod.DebugPort = port
		result[name] = port
		port++
	}

	return result
}

// GetModule returns a module by name.
func (mdr *ModuleDebugDependencyResolver) GetModule(moduleName string) (*ModuleDebugDependency, bool) {
	mdr.mu.RLock()
	defer mdr.mu.RUnlock()

	mod, ok := mdr.modules[moduleName]
	return mod, ok
}

// RemoveModule removes a module from the resolver.
func (mdr *ModuleDebugDependencyResolver) RemoveModule(moduleName string) error {
	mdr.mu.Lock()
	defer mdr.mu.Unlock()

	if _, ok := mdr.modules[moduleName]; !ok {
		return fmt.Errorf("module %s not found", moduleName)
	}
	delete(mdr.modules, moduleName)
	return nil
}

// ModuleCount returns the number of modules in the resolver.
func (mdr *ModuleDebugDependencyResolver) ModuleCount() int {
	mdr.mu.RLock()
	defer mdr.mu.RUnlock()
	return len(mdr.modules)
}

// Clear removes all modules.
func (mdr *ModuleDebugDependencyResolver) Clear() {
	mdr.mu.Lock()
	defer mdr.mu.Unlock()

	mdr.modules = make(map[string]*ModuleDebugDependency)
}

// ListModules returns all module names.
func (mdr *ModuleDebugDependencyResolver) ListModules() []string {
	mdr.mu.RLock()
	defer mdr.mu.RUnlock()

	result := make([]string, 0, len(mdr.modules))
	for name := range mdr.modules {
		result = append(result, name)
	}
	return result
}