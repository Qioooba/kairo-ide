package pathpolicy

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	idSize    = 16
	wsPrefix  = "ws_"
	prjPrefix = "prj_"
	bldPrefix = "bld_"
	srvPrefix = "srv_"
	rtmPrefix = "rtm_"
)

var encoding = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)

var (
	volumePattern = regexp.MustCompile(`^[A-Za-z]:[\\/]`)
	uncPattern    = regexp.MustCompile(`^[/\\]{2}`)
)

type IDGenerator interface {
	NewWorkspaceID() (string, error)
	NewProjectID() (string, error)
	NewBuildID() (string, error)
	NewServerID() (string, error)
	NewRuntimeID() (string, error)
}

type CryptoIDGenerator struct{}

func NewCryptoIDGenerator() *CryptoIDGenerator {
	return &CryptoIDGenerator{}
}

func (g *CryptoIDGenerator) NewWorkspaceID() (string, error) {
	return generatePrefixedID(wsPrefix)
}

func (g *CryptoIDGenerator) NewProjectID() (string, error) {
	return generatePrefixedID(prjPrefix)
}

func (g *CryptoIDGenerator) NewBuildID() (string, error) {
	return generatePrefixedID(bldPrefix)
}

func (g *CryptoIDGenerator) NewServerID() (string, error) {
	return generatePrefixedID(srvPrefix)
}

func (g *CryptoIDGenerator) NewRuntimeID() (string, error) {
	return generatePrefixedID(rtmPrefix)
}

func generatePrefixedID(prefix string) (string, error) {
	var b [idSize]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate random id: %w", err)
	}
	return prefix + encoding.EncodeToString(b[:]), nil
}

func ValidateWorkspaceID(id string) error {
	return validatePrefixedID(id, wsPrefix, "workspace")
}

func ValidateProjectID(id string) error {
	return validatePrefixedID(id, prjPrefix, "project")
}

func ValidateBuildID(id string) error {
	return validatePrefixedID(id, bldPrefix, "build")
}

func ValidateServerID(id string) error {
	return validatePrefixedID(id, srvPrefix, "server")
}

func ValidateRuntimeID(id string) error {
	return validatePrefixedID(id, rtmPrefix, "runtime")
}

// IsBuiltinRuntimeID checks if the runtime ID is a builtin identifier (e.g. "tomcat6")
// rather than a generated crypto ID.
func IsBuiltinRuntimeID(id string) bool {
	switch id {
	case "tomcat6", "tomcat7", "tomcat8", "tomcat9", "tomcat10":
		return true
	default:
		return false
	}
}

func validatePrefixedID(id, prefix, kind string) error {
	if id == "" {
		return fmt.Errorf("%s id is empty", kind)
	}

	if !utf8.ValidString(id) {
		return fmt.Errorf("%s id %q contains invalid UTF-8", kind, id)
	}

	if strings.HasPrefix(id, "/") || strings.HasPrefix(id, `\`) {
		return fmt.Errorf("%s id %q is absolute path", kind, id)
	}

	if volumePattern.MatchString(id) {
		return fmt.Errorf("%s id %q contains Windows volume prefix", kind, id)
	}

	if uncPattern.MatchString(id) {
		return fmt.Errorf("%s id %q contains UNC path prefix", kind, id)
	}

	if !strings.HasPrefix(id, prefix) {
		return fmt.Errorf("%s id %q must start with %q", kind, id, prefix)
	}

	suffix := id[len(prefix):]
	expectedLen := encoding.EncodedLen(idSize)
	if len(suffix) != expectedLen {
		return fmt.Errorf("%s id %q suffix has wrong length (expected %d, got %d)", kind, id, expectedLen, len(suffix))
	}

	if strings.Contains(id, "..") {
		return fmt.Errorf("%s id %q contains path traversal", kind, id)
	}

	if strings.ContainsAny(id, `/\:`) {
		return fmt.Errorf("%s id %q contains invalid characters (separators/colon)", kind, id)
	}

	for _, r := range suffix {
		if !isValidBase32Char(r) {
			return fmt.Errorf("%s id %q contains invalid character %q", kind, id, r)
		}
	}

	if _, err := encoding.DecodeString(suffix); err != nil {
		return fmt.Errorf("%s id %q has invalid base32 suffix: %w", kind, id, err)
	}

	return nil
}

func isValidBase32Char(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= '2' && r <= '7')
}
