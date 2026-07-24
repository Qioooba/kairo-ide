// Package maven provides pom.xml parsing and Maven lifecycle task execution.
package maven

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Settings represents parsed ~/.m2/settings.xml configuration.
type Settings struct {
	LocalRepository string       `json:"localRepository"`
	Mirrors         []Mirror     `json:"mirrors,omitempty"`
	Servers         []Server     `json:"servers,omitempty"`
	Proxies         []Proxy      `json:"proxies,omitempty"`
	Profiles        []SettingsProfile `json:"profiles,omitempty"`
	ActiveProfiles  []string     `json:"activeProfiles,omitempty"`
}

// Mirror defines a repository mirror configuration.
type Mirror struct {
	ID              string `json:"id"`
	Name            string `json:"name,omitempty"`
	URL             string `json:"url"`
	MirrorOf        string `json:"mirrorOf"`
	Layout          string `json:"layout,omitempty"`
	MirrorOfLayouts string `json:"mirrorOfLayouts,omitempty"`
}

// Server holds credentials and configuration for a remote repository.
type Server struct {
	ID              string          `json:"id"`
	Username        string          `json:"username,omitempty"`
	Password        *EncryptedValue `json:"password,omitempty"`
	PrivateKey      string          `json:"privateKey,omitempty"`
	Passphrase      *EncryptedValue `json:"passphrase,omitempty"`
	FilePermissions string          `json:"filePermissions,omitempty"`
	DirectoryPermissions string     `json:"directoryPermissions,omitempty"`
	Configuration   map[string]string `json:"configuration,omitempty"`
}

// EncryptedValue represents an encrypted value with its encryption metadata.
type EncryptedValue struct {
	Encrypted string `json:"encrypted"`
	Algorithm string `json:"algorithm"`
	Plaintext string `json:"-"` // Not serialized to JSON
}

// Proxy defines an HTTP proxy configuration.
type Proxy struct {
	ID            string `json:"id"`
	Active        bool   `json:"active"`
	Protocol      string `json:"protocol"`
	Host          string `json:"host"`
	Port          int    `json:"port"`
	Username      string `json:"username,omitempty"`
	Password      *EncryptedValue `json:"password,omitempty"`
	NonProxyHosts string `json:"nonProxyHosts,omitempty"`
}

// SettingsProfile represents a profile in settings.xml.
type SettingsProfile struct {
	ID             string            `json:"id"`
	Activation     ProfileActivation `json:"activation,omitempty"`
	Properties     map[string]string `json:"properties,omitempty"`
	Repositories   []Repository      `json:"repositories,omitempty"`
	PluginRepositories []Repository  `json:"pluginRepositories,omitempty"`
}

// settingsXML is the raw XML structure for settings.xml parsing.
type settingsXML struct {
	XMLName           xml.Name                `xml:"settings"`
	LocalRepository   string                  `xml:"localRepository"`
	Mirrors           []settingsXMLMirror     `xml:"mirrors>mirror"`
	Servers           []settingsXMLServer     `xml:"servers>server"`
	Proxies           []settingsXMLProxy      `xml:"proxies>proxy"`
	Profiles          []settingsXMLProfile    `xml:"profiles>profile"`
	ActiveProfiles    settingsXMLActiveProfiles `xml:"activeProfiles"`
}

type settingsXMLMirror struct {
	ID              string `xml:"id"`
	Name            string `xml:"name"`
	URL             string `xml:"url"`
	MirrorOf        string `xml:"mirrorOf"`
	Layout          string `xml:"layout"`
	MirrorOfLayouts string `xml:"mirrorOfLayouts"`
}

type settingsXMLServer struct {
	ID              string                             `xml:"id"`
	Username        string                             `xml:"username"`
	Password        string                             `xml:"password"`
	PrivateKey      string                             `xml:"privateKey"`
	Passphrase      string                             `xml:"passphrase"`
	FilePermissions string                             `xml:"filePermissions"`
	DirPermissions  string                             `xml:"directoryPermissions"`
	Configuration   []settingsXMLServerProperty        `xml:"configuration>*,omitempty"`
}

type settingsXMLServerProperty struct {
	XMLName xml.Name
	Value   string `xml:",chardata"`
}

type settingsXMLProxy struct {
	ID            string `xml:"id"`
	Active        string `xml:"active"`
	Protocol      string `xml:"protocol"`
	Host          string `xml:"host"`
	Port          int    `xml:"port"`
	Username      string `xml:"username"`
	Password      string `xml:"password"`
	NonProxyHosts string `xml:"nonProxyHosts"`
}

type settingsXMLProfile struct {
	ID                 string                        `xml:"id"`
	Activation         settingsXMLProfileActivation  `xml:"activation"`
	Properties         []settingsXMLProperty         `xml:"properties>*,omitempty"`
	Repositories       []settingsXMLRepository       `xml:"repositories>repository"`
	PluginRepositories []settingsXMLRepository       `xml:"pluginRepositories>repository"`
}

type settingsXMLProfileActivation struct {
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
}

type settingsXMLProperty struct {
	XMLName xml.Name
	Value   string `xml:",chardata"`
}

type settingsXMLRepository struct {
	ID       string `xml:"id"`
	Name     string `xml:"name"`
	URL      string `xml:"url"`
	Layout   string `xml:"layout"`
	Releases struct {
		Enabled string `xml:"enabled"`
	} `xml:"releases"`
	Snapshots struct {
		Enabled string `xml:"enabled"`
	} `xml:"snapshots"`
}

type settingsXMLActiveProfiles struct {
	ActiveProfile []string `xml:"activeProfile"`
}

// DefaultSettingsPath returns the default path to settings.xml.
func DefaultSettingsPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".m2", "settings.xml")
}

// ParseSettings parses a settings.xml file from the given path.
// If path is empty, it uses the default location (~/.m2/settings.xml).
func ParseSettings(path string) (*Settings, error) {
	if path == "" {
		path = DefaultSettingsPath()
		if path == "" {
			return nil, fmt.Errorf("cannot determine settings.xml path")
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Settings{
				LocalRepository: defaultLocalRepo(),
			}, nil
		}
		return nil, err
	}

	var raw settingsXML
	if err := xml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse settings.xml: %w", err)
	}

	s := &Settings{
		LocalRepository: raw.LocalRepository,
		ActiveProfiles:  raw.ActiveProfiles.ActiveProfile,
	}

	if s.LocalRepository == "" {
		s.LocalRepository = defaultLocalRepo()
	}

	// Parse mirrors
	for _, m := range raw.Mirrors {
		s.Mirrors = append(s.Mirrors, Mirror{
			ID:              m.ID,
			Name:            m.Name,
			URL:             m.URL,
			MirrorOf:        m.MirrorOf,
			Layout:          m.Layout,
			MirrorOfLayouts: m.MirrorOfLayouts,
		})
	}

	// Parse servers
	for _, sv := range raw.Servers {
		server := Server{
			ID:              sv.ID,
			Username:        sv.Username,
			PrivateKey:      sv.PrivateKey,
			FilePermissions: sv.FilePermissions,
			DirectoryPermissions: sv.DirPermissions,
			Configuration:   make(map[string]string),
		}
		// Parse encrypted password
		if sv.Password != "" {
			server.Password = parseEncryptedValue(sv.Password)
		}
		if sv.Passphrase != "" {
			server.Passphrase = parseEncryptedValue(sv.Passphrase)
		}
		for _, cfg := range sv.Configuration {
			server.Configuration[cfg.XMLName.Local] = cfg.Value
		}
		s.Servers = append(s.Servers, server)
	}

	// Parse proxies
	for _, px := range raw.Proxies {
		proxy := Proxy{
			ID:            px.ID,
			Active:        px.Active == "true",
			Protocol:      px.Protocol,
			Host:          px.Host,
			Port:          px.Port,
			Username:      px.Username,
			NonProxyHosts: px.NonProxyHosts,
		}
		if px.Password != "" {
			proxy.Password = parseEncryptedValue(px.Password)
		}
		if proxy.Protocol == "" {
			proxy.Protocol = "http"
		}
		s.Proxies = append(s.Proxies, proxy)
	}

	// Parse profiles
	for _, rp := range raw.Profiles {
		profile := SettingsProfile{
			ID:         rp.ID,
			Properties: make(map[string]string),
		}
		profile.Activation.ActiveByDefault = rp.Activation.ActiveByDefault == "true"
		profile.Activation.JDK = rp.Activation.JDK
		if rp.Activation.OS.Name != "" || rp.Activation.OS.Family != "" {
			profile.Activation.OS = &ProfileOSActivation{
				Name:    rp.Activation.OS.Name,
				Family:  rp.Activation.OS.Family,
				Arch:    rp.Activation.OS.Arch,
				Version: rp.Activation.OS.Version,
			}
		}
		if rp.Activation.Property.Name != "" {
			profile.Activation.Property = &ProfilePropertyActivation{
				Name:  rp.Activation.Property.Name,
				Value: rp.Activation.Property.Value,
			}
		}

		for _, prop := range rp.Properties {
			profile.Properties[prop.XMLName.Local] = prop.Value
		}

		for _, repo := range rp.Repositories {
			profile.Repositories = append(profile.Repositories, Repository{
				ID:   repo.ID,
				URL:  repo.URL,
				Name: repo.Name,
			})
		}

		for _, repo := range rp.PluginRepositories {
			profile.PluginRepositories = append(profile.PluginRepositories, Repository{
				ID:   repo.ID,
				URL:  repo.URL,
				Name: repo.Name,
			})
		}

		s.Profiles = append(s.Profiles, profile)
	}

	return s, nil
}

// defaultLocalRepo returns the default local repository path.
func defaultLocalRepo() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".m2", "repository")
}

// parseEncryptedValue detects the encryption scheme used on a Maven
// encrypted value (e.g., {algorithm}base64data).
func parseEncryptedValue(raw string) *EncryptedValue {
	ev := &EncryptedValue{Encrypted: raw}
	// Check for Maven-style encrypted notation: {algorithm}data
	if len(raw) > 0 && raw[0] == '{' {
		idx := strings.IndexByte(raw, '}')
		if idx > 0 {
			ev.Algorithm = raw[1:idx]
			ev.Encrypted = raw[idx+1:]
		}
	}
	return ev
}

// GetMirrorFor returns the mirror configuration for a given repository URL.
// Returns nil if no mirror matches.
func (s *Settings) GetMirrorFor(repoURL string) *Mirror {
	for _, m := range s.Mirrors {
		if matchesMirrorOf(m.MirrorOf, repoURL) {
			return &m
		}
	}
	return nil
}

// matchesMirrorOf checks if a repository matches a mirrorOf pattern.
// mirrorOf can be "*" (all), "external:*" (all except localhost), or
// a comma-separated list of repo IDs.
func matchesMirrorOf(mirrorOf, repoURL string) bool {
	if mirrorOf == "*" {
		return true
	}
	if strings.HasPrefix(mirrorOf, "external:*") {
		return !strings.Contains(repoURL, "localhost") &&
			!strings.Contains(repoURL, "127.0.0.1")
	}
	return strings.Contains(mirrorOf, repoURL)
}

// GetServer returns the server configuration for a given server ID.
func (s *Settings) GetServer(id string) *Server {
	for i := range s.Servers {
		if s.Servers[i].ID == id {
			return &s.Servers[i]
		}
	}
	return nil
}

// GetActiveProxy returns the first active proxy, or nil if none.
func (s *Settings) GetActiveProxy() *Proxy {
	for i := range s.Proxies {
		if s.Proxies[i].Active {
			return &s.Proxies[i]
		}
	}
	return nil
}

// GetActiveProfiles returns the settings profiles that are active.
func (s *Settings) GetActiveProfiles() []SettingsProfile {
	activeIDs := make(map[string]bool)
	for _, id := range s.ActiveProfiles {
		activeIDs[id] = true
	}

	var active []SettingsProfile
	for _, p := range s.Profiles {
		if activeIDs[p.ID] || p.Activation.ActiveByDefault {
			active = append(active, p)
		}
	}
	return active
}

// ResolveRepositoryURL applies mirror rules to a repository URL.
// Returns the original URL if no mirror matches.
func (s *Settings) ResolveRepositoryURL(repoID, repoURL string) string {
	// Check mirrors first
	mirror := s.GetMirrorFor(repoURL)
	if mirror != nil {
		return mirror.URL
	}

	// Then check settings profiles for additional repositories
	for _, p := range s.GetActiveProfiles() {
		for _, r := range p.Repositories {
			if r.ID == repoID || r.URL == repoURL {
				return r.URL
			}
		}
	}

	return repoURL
}

// Encryption key constants (for basic AES-256-GCM).
// In production, this key should be derived from a master password
// or stored in a secure keystore. This implementation provides
// a basic encryption/decryption for Maven server credentials.
const (
	encryptionKeySize = 32 // AES-256
)

// encryptValue encrypts a plaintext value using AES-256-GCM and
// returns the base64-encoded ciphertext with Maven-style prefix.
func encryptValue(plaintext string, key []byte) (string, error) {
	if len(key) != encryptionKeySize {
		return "", fmt.Errorf("encryption key must be %d bytes", encryptionKeySize)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	encoded := base64.StdEncoding.EncodeToString(ciphertext)
	return "{AES-256-GCM}" + encoded, nil
}

// decryptValue decrypts a Maven-style encrypted value.
// Returns the plaintext if decryption succeeds, or the original
// encrypted string if decryption fails (for non-encrypted values).
func decryptValue(encrypted string, key []byte) (string, error) {
	ev := parseEncryptedValue(encrypted)
	if ev.Algorithm == "" {
		// Not encrypted, return as-is
		return encrypted, nil
	}

	if ev.Algorithm != "AES-256-GCM" {
		return encrypted, fmt.Errorf("unsupported encryption algorithm: %s", ev.Algorithm)
	}

	if len(key) != encryptionKeySize {
		return encrypted, fmt.Errorf("encryption key must be %d bytes", encryptionKeySize)
	}

	ciphertext, err := base64.StdEncoding.DecodeString(ev.Encrypted)
	if err != nil {
		return encrypted, fmt.Errorf("decode base64: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return encrypted, fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return encrypted, fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return encrypted, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return encrypted, fmt.Errorf("decrypt: %w", err)
	}

	return string(plaintext), nil
}

// DecryptServerCredentials decrypts all server credentials in the settings
// using the provided key. This mutates the Settings in place and sets
// the Plaintext field on each EncryptedValue.
func (s *Settings) DecryptServerCredentials(key []byte) error {
	for i := range s.Servers {
		if s.Servers[i].Password != nil && s.Servers[i].Password.Encrypted != "" {
			plain, err := decryptValue(s.Servers[i].Password.Encrypted, key)
			if err != nil {
				return fmt.Errorf("server %s: %w", s.Servers[i].ID, err)
			}
			s.Servers[i].Password.Plaintext = plain
		}
		if s.Servers[i].Passphrase != nil && s.Servers[i].Passphrase.Encrypted != "" {
			plain, err := decryptValue(s.Servers[i].Passphrase.Encrypted, key)
			if err != nil {
				return fmt.Errorf("server %s passphrase: %w", s.Servers[i].ID, err)
			}
			s.Servers[i].Passphrase.Plaintext = plain
		}
	}
	return nil
}

// SettingsSummary returns a human-readable summary of the settings
// suitable for display in the UI.
type SettingsSummary struct {
	LocalRepo       string   `json:"localRepo"`
	MirrorCount     int      `json:"mirrorCount"`
	ServerCount     int      `json:"serverCount"`
	ProxyActive     bool     `json:"proxyActive"`
	ActiveProfileIDs []string `json:"activeProfileIds"`
}

// Summary returns a summary of the settings.
func (s *Settings) Summary() SettingsSummary {
	summary := SettingsSummary{
		LocalRepo:   s.LocalRepository,
		MirrorCount: len(s.Mirrors),
		ServerCount: len(s.Servers),
	}

	proxy := s.GetActiveProxy()
	if proxy != nil {
		summary.ProxyActive = true
	}

	for _, p := range s.GetActiveProfiles() {
		summary.ActiveProfileIDs = append(summary.ActiveProfileIDs, p.ID)
	}

	return summary
}