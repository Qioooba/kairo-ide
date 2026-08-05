package services

import (
	"sync"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/tomcat6"
)

// TestRealServerRunner_MetaWriteRace exercises concurrent List readers
// against Stop/Restart-style meta writers. Under -race this fails if
// m.* fields are mutated outside r.mu.
func TestRealServerRunner_MetaWriteRace(t *testing.T) {
	r := newTestRealServerRunner(t)

	r.mu.Lock()
	r.meta["srv_race"] = &serverMeta{
		ID:           "srv_race",
		ProjectID:    "p1",
		Type:         "tomcat6",
		State:        "running",
		PID:          1,
		Ports:        &tomcat6.Ports{HTTP: 18080, Shutdown: 18005},
		StartedAt:    time.Now(),
		JavaHome:     t.TempDir(),
		ContextPath:  "/",
		WebappDir:    t.TempDir(),
		CatalinaBase: t.TempDir(),
	}
	r.mu.Unlock()

	var wg sync.WaitGroup
	stop := make(chan struct{})

	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				_ = r.List()
				_, _ = r.Get("srv_race")
			}
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			r.mu.Lock()
			if m := r.meta["srv_race"]; m != nil {
				m.State = "stopped"
				m.LastError = ""
				m.PID = i
				ports := &tomcat6.Ports{HTTP: 18080 + (i % 10), Shutdown: 18005}
				m.Ports = ports
				m.State = "running"
			}
			r.mu.Unlock()
		}
	}()

	time.Sleep(50 * time.Millisecond)
	close(stop)
	wg.Wait()
}
