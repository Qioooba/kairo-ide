package services

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
)

func TestMemSearcher_Search_WithRootPath(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memSearcher{}
	payload, _ := json.Marshal(map[string]interface{}{
		"rootPath":      dir,
		"query":         "hello",
		"caseSensitive": false,
	})

	result, err := m.Search(context.Background(), payload)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(result, &resp); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	// Should have results
	matches, ok := resp["matches"]
	if !ok {
		t.Fatal("expected matches in response")
	}
	matchList, ok := matches.([]interface{})
	if !ok {
		t.Fatal("matches is not an array")
	}
	if len(matchList) == 0 {
		t.Fatal("expected at least 1 match")
	}
}

func TestMemSearcher_Search_WithWorkspaceID(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memSearcher{
		workspaces: &stubWorkspaceResolver{root: dir},
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId":   "ws1",
		"query":         "hello",
		"caseSensitive": false,
	})

	result, err := m.Search(context.Background(), payload)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(result, &resp); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	matches, ok := resp["matches"]
	if !ok {
		t.Fatal("expected matches in response")
	}
	matchList, ok := matches.([]interface{})
	if !ok {
		t.Fatal("matches is not an array")
	}
	if len(matchList) == 0 {
		t.Fatal("expected at least 1 match")
	}
}

func TestMemSearcher_Search_WorkspaceIDFallback(t *testing.T) {
	// When workspace resolver fails, fall back to treating workspaceID as path
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memSearcher{
		workspaces: &stubWorkspaceResolver{err: true},
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"workspaceId":   dir,
		"query":         "hello",
		"caseSensitive": false,
	})

	result, err := m.Search(context.Background(), payload)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestMemSearcher_Search_NoRoot(t *testing.T) {
	m := &memSearcher{}
	payload, _ := json.Marshal(map[string]interface{}{
		"query": "hello",
	})

	_, err := m.Search(context.Background(), payload)
	if err == nil {
		t.Fatal("expected error when no rootPath or workspaceId")
	}
}

func TestMemSearcher_Search_InvalidJSON(t *testing.T) {
	m := &memSearcher{}
	_, err := m.Search(context.Background(), json.RawMessage(`not json`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestMemSearcher_Search_NoResults(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	m := &memSearcher{}
	payload, _ := json.Marshal(map[string]interface{}{
		"rootPath":      dir,
		"query":         "nonexistent_string_xyz",
		"caseSensitive": false,
	})

	result, err := m.Search(context.Background(), payload)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(result, &resp); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	// Result should have matches (possibly empty)
	matches, ok := resp["matches"]
	if !ok {
		t.Fatal("expected matches in response")
	}
	if matches == nil {
		return // nil matches is fine for no results
	}
	matchList, ok := matches.([]interface{})
	if !ok {
		t.Fatal("matches is not an array")
	}
	if len(matchList) != 0 {
		t.Errorf("expected 0 matches, got %d", len(matchList))
	}
}

type stubWorkspaceResolver struct {
	root string
	err  bool
}

func (s *stubWorkspaceResolver) Get(id string) (api.WorkspaceRecord, error) {
	if s.err {
		return api.WorkspaceRecord{}, os.ErrNotExist
	}
	return api.WorkspaceRecord{RootPath: s.root}, nil
}