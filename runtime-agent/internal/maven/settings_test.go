package maven

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseSettings_NoFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nonexistent-settings.xml")
	s, err := ParseSettings(path)
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	if s == nil {
		t.Fatal("expected non-nil settings")
	}
	if s.LocalRepository == "" {
		t.Error("expected default local repository")
	}
}

func TestParseSettings_Valid(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.xml")
	content := `<?xml version="1.0" encoding="UTF-8"?>
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0">
  <localRepository>/custom/repo</localRepository>
  <mirrors>
    <mirror>
      <id>central-mirror</id>
      <name>Internal Mirror</name>
      <url>https://nexus.internal/repository/maven-public/</url>
      <mirrorOf>*</mirrorOf>
    </mirror>
  </mirrors>
  <servers>
    <server>
      <id>nexus-releases</id>
      <username>deployer</username>
      <password>{AES-256-GCM}encrypteddata</password>
    </server>
  </servers>
  <proxies>
    <proxy>
      <id>corp-proxy</id>
      <active>true</active>
      <protocol>http</protocol>
      <host>proxy.corp.com</host>
      <port>8080</port>
      <nonProxyHosts>localhost|*.internal.com</nonProxyHosts>
    </proxy>
  </proxies>
  <activeProfiles>
    <activeProfile>default</activeProfile>
  </activeProfiles>
  <profiles>
    <profile>
      <id>default</id>
      <activation>
        <activeByDefault>true</activeByDefault>
      </activation>
      <repositories>
        <repository>
          <id>internal</id>
          <name>Internal Repository</name>
          <url>https://nexus.internal/repository/maven-public/</url>
        </repository>
      </repositories>
    </profile>
  </profiles>
</settings>`
	os.WriteFile(settingsPath, []byte(content), 0o644)

	s, err := ParseSettings(settingsPath)
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}

	if s.LocalRepository != "/custom/repo" {
		t.Errorf("LocalRepository = %q, want /custom/repo", s.LocalRepository)
	}

	if len(s.Mirrors) != 1 {
		t.Fatalf("expected 1 mirror, got %d", len(s.Mirrors))
	}
	if s.Mirrors[0].ID != "central-mirror" {
		t.Errorf("mirror ID = %q", s.Mirrors[0].ID)
	}
	if s.Mirrors[0].URL != "https://nexus.internal/repository/maven-public/" {
		t.Errorf("mirror URL = %q", s.Mirrors[0].URL)
	}

	if len(s.Servers) != 1 {
		t.Fatalf("expected 1 server, got %d", len(s.Servers))
	}
	if s.Servers[0].ID != "nexus-releases" {
		t.Errorf("server ID = %q", s.Servers[0].ID)
	}
	if s.Servers[0].Username != "deployer" {
		t.Errorf("server username = %q", s.Servers[0].Username)
	}
	if s.Servers[0].Password == nil {
		t.Fatal("expected password")
	}
	if s.Servers[0].Password.Algorithm != "AES-256-GCM" {
		t.Errorf("password algorithm = %q", s.Servers[0].Password.Algorithm)
	}

	if len(s.Proxies) != 1 {
		t.Fatalf("expected 1 proxy, got %d", len(s.Proxies))
	}
	if s.Proxies[0].Host != "proxy.corp.com" {
		t.Errorf("proxy host = %q", s.Proxies[0].Host)
	}
	if s.Proxies[0].Port != 8080 {
		t.Errorf("proxy port = %d", s.Proxies[0].Port)
	}

	if len(s.Profiles) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(s.Profiles))
	}

	if len(s.ActiveProfiles) != 1 {
		t.Fatalf("expected 1 active profile, got %d", len(s.ActiveProfiles))
	}
}

func TestParseSettings_Minimal(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.xml")
	content := `<?xml version="1.0" encoding="UTF-8"?>
<settings>
</settings>`
	os.WriteFile(settingsPath, []byte(content), 0o644)

	s, err := ParseSettings(settingsPath)
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	if s == nil {
		t.Fatal("expected non-nil settings")
	}
	if s.LocalRepository == "" {
		t.Error("expected default local repository")
	}
}

func TestParseSettings_InvalidXml(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.xml")
	os.WriteFile(settingsPath, []byte("not xml"), 0o644)

	_, err := ParseSettings(settingsPath)
	if err == nil {
		t.Fatal("expected error for invalid XML")
	}
}

func TestGetMirrorFor(t *testing.T) {
	s := &Settings{
		Mirrors: []Mirror{
			{ID: "all", URL: "https://mirror.internal/", MirrorOf: "*"},
			{ID: "external", URL: "https://mirror.external/", MirrorOf: "external:*"},
		},
	}

	m := s.GetMirrorFor("https://repo.maven.apache.org/maven2")
	if m == nil {
		t.Fatal("expected mirror for wildcard")
	}
	if m.ID != "all" {
		t.Errorf("mirror ID = %q, want all", m.ID)
	}
}

func TestGetMirrorFor_External(t *testing.T) {
	s := &Settings{
		Mirrors: []Mirror{
			{ID: "external", URL: "https://mirror.external/", MirrorOf: "external:*"},
		},
	}

	m := s.GetMirrorFor("https://repo.maven.apache.org/maven2")
	if m == nil {
		t.Fatal("expected mirror for external repo")
	}
	if m.ID != "external" {
		t.Errorf("mirror ID = %q, want external", m.ID)
	}

	m = s.GetMirrorFor("http://localhost:8081/repo")
	if m != nil {
		t.Error("expected no mirror for localhost with external:*")
	}
}

func TestGetMirrorFor_None(t *testing.T) {
	s := &Settings{}
	m := s.GetMirrorFor("https://repo.maven.apache.org/maven2")
	if m != nil {
		t.Error("expected nil for no mirrors")
	}
}

func TestGetServer(t *testing.T) {
	s := &Settings{
		Servers: []Server{
			{ID: "nexus", Username: "user1"},
			{ID: "artifactory", Username: "user2"},
		},
	}

	sv := s.GetServer("nexus")
	if sv == nil {
		t.Fatal("expected server")
	}
	if sv.Username != "user1" {
		t.Errorf("username = %q, want user1", sv.Username)
	}

	sv = s.GetServer("nonexistent")
	if sv != nil {
		t.Error("expected nil for nonexistent server")
	}
}

func TestGetActiveProxy(t *testing.T) {
	s := &Settings{
		Proxies: []Proxy{
			{ID: "inactive", Active: false, Host: "proxy1"},
			{ID: "active", Active: true, Host: "proxy2"},
		},
	}

	p := s.GetActiveProxy()
	if p == nil {
		t.Fatal("expected active proxy")
	}
	if p.ID != "active" {
		t.Errorf("proxy ID = %q, want active", p.ID)
	}

	s2 := &Settings{}
	p = s2.GetActiveProxy()
	if p != nil {
		t.Error("expected nil for no active proxy")
	}
}

func TestSettings_GetActiveProfiles(t *testing.T) {
	s := &Settings{
		ActiveProfiles: []string{"dev"},
		Profiles: []SettingsProfile{
			{ID: "dev"},
			{ID: "prod"},
			{ID: "default", Activation: ProfileActivation{ActiveByDefault: true}},
		},
	}

	active := s.GetActiveProfiles()
	if len(active) != 2 {
		t.Fatalf("expected 2 active profiles, got %d", len(active))
	}
	ids := make(map[string]bool)
	for _, p := range active {
		ids[p.ID] = true
	}
	if !ids["dev"] {
		t.Error("expected dev profile")
	}
	if !ids["default"] {
		t.Error("expected default profile")
	}
}

func TestResolveRepositoryURL(t *testing.T) {
	s := &Settings{
		Mirrors: []Mirror{
			{ID: "mirror", URL: "https://mirror.internal/", MirrorOf: "*"},
		},
	}

	url := s.ResolveRepositoryURL("central", "https://repo.maven.apache.org/maven2")
	if url != "https://mirror.internal/" {
		t.Errorf("URL = %q, want https://mirror.internal/", url)
	}
}

func TestResolveRepositoryURL_NoMirror(t *testing.T) {
	s := &Settings{}

	url := s.ResolveRepositoryURL("central", "https://repo.maven.apache.org/maven2")
	if url != "https://repo.maven.apache.org/maven2" {
		t.Errorf("URL = %q, want original", url)
	}
}

func TestEncryptDecryptValue(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	plaintext := "my-secret-password"
	encrypted, err := encryptValue(plaintext, key)
	if err != nil {
		t.Fatalf("encryptValue: %v", err)
	}
	if encrypted == plaintext {
		t.Error("encrypted should differ from plaintext")
	}

	decrypted, err := decryptValue(encrypted, key)
	if err != nil {
		t.Fatalf("decryptValue: %v", err)
	}
	if decrypted != plaintext {
		t.Errorf("decrypted = %q, want %q", decrypted, plaintext)
	}
}

func TestDecryptValue_Plaintext(t *testing.T) {
	key := make([]byte, 32)
	plain := "plaintext-value"
	result, err := decryptValue(plain, key)
	if err != nil {
		t.Fatalf("decryptValue: %v", err)
	}
	if result != plain {
		t.Errorf("result = %q, want %q", result, plain)
	}
}

func TestEncryptValue_InvalidKeySize(t *testing.T) {
	_, err := encryptValue("test", make([]byte, 16))
	if err == nil {
		t.Fatal("expected error for invalid key size")
	}
}

func TestDecryptValue_InvalidKeySize(t *testing.T) {
	_, err := decryptValue("{AES-256-GCM}data", make([]byte, 16))
	if err == nil {
		t.Fatal("expected error for invalid key size")
	}
}

func TestDecryptServerCredentials(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	encPassword, _ := encryptValue("secret123", key)
	encPassphrase, _ := encryptValue("pass456", key)

	s := &Settings{
		Servers: []Server{
			{
				ID:       "test-server",
				Username: "user",
				Password: &EncryptedValue{Encrypted: encPassword},
				Passphrase: &EncryptedValue{Encrypted: encPassphrase},
			},
		},
	}

	err := s.DecryptServerCredentials(key)
	if err != nil {
		t.Fatalf("DecryptServerCredentials: %v", err)
	}

	if s.Servers[0].Password.Plaintext != "secret123" {
		t.Errorf("password plaintext = %q, want secret123", s.Servers[0].Password.Plaintext)
	}
	if s.Servers[0].Passphrase.Plaintext != "pass456" {
		t.Errorf("passphrase plaintext = %q, want pass456", s.Servers[0].Passphrase.Plaintext)
	}
}

func TestSettingsSummary(t *testing.T) {
	s := &Settings{
		LocalRepository: "/custom/repo",
		Mirrors:         []Mirror{{ID: "m1", URL: "http://m1", MirrorOf: "*"}},
		Servers:         []Server{{ID: "s1"}, {ID: "s2"}},
		Proxies:         []Proxy{{ID: "p1", Active: true, Host: "proxy"}},
		ActiveProfiles:  []string{"dev"},
		Profiles: []SettingsProfile{
			{ID: "dev", Activation: ProfileActivation{ActiveByDefault: true}},
		},
	}

	summary := s.Summary()
	if summary.LocalRepo != "/custom/repo" {
		t.Errorf("LocalRepo = %q", summary.LocalRepo)
	}
	if summary.MirrorCount != 1 {
		t.Errorf("MirrorCount = %d", summary.MirrorCount)
	}
	if summary.ServerCount != 2 {
		t.Errorf("ServerCount = %d", summary.ServerCount)
	}
	if !summary.ProxyActive {
		t.Error("expected ProxyActive=true")
	}
	if len(summary.ActiveProfileIDs) != 1 {
		t.Errorf("expected 1 active profile ID, got %d", len(summary.ActiveProfileIDs))
	}
}

func TestParseEncryptedValue(t *testing.T) {
	ev := parseEncryptedValue("{AES-256-GCM}base64data")
	if ev.Algorithm != "AES-256-GCM" {
		t.Errorf("Algorithm = %q", ev.Algorithm)
	}
	if ev.Encrypted != "base64data" {
		t.Errorf("Encrypted = %q", ev.Encrypted)
	}

	// Plain value
	ev = parseEncryptedValue("plaintext")
	if ev.Algorithm != "" {
		t.Errorf("Algorithm = %q, want empty", ev.Algorithm)
	}
	if ev.Encrypted != "plaintext" {
		t.Errorf("Encrypted = %q", ev.Encrypted)
	}
}

func TestMatchesMirrorOf(t *testing.T) {
	if !matchesMirrorOf("*", "https://any.repo.com") {
		t.Error("wildcard should match anything")
	}
	if !matchesMirrorOf("external:*", "https://repo.maven.apache.org") {
		t.Error("external:* should match external repos")
	}
	if matchesMirrorOf("external:*", "http://localhost:8081/repo") {
		t.Error("external:* should not match localhost")
	}
	if matchesMirrorOf("external:*", "http://127.0.0.1:8081/repo") {
		t.Error("external:* should not match 127.0.0.1")
	}
}

func TestDefaultSettingsPath(t *testing.T) {
	path := DefaultSettingsPath()
	if path == "" {
		t.Error("expected non-empty default settings path")
	}
	// Should end with .m2/settings.xml
	if filepath.Base(path) != "settings.xml" {
		t.Errorf("expected settings.xml, got %q", filepath.Base(path))
	}
}

func TestDefaultLocalRepo(t *testing.T) {
	repo := defaultLocalRepo()
	if repo == "" {
		t.Error("expected non-empty default local repo")
	}
	if filepath.Base(repo) != "repository" {
		t.Errorf("expected repository, got %q", filepath.Base(repo))
	}
}