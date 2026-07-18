package app

import (
	"context"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// StartServerCommand is the input for starting a server instance.
type StartServerCommand struct {
	WorkspaceID domain.WorkspaceID
	ProjectID   domain.ProjectID
}

// ServerUseCaseConfig holds configuration for the server use case.
type ServerUseCaseConfig struct {
	StartTimeout time.Duration
	StopTimeout  time.Duration
}

// ServerUseCase defines the use case operations for server lifecycle management.
type ServerUseCase interface {
	Start(ctx context.Context, cmd StartServerCommand) (*domain.ServerInstance, error)
	Stop(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID, force bool) error
	Restart(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerInstance, error)
	Get(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerInstance, error)
	List(ctx context.Context, workspaceID domain.WorkspaceID) ([]domain.ServerInstance, error)
	Reconcile(ctx context.Context) error
}