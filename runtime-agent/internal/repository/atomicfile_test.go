package repository

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func TestCorruptionError_Unwrap(t *testing.T) {
	inner := fmt.Errorf("inner error")
	ce := &CorruptionError{Path: "/some/path", Err: inner}
	if unwrapped := ce.Unwrap(); unwrapped != inner {
		t.Errorf("Unwrap() = %v, want %v", unwrapped, inner)
	}
}

func TestAtomicWriteYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.yaml")

	type TestData struct {
		Name string `yaml:"name"`
		Age  int    `yaml:"age"`
	}

	data := VersionedDocument[TestData]{
		SchemaVersion: 1,
		Data:          TestData{Name: "Alice", Age: 30},
	}

	if err := AtomicWriteYAML(path, data, 0644); err != nil {
		t.Fatalf("AtomicWriteYAML failed: %v", err)
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatal("file was not created")
	}

	// Read back and verify the file content
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(content) == 0 {
		t.Fatal("empty file written")
	}
	// Verify the content contains expected data
	contentStr := string(content)
	if !strings.Contains(contentStr, "name") || !strings.Contains(contentStr, "Alice") {
		t.Errorf("unexpected content: %s", contentStr)
	}
}

func TestReadVersionedYAML_NotFound(t *testing.T) {
	_, err := ReadVersionedYAML[struct{}]("/nonexistent/file.yaml")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestReadVersionedYAML_InvalidYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.yaml")
	os.WriteFile(path, []byte(": not valid yaml"), 0644)

	_, err := ReadVersionedYAML[struct{}](path)
	if err == nil {
		t.Fatal("expected error for invalid YAML")
	}
}

func TestReadVersionedYAML_WrongSchemaVersion(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.yaml")
	os.WriteFile(path, []byte("schemaVersion: 999\nname: test"), 0644)

	_, err := ReadVersionedYAML[struct{ Name string `yaml:"name"` }](path)
	if err == nil {
		t.Fatal("expected error for wrong schema version")
	}
}

func TestReadVersionedJSON_WrongSchemaVersion(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	os.WriteFile(path, []byte(`{"schemaVersion": 999, "data": {}}`), 0644)

	_, err := ReadVersionedJSON[struct{}](path)
	if err == nil {
		t.Fatal("expected error for wrong schema version")
	}
}

func TestValidateSchemaVersion(t *testing.T) {
	if err := ValidateSchemaVersion(1); err != nil {
		t.Errorf("expected valid schema version, got: %v", err)
	}
	if err := ValidateSchemaVersion(0); err == nil {
		t.Error("expected error for invalid schema version")
	}
	if err := ValidateSchemaVersion(999); err == nil {
		t.Error("expected error for invalid schema version")
	}
}

func TestBackupCorruptFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "corrupt.json")
	os.WriteFile(path, []byte("corrupt data"), 0644)

	backupPath, err := BackupCorruptFile(path)
	if err != nil {
		t.Fatalf("BackupCorruptFile failed: %v", err)
	}

	// Verify backup exists
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		t.Fatal("backup file was not created")
	}

	// Verify original still exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatal("original file was removed")
	}
}

func TestBackupCorruptFile_NotFound(t *testing.T) {
	_, err := BackupCorruptFile("/nonexistent/corrupt.json")
	if err == nil {
		t.Fatal("expected error for nonexistent source")
	}
}

func TestCopyFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	os.WriteFile(src, []byte("hello"), 0644)

	dst := filepath.Join(dir, "dst.txt")
	if err := copyFile(src, dst); err != nil {
		t.Fatalf("copyFile failed: %v", err)
	}

	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Errorf("got %q, want %q", string(data), "hello")
	}
}

func TestCopyFile_SourceNotFound(t *testing.T) {
	dir := t.TempDir()
	if err := copyFile(filepath.Join(dir, "nonexistent"), filepath.Join(dir, "dst")); err == nil {
		t.Fatal("expected error for nonexistent source")
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
