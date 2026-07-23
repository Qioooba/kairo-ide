package domain

import (
	"encoding/json"
	"errors"
	"testing"
)

func validRunConfiguration(id string) TomcatRunConfiguration {
	return TomcatRunConfiguration{
		ID: id, Name: "Tomcat 6 " + id, Type: "tomcat6", ProjectID: "legacy-sample",
		Mode: "run", Suspend: false, JDKRef: "jdk6-local",
		Build:     RunConfigurationBuild{Type: "ant", Target: "war", Clean: false},
		Server:    RunConfigurationServer{ID: "tomcat6-local", HTTPPort: 18080, DebugPort: 8000, ContextPath: "/legacy"},
		Deploy:    RunConfigurationDeploy{Mode: "exploded", Artifact: "dist/legacy"},
		Env:       map[string]string{"DB_PASSWORD": "${env:LEGACY_DB_PASSWORD}"},
		VMOptions: []string{"-Dfile.encoding=GBK"}, BeforeLaunchTasks: []string{"build", "deploy"},
	}
}

func validRunConfigurationDocument() RunConfigurationDocument {
	configuration := validRunConfiguration("tomcat6-run")
	selected := configuration.ID
	return RunConfigurationDocument{Version: 1, Configurations: []TomcatRunConfiguration{configuration}, SelectedConfigurationID: &selected}
}

func TestRunConfigurationValidationMirrorsTypeScriptSecurityFixtures(t *testing.T) {
	for _, artifact := range []string{"../outside", "dist/../../outside", `dist\legacy`, `dist\..\outside`, `C:\release\legacy`, "dist/legacy:copy"} {
		configuration := validRunConfiguration("tomcat6-run")
		configuration.Deploy.Artifact = artifact
		if err := configuration.Validate(); !errors.Is(err, ErrInvalidRunConfiguration) {
			t.Fatalf("artifact %q: expected invalid run configuration, got %v", artifact, err)
		}
	}
	for _, name := range []string{"DB_PASSWORD", "DBPASSWORD", "AUTH_TOKEN", "PRIVATE_KEY_PATH"} {
		configuration := validRunConfiguration("tomcat6-run")
		configuration.Env = map[string]string{name: "plain-text-secret"}
		if err := configuration.Validate(); !errors.Is(err, ErrInvalidRunConfiguration) {
			t.Fatalf("env %q: expected invalid run configuration, got %v", name, err)
		}
		configuration.Env[name] = "${env:HOST_SECRET}"
		if err := configuration.Validate(); err != nil {
			t.Fatalf("env reference %q should be valid: %v", name, err)
		}
	}
}

func TestDecodeRunConfigurationDocumentIsStrict(t *testing.T) {
	document := validRunConfigurationDocument()
	data, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeRunConfigurationDocument(data); err != nil {
		t.Fatalf("valid document: %v", err)
	}

	var object map[string]any
	if err := json.Unmarshal(data, &object); err != nil {
		t.Fatal(err)
	}
	object["unknown"] = true
	unknown, _ := json.Marshal(object)
	if _, err := DecodeRunConfigurationDocument(unknown); !errors.Is(err, ErrInvalidRunConfiguration) {
		t.Fatalf("unknown field: expected invalid, got %v", err)
	}
	delete(object, "unknown")
	delete(object, "selectedConfigurationId")
	missing, _ := json.Marshal(object)
	if _, err := DecodeRunConfigurationDocument(missing); !errors.Is(err, ErrInvalidRunConfiguration) {
		t.Fatalf("missing required field: expected invalid, got %v", err)
	}
	if _, err := DecodeRunConfigurationDocument(append(data, []byte(` {}`)...)); !errors.Is(err, ErrInvalidRunConfiguration) {
		t.Fatalf("multiple JSON values: expected invalid, got %v", err)
	}
}

func TestRunConfigurationDocumentSelectionSemantics(t *testing.T) {
	empty := RunConfigurationDocument{Version: 1, Configurations: []TomcatRunConfiguration{}, SelectedConfigurationID: nil}
	if err := empty.Validate(); err != nil {
		t.Fatalf("empty document: %v", err)
	}
	missing := "missing"
	document := validRunConfigurationDocument()
	document.SelectedConfigurationID = &missing
	if err := document.Validate(); !errors.Is(err, ErrInvalidRunConfiguration) {
		t.Fatalf("missing selection: expected invalid, got %v", err)
	}
}
