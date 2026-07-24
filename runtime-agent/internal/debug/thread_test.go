package debug

import (
	"testing"
)

func TestThreadManager_AddAndGet(t *testing.T) {
	tm := NewThreadManager()
	tm.AddThread(&Thread{
		ID:     100,
		Name:   "main",
		Status: ThreadStatusRunning,
	})

	th, ok := tm.GetThread(100)
	if !ok {
		t.Fatal("should find thread 100")
	}
	if th.Name != "main" {
		t.Errorf("expected 'main', got %q", th.Name)
	}
	if th.Status != ThreadStatusRunning {
		t.Errorf("expected running, got %d", th.Status)
	}
}

func TestThreadManager_RemoveThread(t *testing.T) {
	tm := NewThreadManager()
	tm.AddThread(&Thread{ID: 100, Name: "main"})
	tm.AddThread(&Thread{ID: 200, Name: "worker"})

	tm.RemoveThread(100)
	if tm.Count() != 1 {
		t.Errorf("expected 1, got %d", tm.Count())
	}

	_, ok := tm.GetThread(100)
	if ok {
		t.Error("thread 100 should be removed")
	}

	_, ok = tm.GetThread(200)
	if !ok {
		t.Error("thread 200 should still exist")
	}
}

func TestThreadManager_RemoveCurrentThread(t *testing.T) {
	tm := NewThreadManager()
	tm.AddThread(&Thread{ID: 100, Name: "main"})
	tm.SetCurrentThread(100)

	if tm.GetCurrentThread() != 100 {
		t.Errorf("expected 100, got %d", tm.GetCurrentThread())
	}

	tm.RemoveThread(100)
	if tm.GetCurrentThread() != 0 {
		t.Errorf("expected 0 after removing current, got %d", tm.GetCurrentThread())
	}
}

func TestThreadManager_ListThreads(t *testing.T) {
	tm := NewThreadManager()
	tm.AddThread(&Thread{ID: 100, Name: "main"})
	tm.AddThread(&Thread{ID: 200, Name: "worker"})
	tm.AddThread(&Thread{ID: 300, Name: "GC"})

	list := tm.ListThreads()
	if len(list) != 3 {
		t.Errorf("expected 3, got %d", len(list))
	}
}

func TestThreadManager_SuspendResume(t *testing.T) {
	tm := NewThreadManager()
	tm.AddThread(&Thread{ID: 100, Name: "main"})

	err := tm.SuspendThread(100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	th, _ := tm.GetThread(100)
	if !th.IsSuspended {
		t.Error("thread should be suspended")
	}
	if th.SuspendCount != 1 {
		t.Errorf("suspend count = %d, want 1", th.SuspendCount)
	}

	err = tm.ResumeThread(100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	th, _ = tm.GetThread(100)
	if th.IsSuspended {
		t.Error("thread should not be suspended after resume")
	}
	if th.SuspendCount != 0 {
		t.Errorf("suspend count = %d, want 0", th.SuspendCount)
	}

	err = tm.SuspendThread(999)
	if err == nil {
		t.Error("expected error for nonexistent thread")
	}

	err = tm.ResumeThread(999)
	if err == nil {
		t.Error("expected error for nonexistent thread")
	}
}

func TestThreadManager_MultipleSuspend(t *testing.T) {
	tm := NewThreadManager()
	tm.AddThread(&Thread{ID: 100, Name: "main"})

	tm.SuspendThread(100)
	tm.SuspendThread(100)
	th, _ := tm.GetThread(100)
	if th.SuspendCount != 2 {
		t.Errorf("suspend count = %d, want 2", th.SuspendCount)
	}

	tm.ResumeThread(100)
	th, _ = tm.GetThread(100)
	if th.SuspendCount != 1 {
		t.Errorf("suspend count = %d, want 1", th.SuspendCount)
	}
	if !th.IsSuspended {
		t.Error("should still be suspended with count 1")
	}

	tm.ResumeThread(100)
	th, _ = tm.GetThread(100)
	if th.IsSuspended {
		t.Error("should not be suspended after count reaches 0")
	}
}

func TestThreadManager_CurrentThread(t *testing.T) {
	tm := NewThreadManager()
	tm.AddThread(&Thread{ID: 100, Name: "main"})
	tm.AddThread(&Thread{ID: 200, Name: "worker"})

	if tm.GetCurrentThread() != 0 {
		t.Errorf("expected 0 initially, got %d", tm.GetCurrentThread())
	}

	tm.SetCurrentThread(200)
	if tm.GetCurrentThread() != 200 {
		t.Errorf("expected 200, got %d", tm.GetCurrentThread())
	}

	tm.SetCurrentThread(100)
	if tm.GetCurrentThread() != 100 {
		t.Errorf("expected 100, got %d", tm.GetCurrentThread())
	}
}

func TestThreadManager_GetOrCreateThread(t *testing.T) {
	tm := NewThreadManager()

	th := tm.GetOrCreateThread(100, "main")
	if th.Name != "main" {
		t.Errorf("expected 'main', got %q", th.Name)
	}
	if th.ID != 100 {
		t.Errorf("expected 100, got %d", th.ID)
	}

	// GetOrCreate with empty name should not overwrite
	th2 := tm.GetOrCreateThread(100, "")
	if th2.Name != "main" {
		t.Errorf("name should not be overwritten, got %q", th2.Name)
	}

	// GetOrCreate with new name should update
	th3 := tm.GetOrCreateThread(100, "renamed")
	if th3.Name != "renamed" {
		t.Errorf("expected 'renamed', got %q", th3.Name)
	}
}

func TestThreadManager_ThreadGroups(t *testing.T) {
	tm := NewThreadManager()
	tg := &ThreadGroup{
		ID:   1,
		Name: "main",
	}
	tm.AddThreadGroup(tg)

	retrieved, ok := tm.GetThreadGroup(1)
	if !ok {
		t.Fatal("should find thread group")
	}
	if retrieved.Name != "main" {
		t.Errorf("expected 'main', got %q", retrieved.Name)
	}

	_, ok = tm.GetThreadGroup(999)
	if ok {
		t.Error("should not find nonexistent group")
	}

	groups := tm.ListThreadGroups()
	if len(groups) != 1 {
		t.Errorf("expected 1, got %d", len(groups))
	}
}

func TestThreadManager_Clear(t *testing.T) {
	tm := NewThreadManager()
	tm.AddThread(&Thread{ID: 100, Name: "main"})
	tm.AddThread(&Thread{ID: 200, Name: "worker"})
	tm.AddThreadGroup(&ThreadGroup{ID: 1, Name: "main"})
	tm.SetCurrentThread(100)

	tm.Clear()
	if tm.Count() != 0 {
		t.Errorf("expected 0 threads, got %d", tm.Count())
	}
	if len(tm.ListThreadGroups()) != 0 {
		t.Error("expected 0 groups")
	}
	if tm.GetCurrentThread() != 0 {
		t.Errorf("expected 0, got %d", tm.GetCurrentThread())
	}
}

// ── Command Builder Tests ─────────────────────────────────────────

func TestBuildSuspendResumeThreadCommand(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{"suspend", BuildSuspendThreadCommand(42)},
		{"resume", BuildResumeThreadCommand(42)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewJDWPDataReader(tt.data)
			id, err := r.ReadObjectID()
			if err != nil {
				t.Fatal(err)
			}
			if id != 42 {
				t.Errorf("threadID = %d, want 42", id)
			}
		})
	}
}

func TestBuildSuspendAllResumeAllCommands(t *testing.T) {
	data := BuildSuspendAllThreadsCommand()
	if len(data) != 0 {
		t.Errorf("SuspendAll should have no data, got %d bytes", len(data))
	}

	data = BuildResumeAllThreadsCommand()
	if len(data) != 0 {
		t.Errorf("ResumeAll should have no data, got %d bytes", len(data))
	}
}

func TestBuildThreadGroupCommands(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{"name", BuildThreadGroupNameCommand(100)},
		{"children", BuildThreadGroupChildrenCommand(100)},
		{"parent", BuildThreadGroupParentCommand(100)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewJDWPDataReader(tt.data)
			id, err := r.ReadObjectID()
			if err != nil {
				t.Fatal(err)
			}
			if id != 100 {
				t.Errorf("groupID = %d, want 100", id)
			}
		})
	}
}

// ── ParseThreadInfoList Tests ─────────────────────────────────────

func TestParseThreadInfoList(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(2)
	w.WriteObjectID(100)
	w.WriteObjectID(200)
	data := w.Bytes()

	nameMap := map[int64]string{
		100: "main",
		200: "worker",
	}
	statusMap := map[int64][2]int32{
		100: {ThreadStatusRunning, 0},
		200: {ThreadStatusSleeping, 1},
	}

	threads, err := ParseThreadInfoList(data, nameMap, statusMap)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(threads) != 2 {
		t.Fatalf("expected 2 threads, got %d", len(threads))
	}

	if threads[0].Name != "main" {
		t.Errorf("thread[0].Name = %q, want main", threads[0].Name)
	}
	if threads[0].IsSuspended {
		t.Error("thread[0] should not be suspended")
	}

	if threads[1].Name != "worker" {
		t.Errorf("thread[1].Name = %q, want worker", threads[1].Name)
	}
	if !threads[1].IsSuspended {
		t.Error("thread[1] should be suspended")
	}
}

func TestParseThreadInfoList_MissingNames(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(1)
	w.WriteObjectID(42)
	data := w.Bytes()

	threads, err := ParseThreadInfoList(data, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if threads[0].Name != "Thread-42" {
		t.Errorf("expected 'Thread-42', got %q", threads[0].Name)
	}
}

func TestParseThreadInfoList_Truncated(t *testing.T) {
	_, err := ParseThreadInfoList([]byte{0x00}, nil, nil)
	if err == nil {
		t.Error("expected error for truncated data")
	}
}

// ── Concurrency Tests ─────────────────────────────────────────────

func TestThreadManager_Concurrency(t *testing.T) {
	tm := NewThreadManager()
	done := make(chan bool)

	go func() {
		for i := 0; i < 50; i++ {
			tm.AddThread(&Thread{ID: int64(i), Name: "t"})
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 50; i++ {
			tm.ListThreads()
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 50; i++ {
			tm.SetCurrentThread(int64(i))
			tm.GetCurrentThread()
		}
		done <- true
	}()

	<-done
	<-done
	<-done
}

// ── Thread / ThreadGroup Struct Tests ─────────────────────────────

func TestThread_Struct(t *testing.T) {
	th := &Thread{
		ID:           100,
		Name:         "main",
		Status:       ThreadStatusRunning,
		SuspendCount: 1,
		IsSuspended:  true,
		IsDaemon:     false,
		Priority:     5,
		GroupName:    "main",
		GroupID:      1,
		FrameCount:   10,
	}

	if th.ID != 100 {
		t.Errorf("ID = %d", th.ID)
	}
	if !th.IsSuspended {
		t.Error("IsSuspended should be true")
	}
	if th.IsDaemon {
		t.Error("IsDaemon should be false")
	}
}

func TestThreadGroup_Struct(t *testing.T) {
	tg := &ThreadGroup{
		ID:       1,
		Name:     "main",
		ParentID: 0,
		Children: []*ThreadGroup{
			{ID: 2, Name: "subgroup"},
		},
		Threads: []*Thread{
			{ID: 100, Name: "main-thread"},
		},
	}

	if tg.ID != 1 {
		t.Errorf("ID = %d", tg.ID)
	}
	if len(tg.Children) != 1 {
		t.Errorf("expected 1 child, got %d", len(tg.Children))
	}
	if len(tg.Threads) != 1 {
		t.Errorf("expected 1 thread, got %d", len(tg.Threads))
	}
}