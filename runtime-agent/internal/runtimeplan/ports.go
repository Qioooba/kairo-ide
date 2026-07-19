package runtimeplan

import (
	"fmt"
	"net"
	"sync"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// PortAllocator implementations. The PortAllocator interface itself lives in
// package domain so that the app layer can depend on it without importing
// runtimeplan.

type PortConfig struct {
	HTTPMin     int
	HTTPMax     int
	ShutdownMin int
	ShutdownMax int
	DebugMin    int
	DebugMax    int
}

func DefaultPortConfig() PortConfig {
	return PortConfig{
		HTTPMin:     18080,
		HTTPMax:     18999,
		ShutdownMin: 18005,
		ShutdownMax: 18099,
		DebugMin:    18000,
		DebugMax:    18049,
	}
}

type DefaultPortAllocator struct {
	mu      sync.Mutex
	config  PortConfig
	inUse   map[int]bool
	counter int
}

func NewDefaultPortAllocator(cfg PortConfig) *DefaultPortAllocator {
	return &DefaultPortAllocator{
		config: cfg,
		inUse:  make(map[int]bool),
	}
}

func (a *DefaultPortAllocator) Allocate(preferredHTTP, preferredShutdown, preferredDebug int) (*domain.PortLease, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	httpPort, err := a.allocateOne(preferredHTTP, a.config.HTTPMin, a.config.HTTPMax)
	if err != nil {
		return nil, fmt.Errorf("http port: %w", err)
	}

	shutdownPort, err := a.allocateOne(preferredShutdown, a.config.ShutdownMin, a.config.ShutdownMax, httpPort)
	if err != nil {
		a.releaseOne(httpPort)
		return nil, fmt.Errorf("shutdown port: %w", err)
	}

	debugPort, err := a.allocateOne(preferredDebug, a.config.DebugMin, a.config.DebugMax, httpPort, shutdownPort)
	if err != nil {
		a.releaseOne(httpPort)
		a.releaseOne(shutdownPort)
		return nil, fmt.Errorf("debug port: %w", err)
	}

	release := func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		a.releaseOne(httpPort)
		a.releaseOne(shutdownPort)
		a.releaseOne(debugPort)
	}

	return domain.NewPortLease(httpPort, shutdownPort, debugPort, release), nil
}

func (a *DefaultPortAllocator) allocateOne(preferred, min, max int, exclude ...int) (int, error) {
	excludeSet := make(map[int]bool)
	for _, p := range exclude {
		excludeSet[p] = true
	}

	if preferred > 0 && !excludeSet[preferred] && !a.inUse[preferred] {
		if portAvailable(preferred) {
			a.inUse[preferred] = true
			return preferred, nil
		}
	}

	a.counter++
	start := (a.counter) % (max - min + 1)
	for i := 0; i <= max-min; i++ {
		port := min + ((start + i) % (max - min + 1))
		if excludeSet[port] || a.inUse[port] {
			continue
		}
		if portAvailable(port) {
			a.inUse[port] = true
			return port, nil
		}
	}

	return 0, fmt.Errorf("no available ports in range %d-%d", min, max)
}

func (a *DefaultPortAllocator) releaseOne(port int) {
	delete(a.inUse, port)
}

func portAvailable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

type FakePortAllocator struct {
	mu        sync.Mutex
	nextHTTP  int
	nextShut  int
	nextDebug int
	leased    []*domain.PortLease
	fail      bool
}

func NewFakePortAllocator() *FakePortAllocator {
	return &FakePortAllocator{
		nextHTTP:  18080,
		nextShut:  18005,
		nextDebug: 18000,
	}
}

func (f *FakePortAllocator) SetFail(fail bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fail = fail
}

func (f *FakePortAllocator) Allocate(preferredHTTP, preferredShutdown, preferredDebug int) (*domain.PortLease, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.fail {
		return nil, fmt.Errorf("port allocation failed")
	}

	httpPort := preferredHTTP
	if httpPort <= 0 {
		httpPort = f.nextHTTP
		f.nextHTTP++
	}
	shutdownPort := preferredShutdown
	if shutdownPort <= 0 {
		shutdownPort = f.nextShut
		f.nextShut++
	}
	debugPort := preferredDebug
	if debugPort <= 0 {
		debugPort = f.nextDebug
		f.nextDebug++
	}

	var lease *domain.PortLease
	release := func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		for i, l := range f.leased {
			if l == lease {
				f.leased = append(f.leased[:i], f.leased[i+1:]...)
				break
			}
		}
	}
	lease = domain.NewPortLease(httpPort, shutdownPort, debugPort, release)
	f.leased = append(f.leased, lease)
	return lease, nil
}

// Leased returns a snapshot of currently outstanding leases for test inspection.
func (f *FakePortAllocator) Leased() []*domain.PortLease {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*domain.PortLease, len(f.leased))
	copy(out, f.leased)
	return out
}
