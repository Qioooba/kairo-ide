package repository

import (
	"context"
	"fmt"
	"os"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// FileProjectRepo implements domain.ProjectRepository using per-project
// config files (.kairo/project.yaml) on disk.
type FileProjectRepo struct{}

// NewFileProjectRepo creates a new FileProjectRepo.
func NewFileProjectRepo() *FileProjectRepo {
	return &FileProjectRepo{}
}

// Get returns a project by its workspace and project IDs.
// It looks up the project config file at the project root derived from the project ID.
func (r *FileProjectRepo) Get(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*domain.Project, error) {
	cfg, err := LoadProjectConfig(string(projectID))
	if err != nil {
		return nil, fmt.Errorf("load project config: %w", err)
	}
	return &domain.Project{
		ID:            projectID,
		WorkspaceID:   workspaceID,
		Name:          cfg.Name,
		SourceRoots:   cfg.SourceRoots,
		ResourceRoots: cfg.ResourceRoots,
		WebappDir:     cfg.WebappDir,
		OutputDir:     cfg.OutputDir,
		SourceLevel:   cfg.SourceLevel,
		TargetLevel:   cfg.TargetLevel,
		Encoding:      cfg.Encoding,
		BuildTool:     cfg.BuildTool,
		ContextPath:   cfg.ContextPath,
	}, nil
}

// List returns all projects in a workspace. It scans the workspace root
// for directories containing .kairo/project.yaml.
func (r *FileProjectRepo) List(ctx context.Context, workspaceID domain.WorkspaceID) ([]domain.Project, error) {
	root := string(workspaceID)
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.Project{}, nil
		}
		return nil, fmt.Errorf("read workspace dir %s: %w", root, err)
	}
	var projects []domain.Project
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		cfg, err := LoadProjectConfig(root + "/" + entry.Name())
		if err != nil {
			// Skip directories without a valid project config.
			continue
		}
		projects = append(projects, domain.Project{
			ID:            domain.ProjectID(root + "/" + entry.Name()),
			WorkspaceID:   workspaceID,
			Name:          cfg.Name,
			SourceRoots:   cfg.SourceRoots,
			ResourceRoots: cfg.ResourceRoots,
			WebappDir:     cfg.WebappDir,
			OutputDir:     cfg.OutputDir,
			SourceLevel:   cfg.SourceLevel,
			TargetLevel:   cfg.TargetLevel,
			Encoding:      cfg.Encoding,
			BuildTool:     cfg.BuildTool,
			ContextPath:   cfg.ContextPath,
		})
	}
	return projects, nil
}

// Save persists a project config to disk.
func (r *FileProjectRepo) Save(ctx context.Context, project domain.Project) error {
	cfg := &ProjectConfig{
		SchemaVersion: 1,
		Name:          project.Name,
		SourceRoots:   project.SourceRoots,
		ResourceRoots: project.ResourceRoots,
		WebappDir:     project.WebappDir,
		OutputDir:     project.OutputDir,
		SourceLevel:   project.SourceLevel,
		TargetLevel:   project.TargetLevel,
		Encoding:      project.Encoding,
		BuildTool:     project.BuildTool,
		ContextPath:   project.ContextPath,
	}
	return SaveProjectConfig(string(project.ID), cfg)
}

// Delete removes a project's config file from disk.
func (r *FileProjectRepo) Delete(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) error {
	path := projectConfigPath(string(projectID))
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("remove project config %s: %w", path, err)
	}
	return nil
}