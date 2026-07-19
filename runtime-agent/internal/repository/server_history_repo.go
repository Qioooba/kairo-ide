package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

const serverHistoryFileName = "server_history.json"

type FileServerHistoryRepo struct {
	mu      sync.Mutex
	dataDir string
}

func NewFileServerHistoryRepo(dataDir string) *FileServerHistoryRepo {
	return &FileServerHistoryRepo{dataDir: dataDir}
}

func (r *FileServerHistoryRepo) filePath(workspaceID domain.WorkspaceID) string {
	return filepath.Join(r.dataDir, "history", "servers", string(workspaceID)+".json")
}

func cloneRuntimePlan(plan *domain.RuntimePlan) *domain.RuntimePlan {
	if plan == nil {
		return nil
	}
	cp := *plan
	cp.JVMOptions = cloneStringSlice(plan.JVMOptions)
	return &cp
}

func cloneServerInstance(inst domain.ServerInstance) domain.ServerInstance {
	cp := inst
	cp.LastPlan = cloneRuntimePlan(inst.LastPlan)
	return cp
}

func cloneServerInstances(instances []domain.ServerInstance) []domain.ServerInstance {
	if instances == nil {
		return []domain.ServerInstance{}
	}
	out := make([]domain.ServerInstance, len(instances))
	for i := range instances {
		out[i] = cloneServerInstance(instances[i])
	}
	return out
}

func (r *FileServerHistoryRepo) Save(ctx context.Context, instance domain.ServerInstance) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(instance.WorkspaceID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(instance.ProjectID)); err != nil {
		return fmt.Errorf("invalid project id: %w", err)
	}
	if err := pathpolicy.ValidateServerID(string(instance.ID)); err != nil {
		return fmt.Errorf("invalid server id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.loadAll(instance.WorkspaceID)
	if err != nil {
		return err
	}

	saved := cloneServerInstance(instance)

	found := false
	for i := range all {
		if all[i].ID == instance.ID {
			all[i] = saved
			found = true
			break
		}
	}
	if !found {
		all = append(all, saved)
	}
	return r.writeAll(instance.WorkspaceID, all)
}

func (r *FileServerHistoryRepo) Get(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerInstance, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateServerID(string(serverID)); err != nil {
		return nil, fmt.Errorf("invalid server id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.loadAll(workspaceID)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == serverID {
			cp := cloneServerInstance(all[i])
			return &cp, nil
		}
	}
	return nil, domain.ErrServerNotFound
}

func (r *FileServerHistoryRepo) List(ctx context.Context, workspaceID domain.WorkspaceID) ([]domain.ServerInstance, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.loadAll(workspaceID)
	if err != nil {
		return nil, err
	}
	return cloneServerInstances(all), nil
}

func (r *FileServerHistoryRepo) Delete(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateServerID(string(serverID)); err != nil {
		return fmt.Errorf("invalid server id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

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
		return domain.ErrServerNotFound
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
