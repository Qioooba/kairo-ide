package app

import (
	"context"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

type StartBuildCommand struct {
	WorkspaceID   domain.WorkspaceID
	ProjectID     domain.ProjectID
	Clean         bool
	Intent        domain.BuildIntent
	SelectedFiles []string
}

type BuildEventPublisher interface {
	PublishBuildEvent(ctx context.Context, event domain.BuildEvent) error
}

type BuildUseCase interface {
	Start(ctx context.Context, cmd StartBuildCommand) (*domain.BuildRun, error)
	Get(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) (*domain.BuildRun, error)
	List(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, limit int) ([]domain.BuildRun, error)
	Cancel(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) error
	Shutdown(ctx context.Context) error
}
