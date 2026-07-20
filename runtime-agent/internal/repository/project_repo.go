package repository

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
)

type FileProjectRepo struct {
	dataDir    string
	workspaces domain.WorkspaceRepository
	catalog    *ProjectCatalog
	policy     pathpolicy.PathAuthorizer
}

func NewFileProjectRepo(dataDir string, workspaces domain.WorkspaceRepository, policy pathpolicy.PathAuthorizer) *FileProjectRepo {
	if policy == nil {
		policy = pathpolicy.NewDefaultPathPolicy()
	}
	return &FileProjectRepo{
		dataDir:    dataDir,
		workspaces: workspaces,
		catalog:    NewProjectCatalog(dataDir, policy),
		policy:     policy,
	}
}

func cloneStringSlice(s []string) []string {
	if s == nil {
		return nil
	}
	out := make([]string, len(s))
	copy(out, s)
	return out
}

func cloneProject(p *domain.Project) domain.Project {
	cp := *p
	cp.SourceRoots = cloneStringSlice(p.SourceRoots)
	cp.ResourceRoots = cloneStringSlice(p.ResourceRoots)
	cp.LibraryDirs = cloneStringSlice(p.LibraryDirs)
	cp.BuildTargets = cloneStringSlice(p.BuildTargets)
	return cp
}

func (r *FileProjectRepo) Get(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*domain.Project, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
		return nil, fmt.Errorf("invalid project id: %w", err)
	}

	ws, err := r.workspaces.Get(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("get workspace: %w", err)
	}

	record, err := r.catalog.Get(ctx, workspaceID, projectID)
	if err != nil {
		return nil, err
	}

	projectRoot, err := r.policy.ResolveWithin(ws.Root, record.Root)
	if err != nil {
		return nil, fmt.Errorf("resolve project root: %w", err)
	}

	cfg, err := LoadProjectConfig(projectRoot)
	if err != nil {
		return nil, fmt.Errorf("load project config: %w", err)
	}

	project := ConfigToProject(cfg, workspaceID, projectID)
	project.Root = record.Root
	project.CreatedAt = record.CreatedAt
	project.UpdatedAt = record.UpdatedAt

	cp := cloneProject(project)
	return &cp, nil
}

func (r *FileProjectRepo) List(ctx context.Context, workspaceID domain.WorkspaceID) ([]domain.Project, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}

	ws, err := r.workspaces.Get(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("get workspace: %w", err)
	}

	records, err := r.catalog.ListByWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list project records: %w", err)
	}

	var projects []domain.Project
	var errs []error
	for _, record := range records {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		projectRoot, err := r.policy.ResolveWithin(ws.Root, record.Root)
		if err != nil {
			errs = append(errs, fmt.Errorf("resolve project root for %s: %w", record.ProjectID, err))
			continue
		}
		cfg, err := LoadProjectConfig(projectRoot)
		if err != nil {
			errs = append(errs, fmt.Errorf("load project config for %s at %s: %w", record.ProjectID, projectRoot, err))
			continue
		}
		project := ConfigToProject(cfg, workspaceID, record.ProjectID)
		project.Root = record.Root
		project.CreatedAt = record.CreatedAt
		project.UpdatedAt = record.UpdatedAt
		projects = append(projects, cloneProject(project))
	}
	if len(errs) > 0 {
		return projects, domain.NewAggregateError(errs)
	}
	return projects, nil
}

func (r *FileProjectRepo) Save(ctx context.Context, project domain.Project) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(project.WorkspaceID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(project.ID)); err != nil {
		return fmt.Errorf("invalid project id: %w", err)
	}

	ws, err := r.workspaces.Get(ctx, project.WorkspaceID)
	if err != nil {
		return fmt.Errorf("get workspace: %w", err)
	}

	if project.Root == "" {
		project.Root = "."
	}

	projectRoot, err := r.policy.ResolveWithin(ws.Root, project.Root)
	if err != nil {
		return fmt.Errorf("resolve project root: %w", err)
	}

	cfg := ProjectToConfig(&project)
	if err := SaveProjectConfig(projectRoot, cfg); err != nil {
		return fmt.Errorf("save project config: %w", err)
	}

	now := domain.UTCNow()
	record := ProjectRecord{
		WorkspaceID: project.WorkspaceID,
		ProjectID:   project.ID,
		Root:        project.Root,
	}
	existing, err := r.catalog.Get(ctx, project.WorkspaceID, project.ID)
	if err == nil && existing != nil {
		record.CreatedAt = existing.CreatedAt
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = now
	}
	record.UpdatedAt = now

	if err := r.catalog.Put(ctx, record); err != nil {
		return fmt.Errorf("put catalog record: %w", err)
	}
	return nil
}

func (r *FileProjectRepo) Delete(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
		return fmt.Errorf("invalid project id: %w", err)
	}

	ws, err := r.workspaces.Get(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("get workspace: %w", err)
	}

	record, err := r.catalog.Get(ctx, workspaceID, projectID)
	if err != nil {
		return err
	}

	var configErr error
	projectRoot, err := r.policy.ResolveWithin(ws.Root, record.Root)
	if err == nil {
		configPath := ProjectConfigPath(projectRoot)
		if err := removeFileIfExists(configPath); err != nil {
			configErr = fmt.Errorf("remove project config %s: %w", configPath, err)
		}
	} else {
		configErr = fmt.Errorf("resolve project root for config removal: %w", err)
	}

	catalogErr := r.catalog.Delete(ctx, workspaceID, projectID)

	if configErr != nil && catalogErr != nil {
		return domain.NewAggregateError([]error{configErr, catalogErr})
	}
	if configErr != nil {
		return configErr
	}
	return catalogErr
}

func (r *FileProjectRepo) FindByRoot(ctx context.Context, workspaceID domain.WorkspaceID, root string) (*domain.Project, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if root == "" {
		root = "."
	}
	if err := r.policy.ValidateRelativeConfigPath(root, false); err != nil {
		return nil, fmt.Errorf("invalid root path %q: %w", root, err)
	}

	record, err := r.catalog.FindByRoot(ctx, workspaceID, root)
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, workspaceID, record.ProjectID)
}

func removeFileIfExists(path string) error {
	err := os.Remove(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
