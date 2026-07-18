package config

import (
	"path/filepath"
	"testing"
	"time"
)

func TestDefault(t *testing.T) {
	c := Default()
	if c.BindAddress != "127.0.0.1" {
		t.Errorf("BindAddress = %q, want 127.0.0.1", c.BindAddress)
	}
	if c.Port != 18080 {
		t.Errorf("Port = %d, want 18080", c.Port)
	}
	if c.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want info", c.LogLevel)
	}
	if c.TomcatStartTimeout != 60*time.Second {
		t.Errorf("TomcatStartTimeout = %v, want 60s", c.TomcatStartTimeout)
	}
}

func TestLoadFromFile_Missing(t *testing.T) {
	c, err := LoadFromFile("/nonexistent/path/config.yaml")
	if err != nil {
		t.Fatalf("missing file should not error: %v", err)
	}
	if c.BindAddress != "127.0.0.1" {
		t.Errorf("default should apply: BindAddress = %q", c.BindAddress)
	}
}

func TestLoadFromFile_Override(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "c.yaml")
	contents := `version: 0.1.1
bindAddress: 10.0.0.1
port: 9999
logLevel: debug
`
	if err := writeFile(t, p, contents); err != nil {
		t.Fatal(err)
	}
	c, err := LoadFromFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if c.BindAddress != "10.0.0.1" || c.Port != 9999 || c.LogLevel != "debug" {
		t.Errorf("override failed: %+v", c)
	}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name string
		mod  func(c *Config)
		ok   bool
	}{
		{"default", func(c *Config) {}, true},
		{"no bind", func(c *Config) { c.BindAddress = "" }, false},
		{"bad port", func(c *Config) { c.Port = 0 }, false},
		{"half tls", func(c *Config) { c.TLSCert = "a" }, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := Default()
			tc.mod(&c)
			err := c.Validate()
			if tc.ok && err != nil {
				t.Errorf("expected ok, got %v", err)
			}
			if !tc.ok && err == nil {
				t.Errorf("expected error, got nil")
			}
		})
	}
}

func TestBundled(t *testing.T) {
	c := Default()
	if got, want := c.Bundled(), filepath.Join(c.DataDir, "bundled"); got != want {
		t.Errorf("Bundled() = %q, want %q", got, want)
	}
	c.BundledDir = "/opt/bundled"
	if got, want := c.Bundled(), "/opt/bundled"; got != want {
		t.Errorf("Bundled() = %q, want %q", got, want)
	}
}

func TestBind_DataDir(t *testing.T) {
	cases := []struct {
		name string
		args []string
		env  map[string]string
		want string
	}{
		{"flag only", []string{"--data-dir", "/opt/d1"}, nil, "/opt/d1"},
		{"env only", nil, map[string]string{"KAIRO_DATA_DIR": "/opt/d2"}, "/opt/d2"},
		{"flag overrides env", []string{"--data-dir", "/opt/d3"}, map[string]string{"KAIRO_DATA_DIR": "/opt/d4"}, "/opt/d3"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for k, v := range tc.env {
				t.Setenv(k, v)
			}
			c, _, err := Bind(tc.args)
			if err != nil {
				t.Fatal(err)
			}
			if c.DataDir != tc.want {
				t.Errorf("DataDir = %q, want %q", c.DataDir, tc.want)
			}
		})
	}
}

func TestBind_BundledDir(t *testing.T) {
	cases := []struct {
		name string
		args []string
		env  map[string]string
		want string
	}{
		{"flag only", []string{"--bundled-dir", "/opt/b1"}, nil, "/opt/b1"},
		{"env only", nil, map[string]string{"KAIRO_BUNDLED_DIR": "/opt/b2"}, "/opt/b2"},
		{"flag overrides env", []string{"--bundled-dir", "/opt/b3"}, map[string]string{"KAIRO_BUNDLED_DIR": "/opt/b4"}, "/opt/b3"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for k, v := range tc.env {
				t.Setenv(k, v)
			}
			c, _, err := Bind(tc.args)
			if err != nil {
				t.Fatal(err)
			}
			if c.BundledDir != tc.want {
				t.Errorf("BundledDir = %q, want %q", c.BundledDir, tc.want)
			}
		})
	}
}

func TestBind_OtherFlags(t *testing.T) {
	c, _, err := Bind([]string{
		"--bind", "0.0.0.0",
		"--port", "9090",
		"--log-level", "debug",
		"--require-auth",
		"--tls-cert", "/p/cert",
		"--tls-key", "/p/key",
	})
	if err != nil {
		t.Fatal(err)
	}
	if c.BindAddress != "0.0.0.0" {
		t.Errorf("BindAddress = %q", c.BindAddress)
	}
	if c.Port != 9090 {
		t.Errorf("Port = %d", c.Port)
	}
	if c.LogLevel != "debug" {
		t.Errorf("LogLevel = %q", c.LogLevel)
	}
	if !c.RequireAuth {
		t.Error("RequireAuth = false, want true")
	}
	if c.TLSCert != "/p/cert" || c.TLSKey != "/p/key" {
		t.Errorf("TLS = %+v", c)
	}
}

func writeFile(t *testing.T, path, contents string) error {
	t.Helper()
	return osWriteFile(path, []byte(contents), 0o600)
}
