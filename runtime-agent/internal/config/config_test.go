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

func writeFile(t *testing.T, path, contents string) error {
	t.Helper()
	return osWriteFile(path, []byte(contents), 0o600)
}
