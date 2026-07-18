package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// serverHistoryFileName is the file name for storing server history per workspace.
const serverHistoryFileName = "server_history.json"

// FileServerHistoryRepo implements domain.ServerHistoryRepository using a JSON file on disk.
type FileServerHistoryRepo struct {
	dataDir string
}

// NewFileServerHistoryRepo creates a new FileServerHistoryRepo.
func NewFileServerHistoryRepo(dataDir string) *FileServerHistoryRepo {
	return &FileServerHistoryRepo{dataDir: dataDir}
}

func (r *FileServerHistoryRepo) filePath(workspaceID domain.WorkspaceID) string {
	return filepath.Join(r.dataDir, string(workspaceID), serverHistoryFileName)
}

// Save appends a server instance to the history.
func (r *FileServerHistoryRepo) Save(ctx context.Context, instance domain.ServerInstance) error {
	all, err := r.loadAll(instance.WorkspaceID)
	if err != nil {
		return err
	}
	found := false
	for i := range all {
		if all[i].ID == instance.ID {
			all[i] = instance
			found = true
			break
		}
	}
	if !found {
		all = append(all, instance)
	}
	return r.writeAll(instance.WorkspaceID, all)
}

// Get returns a server instance by its ID.
func (r *FileServerHistoryRepo) Get(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerInstance, error) {
	all, err := r.loadAll(workspaceID)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == serverID {
			return &all[i], nil
		}
	}
	return nil, fmt.Errorf("server instance %s not found in workspace %s", serverID, workspaceID)
}

// List returns all server instances for a workspace.
func (r *FileServerHistoryRepo) List(ctx context.Context, workspaceID domain.WorkspaceID) ([]domain.ServerInstance, error) {
	return r.loadAll(workspaceID)
}

// Delete removes a server instance by its ID.
func (r *FileServerHistoryRepo) Delete(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) error {
	all, err := r.loadAll(workspaceID)
	if err != nil {
		return err
	}
	filtered := make([]domain.ServerInstance, 0, len(all))
	for _, s := range all {
		if s.ID != serverID {
			filtered = append(filtered, s)
		}
	}
	if len(filtered) == len(all) {
		return fmt.Errorf("server instance %s not found in workspace %s", serverID, workspaceID)
	}
	return r.writeAll(workspaceID, filtered)
}

func (r *FileServerHistoryRepo) loadAll(workspaceID domain.WorkspaceID) ([]domain.ServerInstance, error) {
	path := r.filePath(workspaceID)
	doc, err := ReadVersionedJSON[[]domain.ServerInstance](path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.ServerInstance{}, nil
		}
		return nil, fmt.Errorf("read server history from %s: %w", path, err)
	}
	return doc.Data, nil
}

func (r *FileServerHistoryRepo) writeAll(workspaceID domain.WorkspaceID, instances []domain.ServerInstance) error {
	dir := filepath.Dir(r.filePath(workspaceID))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create server history dir %s: %w", dir, err)
	}
	path := r.filePath(workspaceID)
	doc := NewVersioned(instances)
	return AtomicWriteJSON(path, doc, 0644)
}