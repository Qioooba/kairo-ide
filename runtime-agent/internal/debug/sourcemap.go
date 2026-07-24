// Package debug — source map for class-to-source resolution.
//
// Implements class file → source file mapping, Maven multi-module
// source path resolution, JAR-internal source association, and
// decompilation fallback for classes without source attachments.
package debug

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// SourceMapEntry represents a single class-to-source mapping.
type SourceMapEntry struct {
	// ClassName is the fully qualified class name (e.g., "com.example.MyClass").
	ClassName string `json:"className"`
	// SourcePath is the absolute path to the source file.
	SourcePath string `json:"sourcePath"`
	// ModuleName is the Maven/Gradle module containing this source.
	ModuleName string `json:"moduleName,omitempty"`
	// SourceRoot is the root directory of the source tree.
	SourceRoot string `json:"sourceRoot,omitempty"`
	// IsJarSource indicates the source is inside a JAR (e.g., sources.jar).
	IsJarSource bool `json:"isJarSource"`
	// JarPath is the path to the JAR containing the source (if IsJarSource).
	JarPath string `json:"jarPath,omitempty"`
	// IsDecompiled indicates the source was produced by a decompiler.
	IsDecompiled bool `json:"isDecompiled"`
	// DecompilerName is the name of the decompiler used (e.g., "CFR", "Procyon").
	DecompilerName string `json:"decompilerName,omitempty"`
	// LineOffset is the offset between source line numbers and class line numbers.
	LineOffset int32 `json:"lineOffset"`
}

// SourceMap manages class-to-source file mappings for multi-module
// Java projects. It supports Maven multi-module layout, JAR source
// attachments, and decompilation fallback.
type SourceMap struct {
	mu sync.RWMutex
	// entries maps class name → source map entry
	entries map[string]*SourceMapEntry
	// moduleRoots maps module name → source root directory
	moduleRoots map[string]string
	// sourceRoots is a list of all source root directories
	sourceRoots []string
	// classpathRoots is a list of all classpath root directories
	classpathRoots []string
	// jarSources maps JAR path → source JAR path
	jarSources map[string]string
	// decompilerEnabled controls whether decompilation fallback is active
	decompilerEnabled bool
}

// NewSourceMap creates a new SourceMap.
func NewSourceMap() *SourceMap {
	return &SourceMap{
		entries:       make(map[string]*SourceMapEntry),
		moduleRoots:   make(map[string]string),
		sourceRoots:   make([]string, 0),
		classpathRoots: make([]string, 0),
		jarSources:    make(map[string]string),
	}
}

// AddSourceRoot adds a source root directory for scanning.
func (sm *SourceMap) AddSourceRoot(root string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.sourceRoots = append(sm.sourceRoots, root)
}

// AddModule maps a Maven module name to its source root.
func (sm *SourceMap) AddModule(name, sourceRoot string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.moduleRoots[name] = sourceRoot
	sm.sourceRoots = append(sm.sourceRoots, sourceRoot)
}

// AddClasspathRoot adds a classpath root for class file scanning.
func (sm *SourceMap) AddClasspathRoot(root string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.classpathRoots = append(sm.classpathRoots, root)
}

// AddJarSource associates a JAR with its source JAR.
func (sm *SourceMap) AddJarSource(jarPath, sourceJarPath string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.jarSources[jarPath] = sourceJarPath
}

// EnableDecompiler enables or disables the decompilation fallback.
func (sm *SourceMap) EnableDecompiler(enabled bool) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.decompilerEnabled = enabled
}

// ResolveSource resolves a class name to its source file path.
// It searches in this order:
//  1. Existing source map entries
//  2. Source root scanning
//  3. Maven module layout detection
//  4. JAR source attachment
//  5. Decompilation fallback
func (sm *SourceMap) ResolveSource(className string) (*SourceMapEntry, error) {
	sm.mu.RLock()
	// Check cache first
	if entry, ok := sm.entries[className]; ok {
		sm.mu.RUnlock()
		return entry, nil
	}
	sm.mu.RUnlock()

	// Try to resolve from source roots
	entry, err := sm.resolveFromSourceRoots(className)
	if err == nil {
		sm.mu.Lock()
		sm.entries[className] = entry
		sm.mu.Unlock()
		return entry, nil
	}

	// Try Maven module layout
	entry, err = sm.resolveFromMavenModules(className)
	if err == nil {
		sm.mu.Lock()
		sm.entries[className] = entry
		sm.mu.Unlock()
		return entry, nil
	}

	// Try JAR source attachment
	entry, err = sm.resolveFromJarSource(className)
	if err == nil {
		sm.mu.Lock()
		sm.entries[className] = entry
		sm.mu.Unlock()
		return entry, nil
	}

	// Decompilation fallback
	if sm.decompilerEnabled {
		entry, err = sm.resolveViaDecompiler(className)
		if err == nil {
			sm.mu.Lock()
			sm.entries[className] = entry
			sm.mu.Unlock()
			return entry, nil
		}
	}

	return nil, fmt.Errorf("source not found for class %s", className)
}

// resolveFromSourceRoots searches for a source file in the registered source roots.
func (sm *SourceMap) resolveFromSourceRoots(className string) (*SourceMapEntry, error) {
	sm.mu.RLock()
	roots := make([]string, len(sm.sourceRoots))
	copy(roots, sm.sourceRoots)
	sm.mu.RUnlock()

	relativePath := classToSourcePath(className)

	for _, root := range roots {
		fullPath := filepath.Join(root, relativePath)
		if _, err := os.Stat(fullPath); err == nil {
			return &SourceMapEntry{
				ClassName:  className,
				SourcePath: fullPath,
				SourceRoot: root,
			}, nil
		}
	}

	return nil, fmt.Errorf("class %s not found in source roots", className)
}

// resolveFromMavenModules searches for a source file using Maven module layout.
// Maven multi-module projects typically have:
//
//	project/
//	  module-a/src/main/java/com/example/...
//	  module-b/src/main/java/com/example/...
func (sm *SourceMap) resolveFromMavenModules(className string) (*SourceMapEntry, error) {
	sm.mu.RLock()
	moduleRoots := make(map[string]string, len(sm.moduleRoots))
	for k, v := range sm.moduleRoots {
		moduleRoots[k] = v
	}
	roots := make([]string, len(sm.sourceRoots))
	copy(roots, sm.sourceRoots)
	sm.mu.RUnlock()

	relativePath := classToSourcePath(className)

	// Try each module's standard Maven source directories
	mavenSrcDirs := []string{
		"src/main/java",
		"src/main/kotlin",
		"src/main/scala",
	}

	for moduleName, root := range moduleRoots {
		for _, srcDir := range mavenSrcDirs {
			fullPath := filepath.Join(root, srcDir, relativePath)
			if _, err := os.Stat(fullPath); err == nil {
				return &SourceMapEntry{
					ClassName:  className,
					SourcePath: fullPath,
					SourceRoot: root,
					ModuleName: moduleName,
				}, nil
			}
		}
	}

	// Try broader search: walk source roots for Maven layout
	for _, root := range roots {
		// Check if root itself is a Maven module (has src/main/java)
		for _, srcDir := range mavenSrcDirs {
			fullPath := filepath.Join(root, srcDir, relativePath)
			if _, err := os.Stat(fullPath); err == nil {
				moduleName := filepath.Base(root)
				return &SourceMapEntry{
					ClassName:  className,
					SourcePath: fullPath,
					SourceRoot: root,
					ModuleName: moduleName,
				}, nil
			}
		}
	}

	return nil, fmt.Errorf("class %s not found in Maven modules", className)
}

// resolveFromJarSource searches for a source file inside a source JAR.
func (sm *SourceMap) resolveFromJarSource(className string) (*SourceMapEntry, error) {
	sm.mu.RLock()
	jarSources := make(map[string]string, len(sm.jarSources))
	for k, v := range sm.jarSources {
		jarSources[k] = v
	}
	sm.mu.RUnlock()

	relativePath := classToSourcePath(className)

	for jarPath, srcJarPath := range jarSources {
		_ = jarPath
		// Check if the source JAR exists
		if _, err := os.Stat(srcJarPath); err != nil {
			continue
		}

		// Note: actual JAR content reading would require a ZIP reader.
		// For now, we record the association and let the caller handle
		// JAR-internal extraction.
		return &SourceMapEntry{
			ClassName:   className,
			SourcePath:  "jar:" + srcJarPath + "!/" + relativePath,
			IsJarSource: true,
			JarPath:     srcJarPath,
		}, nil
	}

	return nil, fmt.Errorf("class %s not found in JAR sources", className)
}

// resolveViaDecompiler provides a decompilation fallback.
// When no source is available, we mark the entry as decompiled
// and the caller can use an external decompiler (CFR, Procyon, etc.)
func (sm *SourceMap) resolveViaDecompiler(className string) (*SourceMapEntry, error) {
	sm.mu.RLock()
	classpathRoots := make([]string, len(sm.classpathRoots))
	copy(classpathRoots, sm.classpathRoots)
	sm.mu.RUnlock()

	relativePath := classToSourcePath(className)

	// Generate a virtual source path for decompiled output
	for _, root := range classpathRoots {
		classFile := filepath.Join(root, classToClassPath(className))
		if _, err := os.Stat(classFile); err == nil {
			// Class file exists, mark as decompilable
			decompiledDir := filepath.Join(root, ".kairo-decompiled")
			virtualSource := filepath.Join(decompiledDir, relativePath)
			return &SourceMapEntry{
				ClassName:      className,
				SourcePath:     virtualSource,
				SourceRoot:     root,
				IsDecompiled:   true,
				DecompilerName: "CFR",
			}, nil
		}
	}

	return nil, fmt.Errorf("class file for %s not found for decompilation", className)
}

// GetSourcePath returns the source path for a class, or empty string if not found.
func (sm *SourceMap) GetSourcePath(className string) string {
	entry, err := sm.ResolveSource(className)
	if err != nil {
		return ""
	}
	return entry.SourcePath
}

// ListEntries returns all source map entries.
func (sm *SourceMap) ListEntries() []*SourceMapEntry {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	result := make([]*SourceMapEntry, 0, len(sm.entries))
	for _, entry := range sm.entries {
		result = append(result, entry)
	}
	return result
}

// Count returns the number of mapped entries.
func (sm *SourceMap) Count() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.entries)
}

// Clear removes all entries.
func (sm *SourceMap) Clear() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.entries = make(map[string]*SourceMapEntry)
}

// ── Path Conversion Helpers ───────────────────────────────────────

// classToSourcePath converts a fully qualified class name to a relative
// source file path. "com.example.MyClass" → "com/example/MyClass.java"
func classToSourcePath(className string) string {
	// Handle nested classes (e.g., "com.example.Outer$Inner")
	className = strings.SplitN(className, "$", 2)[0]
	return strings.ReplaceAll(className, ".", string(filepath.Separator)) + ".java"
}

// classToClassPath converts a fully qualified class name to a relative
// class file path. "com.example.MyClass" → "com/example/MyClass.class"
func classToClassPath(className string) string {
	className = strings.SplitN(className, "$", 2)[0]
	return strings.ReplaceAll(className, ".", string(filepath.Separator)) + ".class"
}

// ── Maven Multi-Module Source Path Resolution ─────────────────────

// MavenModuleLayout represents a detected Maven multi-module project layout.
type MavenModuleLayout struct {
	// ProjectRoot is the root directory of the Maven project.
	ProjectRoot string `json:"projectRoot"`
	// Modules lists all detected sub-modules.
	Modules []MavenModule `json:"modules"`
}

// MavenModule represents a single Maven module.
type MavenModule struct {
	// Name is the module name (artifactId).
	Name string `json:"name"`
	// Path is the module directory path.
	Path string `json:"path"`
	// SourceRoot is the path to src/main/java.
	SourceRoot string `json:"sourceRoot"`
	// TestSourceRoot is the path to src/test/java.
	TestSourceRoot string `json:"testSourceRoot,omitempty"`
	// ResourceRoot is the path to src/main/resources.
	ResourceRoot string `json:"resourceRoot,omitempty"`
	// TargetDir is the path to target/.
	TargetDir string `json:"targetDir,omitempty"`
	// ClassOutputDir is the path to target/classes.
	ClassOutputDir string `json:"classOutputDir,omitempty"`
}

// DetectMavenModules scans a directory for Maven multi-module layout.
// It looks for subdirectories containing pom.xml files.
func DetectMavenModules(projectRoot string) (*MavenModuleLayout, error) {
	layout := &MavenModuleLayout{
		ProjectRoot: projectRoot,
		Modules:     make([]MavenModule, 0),
	}

	// Check if projectRoot itself is a Maven module
	pomPath := filepath.Join(projectRoot, "pom.xml")
	if _, err := os.Stat(pomPath); err == nil {
		// It's a Maven project. Check for sub-modules.
		entries, err := os.ReadDir(projectRoot)
		if err != nil {
			return nil, fmt.Errorf("read project root: %w", err)
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			subPomPath := filepath.Join(projectRoot, entry.Name(), "pom.xml")
			if _, err := os.Stat(subPomPath); err == nil {
				module := MavenModule{
					Name:           entry.Name(),
					Path:           filepath.Join(projectRoot, entry.Name()),
					SourceRoot:     filepath.Join(projectRoot, entry.Name(), "src", "main", "java"),
					TestSourceRoot: filepath.Join(projectRoot, entry.Name(), "src", "test", "java"),
					ResourceRoot:   filepath.Join(projectRoot, entry.Name(), "src", "main", "resources"),
					TargetDir:      filepath.Join(projectRoot, entry.Name(), "target"),
					ClassOutputDir: filepath.Join(projectRoot, entry.Name(), "target", "classes"),
				}
				layout.Modules = append(layout.Modules, module)
			}
		}

		// Also add the root as a module if it has src/main/java
		rootSrcDir := filepath.Join(projectRoot, "src", "main", "java")
		if _, err := os.Stat(rootSrcDir); err == nil {
			rootModule := MavenModule{
				Name:           filepath.Base(projectRoot),
				Path:           projectRoot,
				SourceRoot:     rootSrcDir,
				TestSourceRoot: filepath.Join(projectRoot, "src", "test", "java"),
				ResourceRoot:   filepath.Join(projectRoot, "src", "main", "resources"),
				TargetDir:      filepath.Join(projectRoot, "target"),
				ClassOutputDir: filepath.Join(projectRoot, "target", "classes"),
			}
			layout.Modules = append(layout.Modules, rootModule)
		}
	}

	return layout, nil
}

// PopulateSourceMap populates a SourceMap from a MavenModuleLayout.
func PopulateSourceMap(sm *SourceMap, layout *MavenModuleLayout) {
	for _, module := range layout.Modules {
		// AddModule already registers the source root in moduleRoots
		// and appends to sourceRoots — no need to call AddSourceRoot again.
		sm.AddModule(module.Name, module.SourceRoot)

		// Add source JAR associations
		// Maven convention: target/<artifactId>-<version>-sources.jar
		sourceJarPattern := filepath.Join(module.TargetDir, module.Name+"-sources.jar")
		if _, err := os.Stat(sourceJarPattern); err == nil {
			sm.AddJarSource(module.Name+".jar", sourceJarPattern)
		}
	}
}

// ── Decompilation Support ─────────────────────────────────────────

// DecompilerConfig configures the decompilation fallback.
type DecompilerConfig struct {
	// Enabled controls whether decompilation is active.
	Enabled bool `json:"enabled"`
	// DecompilerName is the decompiler to use (e.g., "CFR", "Procyon", "FernFlower").
	DecompilerName string `json:"decompilerName"`
	// OutputDir is the directory for decompiled source files.
	OutputDir string `json:"outputDir"`
	// CacheEnabled controls whether decompiled sources are cached.
	CacheEnabled bool `json:"cacheEnabled"`
}

// DefaultDecompilerConfig returns a default decompiler configuration.
func DefaultDecompilerConfig() DecompilerConfig {
	return DecompilerConfig{
		Enabled:        true,
		DecompilerName: "CFR",
		OutputDir:      ".kairo-decompiled",
		CacheEnabled:   true,
	}
}

// ApplyDecompilerConfig applies a decompiler configuration to a SourceMap.
func (sm *SourceMap) ApplyDecompilerConfig(cfg DecompilerConfig) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.decompilerEnabled = cfg.Enabled
}