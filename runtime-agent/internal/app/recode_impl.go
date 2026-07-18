package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/text/transform"
)

// RecodeService converts files between encodings with atomic writes.
type RecodeService struct{}

// NewRecodeService returns a new RecodeService.
func NewRecodeService() *RecodeService {
	return &RecodeService{}
}

// RecodeRequest is the input for a recode operation.
type RecodeRequest struct {
	FilePath       string
	SourceEncoding string
	TargetEncoding string
	CreateBackup   bool
}

// RecodeResult is the output of a recode operation.
type RecodeResult struct {
	FilePath       string
	BackupPath     string
	SourceEncoding string
	TargetEncoding string
	BytesWritten   int64
}

// Recode converts a file from source encoding to target encoding atomically.
// 1. Reads the source file with source encoding
// 2. Converts to target encoding
// 3. Writes to temp file in same directory
// 4. fsyncs and atomically replaces
// 5. Optionally creates .bak backup
func (s *RecodeService) Recode(ctx context.Context, req RecodeRequest) (*RecodeResult, error) {
	// Read source file as bytes
	srcData, err := os.ReadFile(req.FilePath)
	if err != nil {
		return nil, fmt.Errorf("read source: %w", err)
	}

	// Convert encoding
	srcEnc := getEncoding(req.SourceEncoding)
	if srcEnc == nil {
		return nil, fmt.Errorf("unsupported source encoding: %s", req.SourceEncoding)
	}
	dstEnc := getEncoding(req.TargetEncoding)
	if dstEnc == nil {
		return nil, fmt.Errorf("unsupported target encoding: %s", req.TargetEncoding)
	}

	// Decode from source → UTF-8 → encode to target
	decoder := srcEnc.NewDecoder()
	utf8Data, _, err := transform.Bytes(decoder, srcData)
	if err != nil {
		return nil, fmt.Errorf("decode from %s: %w", req.SourceEncoding, err)
	}

	encoder := dstEnc.NewEncoder()
	dstData, _, err := transform.Bytes(encoder, utf8Data)
	if err != nil {
		return nil, fmt.Errorf("encode to %s: %w", req.TargetEncoding, err)
	}

	// Get original file info for permissions
	info, err := os.Stat(req.FilePath)
	if err != nil {
		return nil, fmt.Errorf("stat: %w", err)
	}

	// Create backup if requested
	var backupPath string
	if req.CreateBackup {
		backupPath = req.FilePath + ".bak"
		if err := atomicWriteBytes(backupPath, srcData, info.Mode()); err != nil {
			return nil, fmt.Errorf("create backup: %w", err)
		}
	}

	// Write atomically using temp file + rename
	if err := atomicWriteBytes(req.FilePath, dstData, info.Mode()); err != nil {
		return nil, fmt.Errorf("atomic write: %w", err)
	}

	return &RecodeResult{
		FilePath:       req.FilePath,
		BackupPath:     backupPath,
		SourceEncoding: req.SourceEncoding,
		TargetEncoding: req.TargetEncoding,
		BytesWritten:   int64(len(dstData)),
	}, nil
}

// atomicWriteBytes writes bytes to a file atomically using
// temp file + fsync + rename, then syncs the parent directory.
func atomicWriteBytes(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, perm); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	// Sync parent directory on Unix
	if f, err := os.Open(dir); err == nil {
		f.Sync()
		f.Close()
	}
	return nil
}