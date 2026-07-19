package app

import (
	"context"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/runtimeplan"
)

type ServerUseCaseConfig struct {
	StartTimeout      time.Duration
	StopTimeout       time.Duration
	ShutdownTimeout   time.Duration
	InspectTimeout    time.Duration
	LogBufferSize     int
	StopServersOnExit bool
	// PortAllocator reserves HTTP/Shutdown/Debug ports for each server
	// started through the UseCase. If nil, a DefaultPortAllocator with
	// DefaultPortConfig is used. The UseCase owns the resulting PortLease
	// and releases it on stop, restart, failure, or shutdown.
	PortAllocator domain.PortAllocator
}

// defaultPortAllocator returns the config's PortAllocator or a freshly
// constructed DefaultPortAllocator if none was provided.
func defaultPortAllocator(a domain.PortAllocator) domain.PortAllocator {
	if a != nil {
		return a
	}
	return runtimeplan.NewDefaultPortAllocator(runtimeplan.DefaultPortConfig())
}

type ServerUseCase interface {
	Start(ctx context.Context, cmd domain.StartServerCommand) (*domain.ServerRecord, error)
	Stop(ctx context.Context, cmd domain.StopServerCommand) (*domain.ServerRecord, error)
	Restart(ctx context.Context, cmd domain.RestartServerCommand) (*domain.ServerRecord, error)
	Get(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID) (*domain.ServerRecord, error)
	List(ctx context.Context, ws domain.WorkspaceID) ([]*domain.ServerRecord, error)
	Reconcile(ctx context.Context) error
	Shutdown(ctx context.Context) ([]*domain.ServerRecord, error)
	GetLogs(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID, cursor int, limit int) ([]domain.LogLine, int, bool, error)
}
