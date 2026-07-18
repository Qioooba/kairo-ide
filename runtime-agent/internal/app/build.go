package app

import (
	"context"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// StartBuildCommand is the input for starting a build.
type StartBuildCommand struct {
	WorkspaceID domain.WorkspaceID
	ProjectID   domain.ProjectID
	Clean       bool
	Intent      domain.BuildIntent
}

// BuildUseCase defines the use case operations for build management.
type BuildUseCase interface {
	Start(ctx context.Context, cmd StartBuildCommand) (*domain.BuildRun, error)
	Get(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) (*domain.BuildRun, error)
	List(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, limit int) ([]domain.BuildRun, error)
	Cancel(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) error
}