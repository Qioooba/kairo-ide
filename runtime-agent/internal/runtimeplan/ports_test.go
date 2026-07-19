package runtimeplan

import (
	"fmt"
	"net"
	"sync"
	"testing"
)

func TestFakePortAllocator(t *testing.T) {
	pa := NewFakePortAllocator()

	lease, err := pa.Allocate(0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if lease.HTTP == 0 || lease.Shutdown == 0 || lease.Debug == 0 {
		t.Error("ports should be non-zero")
	}
	if lease.HTTP == lease.Shutdown || lease.HTTP == lease.Debug || lease.Shutdown == lease.Debug {
		t.Error("ports should be distinct")
	}

	lease.Release()
	if lease.HTTP != 0 {
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

func TestDefaultPortAllocator(t *testing.T) {
	cfg := DefaultPortConfig()
	pa := NewDefaultPortAllocator(cfg)

	lease, err := pa.Allocate(0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Release()

	if lease.HTTP < cfg.HTTPMin || lease.HTTP > cfg.HTTPMax {
		t.Errorf("HTTP port %d out of range", lease.HTTP)
	}
	if lease.Shutdown < cfg.ShutdownMin || lease.Shutdown > cfg.ShutdownMax {
		t.Errorf("Shutdown port %d out of range", lease.Shutdown)
	}
	if lease.Debug < cfg.DebugMin || lease.Debug > cfg.DebugMax {
		t.Errorf("Debug port %d out of range", lease.Debug)
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", lease.HTTP))
	if err != nil {
		t.Logf("Note: port %d may already be in use: %v", lease.HTTP, err)
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
		lease.HTTP:     true,
		lease.Shutdown: true,
		lease.Debug:    true,
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
	allLeases := make([]*PortLease, 0)
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
		for _, p := range []int{l.HTTP, l.Shutdown, l.Debug} {
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
