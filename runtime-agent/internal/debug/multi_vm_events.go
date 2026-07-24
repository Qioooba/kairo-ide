// Package debug — multi-VM event aggregation.
//
// Aggregates debug events from multiple JVM instances into a unified
// event stream. Supports event filtering by session, listener-based
// notification, and configurable event buffering.
package debug

import (
	"sync"
	"time"
)

// AggregatedDebugEvent represents a debug event from any VM in the
// multi-VM setup, enriched with session and module context.
type AggregatedDebugEvent struct {
	Timestamp  time.Time              `json:"timestamp"`
	SessionID  string                 `json:"sessionId"`
	ModuleName string                 `json:"moduleName"`
	EventType  DebugEventType         `json:"eventType"`
	ThreadID   int64                  `json:"threadId,omitempty"`
	ClassName  string                 `json:"className,omitempty"`
	LineNumber int32                  `json:"lineNumber,omitempty"`
	Variables  map[string]interface{} `json:"variables,omitempty"`
	StackTrace []StackFrame           `json:"stackTrace,omitempty"`
}

// MultiVMEventAggregator collects and distributes debug events from
// multiple VM sessions.
type MultiVMEventAggregator struct {
	mu        sync.RWMutex
	events    []AggregatedDebugEvent
	listeners []func(AggregatedDebugEvent)
	maxEvents int
}

// NewMultiVMEventAggregator creates a new event aggregator with the
// specified maximum number of stored events.
func NewMultiVMEventAggregator(maxEvents int) *MultiVMEventAggregator {
	if maxEvents <= 0 {
		maxEvents = 1000
	}
	return &MultiVMEventAggregator{
		events:    make([]AggregatedDebugEvent, 0),
		listeners: make([]func(AggregatedDebugEvent), 0),
		maxEvents: maxEvents,
	}
}

// RecordEvent records a debug event from a specific session.
func (mea *MultiVMEventAggregator) RecordEvent(sessionID, moduleName string, event DebugEvent) {
	mea.mu.Lock()

	aggregated := AggregatedDebugEvent{
		Timestamp:  time.Now(),
		SessionID:  sessionID,
		ModuleName: moduleName,
		EventType:  event.Type,
		ThreadID:   event.ThreadID,
		ClassName:  event.ClassName,
		LineNumber: event.LineNumber,
	}

	// Maintain max events limit
	if len(mea.events) >= mea.maxEvents {
		mea.events = mea.events[1:]
	}
	mea.events = append(mea.events, aggregated)

	// Copy listeners to notify outside lock
	listeners := make([]func(AggregatedDebugEvent), len(mea.listeners))
	copy(listeners, mea.listeners)
	mea.mu.Unlock()

	for _, fn := range listeners {
		fn(aggregated)
	}
}

// GetEvents returns all events for a specific session.
func (mea *MultiVMEventAggregator) GetEvents(sessionID string) []AggregatedDebugEvent {
	mea.mu.RLock()
	defer mea.mu.RUnlock()

	result := make([]AggregatedDebugEvent, 0)
	for _, event := range mea.events {
		if event.SessionID == sessionID {
			result = append(result, event)
		}
	}
	return result
}

// GetAllEvents returns all recorded events.
func (mea *MultiVMEventAggregator) GetAllEvents() []AggregatedDebugEvent {
	mea.mu.RLock()
	defer mea.mu.RUnlock()

	result := make([]AggregatedDebugEvent, len(mea.events))
	copy(result, mea.events)
	return result
}

// AddListener adds a listener function that will be called whenever
// a new event is recorded.
func (mea *MultiVMEventAggregator) AddListener(fn func(AggregatedDebugEvent)) {
	mea.mu.Lock()
	defer mea.mu.Unlock()

	mea.listeners = append(mea.listeners, fn)
}

// Clear removes all events and listeners.
func (mea *MultiVMEventAggregator) Clear() {
	mea.mu.Lock()
	defer mea.mu.Unlock()

	mea.events = make([]AggregatedDebugEvent, 0)
	mea.listeners = make([]func(AggregatedDebugEvent), 0)
}

// EventCount returns the total number of recorded events.
func (mea *MultiVMEventAggregator) EventCount() int {
	mea.mu.RLock()
	defer mea.mu.RUnlock()
	return len(mea.events)
}

// GetEventsByModule returns all events for a specific module name.
func (mea *MultiVMEventAggregator) GetEventsByModule(moduleName string) []AggregatedDebugEvent {
	mea.mu.RLock()
	defer mea.mu.RUnlock()

	result := make([]AggregatedDebugEvent, 0)
	for _, event := range mea.events {
		if event.ModuleName == moduleName {
			result = append(result, event)
		}
	}
	return result
}

// GetEventsByType returns all events of a specific event type.
func (mea *MultiVMEventAggregator) GetEventsByType(eventType DebugEventType) []AggregatedDebugEvent {
	mea.mu.RLock()
	defer mea.mu.RUnlock()

	result := make([]AggregatedDebugEvent, 0)
	for _, event := range mea.events {
		if event.EventType == eventType {
			result = append(result, event)
		}
	}
	return result
}

// GetLatestEvent returns the most recent event, or nil if no events exist.
func (mea *MultiVMEventAggregator) GetLatestEvent() *AggregatedDebugEvent {
	mea.mu.RLock()
	defer mea.mu.RUnlock()

	if len(mea.events) == 0 {
		return nil
	}
	latest := mea.events[len(mea.events)-1]
	return &latest
}

// ListenerCount returns the number of registered listeners.
func (mea *MultiVMEventAggregator) ListenerCount() int {
	mea.mu.RLock()
	defer mea.mu.RUnlock()
	return len(mea.listeners)
}