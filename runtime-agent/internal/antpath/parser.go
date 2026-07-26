package antpath

import (
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ParseFile reads and parses a build.xml file.
func ParseFile(path string) (*BuildProject, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(data, filepath.Dir(path))
}

// Parse parses build.xml content with a given base directory.
func Parse(data []byte, baseDir string) (*BuildProject, error) {
	var raw buildXML
	if err := xml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse build.xml: %w", err)
	}

	project := &BuildProject{
		Name:       raw.Name,
		Default:    raw.Default,
		Basedir:    baseDir,
		Properties: make(map[string]string),
		Paths:      make(map[string]*AntPath),
		Targets:    make(map[string]*Target),
	}

	// Set built-in properties
	project.Properties["basedir"] = baseDir
	project.Properties["ant.file"] = filepath.Join(baseDir, "build.xml")

	// Collect properties
	for _, prop := range raw.Properties {
		if prop.Name != "" {
			project.Properties[prop.Name] = prop.Value
		}
		if prop.File != "" {
			// Load property file
			propPath := filepath.Join(baseDir, prop.File)
			if props, err := loadPropertyFile(propPath); err == nil {
				for k, v := range props {
					project.Properties[k] = v
				}
			}
		}
	}

	// Collect paths
	for _, p := range raw.Paths {
		ap := &AntPath{ID: p.ID}
		for _, loc := range p.PathElements {
			if loc.Location != "" {
				ap.Location = append(ap.Location, loc.Location)
			}
			if loc.Path != "" {
				// Split path by : or ;
				for _, part := range splitPath(loc.Path) {
					ap.Path = append(ap.Path, part)
				}
			}
			if loc.RefID != "" {
				ap.PathRefs = append(ap.PathRefs, loc.RefID)
			}
		}
		for _, fs := range p.FileSets {
			includes := mergeIncludesExcludes(fs.IncludesAttr, fs.Includes)
			excludes := mergeIncludesExcludes(fs.ExcludesAttr, fs.Excludes)
			ap.FileSets = append(ap.FileSets, FileSet{
				Dir:      fs.Dir,
				Includes: nonEmpty(includes),
				Excludes: nonEmpty(excludes),
			})
		}
		if p.ID != "" {
			project.Paths[p.ID] = ap
		}
	}

	// Collect imports
	for _, imp := range raw.Imports {
		project.Imports = append(project.Imports, Import{
			File:     imp.File,
			Optional: imp.Optional,
		})
	}

	// Collect targets and their javac tasks
	for _, t := range raw.Targets {
		target := &Target{Name: t.Name}
		for _, dep := range strings.Fields(t.Depends) {
			if dep != "" {
				target.Depends = append(target.Depends, dep)
			}
		}
		for _, jc := range t.JavacTasks {
			jt := JavacTask{
				SrcDir:       jc.SrcDir,
				DestDir:      jc.DestDir,
				ClasspathRef: jc.ClasspathRef,
				Source:       jc.Source,
				Target:       jc.Target,
			}
			// Check for inline classpath
			if jc.Classpath != nil {
				jt.InlineClasspath = &AntPath{}
				for _, loc := range jc.Classpath.PathElements {
					if loc.Location != "" {
						jt.InlineClasspath.Location = append(jt.InlineClasspath.Location, loc.Location)
					}
					if loc.Path != "" {
						for _, part := range splitPath(loc.Path) {
							jt.InlineClasspath.Path = append(jt.InlineClasspath.Path, part)
						}
					}
				}
			}
			target.JavacTasks = append(target.JavacTasks, jt)
		}
		project.Targets[t.Name] = target
	}

	return project, nil
}

// loadPropertyFile reads key=value pairs from a properties file.
func loadPropertyFile(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	props := make(map[string]string)
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		if idx := strings.IndexByte(line, '='); idx > 0 {
			key := strings.TrimSpace(line[:idx])
			val := strings.TrimSpace(line[idx+1:])
			props[key] = val
		}
	}
	return props, nil
}

func splitPath(p string) []string {
	var parts []string
	sep := ":"
	if strings.Contains(p, ";") {
		sep = ";"
	}
	for _, part := range strings.Split(p, sep) {
		part = strings.TrimSpace(part)
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

func nonEmpty(list []string) []string {
	var result []string
	for _, s := range list {
		if strings.TrimSpace(s) != "" {
			result = append(result, s)
		}
	}
	return result
}

// mergeIncludesExcludes combines an attribute value (e.g. includes="*.jar,*.zip")
// with child elements (e.g. <include name="*.xml"/>).
func mergeIncludesExcludes(attrValue string, childElements []string) []string {
	var result []string
	// Parse attribute value (comma or space separated)
	if attrValue != "" {
		for _, item := range strings.FieldsFunc(attrValue, func(r rune) bool {
			return r == ',' || r == ' '
		}) {
			item = strings.TrimSpace(item)
			if item != "" {
				result = append(result, item)
			}
		}
	}
	// Add child elements
	for _, item := range childElements {
		item = strings.TrimSpace(item)
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}

// XML structures for unmarshalling
type buildXML struct {
	XMLName    xml.Name        `xml:"project"`
	Name       string          `xml:"name,attr"`
	Default    string          `xml:"default,attr"`
	Properties []propElement   `xml:"property"`
	Paths      []pathElement   `xml:"path"`
	Imports    []importElement `xml:"import"`
	Targets    []targetElement `xml:"target"`
}

type propElement struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value,attr"`
	File  string `xml:"file,attr"`
}

type pathElement struct {
	ID           string          `xml:"id,attr"`
	RefID        string          `xml:"refid,attr"`
	PathElements []pathElemChild `xml:"pathelement"`
	FileSets     []fileSetChild  `xml:"fileset"`
}

type pathElemChild struct {
	Location string `xml:"location,attr"`
	Path     string `xml:"path,attr"`
	RefID    string `xml:"refid,attr"`
}

type fileSetChild struct {
	Dir          string   `xml:"dir,attr"`
	Includes     []string `xml:"include"`
	Excludes     []string `xml:"exclude"`
	IncludesAttr string   `xml:"includes,attr"`
	ExcludesAttr string   `xml:"excludes,attr"`
}

type importElement struct {
	File     string `xml:"file,attr"`
	Optional bool   `xml:"optional,attr"`
}

type targetElement struct {
	Name       string         `xml:"name,attr"`
	Depends    string         `xml:"depends,attr"`
	JavacTasks []javacElement `xml:"javac"`
}

type javacElement struct {
	SrcDir       string       `xml:"srcdir,attr"`
	DestDir      string       `xml:"destdir,attr"`
	ClasspathRef string       `xml:"classpathref,attr"`
	Source       string       `xml:"source,attr"`
	Target       string       `xml:"target,attr"`
	Classpath    *pathElement `xml:"classpath"`
}