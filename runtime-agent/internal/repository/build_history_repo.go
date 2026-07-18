package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// buildHistoryFileName is the file name for storing build history per workspace.
const buildHistoryFileName = "build_history.json"

// FileBuildHistoryRepo implements domain.BuildHistoryRepository using a JSON file on disk.
type FileBuildHistoryRepo struct {
	dataDir string
}

// NewFileBuildHistoryRepo creates a new FileBuildHistoryRepo.
func NewFileBuildHistoryRepo(dataDir string) *FileBuildHistoryRepo {
	return &FileBuildHistoryRepo{dataDir: dataDir}
}

func (r *FileBuildHistoryRepo) filePath(workspaceID domain.WorkspaceID) string {
	return filepath.Join(r.dataDir, string(workspaceID), buildHistoryFileName)
}

// Save appends a build run to the history.
func (r *FileBuildHistoryRepo) Save(ctx context.Context, run domain.BuildRun) error {
	all, err := r.loadAll(run.WorkspaceID)
	if err != nil {
		return err
	}
	all = append(all, run)
	return r.writeAll(run.WorkspaceID, all)
}

// Get returns a build run by its ID.
func (r *FileBuildHistoryRepo) Get(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) (*domain.BuildRun, error) {
	all, err := r.loadAll(workspaceID)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == buildID {
			return &all[i], nil
		}
	}
	return nil, fmt.Errorf("build run %s not found in workspace %s", buildID, workspaceID)
}

// List returns build runs for a workspace, optionally filtered by project.
func (r *FileBuildHistoryRepo) List(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, limit int) ([]domain.BuildRun, error) {
	all, err := r.loadAll(workspaceID)
	if err != nil {
		return nil, err
	}
	var filtered []domain.BuildRun
	for _, run := range all {
		if projectID != "" && run.ProjectID != projectID {
			continue
		}
		filtered = append(filtered, run)
	}
	if limit > 0 && len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}
	return filtered, nil
}

func (r *FileBuildHistoryRepo) loadAll(workspaceID domain.WorkspaceID) ([]domain.BuildRun, error) {
	path := r.filePath(workspaceID)
	doc, err := ReadVersionedJSON[[]domain.BuildRun](path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.BuildRun{}, nil
		}
		return nil, fmt.Errorf("read build history from %s: %w", path, err)
	}
	return doc.Data, nil
}

func (r *FileBuildHistoryRepo) writeAll(workspaceID domain.WorkspaceID, runs []domain.BuildRun) error {
	dir := filepath.Dir(r.filePath(workspaceID))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create build history dir %s: %w", dir, err)
	}
	path := r.filePath(workspaceID)
	doc := NewVersioned(runs)
	return AtomicWriteJSON(path, doc, 0644)
}