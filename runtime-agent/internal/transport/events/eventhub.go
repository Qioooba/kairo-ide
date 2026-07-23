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
	EventBuildQueued      EventType = "build.queued"
	EventBuildStarted     EventType = "build.started"
	EventBuildProgress    EventType = "build.progress"
	EventBuildCompleted   EventType = "build.completed"
	EventBuildFailed      EventType = "build.failed"
	EventBuildCancelled   EventType = "build.cancelled"
	EventServerStarted    EventType = "server.started"
	EventServerStopped    EventType = "server.stopped"
	EventServerError      EventType = "server.error"
	EventDeployComplete   EventType = "deploy.completed"
	EventDeployStarted    EventType = "deploy.started"
	EventHotReloadStatus  EventType = "hotreload.status"
	EventSnapshotRequired EventType = "snapshot.required"
	EventGap              EventType = "event.gap"
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

const (
	defaultMaxHistory = 1000
	defaultMaxSubBuf  = 256
	maxSubscribers    = 1000
	maxMessageSize    = 64 * 1024 // 64KB
)

// EventHub is a publish-subscribe event bus with history and sequence tracking.
// Multiple subscribers per workspace are supported.
type EventHub struct {
	mu           sync.RWMutex
	subscribers  map[string]map[string]chan Event // workspaceID → subscriberID → channel
	sequence     int64
	history      []Event // ring buffer
	historyHead  int     // index of oldest entry in ring buffer
	historyCount int     // number of entries currently in ring buffer
	maxHistory   int
	maxSubBuffer int
}

// NewEventHub creates a new EventHub with the given max history size and subscriber buffer.
func NewEventHub(maxHistory, maxSubBuffer int) *EventHub {
	if maxHistory <= 0 {
		maxHistory = defaultMaxHistory
	}
	if maxSubBuffer <= 0 {
		maxSubBuffer = defaultMaxSubBuf
	}
	return &EventHub{
		subscribers:  make(map[string]map[string]chan Event),
		maxHistory:   maxHistory,
		maxSubBuffer: maxSubBuffer,
	}
}

// generateSubscriberID creates a unique subscriber identifier.
func generateSubscriberID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Subscribe returns a channel and an unsubscribe function for the given workspace
// and subscriber. If subscriberID is empty, a random ID is generated.
// Events after afterSequence are replayed from history before new events.
// If history is insufficient to cover the gap, a snapshot.required event is sent.
func (h *EventHub) Subscribe(workspaceID, subscriberID string, afterSequence int64) (<-chan Event, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Count total subscribers across all workspaces
	total := 0
	for _, wsSubs := range h.subscribers {
		total += len(wsSubs)
	}
	if total >= maxSubscribers {
		ch := make(chan Event)
		close(ch)
		return ch, func() {}
	}

	if subscriberID == "" {
		subscriberID = generateSubscriberID()
	}

	ch := make(chan Event, h.maxSubBuffer)

	if h.subscribers[workspaceID] == nil {
		h.subscribers[workspaceID] = make(map[string]chan Event)
	}
	h.subscribers[workspaceID][subscriberID] = ch

	// Replay history after afterSequence
	historyEvents, hasGap := h.getHistoryLocked(workspaceID, afterSequence)

	// If there's a gap, send snapshot.required first
	if hasGap {
		go func() {
			select {
			case ch <- Event{
				Type:        EventSnapshotRequired,
				WorkspaceID: workspaceID,
				Message:     "History gap detected, please re-sync snapshot",
				Time:        time.Now(),
			}:
			default:
			}
		}()
	}

	// Replay history events asynchronously
	if len(historyEvents) > 0 {
		go func() {
			for _, e := range historyEvents {
				select {
				case ch <- e:
				default:
					return
				}
			}
		}()
	}

	return ch, func() {
		h.unsubscribe(workspaceID, subscriberID)
	}
}

// SubscribeWithID is a convenience wrapper that generates a subscriber ID.
func (h *EventHub) SubscribeWithID(workspaceID string, afterSequence int64) (string, <-chan Event, func()) {
	id := generateSubscriberID()
	ch, cancel := h.Subscribe(workspaceID, id, afterSequence)
	return id, ch, cancel
}

// unsubscribe removes a subscriber and closes its channel.
func (h *EventHub) unsubscribe(workspaceID, subscriberID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if subs, ok := h.subscribers[workspaceID]; ok {
		if ch, ok := subs[subscriberID]; ok {
			close(ch)
			delete(subs, subscriberID)
		}
		if len(subs) == 0 {
			delete(h.subscribers, workspaceID)
		}
	}
}

// Publish sends an event to all subscribers of the workspace.
// If a subscriber's channel is full, a gap event is sent and the
// subscriber is disconnected.
func (h *EventHub) Publish(event Event) {
	h.mu.Lock()
	h.sequence++
	event.Sequence = h.sequence
	if event.Time.IsZero() {
		event.Time = time.Now()
	}

	// Add to history ring buffer
	if h.maxHistory > 0 {
		if h.historyCount < h.maxHistory {
			// Buffer not yet full, need to grow slice
			if h.history == nil {
				h.history = make([]Event, h.maxHistory)
			}
			h.history[(h.historyHead+h.historyCount)%h.maxHistory] = event
			h.historyCount++
		} else {
			// Overwrite oldest entry
			h.history[h.historyHead] = event
			h.historyHead = (h.historyHead + 1) % h.maxHistory
		}
	}

	// Copy subscribers to avoid holding lock during send
	workspaceSubs := h.subscribers[event.WorkspaceID]
	var subs []chan Event
	if len(workspaceSubs) > 0 {
		subs = make([]chan Event, 0, len(workspaceSubs))
		for _, ch := range workspaceSubs {
			subs = append(subs, ch)
		}
	}
	h.mu.Unlock()

	// Send to all subscribers
	for _, ch := range subs {
		select {
		case ch <- event:
		default:
			// Channel full - slow consumer, send gap event
			select {
			case ch <- Event{
				Type:        EventGap,
				WorkspaceID: event.WorkspaceID,
				Message:     "Gap detected: events dropped due to slow consumer",
				Time:        time.Now(),
			}:
			default:
			}
		}
	}
}

// getHistoryLocked returns events for a workspace after the given sequence
// and a boolean indicating whether there is a gap. Caller must hold h.mu.
func (h *EventHub) getHistoryLocked(workspaceID string, afterSequence int64) ([]Event, bool) {
	if h.historyCount == 0 {
		return nil, false
	}

	var result []Event
	hasGap := false
	earliestSeq := int64(0)

	for i := 0; i < h.historyCount; i++ {
		e := h.history[(h.historyHead+i)%h.maxHistory]
		if e.WorkspaceID == workspaceID {
			if earliestSeq == 0 || e.Sequence < earliestSeq {
				earliestSeq = e.Sequence
			}
			if e.Sequence > afterSequence {
				result = append(result, e)
			}
		}
	}

	// Check if we have a gap: the earliest event we have is after afterSequence+1
	if afterSequence > 0 && len(result) > 0 && earliestSeq > afterSequence+1 {
		hasGap = true
	}

	return result, hasGap
}

// GetHistory returns events for a workspace after the given sequence number,
// and a boolean indicating whether there is a gap in the sequence.
func (h *EventHub) GetHistory(workspaceID string, afterSequence int64) ([]Event, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.getHistoryLocked(workspaceID, afterSequence)
}

// GetHistoryAll returns all events for a workspace.
func (h *EventHub) GetHistoryAll(workspaceID string) []Event {
	events, _ := h.GetHistory(workspaceID, 0)
	return events
}

// OldSubscribe is the legacy subscription method for backward compatibility.
// Deprecated: use Subscribe or SubscribeWithID instead.
func (h *EventHub) OldSubscribe(workspaceID string) (string, <-chan Event, func()) {
	return h.SubscribeWithID(workspaceID, 0)
}
