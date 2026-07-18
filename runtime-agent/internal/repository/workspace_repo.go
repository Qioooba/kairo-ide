package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// FileWorkspaceRepo implements domain.WorkspaceRepository using a JSON file on disk.
type FileWorkspaceRepo struct {
	dataDir string
}

// NewFileWorkspaceRepo creates a new FileWorkspaceRepo.
func NewFileWorkspaceRepo(dataDir string) *FileWorkspaceRepo {
	return &FileWorkspaceRepo{dataDir: dataDir}
}

func (r *FileWorkspaceRepo) filePath() string {
	return filepath.Join(r.dataDir, workspacesFileName)
}

// Get returns a workspace by ID.
func (r *FileWorkspaceRepo) Get(ctx context.Context, id domain.WorkspaceID) (*domain.Workspace, error) {
	all, err := r.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == id {
			return &all[i], nil
		}
	}
	return nil, fmt.Errorf("workspace %s not found", id)
}

// List returns all workspaces.
func (r *FileWorkspaceRepo) List(ctx context.Context) ([]domain.Workspace, error) {
	path := r.filePath()
	doc, err := ReadVersionedJSON[[]domain.Workspace](path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.Workspace{}, nil
		}
		return nil, fmt.Errorf("read workspaces from %s: %w", path, err)
	}
	return doc.Data, nil
}

// Save upserts a workspace.
func (r *FileWorkspaceRepo) Save(ctx context.Context, ws domain.Workspace) error {
	all, err := r.List(ctx)
	if err != nil {
		return fmt.Errorf("list workspaces: %w", err)
	}
	found := false
	for i := range all {
		if all[i].ID == ws.ID {
			all[i] = ws
			found = true
			break
		}
	}
	if !found {
		all = append(all, ws)
	}
	return r.writeAll(all)
}

// Delete removes a workspace by ID.
func (r *FileWorkspaceRepo) Delete(ctx context.Context, id domain.WorkspaceID) error {
	all, err := r.List(ctx)
	if err != nil {
		return fmt.Errorf("list workspaces: %w", err)
	}
	filtered := make([]domain.Workspace, 0, len(all))
	for _, w := range all {
		if w.ID != id {
			filtered = append(filtered, w)
		}
	}
	if len(filtered) == len(all) {
		return fmt.Errorf("workspace %s not found", id)
	}
	return r.writeAll(filtered)
}

func (r *FileWorkspaceRepo) writeAll(workspaces []domain.Workspace) error {
	if err := os.MkdirAll(r.dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir %s: %w", r.dataDir, err)
	}
	for i := range workspaces {
		if workspaces[i].LastOpened.IsZero() {
			workspaces[i].LastOpened = time.Now()
		}
	}
	path := r.filePath()
	doc := NewVersioned(workspaces)
	return AtomicWriteJSON(path, doc, 0644)
}