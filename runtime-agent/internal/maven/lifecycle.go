// Package maven provides pom.xml parsing and Maven lifecycle task execution.
package maven

import (
	"encoding/xml"
	"os"
	"strings"
)

// Lifecycle represents a Maven lifecycle (clean, default, site).
type Lifecycle struct {
	ID     string                `json:"id"`
	Name   string                `json:"name"`
	Phases []LifecyclePhase      `json:"phases"`
}

// LifecyclePhase represents a single phase within a lifecycle.
type LifecyclePhase struct {
	ID          string             `json:"id"`
	Label       string             `json:"label"`
	Description string             `json:"description"`
	Order       int                `json:"order"`
	Bindings    []PluginBinding    `json:"bindings,omitempty"`
}

// PluginBinding binds a plugin goal to a lifecycle phase.
type PluginBinding struct {
	GroupID    string `json:"groupId"`
	ArtifactID string `json:"artifactId"`
	Goal       string `json:"goal"`
	Phase      string `json:"phase"`
}

// BuildProfile represents a Maven build profile with activation
// conditions and overrides.
type BuildProfile struct {
	ID           string              `json:"id"`
	Default      bool                `json:"default"`
	Activation   ProfileActivation   `json:"activation,omitempty"`
	Properties   map[string]string   `json:"properties,omitempty"`
	Dependencies []Dependency        `json:"dependencies,omitempty"`
	Plugins      []Plugin            `json:"plugins,omitempty"`
	Modules      []string            `json:"modules,omitempty"`
}

// ProfileActivation defines when a profile becomes active.
type ProfileActivation struct {
	ActiveByDefault bool              `json:"activeByDefault"`
	JDK             string            `json:"jdk,omitempty"`
	OS              *ProfileOSActivation `json:"os,omitempty"`
	Property        *ProfilePropertyActivation `json:"property,omitempty"`
	File            *ProfileFileActivation `json:"file,omitempty"`
}

// ProfileOSActivation activates a profile based on OS properties.
type ProfileOSActivation struct {
	Name    string `json:"name,omitempty"`
	Family  string `json:"family,omitempty"`
	Arch    string `json:"arch,omitempty"`
	Version string `json:"version,omitempty"`
}

// ProfilePropertyActivation activates a profile based on a system property.
type ProfilePropertyActivation struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
}

// ProfileFileActivation activates a profile based on file existence/missing.
type ProfileFileActivation struct {
	Exists    string `json:"exists,omitempty"`
	Missing   string `json:"missing,omitempty"`
}

// LifecycleRegistry holds all known lifecycles and their phase bindings.
type LifecycleRegistry struct {
	Lifecycles map[string]Lifecycle `json:"lifecycles"`
	Profiles   []BuildProfile       `json:"profiles,omitempty"`
}

// DefaultPluginBindings returns the standard Maven plugin-to-phase
// bindings for the default packaging type.
func DefaultPluginBindings() map[string][]PluginBinding {
	return map[string][]PluginBinding{
		"jar": {
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-resources-plugin", Goal: "resources", Phase: "process-resources"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-compiler-plugin", Goal: "compile", Phase: "compile"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-resources-plugin", Goal: "testResources", Phase: "process-test-resources"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-compiler-plugin", Goal: "testCompile", Phase: "test-compile"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-surefire-plugin", Goal: "test", Phase: "test"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-jar-plugin", Goal: "jar", Phase: "package"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-install-plugin", Goal: "install", Phase: "install"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-deploy-plugin", Goal: "deploy", Phase: "deploy"},
		},
		"war": {
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-resources-plugin", Goal: "resources", Phase: "process-resources"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-compiler-plugin", Goal: "compile", Phase: "compile"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-resources-plugin", Goal: "testResources", Phase: "process-test-resources"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-compiler-plugin", Goal: "testCompile", Phase: "test-compile"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-surefire-plugin", Goal: "test", Phase: "test"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-war-plugin", Goal: "war", Phase: "package"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-install-plugin", Goal: "install", Phase: "install"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-deploy-plugin", Goal: "deploy", Phase: "deploy"},
		},
		"pom": {
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-install-plugin", Goal: "install", Phase: "install"},
			{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-deploy-plugin", Goal: "deploy", Phase: "deploy"},
		},
	}
}

// NewLifecycleRegistry creates a LifecycleRegistry with all standard
// Maven lifecycles (clean, default, site) and default plugin bindings.
func NewLifecycleRegistry() *LifecycleRegistry {
	registry := &LifecycleRegistry{
		Lifecycles: make(map[string]Lifecycle),
	}

	registry.Lifecycles["clean"] = Lifecycle{
		ID:   "clean",
		Name: "Clean Lifecycle",
		Phases: []LifecyclePhase{
			{ID: "pre-clean", Label: "Pre-clean", Description: "Execute processes needed prior to the actual project cleaning", Order: 0},
			{ID: "clean", Label: "Clean", Description: "Remove all files generated by the previous build", Order: 1, Bindings: []PluginBinding{
				{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-clean-plugin", Goal: "clean", Phase: "clean"},
			}},
			{ID: "post-clean", Label: "Post-clean", Description: "Execute processes needed to finalize the project cleaning", Order: 2},
		},
	}

	registry.Lifecycles["default"] = Lifecycle{
		ID:   "default",
		Name: "Default Lifecycle",
		Phases: []LifecyclePhase{
			{ID: "validate", Label: "Validate", Description: "Validate the project is correct and all necessary information is available", Order: 0},
			{ID: "initialize", Label: "Initialize", Description: "Initialize build state, e.g. set properties or create directories", Order: 1},
			{ID: "generate-sources", Label: "Generate Sources", Description: "Generate any source code for inclusion in compilation", Order: 2},
			{ID: "process-sources", Label: "Process Sources", Description: "Process the source code, for example to filter any values", Order: 3},
			{ID: "generate-resources", Label: "Generate Resources", Description: "Generate resources for inclusion in the package", Order: 4},
			{ID: "process-resources", Label: "Process Resources", Description: "Copy and process the resources into the destination directory", Order: 5},
			{ID: "compile", Label: "Compile", Description: "Compile the source code of the project", Order: 6},
			{ID: "process-classes", Label: "Process Classes", Description: "Post-process the generated files from compilation", Order: 7},
			{ID: "generate-test-sources", Label: "Generate Test Sources", Description: "Generate any test source code for inclusion in compilation", Order: 8},
			{ID: "process-test-sources", Label: "Process Test Sources", Description: "Process the test source code, for example to filter any values", Order: 9},
			{ID: "generate-test-resources", Label: "Generate Test Resources", Description: "Create resources for testing", Order: 10},
			{ID: "process-test-resources", Label: "Process Test Resources", Description: "Copy and process the test resources into the test destination directory", Order: 11},
			{ID: "test-compile", Label: "Test Compile", Description: "Compile the test source code into the test destination directory", Order: 12},
			{ID: "process-test-classes", Label: "Process Test Classes", Description: "Post-process the generated files from test compilation", Order: 13},
			{ID: "test", Label: "Test", Description: "Run tests using a suitable unit testing framework", Order: 14},
			{ID: "prepare-package", Label: "Prepare Package", Description: "Perform any operations necessary to prepare a package", Order: 15},
			{ID: "package", Label: "Package", Description: "Take the compiled code and package it in its distributable format", Order: 16},
			{ID: "pre-integration-test", Label: "Pre-integration Test", Description: "Perform actions required before integration tests are executed", Order: 17},
			{ID: "integration-test", Label: "Integration Test", Description: "Process and deploy the package into an environment where integration tests can be run", Order: 18},
			{ID: "post-integration-test", Label: "Post-integration Test", Description: "Perform actions required after integration tests have been executed", Order: 19},
			{ID: "verify", Label: "Verify", Description: "Run any checks to verify the package is valid and meets quality criteria", Order: 20},
			{ID: "install", Label: "Install", Description: "Install the package into the local repository", Order: 21},
			{ID: "deploy", Label: "Deploy", Description: "Copy the final package to the remote repository", Order: 22},
		},
	}

	registry.Lifecycles["site"] = Lifecycle{
		ID:   "site",
		Name: "Site Lifecycle",
		Phases: []LifecyclePhase{
			{ID: "pre-site", Label: "Pre-site", Description: "Execute processes needed prior to the actual project site generation", Order: 0},
			{ID: "site", Label: "Site", Description: "Generate the project's site documentation", Order: 1, Bindings: []PluginBinding{
				{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-site-plugin", Goal: "site", Phase: "site"},
			}},
			{ID: "post-site", Label: "Post-site", Description: "Execute processes needed to finalize the site generation", Order: 2},
			{ID: "site-deploy", Label: "Site Deploy", Description: "Deploy the generated site documentation to the specified web server", Order: 3, Bindings: []PluginBinding{
				{GroupID: "org.apache.maven.plugins", ArtifactID: "maven-site-plugin", Goal: "deploy", Phase: "site-deploy"},
			}},
		},
	}

	return registry
}

// GetLifecycle returns a lifecycle by ID.
func (r *LifecycleRegistry) GetLifecycle(id string) (Lifecycle, bool) {
	lc, ok := r.Lifecycles[id]
	return lc, ok
}

// GetPhase returns a specific phase within a lifecycle.
func (r *LifecycleRegistry) GetPhase(lifecycleID, phaseID string) (LifecyclePhase, bool) {
	lc, ok := r.Lifecycles[lifecycleID]
	if !ok {
		return LifecyclePhase{}, false
	}
	for _, p := range lc.Phases {
		if p.ID == phaseID {
			return p, true
		}
	}
	return LifecyclePhase{}, false
}

// GetPhasesUpTo returns all phases in a lifecycle up to (and including)
// the specified phase.
func (r *LifecycleRegistry) GetPhasesUpTo(lifecycleID, phaseID string) []LifecyclePhase {
	lc, ok := r.Lifecycles[lifecycleID]
	if !ok {
		return nil
	}
	var result []LifecyclePhase
	for _, p := range lc.Phases {
		result = append(result, p)
		if p.ID == phaseID {
			break
		}
	}
	return result
}

// GetBindingsForPackaging returns the plugin bindings for a given
// packaging type. Falls back to "jar" bindings if the packaging
// type is not found.
func GetBindingsForPackaging(packaging string) []PluginBinding {
	bindings := DefaultPluginBindings()
	if b, ok := bindings[packaging]; ok {
		return b
	}
	return bindings["jar"]
}

// GetPhaseOrder returns the index of a phase in the default lifecycle.
// Returns -1 if the phase is not found.
func GetPhaseOrder(phaseID string) int {
	registry := NewLifecycleRegistry()
	lc, ok := registry.Lifecycles["default"]
	if !ok {
		return -1
	}
	for _, p := range lc.Phases {
		if p.ID == phaseID {
			return p.Order
		}
	}
	return -1
}

// GetActiveProfiles filters a list of profiles and returns
// only those that should be active based on activation conditions.
func GetActiveProfiles(profiles []BuildProfile, osName string, osArch string, jdkVersion string, systemProperties map[string]string) []BuildProfile {
	var active []BuildProfile
	for _, p := range profiles {
		if isProfileActive(p, osName, osArch, jdkVersion, systemProperties) {
			active = append(active, p)
		}
	}
	return active
}

// isProfileActive checks whether a single profile should be activated.
func isProfileActive(p BuildProfile, osName string, osArch string, jdkVersion string, systemProperties map[string]string) bool {
	act := p.Activation

	// Active by default
	if act.ActiveByDefault {
		return true
	}

	// JDK activation
	if act.JDK != "" {
		if !strings.HasPrefix(jdkVersion, act.JDK) {
			return false
		}
	}

	// OS activation
	if act.OS != nil {
		if act.OS.Name != "" && act.OS.Name != osName {
			return false
		}
		if act.OS.Family != "" && !strings.EqualFold(act.OS.Family, osName) {
			return false
		}
		if act.OS.Arch != "" && act.OS.Arch != osArch {
			return false
		}
	}

	// Property activation
	if act.Property != nil {
		val, ok := systemProperties[act.Property.Name]
		if !ok {
			return false
		}
		if act.Property.Value != "" && val != act.Property.Value {
			return false
		}
	}

	// File activation (requires FS access, simplified here)
	if act.File != nil {
		if act.File.Exists != "" {
			if _, err := os.Stat(act.File.Exists); os.IsNotExist(err) {
				return false
			}
		}
		if act.File.Missing != "" {
			if _, err := os.Stat(act.File.Missing); err == nil {
				return false
			}
		}
	}

	return true
}

// MergeProfiles merges active profiles into a base set of dependencies
// and plugins. Profile dependencies override base ones with the same
// (groupId, artifactId) key.
func MergeProfiles(baseDeps []Dependency, basePlugins []Plugin, profiles []BuildProfile) ([]Dependency, []Plugin) {
	depMap := make(map[string]Dependency)
	for _, d := range baseDeps {
		key := d.GroupID + ":" + d.ArtifactID
		depMap[key] = d
	}
	pluginMap := make(map[string]Plugin)
	for _, p := range basePlugins {
		key := p.GroupID + ":" + p.ArtifactID
		pluginMap[key] = p
	}

	for _, profile := range profiles {
		for _, d := range profile.Dependencies {
			key := d.GroupID + ":" + d.ArtifactID
			depMap[key] = d
		}
		for _, p := range profile.Plugins {
			key := p.GroupID + ":" + p.ArtifactID
			pluginMap[key] = p
		}
	}

	deps := make([]Dependency, 0, len(depMap))
	for _, d := range depMap {
		deps = append(deps, d)
	}
	plugins := make([]Plugin, 0, len(pluginMap))
	for _, p := range pluginMap {
		plugins = append(plugins, p)
	}

	return deps, plugins
}

// ParseProfilesFromPOM extracts <profile> elements from a raw POM.
func ParseProfilesFromPOM(pomData []byte) ([]BuildProfile, error) {
	var pom struct {
		Profiles []struct {
			ID         string `xml:"id"`
			Activation struct {
				ActiveByDefault string `xml:"activeByDefault"`
				JDK             string `xml:"jdk"`
				OS              struct {
					Name    string `xml:"name"`
					Family  string `xml:"family"`
					Arch    string `xml:"arch"`
					Version string `xml:"version"`
				} `xml:"os"`
				Property struct {
					Name  string `xml:"name"`
					Value string `xml:"value"`
				} `xml:"property"`
				File struct {
					Exists  string `xml:"exists"`
					Missing string `xml:"missing"`
				} `xml:"file"`
			} `xml:"activation"`
			Properties struct {
				Entries []rawProperty `xml:",any"`
			} `xml:"properties"`
			Dependencies struct {
				Deps []rawDependency `xml:"dependency"`
			} `xml:"dependencies"`
			Plugins struct {
				Plugin []rawPlugin `xml:"plugin"`
			} `xml:"plugins"`
			Modules struct {
				Module []string `xml:"module"`
			} `xml:"modules"`
		} `xml:"profiles>profile"`
	}

	if err := xml.Unmarshal(pomData, &pom); err != nil {
		return nil, err
	}

	var profiles []BuildProfile
	for _, rp := range pom.Profiles {
		p := BuildProfile{
			ID:      rp.ID,
			Default: rp.Activation.ActiveByDefault == "true",
		}

		p.Activation.ActiveByDefault = rp.Activation.ActiveByDefault == "true"
		p.Activation.JDK = rp.Activation.JDK
		if rp.Activation.OS.Name != "" || rp.Activation.OS.Family != "" {
			p.Activation.OS = &ProfileOSActivation{
				Name:    rp.Activation.OS.Name,
				Family:  rp.Activation.OS.Family,
				Arch:    rp.Activation.OS.Arch,
				Version: rp.Activation.OS.Version,
			}
		}
		if rp.Activation.Property.Name != "" {
			p.Activation.Property = &ProfilePropertyActivation{
				Name:  rp.Activation.Property.Name,
				Value: rp.Activation.Property.Value,
			}
		}
		if rp.Activation.File.Exists != "" || rp.Activation.File.Missing != "" {
			p.Activation.File = &ProfileFileActivation{
				Exists:  rp.Activation.File.Exists,
				Missing: rp.Activation.File.Missing,
			}
		}

		p.Properties = make(map[string]string)
		for _, entry := range rp.Properties.Entries {
			p.Properties[entry.XMLName.Local] = entry.Value
		}

		for _, d := range rp.Dependencies.Deps {
			dep := Dependency{
				GroupID:    d.GroupID,
				ArtifactID: d.ArtifactID,
				Version:    d.Version,
				Scope:      d.Scope,
				Type:       d.Type,
			}
			if d.Optional == "true" {
				dep.Optional = true
			}
			if dep.Scope == "" {
				dep.Scope = "compile"
			}
			if dep.Type == "" {
				dep.Type = "jar"
			}
			p.Dependencies = append(p.Dependencies, dep)
		}

		for _, pl := range rp.Plugins.Plugin {
			p.Plugins = append(p.Plugins, Plugin{
				GroupID:    pl.GroupID,
				ArtifactID: pl.ArtifactID,
				Version:    pl.Version,
			})
		}

		p.Modules = rp.Modules.Module

		profiles = append(profiles, p)
	}

	return profiles, nil
}

// LifecycleTreeItem is a serializable tree node for the lifecycle
// visualization in the frontend.
type LifecycleTreeItem struct {
	ID          string              `json:"id"`
	Label       string              `json:"label"`
	Description string              `json:"description"`
	Order       int                 `json:"order"`
	Bindings    []PluginBinding     `json:"bindings,omitempty"`
	Children    []LifecycleTreeItem `json:"children,omitempty"`
}

// BuildLifecycleTree builds a tree representation of all lifecycles
// with their phases and plugin bindings.
func BuildLifecycleTree(packaging string) []LifecycleTreeItem {
	registry := NewLifecycleRegistry()
	bindings := GetBindingsForPackaging(packaging)

	var trees []LifecycleTreeItem
	lifecycleOrder := []string{"clean", "default", "site"}

	for _, lcID := range lifecycleOrder {
		lc, ok := registry.Lifecycles[lcID]
		if !ok {
			continue
		}
		lcNode := LifecycleTreeItem{
			ID:    lc.ID,
			Label: lc.Name,
		}
		for _, phase := range lc.Phases {
			phaseNode := LifecycleTreeItem{
				ID:          phase.ID,
				Label:       phase.Label,
				Description: phase.Description,
				Order:       phase.Order,
			}
			// Add standard bindings
			for _, b := range bindings {
				if b.Phase == phase.ID {
					phaseNode.Bindings = append(phaseNode.Bindings, b)
				}
			}
			// Add phase-specific bindings
			for _, b := range phase.Bindings {
				phaseNode.Bindings = append(phaseNode.Bindings, b)
			}
			lcNode.Children = append(lcNode.Children, phaseNode)
		}
		trees = append(trees, lcNode)
	}

	return trees
}