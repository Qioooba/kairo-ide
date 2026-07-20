package runtimeplan

import (
	"fmt"
	"net"
	"sync"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

func TestFakePortAllocator(t *testing.T) {
	pa := NewFakePortAllocator()

	lease, err := pa.Allocate(0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if lease.HTTPPort == 0 || lease.ShutdownPort == 0 || lease.DebugPort == 0 {
		t.Error("ports should be non-zero")
	}
	if lease.HTTPPort == lease.ShutdownPort || lease.HTTPPort == lease.DebugPort || lease.ShutdownPort == lease.DebugPort {
		t.Error("ports should be distinct")
	}

	lease.Release()
	if lease.HTTPPort != 0 {
		t.Error("lease should be released")
	}
}

func TestFakePortAllocatorFail(t *testing.T) {
	pa := NewFakePortAllocator()
	pa.SetFail(true)
	_, err := pa.Allocate(0, 0, 0)
	if err == nil {
		t.Error("expected error")
	}
}

func TestFakePortAllocatorPrefersRequestedPorts(t *testing.T) {
	pa := NewFakePortAllocator()
	lease, err := pa.Allocate(19090, 19091, 19092)
	if err != nil {
		t.Fatal(err)
	}
	if lease.HTTPPort != 19090 || lease.ShutdownPort != 19091 || lease.DebugPort != 19092 {
		t.Errorf("expected requested ports, got http=%d shutdown=%d debug=%d",
			lease.HTTPPort, lease.ShutdownPort, lease.DebugPort)
	}
	lease.Release()
}

func TestDefaultPortAllocator(t *testing.T) {
	cfg := DefaultPortConfig()
	pa := NewDefaultPortAllocator(cfg)

	lease, err := pa.Allocate(0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Release()

	if lease.HTTPPort < cfg.HTTPMin || lease.HTTPPort > cfg.HTTPMax {
		t.Errorf("HTTP port %d out of range", lease.HTTPPort)
	}
	if lease.ShutdownPort < cfg.ShutdownMin || lease.ShutdownPort > cfg.ShutdownMax {
		t.Errorf("Shutdown port %d out of range", lease.ShutdownPort)
	}
	if lease.DebugPort < cfg.DebugMin || lease.DebugPort > cfg.DebugMax {
		t.Errorf("Debug port %d out of range", lease.DebugPort)
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", lease.HTTPPort))
	if err != nil {
		t.Logf("Note: port %d may already be in use: %v", lease.HTTPPort, err)
	} else {
		ln.Close()
	}
}

func TestDefaultPortAllocatorDistinct(t *testing.T) {
	cfg := PortConfig{
		HTTPMin:     28080,
		HTTPMax:     28089,
		ShutdownMin: 28005,
		ShutdownMax: 28009,
		DebugMin:    28000,
		DebugMax:    28004,
	}
	pa := NewDefaultPortAllocator(cfg)

	lease, err := pa.Allocate(0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Release()

	ports := map[int]bool{
		lease.HTTPPort:     true,
		lease.ShutdownPort: true,
		lease.DebugPort:    true,
	}
	if len(ports) != 3 {
		t.Errorf("ports should be distinct, got %v", ports)
	}
}

func TestPortLeaseRelease(t *testing.T) {
	cfg := PortConfig{
		HTTPMin:     38080,
		HTTPMax:     38081,
		ShutdownMin: 38005,
		ShutdownMax: 38005,
		DebugMin:    38000,
		DebugMax:    38000,
	}
	pa := NewDefaultPortAllocator(cfg)

	lease1, err := pa.Allocate(0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	lease1.Release()

	lease2, err := pa.Allocate(0, 0, 0)
	if err != nil {
		t.Fatalf("should be able to allocate after release: %v", err)
	}
	lease2.Release()
}

func TestConcurrentPortAllocation(t *testing.T) {
	cfg := PortConfig{
		HTTPMin:     48080,
		HTTPMax:     48180,
		ShutdownMin: 48005,
		ShutdownMax: 48105,
		DebugMin:    48000,
		DebugMax:    48100,
	}
	pa := NewDefaultPortAllocator(cfg)

	var wg sync.WaitGroup
	var mu sync.Mutex
	allLeases := make([]*domain.PortLease, 0)
	errs := make(chan error, 20)

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			lease, err := pa.Allocate(0, 0, 0)
			if err != nil {
				errs <- err
				return
			}
			mu.Lock()
			allLeases = append(allLeases, lease)
			mu.Unlock()
		}()
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("concurrent alloc error: %v", err)
	}

	portSet := make(map[int]bool)
	mu.Lock()
	for _, l := range allLeases {
		for _, p := range []int{l.HTTPPort, l.ShutdownPort, l.DebugPort} {
			if portSet[p] {
				t.Errorf("duplicate port %d allocated", p)
			}
			portSet[p] = true
		}
	}
	mu.Unlock()

	for _, l := range allLeases {
		l.Release()
	}
}
