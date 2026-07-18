package repository

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicWriteJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.json")

	type TestData struct {
		Name string `json:"name"`
		Age  int    `json:"age"`
	}

	data := VersionedDocument[TestData]{
		SchemaVersion: 1,
		Data:          TestData{Name: "Alice", Age: 30},
	}

	if err := AtomicWriteJSON(path, data, 0644); err != nil {
		t.Fatalf("AtomicWriteJSON failed: %v", err)
	}

	// Verify the file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatal("file was not created")
	}

	// Read it back
	read, err := ReadVersionedJSON[TestData](path)
	if err != nil {
		t.Fatalf("ReadVersionedJSON failed: %v", err)
	}

	if read.Data.Name != "Alice" || read.Data.Age != 30 {
		t.Errorf("unexpected data: %+v", read.Data)
	}
}

func TestAtomicWriteJSON_CreatesParentDirs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sub", "deep", "test.json")

	type Empty struct{}
	data := NewVersioned(Empty{})

	if err := AtomicWriteJSON(path, data, 0644); err != nil {
		t.Fatalf("AtomicWriteJSON failed: %v", err)
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatal("file was not created in nested dir")
	}
}

func TestReadVersionedJSON_NotFound(t *testing.T) {
	_, err := ReadVersionedJSON[struct{}]("/nonexistent/file.json")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestReadVersionedJSON_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	os.WriteFile(path, []byte("not json"), 0644)

	_, err := ReadVersionedJSON[struct{}](path)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}