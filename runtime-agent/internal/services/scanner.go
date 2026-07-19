package services

import (
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// scanWorkspace inspects a project root and returns a list of
// detected project layouts. We support multiple projects per
// workspace in principle, but most legacy workspaces are
// single-project; the list usually has one entry.
func scanWorkspace(root string) ([]map[string]any, error) {
	if root == "" {
		return nil, errors.New("root is empty")
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", root)
	}
	detected := map[string]any{
		"rootPath":            root,
		"layout":              detectLayout(root),
		"encodingByExtension": defaultEncodingByExt(),
		"warnings":            []string{},
		"confidence":          0.7,
	}
	if webxml := readWebXML(root); webxml != nil {
		detected["webXml"] = webxml
		detected["confidence"] = 0.85
	}
	if buildSys := detectBuildSystem(root); buildSys != "" {
		detected["buildSystem"] = buildSys
	}
	if jdk := findJdkOnPath(); jdk != nil {
		detected["detectedJdk"] = jdk
	}
	return []map[string]any{detected}, nil
}

func detectLayout(root string) map[string]any {
	layout := map[string]any{
		"src":     []string{"src"},
		"webRoot": "WebRoot",
		"config":  []string{},
	}
	// Common alternates.
	alts := []string{"WebContent", "web", "src/main/webapp"}
	for _, a := range alts {
		if _, err := os.Stat(filepath.Join(root, a)); err == nil {
			layout["webRoot"] = a
			break
		}
	}
	srcAlts := []string{"src", "src/main/java", "java"}
	for _, a := range srcAlts {
		if _, err := os.Stat(filepath.Join(root, a)); err == nil {
			layout["src"] = []string{a}
			break
		}
	}
	// lib
	if _, err := os.Stat(filepath.Join(root, "lib")); err == nil {
		layout["lib"] = "lib"
	}
	// resources
	if _, err := os.Stat(filepath.Join(root, "src", "main", "resources")); err == nil {
		layout["resources"] = []string{"src/main/resources"}
	}
	// build.xml
	if _, err := os.Stat(filepath.Join(root, "build.xml")); err == nil {
		layout["buildXml"] = "build.xml"
	}
	return layout
}

func defaultEncodingByExt() map[string]string {
	return map[string]string{
		".java":       "utf-8",
		".jsp":        "gbk",
		".xml":        "utf-8",
		".properties": "iso-8859-1",
		".html":       "utf-8",
		".css":        "utf-8",
		".js":         "utf-8",
		".tag":        "utf-8",
		".tld":        "utf-8",
	}
}

type webXML struct {
	XMLName  xml.Name `xml:"web-app"`
	Servlets []struct {
		ServletName  string `xml:"servlet-name"`
		ServletClass string `xml:"servlet-class"`
	} `xml:"servlet"`
	ServletMappings []struct {
		ServletName string `xml:"servlet-name"`
		URLPattern  string `xml:"url-pattern"`
	} `xml:"servlet-mapping"`
	ContextParams []struct {
		ParamName  string `xml:"param-name"`
		ParamValue string `xml:"param-value"`
	} `xml:"context-param"`
}

func readWebXML(root string) map[string]any {
	candidates := []string{
		filepath.Join(root, "WEB-INF", "web.xml"),
		filepath.Join(root, "WebRoot", "WEB-INF", "web.xml"),
		filepath.Join(root, "WebContent", "WEB-INF", "web.xml"),
		filepath.Join(root, "src", "main", "webapp", "WEB-INF", "web.xml"),
	}
	for _, c := range candidates {
		data, err := os.ReadFile(c)
		if err != nil {
			continue
		}
		var w webXML
		if err := xml.Unmarshal(data, &w); err != nil {
			continue
		}
		urls := []string{}
		for _, m := range w.ServletMappings {
			if m.URLPattern != "" {
				urls = append(urls, m.URLPattern)
			}
		}
		params := map[string]string{}
		for _, p := range w.ContextParams {
			if p.ParamName != "" {
				params[p.ParamName] = p.ParamValue
			}
		}
		return map[string]any{
			"servletCount":  len(w.Servlets),
			"urlPatterns":   urls,
			"contextParams": params,
		}
	}
	return nil
}

func detectBuildSystem(root string) string {
	checks := []struct {
		system string
		file   string
	}{
		{"ant", "build.xml"},
		{"maven", "pom.xml"},
		{"gradle", "build.gradle"},
	}
	for _, c := range checks {
		if _, err := os.Stat(filepath.Join(root, c.file)); err == nil {
			return c.system
		}
	}
	return "none"
}

// findJdkOnPath does a best-effort search for a JDK on the host.
// It is intentionally not exhaustive; the user is expected to
// import a real toolchain via the wizard.
func findJdkOnPath() map[string]any {
	home := os.Getenv("JAVA_HOME")
	if home == "" {
		return nil
	}
	bin := filepath.Join(home, "bin", "java")
	if _, err := os.Stat(bin); err != nil {
		return nil
	}
	// We do not run `java -version` here; the caller (the import
	// wizard) does that for an authoritative version.
	return map[string]any{
		"home":    home,
		"version": "unknown",
	}
}

// keep import of strings.
var _ = strings.ToLower
var _ = sort.Strings
