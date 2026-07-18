package app

import (
	"context"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// ImportProjectCommand is the input for importing a project into a workspace.
type ImportProjectCommand struct {
	WorkspaceID domain.WorkspaceID
	ProjectRoot string
	Name        string
}

// ProjectService defines the use case operations for project management.
type ProjectService interface {
	Import(ctx context.Context, cmd ImportProjectCommand) (*domain.Project, error)
	Get(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*domain.Project, error)
	List(ctx context.Context, workspaceID domain.WorkspaceID) ([]domain.Project, error)
}