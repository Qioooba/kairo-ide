package app

import (
	"context"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

type ServerUseCaseConfig struct {
	StartTimeout      time.Duration
	StopTimeout       time.Duration
	ShutdownTimeout   time.Duration
	InspectTimeout    time.Duration
	LogBufferSize     int
	StopServersOnExit bool
}

type ServerUseCase interface {
	Start(ctx context.Context, cmd domain.StartServerCommand) (*domain.ServerRecord, error)
	Stop(ctx context.Context, cmd domain.StopServerCommand) (*domain.ServerRecord, error)
	Restart(ctx context.Context, cmd domain.RestartServerCommand) (*domain.ServerRecord, error)
	Get(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID) (*domain.ServerRecord, error)
	List(ctx context.Context, ws domain.WorkspaceID) ([]*domain.ServerRecord, error)
	Reconcile(ctx context.Context) error
	Shutdown(ctx context.Context) ([]*domain.ServerRecord, error)
	GetLogs(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID, cursor int, limit int) ([]domain.LogLine, int, error)
}
