// Package toolchain detects and registers Java toolchains (JDKs).
// See docs/adr/0006-jdk6-tomcat6-eol-strategy.md.
package toolchain

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Toolchain is a registered JDK.
type Toolchain struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"` // "jdk"
	Home        string   `json:"home"`
	Vendor      string   `json:"vendor"`
	Version     string   `json:"version"`
	SourceLevels []string `json:"sourceLevels"`
	Fingerprint string   `json:"fingerprint"`
	ImportedAt  string   `json:"importedAt"`
}

// Registry holds the set of known toolchains.
type Registry struct {
	mu sync.Mutex
	dir string
	items map[string]Toolchain
}

// NewRegistry loads (or creates) a registry at dir.
func NewRegistry(dir string) (*Registry, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	r := &Registry{dir: dir, items: map[string]Toolchain{}}
	if err := r.load(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *Registry) load() error {
	p := filepath.Join(r.dir, "toolchains.json")
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var items []Toolchain
	if err := jsonUnmarshal(data, &items); err != nil {
		return err
	}
	for _, t := range items {
		r.items[t.ID] = t
	}
	return nil
}

func (r *Registry) save() error {
	items := make([]Toolchain, 0, len(r.items))
	for _, t := range r.items {
		items = append(items, t)
	}
	p := filepath.Join(r.dir, "toolchains.json")
	data, err := jsonMarshal(items)
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o600)
}

// List returns all registered toolchains.
func (r *Registry) List() []Toolchain {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Toolchain, 0, len(r.items))
	for _, t := range r.items {
		out = append(out, t)
	}
	return out
}

// Get returns a toolchain by id.
func (r *Registry) Get(id string) (Toolchain, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.items[id]
	return t, ok
}

// Add registers a toolchain and persists it.
func (r *Registry) Add(t Toolchain) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t.ID == "" {
		return errors.New("id is required")
	}
	if !strings.HasPrefix(t.Fingerprint, "sha256:") {
		return errors.New("fingerprint must start with sha256:")
	}
	r.items[t.ID] = t
	return r.save()
}

// Remove unregisters a toolchain.
func (r *Registry) Remove(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.items[id]; !ok {
		return errors.New("not found: " + id)
	}
	delete(r.items, id)
	return r.save()
}

// Detect inspects a candidate home directory and returns its
// detected toolchain info. It does not register the toolchain.
func Detect(home string) (Toolchain, error) {
	if home == "" {
		return Toolchain{}, errors.New("home is empty")
	}
	abs, err := filepath.Abs(home)
	if err != nil {
		return Toolchain{}, err
	}
	javaPath, err := locateBinary(abs, "java")
	if err != nil {
		return Toolchain{}, err
	}
	javacPath, err := locateBinary(abs, "javac")
	if err != nil {
		return Toolchain{}, err
	}

	vendor, version, err := runVersion(javaPath, "-version")
	if err != nil {
		return Toolchain{}, err
	}

	// Compute fingerprint: SHA-256 of the `java` binary. This is
	// the canonical artifact a user is registering.
	fp, err := fileFingerprint(javaPath)
	if err != nil {
		return Toolchain{}, err
	}

	levels, err := probeSourceLevels(javacPath)
	if err != nil {
		// Some JDKs do not advertise; default to common ones.
		levels = []string{"1.5", "1.6", "1.7", "1.8", "9", "11", "17"}
	}

	id := buildID(vendor, version, fp)
	return Toolchain{
		ID:          id,
		Kind:        "jdk",
		Home:        abs,
		Vendor:      vendor,
		Version:     version,
		SourceLevels: levels,
		Fingerprint: "sha256:" + fp,
	}, nil
}

func locateBinary(home, name string) (string, error) {
	var path string
	switch runtime.GOOS {
	case "windows":
		path = filepath.Join(home, "bin", name+".exe")
	default:
		path = filepath.Join(home, "bin", name)
	}
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	// Fall back: maybe the user pointed at a JDK with `jre/`
	// and `bin/` inside `jre/`.
	alt := filepath.Join(home, "jre", "bin", name)
	if _, err := os.Stat(alt); err == nil {
		return alt, nil
	}
	return "", fmt.Errorf("not a JDK: %s (no %s)", home, name)
}

func runVersion(bin string, args ...string) (vendor, version string, err error) {
	out, err := exec.Command(bin, args...).CombinedOutput()
	if err != nil {
		// Some JDKs return non-zero for -version. We don't care
		// about the exit code, only the output. CombinedOutput
		// captures both stdout and stderr so the version line is
		// there even if the exit is non-zero.
		if len(out) == 0 {
			return "", "", fmt.Errorf("run %s: %w", bin, err)
		}
	}
	line := firstNonEmptyLine(out)
	if line == "" {
		return "", "", errors.New("no version output from " + bin)
	}
	// Common formats:
	//   openjdk version "17.0.7" 2025-04-15
	//   java version "1.6.0_45" Java(TM) SE Runtime Environment ...
	vendor = parseVendor(line)
	version = parseVersion(line)
	if version == "" {
		return "", "", fmt.Errorf("could not parse version from: %q", line)
	}
	return vendor, version, nil
}

func firstNonEmptyLine(b []byte) string {
	scanner := bufio.NewScanner(bytes.NewReader(b))
	for scanner.Scan() {
		s := strings.TrimSpace(scanner.Text())
		if s != "" {
			return s
		}
	}
	return ""
}

func parseVendor(line string) string {
	l := strings.ToLower(line)
	switch {
	case strings.Contains(l, "openjdk"):
		return "openjdk"
	case strings.Contains(l, "java(tm)") || strings.Contains(l, "java se"):
		return "oracle"
	case strings.Contains(l, "ibm"):
		return "ibm"
	case strings.Contains(l, "azul"), strings.Contains(l, "zulu"):
		return "azul"
	case strings.Contains(l, "amazon"), strings.Contains(l, "corretto"):
		return "amazon"
	case strings.Contains(l, "temurin"), strings.Contains(l, "adoptium"):
		return "adoptium"
	default:
		return "unknown"
	}
}

var versionRE = regexpCompile(`"([^"]+)"`)

func parseVersion(line string) string {
	m := versionRE.FindStringSubmatch(line)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

func fileFingerprint(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := copyAll(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// probeSourceLevels runs `javac -help` to find supported
// `-source` values. Real JDK 6 lists up to 6; JDK 17 lists up to 17.
func probeSourceLevels(javacPath string) ([]string, error) {
	out, err := exec.Command(javacPath, "-help").CombinedOutput()
	if err != nil && len(out) == 0 {
		return nil, err
	}
	s := string(out)
	// Look for the line "Supported source versions: ..."
	var levels []string
	for _, m := range supportedVersionsRE.FindAllStringSubmatch(s, -1) {
		if len(m) >= 2 {
			levels = append(levels, strings.TrimSpace(m[1]))
		}
	}
	if len(levels) == 0 {
		return nil, errors.New("no supported versions found")
	}
	return levels, nil
}

func buildID(vendor, version, fp string) string {
	h := sha256.Sum256([]byte(vendor + "|" + version + "|" + fp))
	return fmt.Sprintf("%s-%s-%s", sanitize(vendor), sanitize(version), hex.EncodeToString(h[:])[:8])
}

func sanitize(s string) string {
	out := strings.ToLower(s)
	out = strings.ReplaceAll(out, " ", "-")
	out = strings.ReplaceAll(out, "/", "-")
	return out
}
