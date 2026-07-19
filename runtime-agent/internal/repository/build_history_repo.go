package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

type FileBuildHistoryRepo struct {
	mu      sync.Mutex
	dataDir string
}

func NewFileBuildHistoryRepo(dataDir string) *FileBuildHistoryRepo {
	return &FileBuildHistoryRepo{dataDir: dataDir}
}

func (r *FileBuildHistoryRepo) historyDir() string {
	return filepath.Join(r.dataDir, "history", "builds")
}

func (r *FileBuildHistoryRepo) projectFilePath(workspaceID domain.WorkspaceID, projectID domain.ProjectID) string {
	return filepath.Join(r.historyDir(), string(workspaceID), string(projectID)+".json")
}

func (r *FileBuildHistoryRepo) loadProjectRuns(workspaceID domain.WorkspaceID, projectID domain.ProjectID) ([]domain.BuildRun, error) {
	path := r.projectFilePath(workspaceID, projectID)
	doc, err := ReadVersionedJSON[[]domain.BuildRun](path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.BuildRun{}, nil
		}
		return nil, fmt.Errorf("read build history from %s: %w", path, err)
	}
	return doc.Data, nil
}

func (r *FileBuildHistoryRepo) saveProjectRuns(workspaceID domain.WorkspaceID, projectID domain.ProjectID, runs []domain.BuildRun) error {
	dir := filepath.Dir(r.projectFilePath(workspaceID, projectID))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create build history dir %s: %w", dir, err)
	}
	path := r.projectFilePath(workspaceID, projectID)
	doc := NewVersioned(runs)
	return AtomicWriteJSON(path, doc, 0644)
}

func cloneTimePtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	cp := *t
	return &cp
}

func cloneDiagnostics(diags []domain.BuildDiagnostic) []domain.BuildDiagnostic {
	if diags == nil {
		return nil
	}
	out := make([]domain.BuildDiagnostic, len(diags))
	copy(out, diags)
	return out
}

func cloneBuildRun(run domain.BuildRun) domain.BuildRun {
	cp := run
	cp.StartedAt = cloneTimePtr(run.StartedAt)
	cp.FinishedAt = cloneTimePtr(run.FinishedAt)
	cp.ExitCode = cloneIntPtr(run.ExitCode)
	cp.Diagnostics = cloneDiagnostics(run.Diagnostics)
	return cp
}

func cloneIntPtr(i *int) *int {
	if i == nil {
		return nil
	}
	cp := *i
	return &cp
}

func cloneBuildRuns(runs []domain.BuildRun) []domain.BuildRun {
	if runs == nil {
		return []domain.BuildRun{}
	}
	out := make([]domain.BuildRun, len(runs))
	for i := range runs {
		out[i] = cloneBuildRun(runs[i])
	}
	return out
}

func (r *FileBuildHistoryRepo) Save(ctx context.Context, run domain.BuildRun) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(run.WorkspaceID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(run.ProjectID)); err != nil {
		return fmt.Errorf("invalid project id: %w", err)
	}
	if err := pathpolicy.ValidateBuildID(string(run.ID)); err != nil {
		return fmt.Errorf("invalid build id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	runs, err := r.loadProjectRuns(run.WorkspaceID, run.ProjectID)
	if err != nil {
		return err
	}

	savedRun := cloneBuildRun(run)

	found := false
	for i := range runs {
		if runs[i].ID == run.ID {
			runs[i] = savedRun
			found = true
			break
		}
	}
	if !found {
		runs = append(runs, savedRun)
	}

	sort.Slice(runs, func(i, j int) bool {
		return runs[i].QueuedAt.Before(runs[j].QueuedAt)
	})

	return r.saveProjectRuns(run.WorkspaceID, run.ProjectID, runs)
}

func (r *FileBuildHistoryRepo) Get(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) (*domain.BuildRun, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateBuildID(string(buildID)); err != nil {
		return nil, fmt.Errorf("invalid build id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	wsDir := filepath.Join(r.historyDir(), string(workspaceID))
	entries, err := os.ReadDir(wsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, domain.ErrBuildNotFound
		}
		return nil, fmt.Errorf("read workspace build dir %s: %w", wsDir, err)
	}

	var errs []error
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if entry.IsDir() {
			continue
		}
		ext := filepath.Ext(entry.Name())
		if ext != ".json" {
			continue
		}
		projectIDStr := entry.Name()[:len(entry.Name())-len(ext)]
		projectID := domain.ProjectID(projectIDStr)
		if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
			errs = append(errs, fmt.Errorf("invalid project id in filename %q: %w", entry.Name(), err))
			continue
		}
		runs, err := r.loadProjectRuns(workspaceID, projectID)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		for i := range runs {
			if runs[i].ID == buildID {
				cp := cloneBuildRun(runs[i])
				return &cp, nil
			}
		}
	}

	if len(errs) > 0 {
		return nil, domain.NewAggregateError(errs)
	}
	return nil, domain.ErrBuildNotFound
}

func (r *FileBuildHistoryRepo) List(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, limit int) ([]domain.BuildRun, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if projectID != "" {
		if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
			return nil, fmt.Errorf("invalid project id: %w", err)
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	var allRuns []domain.BuildRun
	var errs []error

	if projectID != "" {
		runs, err := r.loadProjectRuns(workspaceID, projectID)
		if err != nil {
			return nil, err
		}
		allRuns = runs
	} else {
		wsDir := filepath.Join(r.historyDir(), string(workspaceID))
		entries, err := os.ReadDir(wsDir)
		if err != nil {
			if os.IsNotExist(err) {
				return []domain.BuildRun{}, nil
			}
			return nil, fmt.Errorf("read workspace build dir %s: %w", wsDir, err)
		}
		for _, entry := range entries {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if entry.IsDir() {
				continue
			}
			ext := filepath.Ext(entry.Name())
			if ext != ".json" {
				continue
			}
			pidStr := entry.Name()[:len(entry.Name())-len(ext)]
			pid := domain.ProjectID(pidStr)
			if err := pathpolicy.ValidateProjectID(string(pid)); err != nil {
				errs = append(errs, fmt.Errorf("invalid project id in filename %q: %w", entry.Name(), err))
				continue
			}
			runs, err := r.loadProjectRuns(workspaceID, pid)
			if err != nil {
				errs = append(errs, err)
				continue
			}
			allRuns = append(allRuns, runs...)
		}
	}

	sort.Slice(allRuns, func(i, j int) bool {
		return allRuns[i].QueuedAt.After(allRuns[j].QueuedAt)
	})

	if limit > 0 && len(allRuns) > limit {
		allRuns = allRuns[:limit]
	}

	result := cloneBuildRuns(allRuns)
	if len(errs) > 0 {
		return result, domain.NewAggregateError(errs)
	}
	return result, nil
}
