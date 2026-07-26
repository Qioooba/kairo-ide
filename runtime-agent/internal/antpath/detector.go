package antpath

import "strings"

// detectCompileClasspath finds the most likely compile classpath from a build project.
func detectCompileClasspath(p *BuildProject) *AntPath {
	// Priority 1: javac classpathref
	for _, target := range p.Targets {
		for _, javac := range target.JavacTasks {
			if javac.ClasspathRef != "" {
				if cp, ok := p.Paths[javac.ClasspathRef]; ok {
					return cp
				}
			}
			if javac.InlineClasspath != nil {
				return javac.InlineClasspath
			}
		}
	}

	// Priority 2: name matching
	namePatterns := []string{
		"compile.classpath", "compile-classpath",
		"classpath", "build.classpath",
		"cp", "javac.classpath",
		"project.classpath",
	}
	for _, name := range namePatterns {
		if cp, ok := p.Paths[name]; ok {
			return cp
		}
	}
	// Partial match: any path id containing "classpath"
	for id, cp := range p.Paths {
		if strings.Contains(strings.ToLower(id), "classpath") {
			return cp
		}
	}
	// Partial match: any path id containing "compile"
	for id, cp := range p.Paths {
		if strings.Contains(strings.ToLower(id), "compile") {
			return cp
		}
	}

	// Priority 3: contains WEB-INF/lib fileset
	for _, cp := range p.Paths {
		for _, fs := range cp.FileSets {
			if strings.Contains(strings.ToLower(fs.Dir), "web-inf/lib") {
				return cp
			}
		}
	}

	return nil
}