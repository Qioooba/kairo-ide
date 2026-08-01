package domain

import (
	"strings"
	"testing"
)

func validTomcatRunConfiguration() TomcatRunConfiguration {
	return TomcatRunConfiguration{
		ID:        "cfg-1",
		Name:      "Run Server",
		Type:      "tomcat6",
		ProjectID: "legacy-sample",
		Mode:      "run",
		JDKRef:    "jdk6-local",
		Build:     RunConfigurationBuild{Type: "ant", Target: "war"},
		Server:    RunConfigurationServer{ID: "tomcat6-local", HTTPPort: 18080, DebugPort: 8000, ContextPath: "/legacy"},
		Deploy:    RunConfigurationDeploy{Mode: "exploded", Artifact: "dist/legacy"},
		Env:       map[string]string{},
		VMOptions: []string{},
		BeforeLaunchTasks: []string{"build", "deploy"},
	}
}

func TestValidateRunConfigurationID(t *testing.T) {
	valid := []string{"a", "cfg-1", "cfg_1", "A.B-c", "x"}
	for _, id := range valid {
		if err := ValidateRunConfigurationID(id); err != nil {
			t.Errorf("ValidateRunConfigurationID(%q) unexpected error: %v", id, err)
		}
	}
	invalid := []string{"", "has space", "中文", "-leading", "x!", "a/b", strings.Repeat("a", 129)}
	for _, id := range invalid {
		if err := ValidateRunConfigurationID(id); err == nil {
			t.Errorf("ValidateRunConfigurationID(%q) expected error", id)
		}
	}
}

func TestDecodeTomcatRunConfiguration_Valid(t *testing.T) {
	data := []byte(`{"id":"cfg-1","name":"Run","type":"tomcat6","projectId":"p1","mode":"run","suspend":false,"jdkRef":"jdk6","build":{"type":"ant","target":"war","clean":false},"server":{"id":"tomcat6-local","httpPort":18080,"debugPort":8000,"contextPath":"/app"},"deploy":{"mode":"exploded","artifact":"dist/app"},"env":{},"vmOptions":[],"beforeLaunchTasks":["build"]}`)
	cfg, err := DecodeTomcatRunConfiguration(data)
	if err != nil {
		t.Fatalf("DecodeTomcatRunConfiguration failed: %v", err)
	}
	if cfg.ID != "cfg-1" || cfg.Mode != "run" {
		t.Errorf("decoded = %+v", cfg)
	}
}

func TestDecodeTomcatRunConfiguration_Invalid(t *testing.T) {
	cases := []string{
		`{}`,
		`{"id":"cfg-1","name":"Run","type":"tomcat6"}`,
		`{"id":"cfg-1","name":"Run","type":"tomcat6","projectId":"p1","mode":"run","suspend":false,"jdkRef":"jdk6","build":{"type":"ant","target":"war","clean":false},"server":{"id":"tomcat6-local","httpPort":18080,"debugPort":8000,"contextPath":"/app"},"deploy":{"mode":"exploded","artifact":"dist/app"},"env":{},"vmOptions":[],"beforeLaunchTasks":["build"],"unknownField":true}`,
	}
	for _, data := range cases {
		if _, err := DecodeTomcatRunConfiguration([]byte(data)); err == nil {
			t.Errorf("expected error for %s", data)
		}
	}
}

func TestTomcatRunConfiguration_Validate_Errors(t *testing.T) {
	base := validTomcatRunConfiguration()
	tests := []struct {
		name   string
		mutate func(*TomcatRunConfiguration)
	}{
		{"invalid id", func(c *TomcatRunConfiguration) { c.ID = "bad id" }},
		{"blank name", func(c *TomcatRunConfiguration) { c.Name = " " }},
		{"bad type", func(c *TomcatRunConfiguration) { c.Type = "weblogic" }},
		{"bad mode", func(c *TomcatRunConfiguration) { c.Mode = "pause" }},
		{"run with suspend", func(c *TomcatRunConfiguration) { c.Mode = "run"; c.Suspend = true }},
		{"bad jdkRef", func(c *TomcatRunConfiguration) { c.JDKRef = "" }},
		{"ant with command", func(c *TomcatRunConfiguration) { c.Build = RunConfigurationBuild{Type: "ant", Target: "war", Command: "x"} }},
		{"ant missing target", func(c *TomcatRunConfiguration) { c.Build = RunConfigurationBuild{Type: "ant"} }},
		{"javac with target", func(c *TomcatRunConfiguration) { c.Build = RunConfigurationBuild{Type: "javac", Target: "war"} }},
		{"custom without command", func(c *TomcatRunConfiguration) { c.Build = RunConfigurationBuild{Type: "custom"} }},
		{"custom with target", func(c *TomcatRunConfiguration) { c.Build = RunConfigurationBuild{Type: "custom", Command: "x", Target: "y"} }},
		{"unknown build type", func(c *TomcatRunConfiguration) { c.Build = RunConfigurationBuild{Type: "make"} }},
		{"bad server id", func(c *TomcatRunConfiguration) { c.Server.ID = "" }},
		{"low http port", func(c *TomcatRunConfiguration) { c.Server.HTTPPort = 80 }},
		{"low debug port", func(c *TomcatRunConfiguration) { c.Server.DebugPort = 0 }},
		{"same ports", func(c *TomcatRunConfiguration) { c.Server.DebugPort = c.Server.HTTPPort }},
		{"bad context path", func(c *TomcatRunConfiguration) { c.Server.ContextPath = "app" }},
		{"bad deploy mode", func(c *TomcatRunConfiguration) { c.Deploy.Mode = "zip" }},
		{"absolute artifact", func(c *TomcatRunConfiguration) { c.Deploy.Artifact = "/etc/passwd" }},
		{"artifact traversal", func(c *TomcatRunConfiguration) { c.Deploy.Artifact = "../outside" }},
		{"nil env", func(c *TomcatRunConfiguration) { c.Env = nil }},
		{"env invalid name", func(c *TomcatRunConfiguration) { c.Env = map[string]string{"bad-name": "v"} }},
		{"env case conflict", func(c *TomcatRunConfiguration) { c.Env = map[string]string{"KEY": "a", "key": "b"} }},
		{"sensitive env not referenced", func(c *TomcatRunConfiguration) { c.Env = map[string]string{"DB_PASSWORD": "plain"} }},
		{"nil vmOptions", func(c *TomcatRunConfiguration) { c.VMOptions = nil }},
		{"vmOptions blank", func(c *TomcatRunConfiguration) { c.VMOptions = []string{" "} }},
		{"nil beforeLaunchTasks", func(c *TomcatRunConfiguration) { c.BeforeLaunchTasks = nil }},
		{"bad task", func(c *TomcatRunConfiguration) { c.BeforeLaunchTasks = []string{"compile"} }},
		{"duplicate tasks", func(c *TomcatRunConfiguration) { c.BeforeLaunchTasks = []string{"build", "build"} }},
		{"deploy before build", func(c *TomcatRunConfiguration) { c.BeforeLaunchTasks = []string{"deploy", "build"} }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := base
			tc.mutate(&cfg)
			if err := cfg.Validate(); err == nil {
				t.Errorf("expected validation error for %s", tc.name)
			}
		})
	}
}

func TestTomcatRunConfiguration_Validate_Valid(t *testing.T) {
	cfg := validTomcatRunConfiguration()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid configuration, got: %v", err)
	}

	// javac build with no target/command is valid.
	cfg.Build = RunConfigurationBuild{Type: "javac"}
	if err := cfg.Validate(); err != nil {
		t.Errorf("javac configuration should be valid: %v", err)
	}

	// custom build with command is valid.
	cfg.Build = RunConfigurationBuild{Type: "custom", Command: "mvn package"}
	if err := cfg.Validate(); err != nil {
		t.Errorf("custom configuration should be valid: %v", err)
	}

	// debug mode with suspend is valid.
	cfg = validTomcatRunConfiguration()
	cfg.Mode = "debug"
	cfg.Suspend = true
	if err := cfg.Validate(); err != nil {
		t.Errorf("debug+suspend configuration should be valid: %v", err)
	}

	// sensitive env with reference is valid.
	cfg = validTomcatRunConfiguration()
	cfg.Env = map[string]string{"DB_PASSWORD": "${env:DB_PASSWORD}"}
	if err := cfg.Validate(); err != nil {
		t.Errorf("referenced sensitive env should be valid: %v", err)
	}
}

func TestRunConfigurationDocument_Validate(t *testing.T) {
	cfg := validTomcatRunConfiguration()
	sel := "cfg-1"
	doc := RunConfigurationDocument{Version: 1, Configurations: []TomcatRunConfiguration{cfg}, SelectedConfigurationID: &sel}
	if err := doc.Validate(); err != nil {
		t.Fatalf("expected valid document: %v", err)
	}

	badVersion := doc
	badVersion.Version = 2
	if err := badVersion.Validate(); err == nil {
		t.Error("expected error for bad version")
	}

	nilConfigs := doc
	nilConfigs.Configurations = nil
	if err := nilConfigs.Validate(); err == nil {
		t.Error("expected error for nil configurations")
	}

	emptySelected := doc
	emptySelected.Configurations = nil
	emptySelected.SelectedConfigurationID = &sel
	if err := emptySelected.Validate(); err == nil {
		t.Error("expected error for selection with empty configurations")
	}

	missingSelection := doc
	missingSelection.SelectedConfigurationID = nil
	if err := missingSelection.Validate(); err == nil {
		t.Error("expected error for missing selection")
	}

	dupIDs := doc
	dupIDs.Configurations = []TomcatRunConfiguration{cfg, cfg}
	if err := dupIDs.Validate(); err == nil {
		t.Error("expected error for duplicate ids")
	}
}

func TestDecodeRunConfigurationDocument_Errors(t *testing.T) {
	cases := []string{
		`not json`,
		`{"version":1}`,
	}
	for _, data := range cases {
		if _, err := DecodeRunConfigurationDocument([]byte(data)); err == nil {
			t.Errorf("expected error for %q", data)
		}
	}
}
