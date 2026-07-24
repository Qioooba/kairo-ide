// Package debug — step control for JDWP debugging.
//
// Implements step over, step into, step out, and step granularity
// control (line-level and instruction-level). Manages step request
// lifecycle including creation, tracking, and cancellation.
package debug

import (
	"fmt"
	"sync"
)

// StepKind defines the type of step operation.
type StepKind string

const (
	StepOver StepKind = "stepOver"
	StepInto StepKind = "stepInto"
	StepOut  StepKind = "stepOut"
)

// StepGranularity defines the granularity of stepping.
type StepGranularity string

const (
	StepGranularityLine        StepGranularity = "line"
	StepGranularityInstruction StepGranularity = "instruction"
)

// StepRequest represents a single step request sent to the JVM.
type StepRequest struct {
	ID           int32           `json:"id"`
	ThreadID     int64           `json:"threadId"`
	Kind         StepKind        `json:"kind"`
	Granularity  StepGranularity `json:"granularity"`
	Depth        int32           `json:"depth"`
	Size         int32           `json:"size"`
	Active       bool            `json:"active"`
}

// StepManager manages step requests.
type StepManager struct {
	mu       sync.RWMutex
	requests map[int32]*StepRequest
	nextID   int32
}

// NewStepManager creates a new StepManager.
func NewStepManager() *StepManager {
	return &StepManager{
		requests: make(map[int32]*StepRequest),
		nextID:   1,
	}
}

// CreateStepRequest creates a new step request.
func (sm *StepManager) CreateStepRequest(threadID int64, kind StepKind, granularity StepGranularity) *StepRequest {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	req := &StepRequest{
		ID:          sm.nextID,
		ThreadID:    threadID,
		Kind:        kind,
		Granularity: granularity,
		Depth:       stepKindToDepth(kind),
		Size:        stepGranularityToSize(granularity),
		Active:      true,
	}
	sm.nextID++
	sm.requests[req.ID] = req
	return req
}

// GetStepRequest returns a step request by ID.
func (sm *StepManager) GetStepRequest(id int32) (*StepRequest, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	req, ok := sm.requests[id]
	return req, ok
}

// CompleteStepRequest marks a step request as completed.
func (sm *StepManager) CompleteStepRequest(id int32) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	req, ok := sm.requests[id]
	if !ok {
		return fmt.Errorf("step request %d not found", id)
	}
	req.Active = false
	return nil
}

// CancelStepRequest cancels a step request and removes it.
func (sm *StepManager) CancelStepRequest(id int32) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if _, ok := sm.requests[id]; !ok {
		return fmt.Errorf("step request %d not found", id)
	}
	delete(sm.requests, id)
	return nil
}

// CancelAllForThread cancels all active step requests for a thread.
func (sm *StepManager) CancelAllForThread(threadID int64) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	for id, req := range sm.requests {
		if req.ThreadID == threadID {
			req.Active = false
			delete(sm.requests, id)
		}
	}
}

// CancelAll cancels all step requests.
func (sm *StepManager) CancelAll() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.requests = make(map[int32]*StepRequest)
}

// ActiveRequests returns all active step requests.
func (sm *StepManager) ActiveRequests() []*StepRequest {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	result := make([]*StepRequest, 0, len(sm.requests))
	for _, req := range sm.requests {
		if req.Active {
			result = append(result, req)
		}
	}
	return result
}

// Count returns the number of active step requests.
func (sm *StepManager) Count() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.requests)
}

// stepKindToDepth maps a step kind to the JDWP step depth constant.
//
// JDWP StepDepth constants:
//
//	0: into (step into)
//	1: over (step over)
//	2: out  (step out)
func stepKindToDepth(kind StepKind) int32 {
	switch kind {
	case StepInto:
		return 0
	case StepOver:
		return 1
	case StepOut:
		return 2
	default:
		return 1
	}
}

// stepGranularityToSize maps a step granularity to the JDWP step size.
//
// JDWP StepSize constants:
//
//	0: min (instruction-level)
//	1: line (line-level)
func stepGranularityToSize(granularity StepGranularity) int32 {
	switch granularity {
	case StepGranularityInstruction:
		return 0
	case StepGranularityLine:
		return 1
	default:
		return 1
	}
}

// ── JDWP Command Builders for Step Control ────────────────────────

// BuildStepCommand builds a ThreadReference.Step command payload.
//
// Command data:
//
//	long: threadID
//	int:  stepSize (0=min, 1=line)
//	int:  stepDepth (0=into, 1=over, 2=out)
func BuildStepCommand(threadID int64, size, depth int32) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(threadID)
	w.WriteInt(size)
	w.WriteInt(depth)
	return w.Bytes()
}

// BuildStepOverCommand builds a step-over command for a thread.
func BuildStepOverCommand(threadID int64, granularity StepGranularity) []byte {
	size := stepGranularityToSize(granularity)
	return BuildStepCommand(threadID, size, 1) // depth=1 = over
}

// BuildStepIntoCommand builds a step-into command for a thread.
func BuildStepIntoCommand(threadID int64, granularity StepGranularity) []byte {
	size := stepGranularityToSize(granularity)
	return BuildStepCommand(threadID, size, 0) // depth=0 = into
}

// BuildStepOutCommand builds a step-out command for a thread.
func BuildStepOutCommand(threadID int64, granularity StepGranularity) []byte {
	size := stepGranularityToSize(granularity)
	return BuildStepCommand(threadID, size, 2) // depth=2 = out
}

// ── Event Request for Step ─────────────────────────────────────────

// BuildStepEventRequestCommand builds an EventRequest.Set command
// for single-step events. This is used to register step-completion
// event requests.
func BuildStepEventRequestCommand(threadID int64, size, depth int32, suspendPolicy byte) []byte {
	w := NewJDWPDataWriter()
	// eventKind for single step is 1
	w.WriteByte(1) // eventKindSingleStep
	w.WriteByte(suspendPolicy)
	w.WriteInt(2) // two modifiers

	// Step modifier
	w.WriteByte(10) // ModKind.Step = 10
	w.WriteObjectID(threadID)
	w.WriteInt(size)
	w.WriteInt(depth)

	// Suspend policy per-thread
	w.WriteByte(2) // ModKind.ThreadOnly = 2
	w.WriteObjectID(threadID)

	return w.Bytes()
}