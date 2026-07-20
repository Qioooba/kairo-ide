package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

type FileToolchainRepo struct {
	mu      sync.Mutex
	dataDir string
}

func NewFileToolchainRepo(dataDir string) *FileToolchainRepo {
	return &FileToolchainRepo{dataDir: dataDir}
}

func (r *FileToolchainRepo) filePath() string {
	return filepath.Join(r.dataDir, toolchainsFileName)
}

func (r *FileToolchainRepo) load() ([]domain.Toolchain, error) {
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

func (r *FileToolchainRepo) save(toolchains []domain.Toolchain) error {
	if err := os.MkdirAll(r.dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir %s: %w", r.dataDir, err)
	}
	path := r.filePath()
	doc := NewVersioned(toolchains)
	return AtomicWriteJSON(path, doc, 0644)
}

func cloneToolchains(toolchains []domain.Toolchain) []domain.Toolchain {
	if toolchains == nil {
		return []domain.Toolchain{}
	}
	out := make([]domain.Toolchain, len(toolchains))
	copy(out, toolchains)
	return out
}

func cloneToolchain(tc *domain.Toolchain) domain.Toolchain {
	return *tc
}

func (r *FileToolchainRepo) Get(ctx context.Context, id string) (*domain.Toolchain, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if id == "" {
		return nil, fmt.Errorf("toolchain id is empty")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.load()
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == id {
			tc := cloneToolchain(&all[i])
			return &tc, nil
		}
	}
	return nil, domain.ErrToolchainNotFound
}

func (r *FileToolchainRepo) List(ctx context.Context) ([]domain.Toolchain, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.load()
	if err != nil {
		return nil, err
	}
	return cloneToolchains(all), nil
}

func (r *FileToolchainRepo) Save(ctx context.Context, tc domain.Toolchain) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if tc.ID == "" {
		return fmt.Errorf("toolchain id is empty")
	}
	if tc.JavaHome == "" {
		return fmt.Errorf("toolchain javaHome is empty")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.load()
	if err != nil {
		return fmt.Errorf("list toolchains: %w", err)
	}

	if tc.VerifiedAt.IsZero() {
		tc.VerifiedAt = domain.UTCNow()
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
	return r.save(all)
}

func (r *FileToolchainRepo) FindByJavaHome(ctx context.Context, javaHome string) (*domain.Toolchain, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if javaHome == "" {
		return nil, fmt.Errorf("javaHome is empty")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.load()
	if err != nil {
		return nil, fmt.Errorf("list toolchains: %w", err)
	}
	for i := range all {
		if all[i].JavaHome == javaHome {
			tc := cloneToolchain(&all[i])
			return &tc, nil
		}
	}
	return nil, domain.ErrToolchainNotFound
}
