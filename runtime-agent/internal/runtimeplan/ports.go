package runtimeplan

import (
	"fmt"
	"net"
	"sync"
)

type PortLease struct {
	HTTP     int
	Shutdown int
	Debug    int
	release  func()
}

func (l *PortLease) Release() {
	if l != nil && l.release != nil {
		l.release()
		l.HTTP = 0
		l.Shutdown = 0
		l.Debug = 0
		l.release = nil
	}
}

type PortAllocator interface {
	Allocate(preferredHTTP, preferredShutdown, preferredDebug int) (*PortLease, error)
}

type DefaultPortAllocator struct {
	mu      sync.Mutex
	config  PortConfig
	inUse   map[int]bool
	counter int
}

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

func NewDefaultPortAllocator(cfg PortConfig) *DefaultPortAllocator {
	return &DefaultPortAllocator{
		config: cfg,
		inUse:  make(map[int]bool),
	}
}

func (a *DefaultPortAllocator) Allocate(preferredHTTP, preferredShutdown, preferredDebug int) (*PortLease, error) {
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

	lease := &PortLease{
		HTTP:     httpPort,
		Shutdown: shutdownPort,
		Debug:    debugPort,
	}

	release := func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		a.releaseOne(httpPort)
		a.releaseOne(shutdownPort)
		a.releaseOne(debugPort)
	}
	lease.release = release

	return lease, nil
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
	leased    []*PortLease
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

func (f *FakePortAllocator) Allocate(preferredHTTP, preferredShutdown, preferredDebug int) (*PortLease, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.fail {
		return nil, fmt.Errorf("port allocation failed")
	}

	f.nextHTTP++
	f.nextShut++
	f.nextDebug++

	lease := &PortLease{
		HTTP:     f.nextHTTP - 1,
		Shutdown: f.nextShut - 1,
		Debug:    f.nextDebug - 1,
	}
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
	lease.release = release
	f.leased = append(f.leased, lease)
	return lease, nil
}
