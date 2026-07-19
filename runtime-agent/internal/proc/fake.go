package proc

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

type FakeProcessBehavior struct {
	ExitCode       int
	ExitAfter      time.Duration
	IgnoreGraceful bool
	LogLines       []string
	LogLineCount   int
	LogLineSize    int
	PartialWrites  bool
	Crash          bool
	StartErr       error
	ReadyAfter     time.Duration
	OnGracefulStop func()
	OnForceStop    func()
	ChildProcesses int
}

type FakeProcess struct {
	mu         sync.Mutex
	behavior   FakeProcessBehavior
	running    bool
	started    bool
	identity   domain.ProcessIdentity
	exitCode   *int
	listeners  map[uint64]LogListener
	listenerID uint64
	logBuf     *ringLogBuffer
	stopCh     chan struct{}
	stopOnce   sync.Once
	pidSeq     atomic.Int64
	waitCh     chan struct{}
	waitOnce   sync.Once
	generation uint64
	stopCount  atomic.Int32
	forceCount atomic.Int32
}

func NewFakeProcess(behavior FakeProcessBehavior) *FakeProcess {
	return &FakeProcess{
		behavior:  behavior,
		listeners: make(map[uint64]LogListener),
		logBuf:    newRingLogBuffer(10000, 1024*1024),
		waitCh:    make(chan struct{}),
		stopCh:    make(chan struct{}),
	}
}

func NewFakeManagedProcess(behavior FakeProcessBehavior) ManagedProcess {
	fp := &FakeProcess{
		behavior:  behavior,
		listeners: make(map[uint64]LogListener),
		logBuf:    newRingLogBuffer(10000, 1024*1024),
		waitCh:    make(chan struct{}),
		stopCh:    make(chan struct{}),
	}
	close(fp.waitCh)
	return fp
}

func (f *FakeProcess) Start(ctx context.Context, spec ProcessSpec) (ProcessObservation, error) {
	f.mu.Lock()
	if f.running {
		f.mu.Unlock()
		return ProcessObservation{}, fmt.Errorf("cannot start: already running")
	}
	if f.behavior.StartErr != nil {
		f.mu.Unlock()
		return ProcessObservation{}, f.behavior.StartErr
	}

	f.generation++
	f.waitCh = make(chan struct{})
	f.waitOnce = sync.Once{}
	f.stopCh = make(chan struct{})
	f.stopOnce = sync.Once{}
	f.logBuf = newRingLogBuffer(10000, 1024*1024)
	f.running = true
	f.started = true

	pid := int(f.pidSeq.Add(1)) + 100000
	now := time.Now()
	f.identity = domain.ProcessIdentity{
		PID:          pid,
		Executable:   spec.Executable,
		StartTime:    now,
		CatalinaBase: spec.CatalinaBase,
		MarkerToken:  spec.MarkerToken,
	}
	f.exitCode = nil

	behavior := f.behavior
	gen := f.generation
	stopCh := f.stopCh
	f.mu.Unlock()

	go f.runSimulation(ctx, behavior, gen, pid, stopCh)

	obs := ProcessObservation{
		PID:      pid,
		Identity: f.identity,
		Running:  true,
	}
	return obs, nil
}

func (f *FakeProcess) runSimulation(ctx context.Context, behavior FakeProcessBehavior, gen uint64, pid int, stopCh chan struct{}) {
	if behavior.ReadyAfter > 0 {
		select {
		case <-time.After(behavior.ReadyAfter):
		case <-ctx.Done():
			f.exitProcess(gen, -1)
			return
		case <-stopCh:
			f.exitProcess(gen, 0)
			return
		}
	}

	f.emitLogs(behavior, gen)

	if behavior.ExitAfter > 0 {
		select {
		case <-time.After(behavior.ExitAfter):
			if behavior.Crash {
				f.exitProcess(gen, 1)
				return
			}
			if !behavior.IgnoreGraceful {
				f.exitProcess(gen, behavior.ExitCode)
				return
			}
		case <-ctx.Done():
			f.exitProcess(gen, -1)
			return
		case <-stopCh:
			f.exitProcess(gen, 0)
			return
		}
	} else {
		if behavior.Crash {
			f.exitProcess(gen, 1)
			return
		}
		if !behavior.IgnoreGraceful {
			f.exitProcess(gen, behavior.ExitCode)
			return
		}
	}

	select {
	case <-ctx.Done():
		f.exitProcess(gen, -1)
	case <-stopCh:
		f.exitProcess(gen, -1)
	}
}

func (f *FakeProcess) emitLogs(behavior FakeProcessBehavior, gen uint64) {
	emit := func(text string) {
		ll := domain.LogLine{
			Stream:     domain.LogStreamStdout,
			Time:       time.Now(),
			Text:       text,
			Generation: gen,
		}
		f.mu.Lock()
		f.logBuf.append(ll)
		var ls []LogListener
		for _, l := range f.listeners {
			ls = append(ls, l)
		}
		f.mu.Unlock()
		for _, l := range ls {
			l(ll)
		}
	}

	if behavior.LogLineCount > 0 {
		line := strings.Repeat("A", behavior.LogLineSize)
		for i := 0; i < behavior.LogLineCount; i++ {
			emit(fmt.Sprintf("%s %d", line, i))
		}
	} else if len(behavior.LogLines) > 0 {
		if behavior.PartialWrites {
			var joined string
			for i, l := range behavior.LogLines {
				if i > 0 {
					joined += "\n"
				}
				joined += l
			}
			data := []byte(joined)
			chunkSize := 3
			var pending []byte
			for i := 0; i < len(data); i += chunkSize {
				end := i + chunkSize
				if end > len(data) {
					end = len(data)
				}
				pending = append(pending, data[i:end]...)
				for {
					nlIdx := -1
					for j, b := range pending {
						if b == '\n' {
							nlIdx = j
							break
						}
					}
					if nlIdx == -1 {
						break
					}
					emit(string(pending[:nlIdx]))
					pending = pending[nlIdx+1:]
				}
				time.Sleep(1 * time.Millisecond)
			}
			if len(pending) > 0 {
				emit(string(pending))
			}
		} else {
			for _, line := range behavior.LogLines {
				emit(line)
			}
		}
	}
}

func (f *FakeProcess) exitProcess(gen uint64, code int) {
	f.mu.Lock()
	if f.generation != gen {
		f.mu.Unlock()
		return
	}
	f.running = false
	c := code
	f.exitCode = &c
	f.mu.Unlock()
	f.stopOnce.Do(func() { close(f.stopCh) })
	f.waitOnce.Do(func() { close(f.waitCh) })
}

func (f *FakeProcess) Wait() {
	<-f.waitCh
}

func (f *FakeProcess) GracefulStop(ctx context.Context, identity domain.ProcessIdentity) error {
	f.stopCount.Add(1)
	f.mu.Lock()
	if !f.running {
		f.mu.Unlock()
		return nil
	}
	if f.identity.PID != identity.PID {
		f.mu.Unlock()
		return domain.ErrProcessIdentityMismatch
	}
	ignore := f.behavior.IgnoreGraceful
	onGraceful := f.behavior.OnGracefulStop
	stopCh := f.stopCh
	stopOnce := &f.stopOnce
	f.mu.Unlock()

	if onGraceful != nil {
		onGraceful()
	}

	if ignore {
		select {
		case <-ctx.Done():
			return f.ForceStop(context.Background(), identity)
		case <-f.waitCh:
			return nil
		}
	}

	stopOnce.Do(func() { close(stopCh) })

	select {
	case <-f.waitCh:
		return nil
	case <-ctx.Done():
		return f.ForceStop(context.Background(), identity)
	}
}

func (f *FakeProcess) ForceStop(ctx context.Context, identity domain.ProcessIdentity) error {
	f.forceCount.Add(1)
	f.mu.Lock()
	if !f.running {
		f.mu.Unlock()
		return nil
	}
	if f.identity.PID != identity.PID {
		f.mu.Unlock()
		return domain.ErrProcessIdentityMismatch
	}
	onForce := f.behavior.OnForceStop
	gen := f.generation
	stopCh := f.stopCh
	stopOnce := &f.stopOnce
	f.mu.Unlock()

	if onForce != nil {
		onForce()
	}

	stopOnce.Do(func() { close(stopCh) })
	f.exitProcess(gen, -1)

	select {
	case <-f.waitCh:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (f *FakeProcess) Inspect(ctx context.Context, identity domain.ProcessIdentity) (ProcessObservation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	running := f.running
	pid := f.identity.PID
	ic := f.identity
	var ec *int
	if f.exitCode != nil {
		c := *f.exitCode
		ec = &c
	}
	mismatch := false
	if running && pid > 0 && identity.PID != 0 && identity.PID != pid {
		mismatch = true
	}
	return ProcessObservation{
		PID:              pid,
		Identity:         ic,
		Running:          running,
		ExitCode:         ec,
		IdentityMismatch: mismatch,
	}, nil
}

func (f *FakeProcess) SubscribeLogs(listener LogListener) Disposable {
	f.mu.Lock()
	id := f.listenerID
	f.listenerID++
	f.listeners[id] = listener
	existing := f.logBuf.snapshot()
	f.mu.Unlock()

	for _, line := range existing {
		listener(line)
	}

	return &fakeSubscription{f: f, id: id}
}

func (f *FakeProcess) removeListener(id uint64) {
	f.mu.Lock()
	delete(f.listeners, id)
	f.mu.Unlock()
}

func (f *FakeProcess) StopCount() int  { return int(f.stopCount.Load()) }
func (f *FakeProcess) ForceCount() int { return int(f.forceCount.Load()) }

// SetBehavior updates the behavior of the fake process.
// Used to simulate changes like crashes or unresponsiveness.
func (f *FakeProcess) SetBehavior(b FakeProcessBehavior) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.behavior = b
}

// SetIdentity updates the process identity. Used to simulate
// PID reuse scenarios where the PID now belongs to a different process.
func (f *FakeProcess) SetIdentity(id domain.ProcessIdentity) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.identity = id
}

func (f *FakeProcess) IsRunning() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.running
}

type fakeSubscription struct {
	f  *FakeProcess
	id uint64
}

func (s *fakeSubscription) Dispose() {
	s.f.removeListener(s.id)
}

var _ ManagedProcess = (*FakeProcess)(nil)
