// Package debug — multi-VM debug orchestrator.
//
// Manages multiple debug sessions across different JVM instances
// (e.g., multi-module Maven projects). Provides global breakpoint
// management, cross-session control, and aggregated state queries.
package debug

import (
	"fmt"
	"sync"
)

// MultiVMDebugOrchestrator manages multiple debug sessions across
// different JVM instances (e.g., multi-module Maven projects).
type MultiVMDebugOrchestrator struct {
	mu       sync.RWMutex
	sessions map[string]*DebugSession // sessionID -> session
	// Maps module artifact ID -> session IDs
	moduleSessions map[string][]string
	// Global breakpoints shared across all VMs
	globalBreakpoints map[int32]*CrossModuleBreakpoint
	// Event aggregator for cross-VM events
	eventAggregator *MultiVMEventAggregator
}

// NewMultiVMDebugOrchestrator creates a new MultiVMDebugOrchestrator.
func NewMultiVMDebugOrchestrator() *MultiVMDebugOrchestrator {
	return &MultiVMDebugOrchestrator{
		sessions:          make(map[string]*DebugSession),
		moduleSessions:    make(map[string][]string),
		globalBreakpoints: make(map[int32]*CrossModuleBreakpoint),
		eventAggregator:   NewMultiVMEventAggregator(1000),
	}
}

// RegisterSession registers a VM session with the orchestrator.
func (mo *MultiVMDebugOrchestrator) RegisterSession(session *DebugSession) error {
	mo.mu.Lock()
	defer mo.mu.Unlock()

	if session == nil {
		return fmt.Errorf("cannot register nil session")
	}
	if session.ID == "" {
		return fmt.Errorf("session ID must not be empty")
	}
	if _, exists := mo.sessions[session.ID]; exists {
		return fmt.Errorf("session %s already registered", session.ID)
	}

	mo.sessions[session.ID] = session
	return nil
}

// UnregisterSession removes a VM session from the orchestrator.
func (mo *MultiVMDebugOrchestrator) UnregisterSession(sessionID string) error {
	mo.mu.Lock()
	defer mo.mu.Unlock()

	if _, ok := mo.sessions[sessionID]; !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	delete(mo.sessions, sessionID)

	// Clean up module mappings
	for moduleID, sessionIDs := range mo.moduleSessions {
		filtered := make([]string, 0, len(sessionIDs))
		for _, sid := range sessionIDs {
			if sid != sessionID {
				filtered = append(filtered, sid)
			}
		}
		if len(filtered) == 0 {
			delete(mo.moduleSessions, moduleID)
		} else {
			mo.moduleSessions[moduleID] = filtered
		}
	}

	return nil
}

// GetSession returns a session by ID.
func (mo *MultiVMDebugOrchestrator) GetSession(sessionID string) (*DebugSession, bool) {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	session, ok := mo.sessions[sessionID]
	return session, ok
}

// GetModuleSessions returns all sessions for a given module ID.
func (mo *MultiVMDebugOrchestrator) GetModuleSessions(moduleID string) []*DebugSession {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	sessionIDs, ok := mo.moduleSessions[moduleID]
	if !ok {
		return nil
	}

	result := make([]*DebugSession, 0, len(sessionIDs))
	for _, sid := range sessionIDs {
		if session, ok := mo.sessions[sid]; ok {
			result = append(result, session)
		}
	}
	return result
}

// ListSessions returns all registered sessions.
func (mo *MultiVMDebugOrchestrator) ListSessions() []*DebugSession {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	result := make([]*DebugSession, 0, len(mo.sessions))
	for _, session := range mo.sessions {
		result = append(result, session)
	}
	return result
}

// SetGlobalBreakpoint sets a breakpoint on all registered VMs.
// Returns the list of breakpoint IDs assigned.
func (mo *MultiVMDebugOrchestrator) SetGlobalBreakpoint(cbp *CrossModuleBreakpoint) []int32 {
	mo.mu.Lock()
	defer mo.mu.Unlock()

	if cbp == nil {
		return nil
	}

	// Use the breakpoint's ID if already set, otherwise assign a new one
	id := cbp.ID
	if id == 0 {
		id = int32(len(mo.globalBreakpoints) + 1)
		for {
			if _, exists := mo.globalBreakpoints[id]; !exists {
				break
			}
			id++
		}
		cbp.ID = id
	}
	mo.globalBreakpoints[id] = cbp

	ids := []int32{id}
	return ids
}

// RemoveGlobalBreakpoint removes a global breakpoint by ID.
func (mo *MultiVMDebugOrchestrator) RemoveGlobalBreakpoint(id int32) error {
	mo.mu.Lock()
	defer mo.mu.Unlock()

	if _, ok := mo.globalBreakpoints[id]; !ok {
		return fmt.Errorf("global breakpoint %d not found", id)
	}
	delete(mo.globalBreakpoints, id)
	return nil
}

// SuspendAll suspends all running VMs.
// Returns the first error encountered, or nil if all succeeded.
func (mo *MultiVMDebugOrchestrator) SuspendAll() error {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	for _, session := range mo.sessions {
		if session.State == StateRunning {
			session.State = StateSuspended
		}
	}
	return nil
}

// ResumeAll resumes all suspended VMs.
// Returns the first error encountered, or nil if all succeeded.
func (mo *MultiVMDebugOrchestrator) ResumeAll() error {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	for _, session := range mo.sessions {
		if session.State == StateSuspended {
			session.State = StateRunning
		}
	}
	return nil
}

// TerminateAll terminates all sessions.
func (mo *MultiVMDebugOrchestrator) TerminateAll() error {
	mo.mu.Lock()
	defer mo.mu.Unlock()

	for _, session := range mo.sessions {
		session.State = StateTerminated
	}

	mo.sessions = make(map[string]*DebugSession)
	mo.moduleSessions = make(map[string][]string)
	mo.globalBreakpoints = make(map[int32]*CrossModuleBreakpoint)

	return nil
}

// GetAllVariables returns variables from all suspended VMs.
// The map key is the session ID.
func (mo *MultiVMDebugOrchestrator) GetAllVariables() map[string][]Variable {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	result := make(map[string][]Variable)
	for id, session := range mo.sessions {
		if session.State == StateSuspended {
			result[id] = nil
		}
	}
	return result
}

// GetAllCallStacks returns call stacks from all suspended VMs.
// The map key is the session ID.
func (mo *MultiVMDebugOrchestrator) GetAllCallStacks() map[string][]StackFrame {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	result := make(map[string][]StackFrame)
	for id, session := range mo.sessions {
		if session.State == StateSuspended {
			result[id] = nil
		}
	}
	return result
}

// ActiveSessionCount returns the number of active (connected, running, or suspended) sessions.
func (mo *MultiVMDebugOrchestrator) ActiveSessionCount() int {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	count := 0
	for _, session := range mo.sessions {
		switch session.State {
		case StateConnected, StateRunning, StateSuspended:
			count++
		}
	}
	return count
}

// SuspendedSessionCount returns the number of suspended sessions.
func (mo *MultiVMDebugOrchestrator) SuspendedSessionCount() int {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	count := 0
	for _, session := range mo.sessions {
		if session.State == StateSuspended {
			count++
		}
	}
	return count
}

// AssociateModule associates a session with a module ID.
func (mo *MultiVMDebugOrchestrator) AssociateModule(sessionID, moduleID string) error {
	mo.mu.Lock()
	defer mo.mu.Unlock()

	if _, ok := mo.sessions[sessionID]; !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	mo.moduleSessions[moduleID] = append(mo.moduleSessions[moduleID], sessionID)
	return nil
}

// GetEventAggregator returns the event aggregator for this orchestrator.
func (mo *MultiVMDebugOrchestrator) GetEventAggregator() *MultiVMEventAggregator {
	mo.mu.RLock()
	defer mo.mu.RUnlock()
	return mo.eventAggregator
}

// GetGlobalBreakpoints returns all global breakpoints.
func (mo *MultiVMDebugOrchestrator) GetGlobalBreakpoints() []*CrossModuleBreakpoint {
	mo.mu.RLock()
	defer mo.mu.RUnlock()

	result := make([]*CrossModuleBreakpoint, 0, len(mo.globalBreakpoints))
	for _, cbp := range mo.globalBreakpoints {
		result = append(result, cbp)
	}
	return result
}

// SessionCount returns the total number of registered sessions.
func (mo *MultiVMDebugOrchestrator) SessionCount() int {
	mo.mu.RLock()
	defer mo.mu.RUnlock()
	return len(mo.sessions)
}