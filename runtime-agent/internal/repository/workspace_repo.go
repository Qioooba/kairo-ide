package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
)

type FileWorkspaceRepo struct {
	mu      sync.Mutex
	dataDir string
}

func NewFileWorkspaceRepo(dataDir string) *FileWorkspaceRepo {
	return &FileWorkspaceRepo{dataDir: dataDir}
}

func (r *FileWorkspaceRepo) catalogDir() string {
	return filepath.Join(r.dataDir, "catalog")
}

func (r *FileWorkspaceRepo) filePath() string {
	return filepath.Join(r.catalogDir(), workspacesFileName)
}

func (r *FileWorkspaceRepo) load() ([]domain.Workspace, error) {
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

func (r *FileWorkspaceRepo) save(workspaces []domain.Workspace) error {
	if err := os.MkdirAll(r.catalogDir(), 0755); err != nil {
		return fmt.Errorf("create catalog dir %s: %w", r.catalogDir(), err)
	}
	doc := NewVersioned(workspaces)
	return AtomicWriteJSON(r.filePath(), doc, 0644)
}

func cloneWorkspaces(workspaces []domain.Workspace) []domain.Workspace {
	if workspaces == nil {
		return []domain.Workspace{}
	}
	out := make([]domain.Workspace, len(workspaces))
	copy(out, workspaces)
	return out
}

func cloneWorkspace(ws *domain.Workspace) domain.Workspace {
	return *ws
}

func validateWorkspaceRoot(root string) error {
	if root == "" {
		return fmt.Errorf("workspace root is empty")
	}
	if !filepath.IsAbs(root) {
		return fmt.Errorf("workspace root %q must be absolute", root)
	}
	return nil
}

func (r *FileWorkspaceRepo) Get(ctx context.Context, id domain.WorkspaceID) (*domain.Workspace, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(id)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.load()
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == id {
			ws := cloneWorkspace(&all[i])
			return &ws, nil
		}
	}
	return nil, domain.ErrWorkspaceNotFound
}

func (r *FileWorkspaceRepo) List(ctx context.Context) ([]domain.Workspace, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.load()
	if err != nil {
		return nil, err
	}
	return cloneWorkspaces(all), nil
}

func (r *FileWorkspaceRepo) Save(ctx context.Context, ws domain.Workspace) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(ws.ID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := validateWorkspaceRoot(ws.Root); err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.load()
	if err != nil {
		return fmt.Errorf("list workspaces: %w", err)
	}

	now := domain.UTCNow()
	if ws.CreatedAt.IsZero() {
		ws.CreatedAt = now
	}
	if ws.LastOpened.IsZero() {
		ws.LastOpened = now
	}

	found := false
	for i := range all {
		if all[i].ID == ws.ID {
			all[i] = ws
			found = true
		} else if all[i].Root == ws.Root {
			return fmt.Errorf("%w: workspace id %s already uses root %q",
				domain.ErrDuplicateRoot, all[i].ID, ws.Root)
		}
	}
	if !found {
		for i := range all {
			if all[i].Root == ws.Root {
				return fmt.Errorf("%w: root %q already registered", domain.ErrDuplicateRoot, ws.Root)
			}
		}
		all = append(all, ws)
	}
	return r.save(all)
}

func (r *FileWorkspaceRepo) Touch(ctx context.Context, id domain.WorkspaceID) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(id)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.load()
	if err != nil {
		return fmt.Errorf("load workspaces: %w", err)
	}

	now := domain.UTCNow()
	found := false
	for i := range all {
		if all[i].ID == id {
			all[i].LastOpened = now
			found = true
			break
		}
	}
	if !found {
		return domain.ErrWorkspaceNotFound
	}
	return r.save(all)
}

func (r *FileWorkspaceRepo) Delete(ctx context.Context, id domain.WorkspaceID) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(id)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.load()
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
		return domain.ErrWorkspaceNotFound
	}
	return r.save(filtered)
}
