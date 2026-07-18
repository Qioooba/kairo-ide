package repository

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// VersionedDocument wraps any stored data with a schema version and timestamp.
type VersionedDocument[T any] struct {
	SchemaVersion int       `json:"schemaVersion"`
	UpdatedAt     time.Time `json:"updatedAt"`
	Data          T         `json:"data"`
}

const currentSchemaVersion = 1

// AtomicWriteJSON writes a value atomically to path.
// It writes to a temp file in the same directory, fsyncs, and renames.
// Parent directories are created if they do not exist.
func AtomicWriteJSON[T any](path string, value T, perm fs.FileMode) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sync temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Chmod(tmpPath, perm); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	// Sync parent directory on Unix to ensure rename is durable.
	if f, err := os.Open(dir); err == nil {
		if syncErr := f.Sync(); syncErr != nil {
			f.Close()
			return fmt.Errorf("sync parent dir %s: %w", dir, syncErr)
		}
		if closeErr := f.Close(); closeErr != nil {
			return fmt.Errorf("close parent dir %s: %w", dir, closeErr)
		}
	} else {
		return fmt.Errorf("open parent dir %s for sync: %w", dir, err)
	}
	return nil
}

// ReadVersionedJSON reads a VersionedDocument from path.
func ReadVersionedJSON[T any](path string) (*VersionedDocument[T], error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc VersionedDocument[T]
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("unmarshal versioned document: %w", err)
	}
	return &doc, nil
}

// NewVersioned wraps data in a VersionedDocument.
func NewVersioned[T any](data T) VersionedDocument[T] {
	return VersionedDocument[T]{
		SchemaVersion: currentSchemaVersion,
		UpdatedAt:     time.Now(),
		Data:          data,
	}
}

// ValidateSchemaVersion returns an error if version is not the current schema version.
func ValidateSchemaVersion(version int) error {
	if version != currentSchemaVersion {
		return fmt.Errorf("unsupported schema version %d (expected %d)", version, currentSchemaVersion)
	}
	return nil
}