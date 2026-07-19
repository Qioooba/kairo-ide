// Package config holds the Runtime Agent's runtime configuration.
//
// Configuration sources, in increasing precedence:
//
//  1. Built-in defaults (compiled in).
//  2. Config file (YAML), passed via --config or KAIRO_CONFIG.
//  3. Environment variables prefixed KAIRO_.
//  4. Command-line flags.
package config

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the top-level configuration.
type Config struct {
	Version string `yaml:"version"`

	// BindAddress is the HTTP bind address. Default 127.0.0.1.
	BindAddress string `yaml:"bindAddress"`
	// Port is the HTTP port. Default 18080.
	Port int `yaml:"port"`
	// TLSCert / TLSKey enable TLS. Optional in dev, required in prod.
	TLSCert string `yaml:"tlsCert"`
	TLSKey  string `yaml:"tlsKey"`

	// DataDir is where workspaces, audit, and toolchain fingerprints
	// live. Default $KAIRO_DATA_DIR or $HOME/.kairo.
	DataDir string `yaml:"dataDir"`
	// BundledDir is where Tomcat 6 and JDT LS live after first use.
	// Default <DataDir>/bundled.
	BundledDir string `yaml:"bundledDir"`

	// LogLevel: debug | info | warn | error. Default info.
	LogLevel string `yaml:"logLevel"`
	// RequireAuth even on loopback. Default false in dev.
	RequireAuth bool `yaml:"requireAuth"`
	// Secret is a local authentication secret for desktop host mode.
	// When set, the API middleware requires the X-Kairo-Secret header.
	Secret string `yaml:"secret"`
	// SessionLifetimeHours. Default 8.
	SessionLifetimeHours int `yaml:"sessionLifetimeHours"`
	// IdleTimeoutMinutes. Default 30.
	IdleTimeoutMinutes int `yaml:"idleTimeoutMinutes"`
	// LogBufferLines is the size of the in-memory ring buffer for
	// the diagnostic center. Default 5000.
	LogBufferLines int `yaml:"logBufferLines"`

	// WorkspaceScan limits: how deep to scan during import.
	WorkspaceScanMaxDepth int `yaml:"workspaceScanMaxDepth"`
	WorkspaceScanMaxFiles int `yaml:"workspaceScanMaxFiles"`

	// Process timeouts.
	TomcatStartTimeout    time.Duration `yaml:"tomcatStartTimeout"`
	TomcatShutdownTimeout time.Duration `yaml:"tomcatShutdownTimeout"`
	// BuildFileTimeout. Default 30s.
	BuildFileTimeout time.Duration `yaml:"buildFileTimeout"`

	// JDT LS distribution
	// SkipSHAVerify skips SHA-256 verification of the JDT LS
	// archive. For development only.
	SkipSHAVerify bool `yaml:"skipSHAVerify"`
	// JDTLSURL overrides the JDT LS download URL. Useful for
	// corporate mirrors.
	JDTLSURL string `yaml:"jdtlsUrl"`
}

// Default returns the default config.
func Default() Config {
	return Config{
		Version:               "0.1.0",
		BindAddress:           "127.0.0.1",
		Port:                  18080,
		DataDir:               defaultDataDir(),
		LogLevel:              "info",
		RequireAuth:           false,
		SessionLifetimeHours:  8,
		IdleTimeoutMinutes:    30,
		LogBufferLines:        5000,
		WorkspaceScanMaxDepth: 8,
		WorkspaceScanMaxFiles: 50_000,
		TomcatStartTimeout:    60 * time.Second,
		TomcatShutdownTimeout: 15 * time.Second,
		BuildFileTimeout:      30 * time.Second,
	}
}

// Bundled returns the resolved bundled directory.
func (c Config) Bundled() string {
	if c.BundledDir != "" {
		return c.BundledDir
	}
	return filepath.Join(c.DataDir, "bundled")
}

func defaultDataDir() string {
	if v := os.Getenv("KAIRO_DATA_DIR"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "/tmp/kairo"
	}
	return filepath.Join(home, ".kairo")
}

// LoadFromFile loads a config from a YAML file. Missing file is OK.
func LoadFromFile(path string) (Config, error) {
	cfg := Default()
	if path == "" {
		return cfg, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return cfg, fmt.Errorf("read %s: %w", path, err)
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("parse %s: %w", path, err)
	}
	return cfg, nil
}

// ApplyEnv overrides fields with environment variables.
func ApplyEnv(cfg *Config) {
	if v := os.Getenv("KAIRO_RUNTIME_BIND"); v != "" {
		cfg.BindAddress = v
	}
	if v := os.Getenv("KAIRO_RUNTIME_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Port = n
		}
	}
	if v := os.Getenv("KAIRO_LOG_LEVEL"); v != "" {
		cfg.LogLevel = v
	}
	if v := os.Getenv("KAIRO_DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	if v := os.Getenv("KAIRO_BUNDLED_DIR"); v != "" {
		cfg.BundledDir = v
	}
	if v := os.Getenv("KAIRO_LOCAL_SECRET"); v != "" {
		cfg.Secret = v
	}
	if v := os.Getenv("KAIRO_REQUIRE_AUTH"); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			cfg.RequireAuth = b
		}
	}
}

// Validate returns an error if the config is invalid.
func (c Config) Validate() error {
	if c.BindAddress == "" {
		return errors.New("bindAddress is required")
	}
	if c.Port <= 0 || c.Port > 65535 {
		return fmt.Errorf("port out of range: %d", c.Port)
	}
	if c.DataDir == "" {
		return errors.New("dataDir is required")
	}
	if (c.TLSCert != "" && c.TLSKey == "") || (c.TLSCert == "" && c.TLSKey != "") {
		return errors.New("tlsCert and tlsKey must both be set or both empty")
	}
	return nil
}

// String returns a redacted view of the config for logging.
func (c Config) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "bind=%s port=%d dataDir=%s logLevel=%s requireAuth=%v",
		c.BindAddress, c.Port, c.DataDir, c.LogLevel, c.RequireAuth)
	if c.TLSCert != "" {
		fmt.Fprintf(&b, " tlsCert=%s", c.TLSCert)
	}
	return b.String()
}

// Bind parses command-line flags. The "config" path is the only
// required flag; all others have defaults.
func Bind(args []string) (Config, string, error) {
	fs := flag.NewFlagSet("kairo-runtime", flag.ContinueOnError)
	configPath := fs.String("config", "", "path to YAML config file")
	bind := fs.String("bind", "", "bind address (overrides config)")
	port := fs.Int("port", 0, "port (overrides config)")
	logLevel := fs.String("log-level", "", "log level (debug|info|warn|error)")
	requireAuth := fs.Bool("require-auth", false, "require auth on loopback")
	dataDir := fs.String("data-dir", "", "data directory (overrides KAIRO_DATA_DIR / config)")
	bundledDir := fs.String("bundled-dir", "", "bundled directory (overrides KAIRO_BUNDLED_DIR / config)")
	secret := fs.String("secret", "", "local auth secret (or set KAIRO_LOCAL_SECRET)")
	// If the flag is empty, fall back to KAIRO_LOCAL_SECRET from the
	// environment. The Desktop host injects this when spawning the
	// agent so renderer + agent share a per-session secret without
	// the secret ever appearing on the command line.
	if *secret == "" {
		if v := os.Getenv("KAIRO_LOCAL_SECRET"); v != "" {
			*secret = v
		}
	}
	tlsCert := fs.String("tls-cert", "", "TLS certificate path")
	tlsKey := fs.String("tls-key", "", "TLS key path")
	skipSHAVerify := fs.Bool("skip-sha-verify", false, "skip SHA-256 verification of JDT LS archive (dev only)")
	jdtlsURL := fs.String("jdtls-url", "", "override JDT LS download URL (corporate mirror)")
	if err := fs.Parse(args); err != nil {
		return Config{}, "", err
	}
	cfg, err := LoadFromFile(*configPath)
	if err != nil {
		return Config{}, "", err
	}
	ApplyEnv(&cfg)
	if *bind != "" {
		cfg.BindAddress = *bind
	}
	if *port != 0 {
		cfg.Port = *port
	}
	if *logLevel != "" {
		cfg.LogLevel = *logLevel
	}
	if *requireAuth {
		cfg.RequireAuth = true
	}
	if *dataDir != "" {
		cfg.DataDir = *dataDir
	}
	if *bundledDir != "" {
		cfg.BundledDir = *bundledDir
	}
	if *secret != "" {
		cfg.Secret = *secret
	}
	if *tlsCert != "" {
		cfg.TLSCert = *tlsCert
	}
	if *tlsKey != "" {
		cfg.TLSKey = *tlsKey
	}
	if *skipSHAVerify {
		cfg.SkipSHAVerify = true
	}
	if *jdtlsURL != "" {
		cfg.JDTLSURL = *jdtlsURL
	}
	return cfg, *configPath, cfg.Validate()
}
