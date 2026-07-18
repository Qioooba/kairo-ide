// Package jdtproject — XML/INI renderers for the JDT project model.
package jdtproject

import (
	"encoding/xml"
	"fmt"
	"path/filepath"
	"strings"
)

// Classpath is the .classpath XML root.
type Classpath struct {
	XMLName          xml.Name         `xml:"classpath"`
	ProjectID        string           `xml:"-" json:"projectId,omitempty"`
	ClasspathEntries []ClasspathEntry `xml:"classpathentry"`
}

// ClasspathEntry is one row of the .classpath file. The Kind
// is the "kind" attribute: "src", "output", "lib", "con".
type ClasspathEntry struct {
	Kind         string `xml:"kind,attr"`
	Path         string `xml:"path,attr,omitempty"`
	SourcePath   string `xml:"sourcepath,attr,omitempty"`
	Output       string `xml:"output,attr,omitempty"`
	Including    string `xml:"including,attr,omitempty"`
	Excluding    string `xml:"excluding,attr,omitempty"`
}

// ProjectModel is the .project XML root. (We name it
// ProjectModel rather than Project to avoid collision with
// the .legacyflow/project.yaml schema struct in the
// generator's package.)
type ProjectModel struct {
	XMLName         xml.Name         `xml:"project"`
	ProjectID       string           `xml:"-" json:"projectId"`
	Name            string           `xml:"name"`
	Description     string           `xml:"comment"`
	LinkedResources []LinkedResource `xml:"linkedResources,omitempty"`
	BuildSpec       []BuildSpec      `xml:"buildSpec>buildCommand"`
	Natures         []Nature         `xml:"natures>nature"`
}

// BuildSpec is one Eclipse build command. We only enable
// the JDT builder; the Kairo runtime agent compiles with
// javac directly and writes the .class files into the
// output dir.
type BuildSpec struct {
	Name     string `xml:"name"`
	Arguments string `xml:"arguments"`
	Triggers  string `xml:"triggers,omitempty"`
}

// Nature is the Eclipse nature a project has. The JDT nature
// is the one that triggers the Java tooling.
type Nature struct {
	Name string `xml:"name"`
}

// LinkedResource maps a classpath entry that lives outside
// the project to an Eclipse linked resource. We use this for
// jars that are pulled from the runtime data dir (e.g.
// Servlet API + JSTL when the project has no copy of its own).
type LinkedResource struct {
	Name       string `xml:"name"`
	Type       string `xml:"type"`
	Location   string `xml:"location"`
	LocationURI string `xml:"locationURI,omitempty"`
}

func renderClasspath(proj Project, srcRoots, testSrcRoots []string, output string, libs, refLibs []string) Classpath {
	cp := Classpath{ProjectID: proj.ProjectID}
	for _, s := range srcRoots {
		cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
			Kind: "src",
			Path: relPathOrAbs(s, proj.RootPath),
		})
	}
	for _, s := range testSrcRoots {
		cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
			Kind:   "src",
			Path:   relPathOrAbs(s, proj.RootPath),
			Output: relPathOrAbs(output, proj.RootPath),
		})
	}
	cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
		Kind: "output",
		Path: relPathOrAbs(output, proj.RootPath),
	})
	jreName := "org.eclipse.jdt.launching.JRE_CONTAINER"
	if proj.SourceLevel != "" {
		jreName += "/" + proj.SourceLevel
	}
	cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
		Kind: "con",
		Path: jreName,
	})
	for _, l := range libs {
		cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
			Kind:       "lib",
			Path:       l, // absolute path is allowed by the JDT LS
			SourcePath: relPathOrAbs(l, proj.RootPath),
		})
	}
	for _, l := range refLibs {
		cp.ClasspathEntries = append(cp.ClasspathEntries, ClasspathEntry{
			Kind: "lib",
			Path: relPathOrAbs(l, proj.RootPath),
		})
	}
	return cp
}

func renderProject(proj Project) ProjectModel {
	p := ProjectModel{
		ProjectID:   proj.ProjectID,
		Name:        proj.Name,
		Description: "Kairo IDE managed project for " + proj.ProjectID,
	}
	p.Natures = append(p.Natures, Nature{Name: "org.eclipse.jdt.core.javanature"})
	p.BuildSpec = append(p.BuildSpec, BuildSpec{
		Name:      "org.eclipse.jdt.core.javabuilder",
		Arguments: "",
		Triggers:  "clean,full,incremental,",
	})
	return p
}

func renderKairoConfig(proj Project) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Kairo IDE generated JDT config for %s\n", proj.ProjectID)
	fmt.Fprintf(&b, "kairo.project.id = %s\n", proj.ProjectID)
	fmt.Fprintf(&b, "kairo.source.level = %s\n", proj.SourceLevel)
	fmt.Fprintf(&b, "kairo.target.level = %s\n", proj.TargetLevel)
	fmt.Fprintf(&b, "kairo.encoding = %s\n", proj.Encoding)
	fmt.Fprintf(&b, "kairo.output.dir = %s\n", proj.OutputDir)
	for i, s := range proj.SourceRoots {
		fmt.Fprintf(&b, "kairo.source.root.%d = %s\n", i, s)
	}
	for i, t := range proj.TestSourceRoots {
		fmt.Fprintf(&b, "kairo.test.source.root.%d = %s\n", i, t)
	}
	return b.String()
}

func renderJDTCorePrefs(proj Project) string {
	var b strings.Builder
	b.WriteString("eclipse.preferences.version=1\n")
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.compliance=%s\n", proj.SourceLevel)
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.source=%s\n", proj.SourceLevel)
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.target=%s\n", proj.TargetLevel)
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.encoding=%s\n", encodingIDForJDT(proj.Encoding))
	fmt.Fprintf(&b, "org.eclipse.jdt.core.compiler.codegen.targetPlatform=%s\n", proj.TargetLevel)
	b.WriteString("org.eclipse.jdt.core.compiler.problem.assertIdentifier=error\n")
	return b.String()
}

func encodingIDForJDT(enc string) string {
	upper := strings.ToUpper(strings.TrimSpace(enc))
	switch upper {
	case "UTF-8", "UTF8":
		return "UTF-8"
	case "GBK", "GB18030":
		return "GBK"
	case "ISO-8859-1":
		return "ISO-8859-1"
	case "US-ASCII":
		return "US-ASCII"
	default:
		if upper == "" {
			return "UTF-8"
		}
		return upper
	}
}

func relPathOrAbs(abs, root string) string {
	if abs == "" {
		return ""
	}
	if root == "" {
		return abs
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return abs
	}
	return rel
}

// readClasspath reads a sibling project's .classpath file.
// Used to resolve dependentProjects entries without having
// to re-parse the YAML.
type parsedClasspath struct {
	ProjectID        string
	ClasspathEntries []ClasspathEntry
}

func readClasspath(root string) (*parsedClasspath, error) {
	p := filepath.Join(root, ".classpath")
	data, err := osReadFile(p)
	if err != nil {
		return nil, err
	}
	return parseClasspathBytes(data)
}

func parseClasspathBytes(data []byte) (*parsedClasspath, error) {
	var cp Classpath
	if err := xml.Unmarshal(data, &cp); err != nil {
		return nil, err
	}
	return &parsedClasspath{ProjectID: cp.ProjectID, ClasspathEntries: cp.ClasspathEntries}, nil
}
