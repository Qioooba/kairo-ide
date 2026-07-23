package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

const RunConfigurationVersion = 1

var (
	ErrRunConfigurationsMissing = errors.New("run configurations file not found")
	ErrRunConfigurationsCorrupt = errors.New("run configurations file is corrupt")
	ErrRunConfigurationNotFound = errors.New("run configuration not found")
	ErrRunConfigurationConflict = errors.New("run configuration conflict")
	ErrInvalidRunConfiguration  = errors.New("invalid run configuration")
	stableRunConfigurationID    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
	contextPathPattern          = regexp.MustCompile(`^/[A-Za-z0-9._-]*$`)
	environmentNamePattern      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	environmentReferencePattern = regexp.MustCompile(`^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$`)
	sensitiveEnvironmentName    = regexp.MustCompile(`(?i)(PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)`)
)

type RunConfigurationDocument struct {
	Version                 int                      `json:"version"`
	Configurations          []TomcatRunConfiguration `json:"configurations"`
	SelectedConfigurationID *string                  `json:"selectedConfigurationId"`
}

type TomcatRunConfiguration struct {
	ID                string                 `json:"id"`
	Name              string                 `json:"name"`
	Type              string                 `json:"type"`
	ProjectID         string                 `json:"projectId"`
	Mode              string                 `json:"mode"`
	Suspend           bool                   `json:"suspend"`
	JDKRef            string                 `json:"jdkRef"`
	Build             RunConfigurationBuild  `json:"build"`
	Server            RunConfigurationServer `json:"server"`
	Deploy            RunConfigurationDeploy `json:"deploy"`
	Env               map[string]string      `json:"env"`
	VMOptions         []string               `json:"vmOptions"`
	BeforeLaunchTasks []string               `json:"beforeLaunchTasks"`
}

type RunConfigurationBuild struct {
	Type    string `json:"type"`
	Target  string `json:"target,omitempty"`
	Command string `json:"command,omitempty"`
	Clean   bool   `json:"clean"`
}

type RunConfigurationServer struct {
	ID          string `json:"id"`
	HTTPPort    int    `json:"httpPort"`
	DebugPort   int    `json:"debugPort"`
	ContextPath string `json:"contextPath"`
}

type RunConfigurationDeploy struct {
	Mode     string `json:"mode"`
	Artifact string `json:"artifact"`
}

func invalidRunConfiguration(path, message string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalidRunConfiguration, path, message)
}

func validateStableID(path, value string) error {
	if !stableRunConfigurationID.MatchString(value) {
		return invalidRunConfiguration(path, "must be a stable id (1-128 ASCII letters, digits, _, . or -)")
	}
	return nil
}

func ValidateRunConfigurationID(value string) error {
	return validateStableID("id", value)
}

func validateNonBlank(path, value string, max int) error {
	if value == "" || strings.TrimSpace(value) != value || utf8.RuneCountInString(value) > max {
		return invalidRunConfiguration(path, fmt.Sprintf("must be non-blank without surrounding whitespace and at most %d characters", max))
	}
	return nil
}

func validateArtifact(value string) error {
	if err := validateNonBlank("deploy.artifact", value, 1024); err != nil {
		return err
	}
	if filepath.IsAbs(value) || strings.HasPrefix(value, "/") || strings.HasPrefix(value, `\`) || strings.Contains(value, `\`) {
		return invalidRunConfiguration("deploy.artifact", "must be a forward-slash project-root-relative path")
	}
	if strings.Contains(value, ":") {
		return invalidRunConfiguration("deploy.artifact", "must not contain a colon")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." {
			return invalidRunConfiguration("deploy.artifact", "must not contain .. traversal segments")
		}
	}
	return nil
}

func (configuration TomcatRunConfiguration) Validate() error {
	if err := validateStableID("id", configuration.ID); err != nil {
		return err
	}
	if err := validateNonBlank("name", configuration.Name, 200); err != nil {
		return err
	}
	if configuration.Type != "tomcat6" {
		return invalidRunConfiguration("type", "must equal tomcat6")
	}
	if err := validateStableID("projectId", configuration.ProjectID); err != nil {
		return err
	}
	if configuration.Mode != "run" && configuration.Mode != "debug" {
		return invalidRunConfiguration("mode", "must be run or debug")
	}
	if configuration.Mode == "run" && configuration.Suspend {
		return invalidRunConfiguration("suspend", "must be false in run mode")
	}
	if err := validateStableID("jdkRef", configuration.JDKRef); err != nil {
		return err
	}

	switch configuration.Build.Type {
	case "ant":
		if err := validateNonBlank("build.target", configuration.Build.Target, 200); err != nil {
			return err
		}
		if configuration.Build.Command != "" {
			return invalidRunConfiguration("build.command", "is not allowed for ant")
		}
	case "javac":
		if configuration.Build.Target != "" || configuration.Build.Command != "" {
			return invalidRunConfiguration("build", "javac must not define target or command")
		}
	case "custom":
		if err := validateNonBlank("build.command", configuration.Build.Command, 4096); err != nil {
			return err
		}
		if configuration.Build.Target != "" {
			return invalidRunConfiguration("build.target", "is not allowed for custom")
		}
	default:
		return invalidRunConfiguration("build.type", "must be ant, javac or custom")
	}

	if err := validateStableID("server.id", configuration.Server.ID); err != nil {
		return err
	}
	if configuration.Server.HTTPPort < 1024 || configuration.Server.HTTPPort > 65535 {
		return invalidRunConfiguration("server.httpPort", "must be between 1024 and 65535")
	}
	if configuration.Server.DebugPort < 1024 || configuration.Server.DebugPort > 65535 {
		return invalidRunConfiguration("server.debugPort", "must be between 1024 and 65535")
	}
	if configuration.Server.HTTPPort == configuration.Server.DebugPort {
		return invalidRunConfiguration("server.debugPort", "must differ from httpPort")
	}
	if !contextPathPattern.MatchString(configuration.Server.ContextPath) {
		return invalidRunConfiguration("server.contextPath", "has an invalid context path")
	}

	if configuration.Deploy.Mode != "exploded" && configuration.Deploy.Mode != "war" {
		return invalidRunConfiguration("deploy.mode", "must be exploded or war")
	}
	if err := validateArtifact(configuration.Deploy.Artifact); err != nil {
		return err
	}
	if configuration.Env == nil {
		return invalidRunConfiguration("env", "is required")
	}
	if len(configuration.Env) > 128 {
		return invalidRunConfiguration("env", "must contain at most 128 entries")
	}
	seenEnvironmentNames := make(map[string]struct{}, len(configuration.Env))
	for name, value := range configuration.Env {
		if !environmentNamePattern.MatchString(name) {
			return invalidRunConfiguration("env."+name, "has an invalid name")
		}
		if utf8.RuneCountInString(value) > 8192 {
			return invalidRunConfiguration("env."+name, "must be at most 8192 characters")
		}
		folded := strings.ToUpper(name)
		if _, exists := seenEnvironmentNames[folded]; exists {
			return invalidRunConfiguration("env", "contains names that conflict by case")
		}
		seenEnvironmentNames[folded] = struct{}{}
		if sensitiveEnvironmentName.MatchString(name) && !environmentReferencePattern.MatchString(value) {
			return invalidRunConfiguration("env."+name, "sensitive values must use a ${env:HOST_NAME} reference")
		}
	}
	if configuration.VMOptions == nil {
		return invalidRunConfiguration("vmOptions", "is required")
	}
	if len(configuration.VMOptions) > 128 {
		return invalidRunConfiguration("vmOptions", "must contain at most 128 values")
	}
	for index, option := range configuration.VMOptions {
		if err := validateNonBlank(fmt.Sprintf("vmOptions[%d]", index), option, 2048); err != nil {
			return err
		}
	}
	if configuration.BeforeLaunchTasks == nil {
		return invalidRunConfiguration("beforeLaunchTasks", "is required")
	}
	if len(configuration.BeforeLaunchTasks) > 2 {
		return invalidRunConfiguration("beforeLaunchTasks", "must contain at most two tasks")
	}
	taskIndex := map[string]int{}
	for index, task := range configuration.BeforeLaunchTasks {
		if task != "build" && task != "deploy" {
			return invalidRunConfiguration(fmt.Sprintf("beforeLaunchTasks[%d]", index), "must be build or deploy")
		}
		if _, exists := taskIndex[task]; exists {
			return invalidRunConfiguration("beforeLaunchTasks", "must contain unique tasks")
		}
		taskIndex[task] = index
	}
	if buildIndex, hasBuild := taskIndex["build"]; hasBuild {
		if deployIndex, hasDeploy := taskIndex["deploy"]; hasDeploy && deployIndex < buildIndex {
			return invalidRunConfiguration("beforeLaunchTasks", "deploy must not run before build")
		}
	}
	return nil
}

func (document RunConfigurationDocument) Validate() error {
	if document.Version != RunConfigurationVersion {
		return invalidRunConfiguration("version", "must equal 1")
	}
	if document.Configurations == nil {
		return invalidRunConfiguration("configurations", "is required")
	}
	if len(document.Configurations) > 100 {
		return invalidRunConfiguration("configurations", "must contain at most 100 entries")
	}
	ids := make(map[string]struct{}, len(document.Configurations))
	names := make(map[string]struct{}, len(document.Configurations))
	for index, configuration := range document.Configurations {
		if err := configuration.Validate(); err != nil {
			return fmt.Errorf("configurations[%d]: %w", index, err)
		}
		if _, exists := ids[configuration.ID]; exists {
			return invalidRunConfiguration(fmt.Sprintf("configurations[%d].id", index), "must be unique")
		}
		ids[configuration.ID] = struct{}{}
		foldedName := strings.ToLower(configuration.Name)
		if _, exists := names[foldedName]; exists {
			return invalidRunConfiguration(fmt.Sprintf("configurations[%d].name", index), "must be unique ignoring case")
		}
		names[foldedName] = struct{}{}
	}
	if len(document.Configurations) == 0 {
		if document.SelectedConfigurationID != nil {
			return invalidRunConfiguration("selectedConfigurationId", "must be null when configurations is empty")
		}
	} else {
		if document.SelectedConfigurationID == nil {
			return invalidRunConfiguration("selectedConfigurationId", "must reference an existing configuration")
		}
		if _, exists := ids[*document.SelectedConfigurationID]; !exists {
			return invalidRunConfiguration("selectedConfigurationId", "must reference an existing configuration")
		}
	}
	return nil
}

func requireFields(object map[string]json.RawMessage, path string, fields ...string) error {
	for _, field := range fields {
		if _, exists := object[field]; !exists {
			return invalidRunConfiguration(path+field, "is required")
		}
	}
	return nil
}

func validateRequiredJSONFields(data []byte) error {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(data, &top); err != nil {
		return err
	}
	if err := requireFields(top, "", "version", "configurations", "selectedConfigurationId"); err != nil {
		return err
	}
	var configurations []json.RawMessage
	if err := json.Unmarshal(top["configurations"], &configurations); err != nil {
		return err
	}
	for index, raw := range configurations {
		var configuration map[string]json.RawMessage
		if err := json.Unmarshal(raw, &configuration); err != nil {
			return err
		}
		prefix := fmt.Sprintf("configurations[%d].", index)
		if err := requireFields(configuration, prefix, "id", "name", "type", "projectId", "mode", "suspend", "jdkRef", "build", "server", "deploy", "env", "vmOptions", "beforeLaunchTasks"); err != nil {
			return err
		}
		for name, fields := range map[string][]string{
			"build": {"type", "clean"}, "server": {"id", "httpPort", "debugPort", "contextPath"}, "deploy": {"mode", "artifact"},
		} {
			var nested map[string]json.RawMessage
			if err := json.Unmarshal(configuration[name], &nested); err != nil {
				return err
			}
			if err := requireFields(nested, prefix+name+".", fields...); err != nil {
				return err
			}
		}
	}
	return nil
}

func decodeStrict(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("multiple JSON values are not allowed")
	}
	return nil
}

func DecodeRunConfigurationDocument(data []byte) (RunConfigurationDocument, error) {
	var document RunConfigurationDocument
	if err := validateRequiredJSONFields(data); err != nil {
		return document, fmt.Errorf("%w: %v", ErrInvalidRunConfiguration, err)
	}
	if err := decodeStrict(data, &document); err != nil {
		return document, fmt.Errorf("%w: %v", ErrInvalidRunConfiguration, err)
	}
	if err := document.Validate(); err != nil {
		return document, err
	}
	return document, nil
}

func DecodeTomcatRunConfiguration(data []byte) (TomcatRunConfiguration, error) {
	wrapped := []byte(fmt.Sprintf(`{"version":1,"configurations":[%s],"selectedConfigurationId":null}`, data))
	// Validate required nested fields using the document decoder, then repair the
	// selection solely for semantic validation of this one configuration.
	if err := validateRequiredJSONFields(wrapped); err != nil {
		return TomcatRunConfiguration{}, fmt.Errorf("%w: %v", ErrInvalidRunConfiguration, err)
	}
	var configuration TomcatRunConfiguration
	if err := decodeStrict(data, &configuration); err != nil {
		return configuration, fmt.Errorf("%w: %v", ErrInvalidRunConfiguration, err)
	}
	if err := configuration.Validate(); err != nil {
		return configuration, err
	}
	return configuration, nil
}
