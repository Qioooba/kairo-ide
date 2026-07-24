package security

import (
	"encoding/json"
	"testing"
	"time"
)

// ---- OIDC: NewSSOManager ----

func TestSSO_NewSSOManager_DefaultScopes(t *testing.T) {
	cfg := OIDCConfig{
		Issuer:       "https://auth.example.com",
		ClientID:     "client-123",
		ClientSecret: "secret",
		RedirectURI:  "https://app.example.com/callback",
	}
	m := NewSSOManager(cfg)
	if m == nil {
		t.Fatal("expected non-nil SSOManager")
	}
	if len(m.cfg.Scopes) != 3 {
		t.Errorf("expected 3 default scopes, got %d", len(m.cfg.Scopes))
	}
}

func TestSSO_NewSSOManager_CustomScopes(t *testing.T) {
	cfg := OIDCConfig{
		Issuer:   "https://auth.example.com",
		ClientID: "client-123",
		Scopes:   []string{"openid", "email"},
	}
	m := NewSSOManager(cfg)
	if len(m.cfg.Scopes) != 2 {
		t.Errorf("expected 2 scopes, got %d", len(m.cfg.Scopes))
	}
}

// ---- OIDC: GetAuthorizationURL ----

func TestSSO_GetAuthorizationURL(t *testing.T) {
	cfg := OIDCConfig{
		Issuer:      "https://auth.example.com",
		ClientID:    "client-123",
		RedirectURI: "https://app.example.com/callback",
		Scopes:      []string{"openid", "profile"},
	}
	m := NewSSOManager(cfg)
	url := m.GetAuthorizationURL("state-abc")
	if url == "" {
		t.Fatal("expected non-empty authorization URL")
	}
	if !contains(url, "response_type=code") {
		t.Error("URL should contain response_type=code")
	}
	if !contains(url, "client_id=client-123") {
		t.Error("URL should contain client_id")
	}
	if !contains(url, "state=state-abc") {
		t.Error("URL should contain state")
	}
	if !contains(url, "scope=openid+profile") {
		t.Errorf("URL should contain scope, got %s", url)
	}
}

func TestSSO_GetAuthorizationURL_EmptyState(t *testing.T) {
	cfg := OIDCConfig{
		Issuer:      "https://auth.example.com",
		ClientID:    "client-123",
		RedirectURI: "https://app.example.com/callback",
	}
	m := NewSSOManager(cfg)
	url := m.GetAuthorizationURL("")
	if url == "" {
		t.Fatal("expected non-empty authorization URL even with empty state")
	}
}

// ---- OIDC: ExchangeCode ----

func TestSSO_ExchangeCode_EmptyCode(t *testing.T) {
	cfg := OIDCConfig{
		TokenEndpoint: "https://auth.example.com/token",
	}
	m := NewSSOManager(cfg)
	_, err := m.ExchangeCode("")
	if err == nil {
		t.Error("expected error for empty code")
	}
}

func TestSSO_ExchangeCode_EmptyTokenEndpoint(t *testing.T) {
	cfg := OIDCConfig{}
	m := NewSSOManager(cfg)
	_, err := m.ExchangeCode("some-code")
	if err == nil {
		t.Error("expected error for empty token endpoint")
	}
}

// ---- OIDC: GetUserInfo ----

func TestSSO_GetUserInfo_EmptyToken(t *testing.T) {
	cfg := OIDCConfig{
		UserInfoEndpoint: "https://auth.example.com/userinfo",
	}
	m := NewSSOManager(cfg)
	_, err := m.GetUserInfo("")
	if err == nil {
		t.Error("expected error for empty access token")
	}
}

func TestSSO_GetUserInfo_EmptyEndpoint(t *testing.T) {
	cfg := OIDCConfig{}
	m := NewSSOManager(cfg)
	_, err := m.GetUserInfo("token-abc")
	if err == nil {
		t.Error("expected error for empty userinfo endpoint")
	}
}

// ---- OIDC: ValidateIDToken ----

func TestSSO_ValidateIDToken_Valid(t *testing.T) {
	cfg := OIDCConfig{
		Issuer: "https://auth.example.com",
	}
	m := NewSSOManager(cfg)

	claims := OIDCClaims{
		Iss: "https://auth.example.com",
		Sub: "user-123",
		Aud: "client-123",
		Exp: time.Now().Add(1 * time.Hour).Unix(),
		Iat: time.Now().Unix(),
	}
	token := BuildJWTToken(claims)

	parsed, err := m.ValidateIDToken(token)
	if err != nil {
		t.Fatalf("expected valid token, got error: %v", err)
	}
	if parsed.Sub != "user-123" {
		t.Errorf("expected sub=user-123, got %s", parsed.Sub)
	}
}

func TestSSO_ValidateIDToken_Expired(t *testing.T) {
	cfg := OIDCConfig{
		Issuer: "https://auth.example.com",
	}
	m := NewSSOManager(cfg)

	claims := OIDCClaims{
		Iss: "https://auth.example.com",
		Sub: "user-123",
		Exp: time.Now().Add(-1 * time.Hour).Unix(),
	}
	token := BuildJWTToken(claims)

	_, err := m.ValidateIDToken(token)
	if err == nil {
		t.Error("expected error for expired token")
	}
}

func TestSSO_ValidateIDToken_NoExpiry(t *testing.T) {
	cfg := OIDCConfig{
		Issuer: "https://auth.example.com",
	}
	m := NewSSOManager(cfg)

	claims := OIDCClaims{
		Iss: "https://auth.example.com",
		Sub: "user-123",
	}
	token := BuildJWTTokenNoExp(claims)

	parsed, err := m.ValidateIDToken(token)
	if err != nil {
		t.Fatalf("expected valid token without expiry, got error: %v", err)
	}
	if parsed.Sub != "user-123" {
		t.Errorf("expected sub=user-123, got %s", parsed.Sub)
	}
}

func TestSSO_ValidateIDToken_WrongIssuer(t *testing.T) {
	cfg := OIDCConfig{
		Issuer: "https://auth.example.com",
	}
	m := NewSSOManager(cfg)

	claims := OIDCClaims{
		Iss: "https://evil.example.com",
		Sub: "user-123",
		Exp: time.Now().Add(1 * time.Hour).Unix(),
	}
	token := BuildJWTToken(claims)

	_, err := m.ValidateIDToken(token)
	if err == nil {
		t.Error("expected error for wrong issuer")
	}
}

func TestSSO_ValidateIDToken_EmptyToken(t *testing.T) {
	cfg := OIDCConfig{}
	m := NewSSOManager(cfg)
	_, err := m.ValidateIDToken("")
	if err == nil {
		t.Error("expected error for empty token")
	}
}

func TestSSO_ValidateIDToken_InvalidFormat(t *testing.T) {
	cfg := OIDCConfig{}
	m := NewSSOManager(cfg)
	_, err := m.ValidateIDToken("not.a.jwt.token.extra")
	if err == nil {
		t.Error("expected error for invalid token format")
	}
}

func TestSSO_ValidateIDToken_InvalidBase64(t *testing.T) {
	cfg := OIDCConfig{}
	m := NewSSOManager(cfg)
	_, err := m.ValidateIDToken("header.!!!invalid-base64!!!.sig")
	if err == nil {
		t.Error("expected error for invalid base64 payload")
	}
}

// ---- SAML: GenerateAuthnRequest ----

func TestSAML_GenerateAuthnRequest(t *testing.T) {
	cfg := SAMLConfig{
		EntityID: "https://app.example.com",
		SSOURL:   "https://idp.example.com/sso",
	}
	m := NewSAMLManager(cfg)
	req, relayState := m.GenerateAuthnRequest()
	if req == "" {
		t.Error("expected non-empty SAML request")
	}
	if relayState == "" {
		t.Error("expected non-empty relay state")
	}
	if len(relayState) != 32 {
		t.Errorf("expected relay state of length 32 (hex), got %d", len(relayState))
	}
}

func TestSAML_GenerateAuthnRequest_Unique(t *testing.T) {
	cfg := SAMLConfig{
		EntityID: "https://app.example.com",
		SSOURL:   "https://idp.example.com/sso",
	}
	m := NewSAMLManager(cfg)
	req1, state1 := m.GenerateAuthnRequest()
	req2, state2 := m.GenerateAuthnRequest()
	if req1 == req2 {
		t.Error("expected unique SAML requests")
	}
	if state1 == state2 {
		t.Error("expected unique relay states")
	}
}

// ---- SAML: ValidateSAMLResponse ----

func TestSAML_ValidateSAMLResponse_Valid(t *testing.T) {
	cfg := SAMLConfig{
		EntityID: "https://app.example.com",
	}
	m := NewSAMLManager(cfg)

	encoded, err := BuildSAMLResponseXML("user-123", map[string]string{
		"email": "user@example.com",
	})
	if err != nil {
		t.Fatalf("failed to build SAML response: %v", err)
	}

	assertion, err := m.ValidateSAMLResponse(encoded)
	if err != nil {
		t.Fatalf("expected valid SAML response, got error: %v", err)
	}
	if assertion.NameID != "user-123" {
		t.Errorf("expected NameID=user-123, got %s", assertion.NameID)
	}
	if assertion.Attributes["email"] != "user@example.com" {
		t.Errorf("expected email attribute, got %v", assertion.Attributes)
	}
}

func TestSAML_ValidateSAMLResponse_EmptyResponse(t *testing.T) {
	cfg := SAMLConfig{}
	m := NewSAMLManager(cfg)
	_, err := m.ValidateSAMLResponse("")
	if err == nil {
		t.Error("expected error for empty SAML response")
	}
}

func TestSAML_ValidateSAMLResponse_InvalidBase64(t *testing.T) {
	cfg := SAMLConfig{}
	m := NewSAMLManager(cfg)
	_, err := m.ValidateSAMLResponse("!!!not-valid-base64!!!")
	if err == nil {
		t.Error("expected error for invalid base64")
	}
}

func TestSAML_ValidateSAMLResponse_InvalidXML(t *testing.T) {
	cfg := SAMLConfig{}
	m := NewSAMLManager(cfg)
	encoded := "aW52YWxpZC14bWw=" // "invalid-xml" in base64
	_, err := m.ValidateSAMLResponse(encoded)
	if err == nil {
		t.Error("expected error for invalid XML")
	}
}

// ---- Helper: BuildJWTToken round-trip ----

func TestSSO_BuildJWTToken_RoundTrip(t *testing.T) {
	claims := OIDCClaims{
		Iss:    "https://auth.example.com",
		Sub:    "user-456",
		Aud:    "client-456",
		Exp:    time.Now().Add(1 * time.Hour).Unix(),
		Iat:    time.Now().Unix(),
		Name:   "Test User",
		Email:  "test@example.com",
		Groups: []string{"developers", "admins"},
	}
	token := BuildJWTToken(claims)

	cfg := OIDCConfig{Issuer: "https://auth.example.com"}
	m := NewSSOManager(cfg)
	parsed, err := m.ValidateIDToken(token)
	if err != nil {
		t.Fatalf("expected valid token, got error: %v", err)
	}
	if parsed.Sub != "user-456" {
		t.Errorf("expected sub=user-456, got %s", parsed.Sub)
	}
	if parsed.Name != "Test User" {
		t.Errorf("expected name='Test User', got %s", parsed.Name)
	}
	if parsed.Email != "test@example.com" {
		t.Errorf("expected email='test@example.com', got %s", parsed.Email)
	}
	if len(parsed.Groups) != 2 {
		t.Errorf("expected 2 groups, got %d", len(parsed.Groups))
	}
}

// ---- OIDCClaims JSON serialization ----

func TestSSO_OIDCClaims_JSON(t *testing.T) {
	claims := OIDCClaims{
		Iss:    "https://issuer.example.com",
		Sub:    "subject-1",
		Aud:    "audience-1",
		Exp:    time.Now().Unix(),
		Iat:    time.Now().Unix(),
		Name:   "Test",
		Email:  "test@test.com",
		Groups: []string{"g1"},
	}
	data, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var parsed OIDCClaims
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed.Sub != claims.Sub {
		t.Errorf("expected sub=%s, got %s", claims.Sub, parsed.Sub)
	}
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}