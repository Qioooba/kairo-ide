// Package debug — thread management over JDWP.
//
// Implements thread listing with status, thread suspension/resumption,
// thread group support, and current thread tracking.
package debug

import (
	"fmt"
	"sync"
)

// ThreadStatus constants (extending stackframe.go definitions).
const (
	SuspendStatusNotSuspended = 0
	SuspendStatusSuspended    = 1
)

// Thread represents a managed debug thread with extended metadata.
type Thread struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Status       int32  `json:"status"`
	SuspendCount int32  `json:"suspendCount"`
	IsSuspended  bool   `json:"isSuspended"`
	IsDaemon     bool   `json:"isDaemon,omitempty"`
	Priority     int32  `json:"priority,omitempty"`
	GroupName    string `json:"groupName,omitempty"`
	GroupID      int64  `json:"groupId,omitempty"`
	FrameCount   int32  `json:"frameCount"`
}

// ThreadGroup represents a thread group.
type ThreadGroup struct {
	ID       int64          `json:"id"`
	Name     string         `json:"name"`
	ParentID int64          `json:"parentId,omitempty"`
	Children []*ThreadGroup `json:"children,omitempty"`
	Threads  []*Thread      `json:"threads,omitempty"`
}

// ThreadManager manages thread state and operations.
type ThreadManager struct {
	mu            sync.RWMutex
	threads       map[int64]*Thread
	groups        map[int64]*ThreadGroup
	currentThread int64
}

// NewThreadManager creates a new ThreadManager.
func NewThreadManager() *ThreadManager {
	return &ThreadManager{
		threads: make(map[int64]*Thread),
		groups:  make(map[int64]*ThreadGroup),
	}
}

// AddThread adds or updates a thread.
func (tm *ThreadManager) AddThread(t *Thread) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	tm.threads[t.ID] = t
}

// RemoveThread removes a thread by ID.
func (tm *ThreadManager) RemoveThread(id int64) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	delete(tm.threads, id)
	if tm.currentThread == id {
		tm.currentThread = 0
	}
}

// GetThread returns a thread by ID.
func (tm *ThreadManager) GetThread(id int64) (*Thread, bool) {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	t, ok := tm.threads[id]
	return t, ok
}

// ListThreads returns all threads.
func (tm *ThreadManager) ListThreads() []*Thread {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	result := make([]*Thread, 0, len(tm.threads))
	for _, t := range tm.threads {
		result = append(result, t)
	}
	return result
}

// SuspendThread marks a thread as suspended.
func (tm *ThreadManager) SuspendThread(id int32) error {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	t, ok := tm.threads[int64(id)]
	if !ok {
		return fmt.Errorf("thread %d not found", id)
	}
	t.SuspendCount++
	t.IsSuspended = true
	return nil
}

// ResumeThread marks a thread as resumed.
func (tm *ThreadManager) ResumeThread(id int32) error {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	t, ok := tm.threads[int64(id)]
	if !ok {
		return fmt.Errorf("thread %d not found", id)
	}
	if t.SuspendCount > 0 {
		t.SuspendCount--
	}
	if t.SuspendCount == 0 {
		t.IsSuspended = false
	}
	return nil
}

// SetCurrentThread sets the current thread for debugging.
func (tm *ThreadManager) SetCurrentThread(id int64) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	tm.currentThread = id
}

// GetCurrentThread returns the current thread ID.
func (tm *ThreadManager) GetCurrentThread() int64 {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	return tm.currentThread
}

// GetOrCreateThread returns an existing thread or creates a new one.
func (tm *ThreadManager) GetOrCreateThread(id int64, name string) *Thread {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if t, ok := tm.threads[id]; ok {
		if name != "" {
			t.Name = name
		}
		return t
	}

	t := &Thread{
		ID:     id,
		Name:   name,
		Status: ThreadStatusRunning,
	}
	tm.threads[id] = t
	return t
}

// AddThreadGroup adds a thread group.
func (tm *ThreadManager) AddThreadGroup(tg *ThreadGroup) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	tm.groups[tg.ID] = tg
}

// GetThreadGroup returns a thread group by ID.
func (tm *ThreadManager) GetThreadGroup(id int64) (*ThreadGroup, bool) {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	tg, ok := tm.groups[id]
	return tg, ok
}

// ListThreadGroups returns all thread groups.
func (tm *ThreadManager) ListThreadGroups() []*ThreadGroup {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	result := make([]*ThreadGroup, 0, len(tm.groups))
	for _, tg := range tm.groups {
		result = append(result, tg)
	}
	return result
}

// Count returns the number of threads.
func (tm *ThreadManager) Count() int {
	tm.mu.RLock()
	defer tm.mu.RUnlock()
	return len(tm.threads)
}

// Clear removes all threads and groups.
func (tm *ThreadManager) Clear() {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	tm.threads = make(map[int64]*Thread)
	tm.groups = make(map[int64]*ThreadGroup)
	tm.currentThread = 0
}

// ── JDWP Command Builders for Thread Management ───────────────────

// BuildSuspendThreadCommand builds a ThreadReference.Suspend command.
func BuildSuspendThreadCommand(threadID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(threadID)
	return w.Bytes()
}

// BuildResumeThreadCommand builds a ThreadReference.Resume command.
func BuildResumeThreadCommand(threadID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(threadID)
	return w.Bytes()
}

// BuildSuspendAllThreadsCommand builds a VirtualMachine.Suspend command.
func BuildSuspendAllThreadsCommand() []byte {
	return NewJDWPDataWriter().Bytes()
}

// BuildResumeAllThreadsCommand builds a VirtualMachine.Resume command.
func BuildResumeAllThreadsCommand() []byte {
	return NewJDWPDataWriter().Bytes()
}

// BuildThreadGroupNameCommand builds a ThreadGroupReference.Name command.
func BuildThreadGroupNameCommand(groupID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(groupID)
	return w.Bytes()
}

// BuildThreadGroupChildrenCommand builds a ThreadGroupReference.Children command.
func BuildThreadGroupChildrenCommand(groupID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(groupID)
	return w.Bytes()
}

// BuildThreadGroupParentCommand builds a ThreadGroupReference.Parent command.
func BuildThreadGroupParentCommand(groupID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(groupID)
	return w.Bytes()
}

// ── Thread Parsing Helpers ─────────────────────────────────────────

// ParseThreadInfoList parses a list of thread info from JDWP reply data.
// This is a convenience wrapper that combines thread list, name, and
// status parsing.
func ParseThreadInfoList(threadData []byte, nameMap map[int64]string, statusMap map[int64][2]int32) ([]*Thread, error) {
	r := NewJDWPDataReader(threadData)
	count, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("parse thread count: %w", err)
	}

	result := make([]*Thread, 0, count)
	for i := int32(0); i < count; i++ {
		threadID, err := r.ReadObjectID()
		if err != nil {
			return nil, fmt.Errorf("parse thread %d ID: %w", i, err)
		}

		name := nameMap[threadID]
		if name == "" {
			name = fmt.Sprintf("Thread-%d", threadID)
		}

		status := int32(ThreadStatusRunning)
		suspendCount := int32(0)
		if s, ok := statusMap[threadID]; ok {
			status = s[0]
			suspendCount = s[1]
		}

		result = append(result, &Thread{
			ID:           threadID,
			Name:         name,
			Status:       status,
			SuspendCount: suspendCount,
			IsSuspended:  suspendCount > 0,
		})
	}

	return result, nil
}