package repository

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

type VersionedDocument[T any] struct {
	SchemaVersion int       `json:"schemaVersion" yaml:"schemaVersion"`
	UpdatedAt     time.Time `json:"updatedAt" yaml:"updatedAt"`
	Data          T         `json:"data" yaml:"data"`
}

const currentSchemaVersion = 1

type CorruptionError struct {
	Path string
	Err  error
}

func (e *CorruptionError) Error() string {
	return fmt.Sprintf("corrupt document at %s: %v", e.Path, e.Err)
}

func (e *CorruptionError) Unwrap() error {
	return e.Err
}

func AtomicWriteFile(path string, data []byte, perm fs.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()

	cleanup := func() {
		os.Remove(tmpPath)
	}

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		cleanup()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		cleanup()
		return fmt.Errorf("sync temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Chmod(tmpPath, perm); err != nil {
		cleanup()
		return fmt.Errorf("chmod: %w", err)
	}
	if err := atomicRename(tmpPath, path); err != nil {
		cleanup()
		return fmt.Errorf("rename: %w", err)
	}
	return syncDir(dir)
}

func AtomicWriteJSON[T any](path string, value T, perm fs.FileMode) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	return AtomicWriteFile(path, data, perm)
}

func AtomicWriteYAML[T any](path string, value T, perm fs.FileMode) error {
	data, err := yaml.Marshal(value)
	if err != nil {
		return fmt.Errorf("marshal yaml: %w", err)
	}
	return AtomicWriteFile(path, data, perm)
}

func ReadVersionedJSON[T any](path string) (*VersionedDocument[T], error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc VersionedDocument[T]
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, &CorruptionError{Path: path, Err: err}
	}
	if doc.SchemaVersion != currentSchemaVersion {
		return nil, &CorruptionError{
			Path: path,
			Err:  fmt.Errorf("unsupported schema version %d (expected %d)", doc.SchemaVersion, currentSchemaVersion),
		}
	}
	return &doc, nil
}

func ReadVersionedYAML[T any](path string) (*T, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc struct {
		SchemaVersion int `yaml:"schemaVersion"`
		Data          T   `yaml:",inline"`
	}
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, &CorruptionError{Path: path, Err: err}
	}
	if doc.SchemaVersion != currentSchemaVersion {
		return nil, &CorruptionError{
			Path: path,
			Err:  fmt.Errorf("unsupported schema version %d (expected %d)", doc.SchemaVersion, currentSchemaVersion),
		}
	}
	return &doc.Data, nil
}

func NewVersioned[T any](data T) VersionedDocument[T] {
	return VersionedDocument[T]{
		SchemaVersion: currentSchemaVersion,
		UpdatedAt:     time.Now().UTC(),
		Data:          data,
	}
}

func ValidateSchemaVersion(version int) error {
	if version != currentSchemaVersion {
		return fmt.Errorf("unsupported schema version %d (expected %d)", version, currentSchemaVersion)
	}
	return nil
}

func BackupCorruptFile(path string) (string, error) {
	backupPath := fmt.Sprintf("%s.corrupt.%d", path, time.Now().UnixNano())
	if err := copyFile(path, backupPath); err != nil {
		return "", fmt.Errorf("backup corrupt file: %w", err)
	}
	return backupPath, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func syncDir(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return fmt.Errorf("open parent dir %s for sync: %w", dir, err)
	}
	defer f.Close()
	if err := f.Sync(); err != nil {
		return fmt.Errorf("sync parent dir %s: %w", dir, err)
	}
	return nil
}
