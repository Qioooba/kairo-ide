package events

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// EventType is the type of a system event.
type EventType string

const (
	EventBuildStarted     EventType = "build.started"
	EventBuildProgress    EventType = "build.progress"
	EventBuildCompleted   EventType = "build.completed"
	EventBuildFailed      EventType = "build.failed"
	EventServerStarted    EventType = "server.started"
	EventServerStopped    EventType = "server.stopped"
	EventServerError      EventType = "server.error"
	EventDeployComplete   EventType = "deploy.completed"
	EventSnapshotRequired EventType = "snapshot.required"
)

// Event represents a system event published to subscribers.
type Event struct {
	Sequence    int64       `json:"sequence"`
	Type        EventType   `json:"type"`
	WorkspaceID string      `json:"workspaceId"`
	Message     string      `json:"message,omitempty"`
	Data        interface{} `json:"data,omitempty"`
	Time        time.Time   `json:"time"`
}

// subscriber represents a single event subscriber.
type subscriber struct {
	id string
	ch chan Event
}

// EventHub is a publish-subscribe event bus with history and sequence tracking.
// Multiple subscribers per workspace are supported.
type EventHub struct {
	mu sync.RWMutex
	// workspaceID → subscriberID → subscriber
	subscribers map[string]map[string]*subscriber
	sequence    int64
	history     []Event
	maxHistory  int
	// Slow consumer config
	chanBuffer    int
	slowThreshold int
}

// NewEventHub creates a new EventHub with the given max history size and channel buffer.
func NewEventHub(maxHistory, chanBuffer int) *EventHub {
	if maxHistory <= 0 {
		maxHistory = 1000
	}
	if chanBuffer <= 0 {
		chanBuffer = 100
	}
	return &EventHub{
		subscribers:   make(map[string]map[string]*subscriber),
		maxHistory:    maxHistory,
		chanBuffer:    chanBuffer,
		slowThreshold: chanBuffer * 3 / 4, // 75% full = slow
	}
}

// generateSubscriberID creates a unique subscriber identifier.
func generateSubscriberID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Subscribe returns a channel, a unique subscriber ID, and an unsubscribe function.
// Multiple subscribers per workspace are supported.
func (h *EventHub) Subscribe(workspaceID string) (string, <-chan Event, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()

	id := generateSubscriberID()
	ch := make(chan Event, h.chanBuffer)

	if h.subscribers[workspaceID] == nil {
		h.subscribers[workspaceID] = make(map[string]*subscriber)
	}
	h.subscribers[workspaceID][id] = &subscriber{id: id, ch: ch}

	return id, ch, func() {
		h.unsubscribe(workspaceID, id)
	}
}

// unsubscribe removes a subscriber and closes its channel.
func (h *EventHub) unsubscribe(workspaceID, subscriberID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if subs, ok := h.subscribers[workspaceID]; ok {
		if sub, ok := subs[subscriberID]; ok {
			close(sub.ch)
			delete(subs, subscriberID)
		}
		if len(subs) == 0 {
			delete(h.subscribers, workspaceID)
		}
	}
}

// Publish sends an event to all subscribers of the workspace.
// If a subscriber's channel is full, the subscriber is marked as slow
// and a gap event is sent instead.
func (h *EventHub) Publish(event Event) {
	h.mu.Lock()
	h.sequence++
	event.Sequence = h.sequence
	if event.Time.IsZero() {
		event.Time = time.Now()
	}

	// Add to history
	h.history = append(h.history, event)
	if len(h.history) > h.maxHistory {
		h.history = h.history[len(h.history)-h.maxHistory:]
	}

	// Copy subscribers to avoid holding lock during send
	var subs []*subscriber
	if wsSubs, ok := h.subscribers[event.WorkspaceID]; ok {
		for _, sub := range wsSubs {
			subs = append(subs, sub)
		}
	}
	h.mu.Unlock()

	// Send to all subscribers
	for _, sub := range subs {
		if len(sub.ch) >= h.slowThreshold {
			// Subscriber is slow - send gap event
			select {
			case sub.ch <- Event{
				Type:        EventSnapshotRequired,
				WorkspaceID: event.WorkspaceID,
				Message:     "Event gap detected, please re-sync snapshot",
			}:
			default:
			}
		} else {
			select {
			case sub.ch <- event:
			default:
				// Channel full, send gap
				select {
				case sub.ch <- Event{
					Type:        EventSnapshotRequired,
					WorkspaceID: event.WorkspaceID,
					Message:     "Event dropped due to slow consumer",
				}:
				default:
				}
			}
		}
	}
}

// GetHistory returns events for a workspace after the given sequence number,
// and a boolean indicating whether there is a gap in the sequence.
func (h *EventHub) GetHistory(workspaceID string, afterSequence int64) ([]Event, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var result []Event
	hasGap := false

	for _, e := range h.history {
		if e.WorkspaceID == workspaceID && e.Sequence > afterSequence {
			result = append(result, e)
		}
	}

	// Check if we have all events since afterSequence
	if len(result) > 0 && afterSequence > 0 {
		expectedFirst := afterSequence + 1
		if result[0].Sequence > expectedFirst {
			hasGap = true
		}
	}

	return result, hasGap
}

// GetHistoryAll returns all events for a workspace.
func (h *EventHub) GetHistoryAll(workspaceID string) []Event {
	events, _ := h.GetHistory(workspaceID, 0)
	return events
}
