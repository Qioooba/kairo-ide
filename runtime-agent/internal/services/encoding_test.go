package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMemEncoder_Detect_NoSandbox(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(path, []byte("Hello, World!"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId": "ws1",
		"file":        path,
		"sampleBytes": 1024,
	})

	result, err := m.Detect(payload)
	if err != nil {
		t.Fatalf("Detect failed: %v", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(result, &resp); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if resp["encoding"] == nil || resp["encoding"] == "" {
		t.Fatal("expected non-empty encoding")
	}
}

func TestMemEncoder_Detect_InvalidJSON(t *testing.T) {
	m := &memEncoder{}
	_, err := m.Detect(json.RawMessage(`not json`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestMemEncoder_Detect_FileNotFound(t *testing.T) {
	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId": "ws1",
		"file":        "/nonexistent/file.txt",
		"sampleBytes": 1024,
	})

	_, err := m.Detect(payload)
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestMemEncoder_Detect_DefaultSampleBytes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(path, []byte("Hello"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId": "ws1",
		"file":        path,
		"sampleBytes": 0,
	})

	result, err := m.Detect(payload)
	if err != nil {
		t.Fatalf("Detect with default sampleBytes failed: %v", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(result, &resp); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if resp["file"] != path {
		t.Errorf("got %v, want %v", resp["file"], path)
	}
}

func TestMemEncoder_Recode_NoSandbox(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(path, []byte("Hello, World!"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId": "ws1",
		"file":        path,
		"from":        "utf-8",
		"to":          "utf-8",
	})

	result, err := m.Recode(payload)
	if err != nil {
		t.Fatalf("Recode failed: %v", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(result, &resp); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	ok, _ := resp["ok"].(bool)
	if !ok {
		t.Fatal("expected ok=true")
	}
}

// BD-P2-14: Recode must honor optional eol override.
func TestMemEncoder_Recode_Eol(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "eol.txt")
	if err := os.WriteFile(path, []byte("a\nb\nc"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId": "ws1",
		"file":        path,
		"from":        "utf-8",
		"to":          "utf-8",
		"eol":         "crlf",
	})
	if _, err := m.Recode(payload); err != nil {
		t.Fatalf("Recode with eol failed: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := []byte("a\r\nb\r\nc")
	if string(got) != string(want) {
		t.Fatalf("eol rewrite: got %q want %q", got, want)
	}
}

func TestMemEncoder_Recode_InvalidJSON(t *testing.T) {
	m := &memEncoder{}
	_, err := m.Recode(json.RawMessage(`not json`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestMemEncoder_Recode_FileNotFound(t *testing.T) {
	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId": "ws1",
		"file":        "/nonexistent/file.txt",
		"from":        "utf-8",
		"to":          "utf-8",
	})

	_, err := m.Recode(payload)
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestMemEncoder_Recode_InvalidEncoding(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(path, []byte("Hello"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId": "ws1",
		"file":        path,
		"from":        "invalid-encoding-xyz",
		"to":          "utf-8",
	})

	_, err := m.Recode(payload)
	if err == nil {
		t.Fatal("expected error for invalid encoding")
	}
}

func TestMemEncoder_ResolveRead_NilReceiver(t *testing.T) {
	var m *memEncoder
	path, err := m.resolveRead("/tmp/test.txt")
	if err != nil {
		t.Fatalf("resolveRead on nil receiver should succeed: %v", err)
	}
	if path != "/tmp/test.txt" {
		t.Errorf("got %q, want /tmp/test.txt", path)
	}
}

func TestMemEncoder_ResolveWrite_NilReceiver(t *testing.T) {
	var m *memEncoder
	path, err := m.resolveWrite("/tmp/test.txt")
	if err != nil {
		t.Fatalf("resolveWrite on nil receiver should succeed: %v", err)
	}
	if path != "/tmp/test.txt" {
		t.Errorf("got %q, want /tmp/test.txt", path)
	}
}

// BD-P2-10: concurrent Detect / GetEncoding must not race on fileEncoding.
func TestMemEncoder_FileEncodingConcurrent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "conc.txt")
	if err := os.WriteFile(path, []byte("Hello"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId": "ws1",
		"file":        path,
		"sampleBytes": 1024,
	})

	const n = 50
	done := make(chan struct{})
	for i := 0; i < n; i++ {
		go func() {
			_, _ = m.Detect(payload)
			_ = m.GetEncoding(path)
			done <- struct{}{}
		}()
	}
	for i := 0; i < n; i++ {
		<-done
	}
	if enc := m.GetEncoding(path); enc == "" {
		t.Fatal("expected cached encoding after concurrent Detect")
	}
}
