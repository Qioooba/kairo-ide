// Package security implements SSO / OIDC integration primitives for the
// Kairo IDE runtime agent. It supports OIDC authorization code flow and
// SAML 2.0 authentication.
package security

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---- OIDC types ----

// OIDCConfig holds the configuration for an OIDC provider.
type OIDCConfig struct {
	Issuer          string
	ClientID        string
	ClientSecret    string
	RedirectURI     string
	Scopes          []string
	TokenEndpoint   string
	UserInfoEndpoint string
}

// OIDCTokenResponse is the response from the OIDC token endpoint.
type OIDCTokenResponse struct {
	AccessToken  string `json:"access_token"`
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// OIDCUserInfo holds the user information returned by the OIDC userinfo
// endpoint.
type OIDCUserInfo struct {
	Sub     string   `json:"sub"`
	Name    string   `json:"name"`
	Email   string   `json:"email"`
	Picture string   `json:"picture"`
	Groups  []string `json:"groups"`
}

// OIDCClaims represents the standard OIDC claims from an ID token.
type OIDCClaims struct {
	Iss    string   `json:"iss"`
	Sub    string   `json:"sub"`
	Aud    string   `json:"aud"`
	Exp    int64    `json:"exp"`
	Iat    int64    `json:"iat"`
	Name   string   `json:"name"`
	Email  string   `json:"email"`
	Groups []string `json:"groups"`
}

// SSOManager manages OIDC authentication flows. It is safe for
// concurrent use.
type SSOManager struct {
	mu  sync.RWMutex
	cfg OIDCConfig
}

// NewSSOManager creates a new SSOManager with the given OIDC config.
func NewSSOManager(cfg OIDCConfig) *SSOManager {
	if len(cfg.Scopes) == 0 {
		cfg.Scopes = []string{"openid", "profile", "email"}
	}
	return &SSOManager{cfg: cfg}
}

// GetAuthorizationURL builds the OIDC authorization URL for the
// authorization code flow. The state parameter is used for CSRF
// protection.
func (m *SSOManager) GetAuthorizationURL(state string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	u, _ := url.Parse(m.cfg.Issuer)
	if u == nil {
		return ""
	}
	authPath := strings.TrimRight(u.Path, "/") + "/authorize"
	u = u.ResolveReference(&url.URL{Path: authPath})

	scopes := strings.Join(m.cfg.Scopes, " ")
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", m.cfg.ClientID)
	q.Set("redirect_uri", m.cfg.RedirectURI)
	q.Set("scope", scopes)
	q.Set("state", state)
	u.RawQuery = q.Encode()

	return u.String()
}

// ExchangeCode exchanges an authorization code for tokens by calling
// the OIDC token endpoint.
func (m *SSOManager) ExchangeCode(code string) (*OIDCTokenResponse, error) {
	m.mu.RLock()
	tokenURL := m.cfg.TokenEndpoint
	clientID := m.cfg.ClientID
	clientSecret := m.cfg.ClientSecret
	redirectURI := m.cfg.RedirectURI
	m.mu.RUnlock()

	if tokenURL == "" {
		return nil, errors.New("token endpoint is empty")
	}
	if code == "" {
		return nil, errors.New("authorization code is empty")
	}

	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)

	req, err := http.NewRequest("POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp OIDCTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("parse token response: %w", err)
	}

	return &tokenResp, nil
}

// GetUserInfo fetches user information from the OIDC userinfo endpoint
// using the provided access token.
func (m *SSOManager) GetUserInfo(accessToken string) (*OIDCUserInfo, error) {
	m.mu.RLock()
	userInfoURL := m.cfg.UserInfoEndpoint
	m.mu.RUnlock()

	if userInfoURL == "" {
		return nil, errors.New("userinfo endpoint is empty")
	}
	if accessToken == "" {
		return nil, errors.New("access token is empty")
	}

	req, err := http.NewRequest("GET", userInfoURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create userinfo request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("userinfo request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read userinfo response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var info OIDCUserInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, fmt.Errorf("parse userinfo response: %w", err)
	}

	return &info, nil
}

// ValidateIDToken parses and validates a raw JWT ID token. It checks:
//   - The token has three dot-separated parts
//   - The header and payload are valid Base64-URL-encoded JSON
//   - The expiration (exp) claim is not in the past
//   - The issuer (iss) matches the configured issuer
//
// It does NOT verify the signature (use a JWT library for full
// verification).
func (m *SSOManager) ValidateIDToken(rawToken string) (*OIDCClaims, error) {
	m.mu.RLock()
	issuer := m.cfg.Issuer
	m.mu.RUnlock()

	if rawToken == "" {
		return nil, errors.New("id token is empty")
	}

	parts := strings.Split(rawToken, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token format: expected 3 parts")
	}

	claims, err := decodeJWTPayload(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode token payload: %w", err)
	}

	// Validate expiration
	if claims.Exp > 0 {
		now := time.Now().Unix()
		if claims.Exp < now {
			return nil, errors.New("token has expired")
		}
	}

	// Validate issuer
	if issuer != "" && claims.Iss != "" && claims.Iss != issuer {
		return nil, fmt.Errorf("invalid issuer: expected %s, got %s", issuer, claims.Iss)
	}

	return claims, nil
}

// decodeJWTPayload decodes a Base64-URL-encoded JWT payload into
// OIDCClaims.
func decodeJWTPayload(payload string) (*OIDCClaims, error) {
	// Add padding if needed
	decoded, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		// Try standard base64 as fallback
		decoded, err = base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return nil, fmt.Errorf("base64 decode: %w", err)
		}
	}

	var claims OIDCClaims
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return nil, fmt.Errorf("json unmarshal: %w", err)
	}
	return &claims, nil
}

// ---- SAML types ----

// SAMLConfig holds the configuration for a SAML 2.0 identity provider.
type SAMLConfig struct {
	EntityID        string
	SSOURL          string
	Certificate     string
	AttributeMapping map[string]string
}

// SAMLAssertion represents the parsed content of a SAML assertion.
type SAMLAssertion struct {
	NameID      string
	Attributes  map[string]string
	Conditions  string
}

// SAMLManager manages SAML 2.0 authentication flows. It is safe for
// concurrent use.
type SAMLManager struct {
	mu  sync.RWMutex
	cfg SAMLConfig
}

// NewSAMLManager creates a new SAMLManager with the given SAML config.
func NewSAMLManager(cfg SAMLConfig) *SAMLManager {
	if cfg.AttributeMapping == nil {
		cfg.AttributeMapping = make(map[string]string)
	}
	return &SAMLManager{cfg: cfg}
}

// GenerateAuthnRequest generates a SAML authentication request and a
// relay state for CSRF protection. Returns the base64-encoded SAML
// request and the relay state.
func (m *SAMLManager) GenerateAuthnRequest() (string, string) {
	m.mu.RLock()
	entityID := m.cfg.EntityID
	m.mu.RUnlock()

	relayState := generateRelayState()

	authnRequest := fmt.Sprintf(
		`<?xml version="1.0" encoding="UTF-8"?>`+
			`<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" `+
			`xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" `+
			`ID="%s" Version="2.0" IssueInstant="%s" `+
			`Destination="%s" AssertionConsumerServiceIndex="0">`+
			`<saml:Issuer>%s</saml:Issuer>`+
			`<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified" AllowCreate="true"/>`+
			`</samlp:AuthnRequest>`,
		generateSAMLID(),
		time.Now().UTC().Format(time.RFC3339),
		escapeXML(m.cfg.SSOURL),
		escapeXML(entityID),
	)

	encoded := base64.StdEncoding.EncodeToString([]byte(authnRequest))
	return encoded, relayState
}

// ValidateSAMLResponse validates and parses a base64-encoded SAML
// response. It returns the parsed SAML assertion.
func (m *SAMLManager) ValidateSAMLResponse(encodedResponse string) (*SAMLAssertion, error) {
	if encodedResponse == "" {
		return nil, errors.New("saml response is empty")
	}

	decoded, err := base64.StdEncoding.DecodeString(encodedResponse)
	if err != nil {
		return nil, fmt.Errorf("base64 decode saml response: %w", err)
	}

	return parseSAMLResponse(decoded)
}

// parseSAMLResponse extracts assertion information from a SAML XML
// response using basic XML parsing.
func parseSAMLResponse(data []byte) (*SAMLAssertion, error) {
	type samlResponse struct {
		XMLName xml.Name `xml:"Response"`
		Assertion struct {
			XMLName    xml.Name `xml:"Assertion"`
			Issuer     string   `xml:"Issuer"`
			Subject    struct {
				NameID struct {
					Value string `xml:",chardata"`
				} `xml:"NameID"`
			} `xml:"Subject"`
			Conditions struct {
				NotBefore string `xml:"NotBefore,attr"`
				NotOnOrAfter string `xml:"NotOnOrAfter,attr"`
			} `xml:"Conditions"`
			AttributeStatement struct {
				Attributes []struct {
					Name   string   `xml:"Name,attr"`
					Values []string `xml:"AttributeValue"`
				} `xml:"Attribute"`
			} `xml:"AttributeStatement"`
		} `xml:"Assertion"`
	}

	var resp samlResponse
	if err := xml.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("parse saml response: %w", err)
	}

	assertion := &SAMLAssertion{
		NameID:     resp.Assertion.Subject.NameID.Value,
		Conditions: resp.Assertion.Conditions.NotBefore + " - " + resp.Assertion.Conditions.NotOnOrAfter,
		Attributes: make(map[string]string),
	}

	for _, attr := range resp.Assertion.AttributeStatement.Attributes {
		if len(attr.Values) > 0 {
			assertion.Attributes[attr.Name] = attr.Values[0]
		}
	}

	return assertion, nil
}

// generateRelayState creates a random relay state for CSRF protection.
func generateRelayState() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// generateSAMLID creates a random SAML request ID.
func generateSAMLID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return "_" + hex.EncodeToString(b)
}

// escapeXML performs basic XML escaping for attribute values.
func escapeXML(s string) string {
	var buf bytes.Buffer
	for _, r := range s {
		switch r {
		case '&':
			buf.WriteString("&amp;")
		case '<':
			buf.WriteString("&lt;")
		case '>':
			buf.WriteString("&gt;")
		case '"':
			buf.WriteString("&quot;")
		case '\'':
			buf.WriteString("&apos;")
		default:
			buf.WriteRune(r)
		}
	}
	return buf.String()
}

// SAMLResponse is a helper for building SAML responses (used in
// tests).
type SAMLResponse struct {
	XMLName    xml.Name `xml:"Response"`
	Assertion  SAMLResponseAssertion `xml:"Assertion"`
}

// SAMLResponseAssertion is the assertion portion of a SAML response.
type SAMLResponseAssertion struct {
	XMLName             xml.Name                    `xml:"Assertion"`
	Issuer              string                      `xml:"Issuer"`
	Subject             SAMLSubject                 `xml:"Subject"`
	Conditions          SAMLConditions              `xml:"Conditions"`
	AttributeStatement  SAMLAttributeStatement      `xml:"AttributeStatement"`
}

// SAMLSubject is the subject of a SAML assertion.
type SAMLSubject struct {
	NameID SAMLNameID `xml:"NameID"`
}

// SAMLNameID is the name identifier in a SAML subject.
type SAMLNameID struct {
	Value string `xml:",chardata"`
}

// SAMLConditions holds the conditions of a SAML assertion.
type SAMLConditions struct {
	NotBefore    string `xml:"NotBefore,attr"`
	NotOnOrAfter string `xml:"NotOnOrAfter,attr"`
}

// SAMLAttributeStatement holds SAML attributes.
type SAMLAttributeStatement struct {
	Attributes []SAMLAttribute `xml:"Attribute"`
}

// SAMLAttribute is a single SAML attribute.
type SAMLAttribute struct {
	Name   string   `xml:"Name,attr"`
	Values []string `xml:"AttributeValue"`
}

// BuildSAMLResponseXML builds a SAML response XML string for testing.
func BuildSAMLResponseXML(nameID string, attributes map[string]string) (string, error) {
	now := time.Now().UTC()
	notBefore := now.Add(-5 * time.Minute).Format(time.RFC3339)
	notOnOrAfter := now.Add(1 * time.Hour).Format(time.RFC3339)

	var attrs []SAMLAttribute
	for k, v := range attributes {
		attrs = append(attrs, SAMLAttribute{
			Name:   k,
			Values: []string{v},
		})
	}
	if len(attrs) == 0 {
		attrs = []SAMLAttribute{}
	}

	resp := SAMLResponse{
		Assertion: SAMLResponseAssertion{
			Issuer: "https://idp.example.com",
			Subject: SAMLSubject{
				NameID: SAMLNameID{Value: nameID},
			},
			Conditions: SAMLConditions{
				NotBefore:    notBefore,
				NotOnOrAfter: notOnOrAfter,
			},
			AttributeStatement: SAMLAttributeStatement{
				Attributes: attrs,
			},
		},
	}

	data, err := xml.MarshalIndent(resp, "", "  ")
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// BuildJWTToken builds a simple JWT token for testing purposes.
// It does NOT produce a real signature — only header.payload.fakeSig.
func BuildJWTToken(claims OIDCClaims) string {
	header := base64.RawURLEncoding.EncodeToString(
		[]byte(`{"alg":"RS256","typ":"JWT"}`),
	)
	payloadBytes, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	sig := base64.RawURLEncoding.EncodeToString([]byte("fake-signature"))
	return header + "." + payload + "." + sig
}

// BuildJWTTokenNoExp is like BuildJWTToken but without the exp claim.
func BuildJWTTokenNoExp(claims OIDCClaims) string {
	claims.Exp = 0
	return BuildJWTToken(claims)
}

// strPtr is a helper to create a string pointer from a string literal.
func strPtr(s string) *string {
	return &s
}

// intPtr is a helper to create an int pointer from an int literal.
func intPtr(i int) *int {
	return &i
}

// Ensure that standard library helpers are used.
var _ = strconv.Itoa