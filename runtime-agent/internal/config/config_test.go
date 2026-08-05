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
		{"ephemeral port", func(c *Config) { c.Port = 0 }, true},
		{"negative port", func(c *Config) { c.Port = -1 }, false},
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

func TestBind_EphemeralPort(t *testing.T) {
	c, _, err := Bind([]string{"--port", "0"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 0 {
		t.Errorf("Port = %d, want 0 (ephemeral)", c.Port)
	}
}

func writeFile(t *testing.T, path, contents string) error {
	t.Helper()
	return osWriteFile(path, []byte(contents), 0o600)
}

// =============================================================================
// Validate additional cases
// =============================================================================

func TestValidate_PortTooHigh(t *testing.T) {
	c := Default()
	c.Port = 70000
	err := c.Validate()
	if err == nil {
		t.Fatal("expected error for port > 65535")
	}
}

func TestValidate_NoDataDir(t *testing.T) {
	c := Default()
	c.DataDir = ""
	err := c.Validate()
	if err == nil {
		t.Fatal("expected error for empty dataDir")
	}
}

func TestValidate_HalfTLSKeyOnly(t *testing.T) {
	c := Default()
	c.TLSKey = "key"
	err := c.Validate()
	if err == nil {
		t.Fatal("expected error for TLSKey without TLSCert")
	}
}

// =============================================================================
// String with TLS
// =============================================================================

func TestString_WithTLS(t *testing.T) {
	c := Default()
	c.TLSCert = "/path/to/cert"
	s := c.String()
	if s == "" {
		t.Error("expected non-empty string")
	}
}

// =============================================================================
// ApplyEnv all vars
// =============================================================================

func TestApplyEnv_All(t *testing.T) {
	cfg := Default()
	t.Setenv("KAIRO_RUNTIME_BIND", "0.0.0.0")
	t.Setenv("KAIRO_RUNTIME_PORT", "9999")
	t.Setenv("KAIRO_LOG_LEVEL", "debug")
	t.Setenv("KAIRO_DATA_DIR", "/opt/data")
	t.Setenv("KAIRO_BUNDLED_DIR", "/opt/bundled")
	t.Setenv("KAIRO_LOCAL_SECRET", "mysecret")
	t.Setenv("KAIRO_REQUIRE_AUTH", "true")

	ApplyEnv(&cfg)
	if cfg.BindAddress != "0.0.0.0" {
		t.Errorf("BindAddress = %q, want 0.0.0.0", cfg.BindAddress)
	}
	if cfg.Port != 9999 {
		t.Errorf("Port = %d, want 9999", cfg.Port)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want debug", cfg.LogLevel)
	}
	if cfg.DataDir != "/opt/data" {
		t.Errorf("DataDir = %q, want /opt/data", cfg.DataDir)
	}
	if cfg.BundledDir != "/opt/bundled" {
		t.Errorf("BundledDir = %q, want /opt/bundled", cfg.BundledDir)
	}
	if cfg.Secret != "mysecret" {
		t.Errorf("Secret = %q, want mysecret", cfg.Secret)
	}
	if !cfg.RequireAuth {
		t.Error("RequireAuth should be true")
	}
}

func TestApplyEnv_InvalidPort(t *testing.T) {
	cfg := Default()
	t.Setenv("KAIRO_RUNTIME_PORT", "notanumber")
	ApplyEnv(&cfg)
	if cfg.Port != 18080 {
		t.Errorf("Port should not change on invalid env, got %d", cfg.Port)
	}
}

func TestApplyEnv_InvalidBool(t *testing.T) {
	cfg := Default()
	t.Setenv("KAIRO_REQUIRE_AUTH", "notabool")
	ApplyEnv(&cfg)
	if cfg.RequireAuth {
		t.Error("RequireAuth should not change on invalid env")
	}
}

// =============================================================================
// LoadFromFile with empty path
// =============================================================================

func TestLoadFromFile_EmptyPath(t *testing.T) {
	c, err := LoadFromFile("")
	if err != nil {
		t.Fatalf("empty path should not error: %v", err)
	}
	if c.BindAddress != "127.0.0.1" {
		t.Errorf("BindAddress = %q, want 127.0.0.1", c.BindAddress)
	}
}

// =============================================================================
// Bind with config file
// =============================================================================

func TestBind_WithConfigFile(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	contents := `bindAddress: 10.0.0.1
port: 7777
logLevel: warn
`
	if err := writeFile(t, configPath, contents); err != nil {
		t.Fatal(err)
	}
	c, path, err := Bind([]string{"--config", configPath})
	if err != nil {
		t.Fatalf("Bind failed: %v", err)
	}
	if path != configPath {
		t.Errorf("config path = %q, want %q", path, configPath)
	}
	if c.BindAddress != "10.0.0.1" {
		t.Errorf("BindAddress = %q, want 10.0.0.1", c.BindAddress)
	}
	if c.Port != 7777 {
		t.Errorf("Port = %d, want 7777", c.Port)
	}
}

func TestBind_FlagOverridesConfig(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	contents := `bindAddress: 10.0.0.1
port: 7777
`
	if err := writeFile(t, configPath, contents); err != nil {
		t.Fatal(err)
	}
	c, _, err := Bind([]string{"--config", configPath, "--bind", "1.2.3.4", "--port", "5555"})
	if err != nil {
		t.Fatalf("Bind failed: %v", err)
	}
	if c.BindAddress != "1.2.3.4" {
		t.Errorf("flag should override: BindAddress = %q", c.BindAddress)
	}
	if c.Port != 5555 {
		t.Errorf("flag should override: Port = %d", c.Port)
	}
}

// =============================================================================
// Bind with skip-sha-verify and jdtls-url
// =============================================================================

func TestBind_SkipSHAVerify(t *testing.T) {
	c, _, err := Bind([]string{"--skip-sha-verify"})
	if err != nil {
		t.Fatalf("Bind failed: %v", err)
	}
	if !c.SkipSHAVerify {
		t.Error("SkipSHAVerify should be true")
	}
}

func TestBind_JDTLSURL(t *testing.T) {
	c, _, err := Bind([]string{"--jdtls-url", "https://mirror.example.com/jdtls"})
	if err != nil {
		t.Fatalf("Bind failed: %v", err)
	}
	if c.JDTLSURL != "https://mirror.example.com/jdtls" {
		t.Errorf("JDTLSURL = %q", c.JDTLSURL)
	}
}

func TestBind_SecretEnv(t *testing.T) {
	t.Setenv("KAIRO_LOCAL_SECRET", "env-secret")
	c, _, err := Bind([]string{})
	if err != nil {
		t.Fatalf("Bind failed: %v", err)
	}
	if c.Secret != "env-secret" {
		t.Errorf("Secret = %q, want env-secret", c.Secret)
	}
}

func TestBind_SecretFlag(t *testing.T) {
	t.Setenv("KAIRO_LOCAL_SECRET", "env-secret")
	c, _, err := Bind([]string{"--secret", "flag-secret"})
	if err != nil {
		t.Fatalf("Bind failed: %v", err)
	}
	if c.Secret != "flag-secret" {
		t.Errorf("flag should override env: Secret = %q", c.Secret)
	}
}

func TestBind_InvalidFlag(t *testing.T) {
	_, _, err := Bind([]string{"--nonexistent", "value"})
	if err == nil {
		t.Fatal("expected error for invalid flag")
	}
}

func TestBind_InvalidConfigFile(t *testing.T) {
	_, _, err := Bind([]string{"--config", "/nonexistent/path/config.yaml"})
	if err != nil {
		t.Fatal("invalid config file should not error (missing is OK)")
	}
}

// =============================================================================
// defaultDataDir with KAIRO_DATA_DIR
// =============================================================================

func TestDefaultDataDir_Env(t *testing.T) {
	t.Setenv("KAIRO_DATA_DIR", "/custom/data")
	got := defaultDataDir()
	if got != "/custom/data" {
		t.Errorf("defaultDataDir = %q, want /custom/data", got)
	}
}
