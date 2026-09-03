// Package debug — debug session state machine.
//
// Manages debug session lifecycle with well-defined state transitions:
//
//	not_connected → connected → running → suspended → terminated
//
// Handles JDWP events: VM start, VM death, class prepare, thread
// start/death, breakpoint, step, and exception events.
package debug

import (
	"fmt"
	"sync"
	"time"
)

// DebugState represents the state of a debug session.
type DebugState string

const (
	StateNotConnected DebugState = "not_connected"
	StateConnected    DebugState = "connected"
	StateRunning      DebugState = "running"
	StateSuspended    DebugState = "suspended"
	StateTerminated   DebugState = "terminated"
)

// DebugEventType represents the type of a debug event.
type DebugEventType string

const (
	EventVMStart       DebugEventType = "vmStart"
	EventVMDeath       DebugEventType = "vmDeath"
	EventClassPrepare  DebugEventType = "classPrepare"
	EventClassUnload   DebugEventType = "classUnload"
	EventThreadStart   DebugEventType = "threadStart"
	EventThreadDeath   DebugEventType = "threadDeath"
	EventBreakpointHit DebugEventType = "breakpointHit"
	EventStepComplete  DebugEventType = "stepComplete"
	EventExceptionHit  DebugEventType = "exceptionHit"
	EventFieldAccess   DebugEventType = "fieldAccess"
	EventFieldModify   DebugEventType = "fieldModify"
)

// DebugEvent represents a single debug event from the JVM.
type DebugEvent struct {
	Type        DebugEventType `json:"type"`
	ThreadID    int64          `json:"threadId,omitempty"`
	ClassName   string         `json:"className,omitempty"`
	MethodName  string         `json:"methodName,omitempty"`
	LineNumber  int32          `json:"lineNumber,omitempty"`
	RequestID   int32          `json:"requestId,omitempty"`
	ExceptionClass string      `json:"exceptionClass,omitempty"`
	Timestamp   time.Time      `json:"timestamp"`
	SuspendPolicy byte         `json:"suspendPolicy"`
}

// DebugSession holds the state and metadata of a debug session.
type DebugSession struct {
	ID          string     `json:"id"`
	State       DebugState `json:"state"`
	VMName      string     `json:"vmName,omitempty"`
	VMVersion   string     `json:"vmVersion,omitempty"`
	StartedAt   time.Time  `json:"startedAt"`
	EndedAt     time.Time  `json:"endedAt,omitempty"`
	Port        int        `json:"port"`
	Hostname    string     `json:"hostname"`
	SessionType string     `json:"sessionType"` // "attach" or "launch"
}

// DebugStateMachine manages the state of a debug session.
type DebugStateMachine struct {
	mu          sync.RWMutex
	session     *DebugSession
	listeners   []func(DebugEvent)
	eventLog    []DebugEvent
	errorLog    []string
	breakpoints *BreakpointManager
	varProvider func(DebugEvent) map[string]interface{}
}

// NewDebugStateMachine creates a new debug state machine.
func NewDebugStateMachine() *DebugStateMachine {
	return &DebugStateMachine{
		session: &DebugSession{
			State: StateNotConnected,
		},
		listeners: make([]func(DebugEvent), 0),
		eventLog:  make([]DebugEvent, 0),
		errorLog:  make([]string, 0),
	}
}

// Session returns the current session metadata.
func (dsm *DebugStateMachine) Session() *DebugSession {
	dsm.mu.RLock()
	defer dsm.mu.RUnlock()
	return dsm.session
}

// State returns the current debug state.
func (dsm *DebugStateMachine) State() DebugState {
	dsm.mu.RLock()
	defer dsm.mu.RUnlock()
	return dsm.session.State
}

// Transition attempts to transition to a new state.
// Returns an error if the transition is invalid.
func (dsm *DebugStateMachine) Transition(newState DebugState) error {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()

	if !isValidTransition(dsm.session.State, newState) {
		return fmt.Errorf("invalid state transition: %s → %s", dsm.session.State, newState)
	}

	dsm.session.State = newState
	return nil
}

// Connect transitions from not_connected to connected.
func (dsm *DebugStateMachine) Connect(id string, port int, hostname, sessionType string) error {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()

	if dsm.session.State != StateNotConnected {
		return fmt.Errorf("cannot connect: current state is %s", dsm.session.State)
	}

	dsm.session.ID = id
	dsm.session.State = StateConnected
	dsm.session.Port = port
	dsm.session.Hostname = hostname
	dsm.session.SessionType = sessionType
	dsm.session.StartedAt = time.Now()

	return nil
}

// Resume transitions from suspended to running.
func (dsm *DebugStateMachine) Resume() error {
	return dsm.Transition(StateRunning)
}

// Suspend transitions from running to suspended.
func (dsm *DebugStateMachine) Suspend() error {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()

	// We can suspend from running or connected
	if dsm.session.State != StateRunning && dsm.session.State != StateConnected {
		return fmt.Errorf("cannot suspend: current state is %s", dsm.session.State)
	}

	dsm.session.State = StateSuspended
	return nil
}

// Terminate transitions to terminated state.
func (dsm *DebugStateMachine) Terminate() error {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()

	if dsm.session.State == StateNotConnected || dsm.session.State == StateTerminated {
		return fmt.Errorf("cannot terminate: current state is %s", dsm.session.State)
	}

	dsm.session.State = StateTerminated
	dsm.session.EndedAt = time.Now()
	return nil
}

// HandleEvent processes a debug event and updates state accordingly.
func (dsm *DebugStateMachine) HandleEvent(event DebugEvent) {
	dsm.mu.Lock()

	if event.Type == EventBreakpointHit && dsm.breakpoints != nil {
		vars := map[string]interface{}{}
		if dsm.varProvider != nil {
			if provided := dsm.varProvider(event); provided != nil {
				vars = provided
			}
		}
		if !dsm.breakpoints.RecordHitAndShouldStop(event.RequestID, vars, nil, event.ThreadID, "", 0) {
			dsm.mu.Unlock()
			return
		}
	}

	// Update state based on event type
	switch event.Type {
	case EventVMStart:
		dsm.session.State = StateRunning
	case EventVMDeath:
		dsm.session.State = StateTerminated
		dsm.session.EndedAt = time.Now()
	case EventBreakpointHit, EventStepComplete, EventExceptionHit:
		if dsm.session.State == StateRunning {
			dsm.session.State = StateSuspended
		}
	case EventFieldAccess, EventFieldModify:
		if dsm.session.State == StateRunning {
			dsm.session.State = StateSuspended
		}
	case EventThreadStart, EventThreadDeath, EventClassPrepare, EventClassUnload:
		// These events don't change the session state
	}

	event.Timestamp = time.Now()
	dsm.eventLog = append(dsm.eventLog, event)
	dsm.mu.Unlock()

	// Notify listeners outside the lock
	dsm.notifyListeners(event)
}

// AddListener adds a listener for debug events.
func (dsm *DebugStateMachine) AddListener(fn func(DebugEvent)) {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()

	dsm.listeners = append(dsm.listeners, fn)
}

// SetBreakpointManager attaches the breakpoint table used to evaluate
// conditions / hit-count filters when a JDWP breakpoint event arrives.
// HotSpot does not implement JDWP Conditional modifiers; filtering happens here.
func (dsm *DebugStateMachine) SetBreakpointManager(bm *BreakpointManager) {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()
	dsm.breakpoints = bm
}

// SetVariableProvider supplies locals/fields for condition evaluation on hit.
func (dsm *DebugStateMachine) SetVariableProvider(fn func(DebugEvent) map[string]interface{}) {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()
	dsm.varProvider = fn
}

// AddError records an error that occurred during debugging.
func (dsm *DebugStateMachine) AddError(msg string) {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()

	dsm.errorLog = append(dsm.errorLog, msg)
}

// EventLog returns a copy of the event log.
func (dsm *DebugStateMachine) EventLog() []DebugEvent {
	dsm.mu.RLock()
	defer dsm.mu.RUnlock()

	result := make([]DebugEvent, len(dsm.eventLog))
	copy(result, dsm.eventLog)
	return result
}

// ErrorLog returns a copy of the error log.
func (dsm *DebugStateMachine) ErrorLog() []string {
	dsm.mu.RLock()
	defer dsm.mu.RUnlock()

	result := make([]string, len(dsm.errorLog))
	copy(result, dsm.errorLog)
	return result
}

// Reset clears the state machine back to not_connected.
func (dsm *DebugStateMachine) Reset() {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()

	dsm.session = &DebugSession{
		State: StateNotConnected,
	}
	dsm.eventLog = make([]DebugEvent, 0)
	dsm.errorLog = make([]string, 0)
}

// IsActive returns true if the session is in an active state.
func (dsm *DebugStateMachine) IsActive() bool {
	dsm.mu.RLock()
	defer dsm.mu.RUnlock()

	s := dsm.session.State
	return s == StateConnected || s == StateRunning || s == StateSuspended
}

// IsSuspended returns true if the session is suspended.
func (dsm *DebugStateMachine) IsSuspended() bool {
	dsm.mu.RLock()
	defer dsm.mu.RUnlock()
	return dsm.session.State == StateSuspended
}

func (dsm *DebugStateMachine) notifyListeners(event DebugEvent) {
	dsm.mu.RLock()
	listeners := make([]func(DebugEvent), len(dsm.listeners))
	copy(listeners, dsm.listeners)
	dsm.mu.RUnlock()

	for _, fn := range listeners {
		fn(event)
	}
}

// isValidTransition checks if a state transition is valid.
func isValidTransition(from, to DebugState) bool {
	// Allow same-state transitions (e.g., re-suspending)
	if from == to {
		return true
	}

	switch from {
	case StateNotConnected:
		return to == StateConnected
	case StateConnected:
		return to == StateRunning || to == StateSuspended || to == StateTerminated
	case StateRunning:
		return to == StateSuspended || to == StateTerminated
	case StateSuspended:
		return to == StateRunning || to == StateTerminated
	case StateTerminated:
		return false // terminal state
	default:
		return false
	}
}

// ── JDWP Event Parsing ────────────────────────────────────────────

// ParseEventKind maps a JDWP event kind byte to a DebugEventType.
func ParseEventKind(kind byte) DebugEventType {
	switch kind {
	case eventKindVMStart:
		return EventVMStart
	case eventKindVMDeath:
		return EventVMDeath
	case eventKindClassPrepare:
		return EventClassPrepare
	case eventKindClassUnload:
		return EventClassUnload
	case eventKindThreadStart:
		return EventThreadStart
	case eventKindThreadDeath:
		return EventThreadDeath
	case eventKindBreakpoint:
		return EventBreakpointHit
	case eventKindStep:
		return EventStepComplete
	case eventKindException:
		return EventExceptionHit
	case eventKindFieldAccess:
		return EventFieldAccess
	case eventKindFieldModification:
		return EventFieldModify
	default:
		return DebugEventType(fmt.Sprintf("unknown_%d", kind))
	}
}

// ParseCompositeEventReply parses a JDWP Event.Composite reply.
//
// Reply format:
//
//	byte: suspendPolicy
//	int:  event count
//	[for each event:
//	  byte: eventKind
//	  int:  requestID
//	  ...event-specific data]
func ParseCompositeEventReply(data []byte) ([]DebugEvent, error) {
	r := NewJDWPDataReader(data)

	suspendPolicy, err := r.ReadByte()
	if err != nil {
		return nil, fmt.Errorf("parse suspend policy: %w", err)
	}

	count, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("parse event count: %w", err)
	}

	events := make([]DebugEvent, 0, count)
	for i := int32(0); i < count; i++ {
		eventKind, err := r.ReadByte()
		if err != nil {
			return nil, fmt.Errorf("parse event kind %d: %w", i, err)
		}

		requestID, err := r.ReadInt()
		if err != nil {
			return nil, fmt.Errorf("parse request ID %d: %w", i, err)
		}

		event := DebugEvent{
			Type:          ParseEventKind(eventKind),
			RequestID:     requestID,
			SuspendPolicy: suspendPolicy,
			Timestamp:     time.Now(),
		}

		// Parse event-specific data
		switch eventKind {
		case eventKindBreakpoint, eventKindStep, eventKindException,
			eventKindFieldAccess, eventKindFieldModification:
			threadID, err := r.ReadObjectID()
			if err != nil {
				return nil, fmt.Errorf("parse event thread ID %d: %w", i, err)
			}
			event.ThreadID = threadID

			// Parse location (tag, classID, methodID, index)
			_, err = r.ReadByte() // location tag
			if err != nil {
				return nil, fmt.Errorf("parse location tag %d: %w", i, err)
			}
			_, err = r.ReadObjectID() // classID
			if err != nil {
				return nil, fmt.Errorf("parse classID %d: %w", i, err)
			}
			_, err = r.ReadObjectID() // methodID
			if err != nil {
				return nil, fmt.Errorf("parse methodID %d: %w", i, err)
			}
			lineNumber, err := r.ReadLong()
			if err != nil {
				return nil, fmt.Errorf("parse line number %d: %w", i, err)
			}
			event.LineNumber = int32(lineNumber)

			// For exception events, parse exception data
			if eventKind == eventKindException {
				_, err = r.ReadByte() // exception tag
				if err != nil {
					return nil, fmt.Errorf("parse exception tag %d: %w", i, err)
				}
				_, err = r.ReadObjectID() // exception objectID
				if err != nil {
					return nil, fmt.Errorf("parse exception objectID %d: %w", i, err)
				}
				_, err = r.ReadObjectID() // catch location
				if err != nil {
					return nil, fmt.Errorf("parse catch location %d: %w", i, err)
				}
			}

		case eventKindThreadStart, eventKindThreadDeath:
			threadID, err := r.ReadObjectID()
			if err != nil {
				return nil, fmt.Errorf("parse thread event ID %d: %w", i, err)
			}
			event.ThreadID = threadID

		case eventKindClassPrepare:
			// Skip: threadID, refTypeTag, typeID, signature, status
			_, err = r.ReadObjectID() // threadID
			if err != nil {
				return nil, fmt.Errorf("parse class prepare %d: %w", i, err)
			}
			_, err = r.ReadByte() // refTypeTag
			if err != nil {
				return nil, fmt.Errorf("parse refTypeTag %d: %w", i, err)
			}
			_, err = r.ReadObjectID() // typeID
			if err != nil {
				return nil, fmt.Errorf("parse typeID %d: %w", i, err)
			}
			className, err := r.ReadString() // signature
			if err != nil {
				return nil, fmt.Errorf("parse class signature %d: %w", i, err)
			}
			event.ClassName = className
			// Skip status
			_, err = r.ReadInt()
			if err != nil {
				return nil, fmt.Errorf("parse class status %d: %w", i, err)
			}

		case eventKindVMStart, eventKindVMDeath:
			// VM events have no additional data beyond eventKind and requestID
		}

		events = append(events, event)
	}

	return events, nil
}

const (
	eventKindStep = 1 // SingleStep event kind
)