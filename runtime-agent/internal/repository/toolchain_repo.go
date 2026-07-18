package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// FileToolchainRepo implements domain.ToolchainRepository using a JSON file on disk.
type FileToolchainRepo struct {
	dataDir string
}

// NewFileToolchainRepo creates a new FileToolchainRepo.
func NewFileToolchainRepo(dataDir string) *FileToolchainRepo {
	return &FileToolchainRepo{dataDir: dataDir}
}

func (r *FileToolchainRepo) filePath() string {
	return filepath.Join(r.dataDir, toolchainsFileName)
}

// Get returns a toolchain by ID.
func (r *FileToolchainRepo) Get(ctx context.Context, id string) (*domain.Toolchain, error) {
	all, err := r.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == id {
			return &all[i], nil
		}
	}
	return nil, fmt.Errorf("toolchain %s not found", id)
}

// List returns all toolchains.
func (r *FileToolchainRepo) List(ctx context.Context) ([]domain.Toolchain, error) {
	path := r.filePath()
	doc, err := ReadVersionedJSON[[]domain.Toolchain](path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.Toolchain{}, nil
		}
		return nil, fmt.Errorf("read toolchains from %s: %w", path, err)
	}
	return doc.Data, nil
}

// Save upserts a toolchain.
func (r *FileToolchainRepo) Save(ctx context.Context, tc domain.Toolchain) error {
	all, err := r.List(ctx)
	if err != nil {
		return fmt.Errorf("list toolchains: %w", err)
	}
	found := false
	for i := range all {
		if all[i].ID == tc.ID {
			all[i] = tc
			found = true
			break
		}
	}
	if !found {
		all = append(all, tc)
	}
	return r.writeAll(all)
}

// FindByJavaHome looks up a toolchain by its javaHome path.
func (r *FileToolchainRepo) FindByJavaHome(ctx context.Context, javaHome string) (*domain.Toolchain, error) {
	all, err := r.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("list toolchains: %w", err)
	}
	for i := range all {
		if all[i].JavaHome == javaHome {
			return &all[i], nil
		}
	}
	return nil, fmt.Errorf("toolchain with javaHome %s not found", javaHome)
}

func (r *FileToolchainRepo) writeAll(toolchains []domain.Toolchain) error {
	if err := os.MkdirAll(r.dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir %s: %w", r.dataDir, err)
	}
	for i := range toolchains {
		if toolchains[i].VerifiedAt.IsZero() {
			toolchains[i].VerifiedAt = time.Now()
		}
	}
	path := r.filePath()
	doc := NewVersioned(toolchains)
	return AtomicWriteJSON(path, doc, 0644)
}