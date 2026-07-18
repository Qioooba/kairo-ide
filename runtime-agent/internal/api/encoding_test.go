package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/kairo-ide/runtime-agent/internal/api"
	"github.com/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/kairo-ide/runtime-agent/internal/audit"
	"github.com/kairo-ide/runtime-agent/internal/log"
	"github.com/kairo-ide/runtime-agent/internal/services"
	"github.com/kairo-ide/runtime-agent/internal/security"
)

// newEncodingTestServer wires a real Services (with the
// production memEncoder) so the encoding tests exercise the
// real Detect path — not a mock. /api/v1/encoding/recode is
// also real.
func newEncodingTestServer(t *testing.T) (*api.Server, string) {
	t.Helper()
	dataDir := t.TempDir()
	auditLog, err := audit.New(filepath.Join(dataDir, "audit.log"))
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	logger := log.New("test").WithLevel(log.LevelWarn)
	sandbox, err := security.NewWorkspaceRoots(dataDir)
	if err != nil {
		t.Fatalf("sandbox: %v", err)
	}
	svcs := services.NewMemoryServices(services.Config{
		DataDir: dataDir,
		// No Tomcat 6 — not needed for encoding tests.
		Logger: logger,
	}, sandbox)
	srv := api.NewServer(svcs, logger, auditLog, "test-0.1.0")
	return srv, dataDir
}

func writeFile(t *testing.T, dir, name string, bytes_ []byte) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(p, bytes_, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	return p
}

func detectFile(t *testing.T, srv *api.Server, file string) (int, map[string]any) {
	t.Helper()
	body := mustEncode(t, map[string]any{"file": file})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	var j map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &j)
	if envv, ok := j["payload"].(map[string]any); ok {
		return rr.Code, envv
	}
	return rr.Code, j
}

func recodeFile(t *testing.T, srv *api.Server, file, from, to string) (int, map[string]any) {
	t.Helper()
	body := mustEncode(t, map[string]any{
		"file": file,
		"from": from,
		"to":   to,
	})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/recode", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	var j map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &j)
	if envv, ok := j["payload"].(map[string]any); ok {
		return rr.Code, envv
	}
	return rr.Code, j
}

func mustEncode(t *testing.T, payload map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	// Match the wire shape: { "requestId": "...", "payload": {...} }.
	return []byte(`{"requestId":"` + protocol.RequestEnvelope{}.RequestID + `","workspaceId":"ws_test","payload":` + string(raw) + `}`)
}

func TestEncoding_Detect_GBK_HelloJsp(t *testing.T) {
	srv, dir := newEncodingTestServer(t)
	// "你好" in GBK: 0xC4 0xE3 0xBA 0xC3
	body := []byte{0x3C, 0x25, 0x40, 0x20, 0x70, 0x61, 0x67, 0x65, 0x20,
		0x63, 0x6F, 0x6E, 0x74, 0x65, 0x6E, 0x74, 0x54, 0x79, 0x70,
		0x65, 0x3D, 0x22, 0x74, 0x65, 0x78, 0x74, 0x2F, 0x68, 0x74,
		0x6D, 0x6C, 0x3B, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74,
		0x3D, 0x47, 0x42, 0x4B, 0x22, 0x25, 0x3E, 0x0A,
		0x3C, 0x68, 0x31, 0x3E, 0xC4, 0xE3, 0xBA, 0xC3, 0x3C, 0x2F, 0x68, 0x31, 0x3E,
	}
	fp := writeFile(t, dir, "WebRoot/hello.jsp", body)
	code, p := detectFile(t, srv, fp)
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%+v", code, p)
	}
	enc, _ := p["encoding"].(string)
	if enc != "gbk" && enc != "gb18030" {
		t.Errorf("hello.jsp encoding = %s, want gbk or gb18030", enc)
	}
}

func TestEncoding_Detect_UTF8BOM(t *testing.T) {
	srv, dir := newEncodingTestServer(t)
	body := append([]byte{0xEF, 0xBB, 0xBF}, []byte("hello, 你好")...)
	fp := writeFile(t, dir, "utf8bom.txt", body)
	code, p := detectFile(t, srv, fp)
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%+v", code, p)
	}
	if got := p["encoding"]; got != "utf-8-bom" {
		t.Errorf("utf-8-bom file detected as %v, want utf-8-bom", got)
	}
	if got, _ := p["hasBom"].(bool); !got {
		t.Errorf("hasBom should be true for utf-8-bom file")
	}
}

func TestEncoding_Detect_Plain_UTF8(t *testing.T) {
	srv, dir := newEncodingTestServer(t)
	fp := writeFile(t, dir, "plain.txt", []byte("hello, world\n"))
	code, p := detectFile(t, srv, fp)
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%+v", code, p)
	}
	if got := p["encoding"]; got != "utf-8" {
		t.Errorf("plain ASCII file detected as %v, want utf-8", got)
	}
}

func TestEncoding_Detect_ISO88591(t *testing.T) {
	srv, dir := newEncodingTestServer(t)
	// 0xC0 0xE0 0xF1 are "Ààñ" in ISO-8859-1; not valid UTF-8
	// single bytes. Detection should call these out as
	// iso-8859-1 with high confidence.
	body := []byte{0xC0, 0xE0, 0xF1, 0x21, 0x0A}
	fp := writeFile(t, dir, "latin1.txt", body)
	code, p := detectFile(t, srv, fp)
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%+v", code, p)
	}
	t.Logf("ISO-8859-1 sample detected as: %v (candidates: %v, confidence: %v)",
		p["encoding"], p["candidates"], p["confidence"])
	// The detection may pick iso-8859-1 or windows-1252 — the
	// only requirement is that the agent does NOT pretend
	// this is utf-8.
	enc, _ := p["encoding"].(string)
	if enc == "utf-8" || enc == "utf-8-bom" {
		t.Errorf("ISO-8859-1 bytes falsely detected as %s", enc)
	}
}

func TestEncoding_Recode_GBK_to_UTF8(t *testing.T) {
	srv, dir := newEncodingTestServer(t)
	body := []byte{0x3C, 0x68, 0x31, 0x3E, 0xC4, 0xE3, 0xBA, 0xC3, 0x3C, 0x2F, 0x68, 0x31, 0x3E}
	fp := writeFile(t, dir, "WebRoot/chinese.jsp", body)
	code, p := recodeFile(t, srv, fp, "gbk", "utf-8")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%+v", code, p)
	}
	// The file is now UTF-8.
	newBytes, err := os.ReadFile(fp)
	if err != nil {
		t.Fatalf("read after recode: %v", err)
	}
	if !bytes.Contains(newBytes, []byte("你好")) {
		t.Errorf("after recode, file does not contain '你好' utf-8 bytes: %q", string(newBytes))
	}
	// Confirm detect now reports utf-8.
	code2, p2 := detectFile(t, srv, fp)
	if code2 != http.StatusOK {
		t.Fatalf("detect after recode: %d", code2)
	}
	if got := p2["encoding"]; got != "utf-8" {
		t.Errorf("after recode, encoding = %v, want utf-8", got)
	}
}

func TestEncoding_Recode_UTF8_to_GBK_Roundtrip(t *testing.T) {
	srv, dir := newEncodingTestServer(t)
	fp := writeFile(t, dir, "round.txt", []byte("Round trip: 你好"))
	code, _ := recodeFile(t, srv, fp, "utf-8", "gbk")
	if code != http.StatusOK {
		t.Fatalf("recode utf-8 -> gbk: %d", code)
	}
	code, _ = recodeFile(t, srv, fp, "gbk", "utf-8")
	if code != http.StatusOK {
		t.Fatalf("recode gbk -> utf-8: %d", code)
	}
	final, err := os.ReadFile(fp)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Contains(final, []byte("Round trip: 你好")) {
		t.Errorf("round-trip lost the Chinese text: %q", string(final))
	}
}

func TestEncoding_Recode_AddsBOMForUtf8BOM(t *testing.T) {
	srv, dir := newEncodingTestServer(t)
	fp := writeFile(t, dir, "bom.txt", []byte("hello world"))
	code, _ := recodeFile(t, srv, fp, "utf-8", "utf-8-bom")
	if code != http.StatusOK {
		t.Fatalf("recode: %d", code)
	}
	final, err := os.ReadFile(fp)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.HasPrefix(final, []byte{0xEF, 0xBB, 0xBF}) {
		t.Errorf("utf-8-bom file should start with EF BB BF, got %x", final[:3])
	}
}

func TestEncoding_Detect_MissingFileReturnsErrorEnvelope(t *testing.T) {
	srv, _ := newEncodingTestServer(t)
	body := mustEncode(t, map[string]any{"file": "F:/nonexistent/does-not-exist.txt"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code == http.StatusOK {
		t.Fatalf("expected non-200 for missing file, got 200 body=%s", rr.Body.String())
	}
	var env2 protocol.ErrorResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &env2)
	if env2.OK {
		t.Fatalf("expected ok=false, body=%s", rr.Body.String())
	}
	if env2.Error.Code != protocol.ErrIOError {
		t.Errorf("error.code = %s, want %s", env2.Error.Code, protocol.ErrIOError)
	}
}
