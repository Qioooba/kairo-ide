package antpath

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var propRefRE = regexp.MustCompile(`\$\{([^}]+)\}`)

// Resolve resolves a build.xml file into a classpath result.
func Resolve(buildFile string) (*ResolveResult, error) {
	project, err := ParseFile(buildFile)
	if err != nil {
		return nil, err
	}

	// Recursively process imports (max depth 5)
	processImports(project, filepath.Dir(buildFile), 0, 5)

	// Resolve properties
	resolveProperties(project)

	// Detect compile classpath
	compilePath := detectCompileClasspath(project)

	result := &ResolveResult{
		Properties: project.Properties,
		Warnings:   project.Warnings,
	}

	if compilePath != nil {
		// Expand the classpath
		classpath := expandAntPath(compilePath, project)
		result.Classpath = classpath
	}

	// Detect source roots and output dir
	for _, target := range project.Targets {
		for _, jc := range target.JavacTasks {
			if jc.SrcDir != "" {
				resolved := resolveProp(jc.SrcDir, project.Properties)
				abs := filepath.Join(project.Basedir, resolved)
				if info, err := os.Stat(abs); err == nil && info.IsDir() {
					result.SourceRoots = append(result.SourceRoots, abs)
				}
			}
			if jc.DestDir != "" && result.OutputDir == "" {
				resolved := resolveProp(jc.DestDir, project.Properties)
				result.OutputDir = filepath.Join(project.Basedir, resolved)
			}
		}
	}

	return result, nil
}

// processImports recursively processes imported build files.
func processImports(project *BuildProject, baseDir string, depth int, maxDepth int) {
	if depth >= maxDepth {
		return
	}
	for _, imp := range project.Imports {
		importPath := filepath.Join(baseDir, imp.File)
		imported, err := ParseFile(importPath)
		if err != nil {
			if !imp.Optional {
				project.Warnings = append(project.Warnings, ResolveWarning{
					File:     importPath,
					Message:  fmt.Sprintf("Cannot parse imported file: %v", err),
					Severity: "warning",
				})
			}
			continue
		}
		// Merge properties (imported first, main project overrides)
		for k, v := range imported.Properties {
			if _, exists := project.Properties[k]; !exists {
				project.Properties[k] = v
			}
		}
		// Merge paths
		for k, v := range imported.Paths {
			if _, exists := project.Paths[k]; !exists {
				project.Paths[k] = v
			}
		}
		// Merge targets
		for k, v := range imported.Targets {
			if _, exists := project.Targets[k]; !exists {
				project.Targets[k] = v
			}
		}
	}
}

// resolveProperties expands all ${...} references in properties.
func resolveProperties(project *BuildProject) {
	// Resolve environment variables
	for k, v := range project.Properties {
		if strings.HasPrefix(v, "${env.") {
			envName := strings.TrimSuffix(strings.TrimPrefix(v, "${env."), "}")
			if envVal := os.Getenv(envName); envVal != "" {
				project.Properties[k] = envVal
			}
		}
	}
	// Two-pass resolution for nested references
	for i := 0; i < 3; i++ {
		changed := false
		for k, v := range project.Properties {
			resolved := resolveProp(v, project.Properties)
			if resolved != v {
				project.Properties[k] = resolved
				changed = true
			}
		}
		if !changed {
			break
		}
	}
}

func resolveProp(value string, props map[string]string) string {
	// Iterate until stable (handles nested references like ${webinf}/lib where
	// webinf=${webroot}/WEB-INF and webroot=WebRoot).
	for i := 0; i < 10; i++ {
		prev := value
		value = propRefRE.ReplaceAllStringFunc(value, func(match string) string {
			name := match[2 : len(match)-1] // Remove ${ and }
			if val, ok := props[name]; ok {
				return val
			}
			// Check environment variables
			if strings.HasPrefix(name, "env.") {
				envName := name[4:]
				if envVal := os.Getenv(envName); envVal != "" {
					return envVal
				}
			}
			return match // Keep as-is if unresolved
		})
		if value == prev {
			break
		}
	}
	return value
}

// expandAntPath expands a path definition to absolute file paths.
func expandAntPath(ap *AntPath, project *BuildProject) []string {
	var result []string
	seen := make(map[string]bool)

	// Process locations
	for _, loc := range ap.Location {
		resolved := resolveProp(loc, project.Properties)
		abs := toAbs(resolved, project.Basedir)
		if _, err := os.Stat(abs); err == nil && !seen[abs] {
			result = append(result, abs)
			seen[abs] = true
		}
	}

	// Process path entries
	for _, p := range ap.Path {
		for _, part := range splitPath(p) {
			resolved := resolveProp(part, project.Properties)
			abs := toAbs(resolved, project.Basedir)
			if _, err := os.Stat(abs); err == nil && !seen[abs] {
				result = append(result, abs)
				seen[abs] = true
			}
		}
	}

	// Process filesets
	for _, fs := range ap.FileSets {
		dir := resolveProp(fs.Dir, project.Properties)
		absDir := toAbs(dir, project.Basedir)

		includes := fs.Includes
		if len(includes) == 0 {
			includes = []string{"**/*"}
		}

		for _, pattern := range includes {
			matches, err := globWithDoubleStar(absDir, pattern)
			if err != nil {
				continue
			}
			for _, match := range matches {
				info, err := os.Stat(match)
				if err != nil || info.IsDir() {
					continue
				}
				// Check exclusions
				excluded := false
				for _, exc := range fs.Excludes {
					matched, _ := filepath.Match(exc, filepath.Base(match))
					if matched {
						excluded = true
						break
					}
				}
				if !excluded && !seen[match] {
					result = append(result, match)
					seen[match] = true
				}
			}
		}
	}

	// Process path references
	for _, refID := range ap.PathRefs {
		if ref, ok := project.Paths[refID]; ok && ref != ap {
			refEntries := expandAntPath(ref, project)
			for _, entry := range refEntries {
				if !seen[entry] {
					result = append(result, entry)
					seen[entry] = true
				}
			}
		}
	}

	return result
}

func toAbs(p string, baseDir string) string {
	if filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(baseDir, p)
}

// globWithDoubleStar performs a glob match that supports ** (double-star)
// patterns. Go's filepath.Glob does not support **, so we walk the tree
// ourselves for patterns containing **.
func globWithDoubleStar(baseDir string, pattern string) ([]string, error) {
	// If the pattern doesn't contain **, use standard filepath.Glob
	if !strings.Contains(pattern, "**") {
		return filepath.Glob(filepath.Join(baseDir, pattern))
	}

	var matches []string
	err := filepath.Walk(baseDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if info.IsDir() {
			return nil // Skip directories, only return files
		}
		rel, err := filepath.Rel(baseDir, path)
		if err != nil {
			return nil
		}
		// Check if the relative path matches the pattern
		matched, _ := filepath.Match(pattern, rel)
		if matched {
			matches = append(matches, path)
		}
		return nil
	})

	return matches, err
}