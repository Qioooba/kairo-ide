package search

import (
	"path/filepath"
	"regexp"
	"strings"
)

// globSet is a small wrapper around a list of compiled globs.
type globSet struct {
	globs []*compiledGlob
}

type compiledGlob struct {
	re       *regexp.Regexp
	basename bool // when true, also match against filepath.Base
}

func compileGlobs(patterns []string) *globSet {
	if len(patterns) == 0 {
		return nil
	}
	out := &globSet{}
	for _, p := range patterns {
		p = strings.TrimSpace(strings.ReplaceAll(p, "\\", "/"))
		if p == "" {
			continue
		}
		g := compileGlob(p)
		if g != nil {
			out.globs = append(out.globs, g)
		}
	}
	if len(out.globs) == 0 {
		return nil
	}
	return out
}

func (g *globSet) matchAny(s string) bool {
	if g == nil {
		return false
	}
	s = strings.ReplaceAll(s, "\\", "/")
	base := filepath.Base(s)
	for _, cg := range g.globs {
		if cg.re.MatchString(s) {
			return true
		}
		// IDEA-style: "*.java" matches any depth (basename).
		if cg.basename && cg.re.MatchString(base) {
			return true
		}
	}
	return false
}

// compileGlob compiles a single glob. Patterns without a path separator
// match either the full relative path or the basename (so "*.java"
// matches "src/Foo.java", matching IntelliJ file-mask behavior).
func compileGlob(p string) *compiledGlob {
	basenameOnly := !strings.Contains(p, "/")
	re := globToRegexp(p)
	if re == nil {
		return nil
	}
	return &compiledGlob{re: re, basename: basenameOnly}
}

// globToRegexp compiles a glob pattern into a regular expression.
// Only `*`, `**`, `?` and `.` carry glob semantics; every other
// regex metacharacter is escaped via regexp.QuoteMeta.
func globToRegexp(p string) *regexp.Regexp {
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(p); i++ {
		switch p[i] {
		case '*':
			if i+1 < len(p) && p[i+1] == '*' {
				b.WriteString(".*")
				i++
			} else {
				b.WriteString("[^/]*")
			}
		case '?':
			b.WriteString("[^/]")
		default:
			b.WriteString(regexp.QuoteMeta(string(p[i])))
		}
	}
	b.WriteString("$")
	re, err := regexp.Compile(b.String())
	if err != nil {
		return nil
	}
	return re
}
