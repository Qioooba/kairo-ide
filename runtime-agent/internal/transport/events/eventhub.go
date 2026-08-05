package events

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sync"
	"sync/atomic"
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
	Sequence    int64           `json:"sequence"`
	Type        EventType       `json:"type"`
	WorkspaceID string          `json:"workspaceId"`
	Message     string          `json:"message,omitempty"`
	Data        json.RawMessage `json:"data,omitempty"`
	Time        time.Time       `json:"time"`
}

const (
	defaultMaxHistory = 1000
	defaultMaxSubBuf  = 256
	maxSubscribers    = 1000
	maxMessageSize    = 64 * 1024 // 64KB
)

// subscriber holds a buffered event channel plus a done signal.
// Unsubscribe closes done only — never the data channel — so Publish
// can safely select without risking "send on closed channel".
type subscriber struct {
	ch   chan Event
	done chan struct{}
}

// EventHub is a publish-subscribe event bus with history and sequence tracking.
// Multiple subscribers per workspace are supported.
type EventHub struct {
	mu           sync.RWMutex
	subscribers  map[string]map[string]*subscriber // workspaceID → subscriberID → subscriber
	sequence     atomic.Int64
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
		subscribers:  make(map[string]map[string]*subscriber),
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
//
// The data channel is never closed by unsubscribe (callers should stop reading
// after calling the cancel func). A closed channel is only returned when the
// hub is at max subscribers.
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

	sub := &subscriber{
		ch:   make(chan Event, h.maxSubBuffer),
		done: make(chan struct{}),
	}

	if h.subscribers[workspaceID] == nil {
		h.subscribers[workspaceID] = make(map[string]*subscriber)
	}
	h.subscribers[workspaceID][subscriberID] = sub

	// Replay history after afterSequence synchronously under the lock
	// so Publish cannot interleave live events ahead of history and
	// break afterSequence resume semantics. trySend is non-blocking;
	// a full buffer simply stops replay (same as the prior async path).
	historyEvents, hasGap := h.getHistoryLocked(workspaceID, afterSequence)

	if hasGap {
		trySend(sub, Event{
			Type:        EventSnapshotRequired,
			WorkspaceID: workspaceID,
			Message:     "History gap detected, please re-sync snapshot",
			Time:        time.Now(),
		})
	}
	for _, e := range historyEvents {
		if !trySend(sub, e) {
			break
		}
	}

	return sub.ch, func() {
		h.unsubscribe(workspaceID, subscriberID)
	}
}

// trySend delivers an event to a subscriber unless it has unsubscribed
// (done closed) or its buffer is full. Returns false if the event was
// not delivered (unsubscribed or full).
func trySend(sub *subscriber, event Event) bool {
	select {
	case <-sub.done:
		return false
	default:
	}
	select {
	case <-sub.done:
		return false
	case sub.ch <- event:
		return true
	default:
		return false
	}
}

// SubscribeWithID is a convenience wrapper that generates a subscriber ID.
func (h *EventHub) SubscribeWithID(workspaceID string, afterSequence int64) (string, <-chan Event, func()) {
	id := generateSubscriberID()
	ch, cancel := h.Subscribe(workspaceID, id, afterSequence)
	return id, ch, cancel
}

// unsubscribe removes a subscriber and closes its done signal.
// The data channel is intentionally left open to avoid racing with Publish.
func (h *EventHub) unsubscribe(workspaceID, subscriberID string) {
	h.mu.Lock()
	var sub *subscriber
	if subs, ok := h.subscribers[workspaceID]; ok {
		if s, ok := subs[subscriberID]; ok {
			sub = s
			delete(subs, subscriberID)
		}
		if len(subs) == 0 {
			delete(h.subscribers, workspaceID)
		}
	}
	h.mu.Unlock()

	if sub != nil {
		select {
		case <-sub.done:
			// already closed (double-unsubscribe)
		default:
			close(sub.done)
		}
	}
}

// Publish sends an event to all subscribers of the workspace.
// If a subscriber's channel is full, a gap event is sent and the
// subscriber is disconnected.
func (h *EventHub) Publish(event Event) {
	seq := h.sequence.Add(1)
	event.Sequence = seq
	h.mu.Lock()
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
	var subs []*subscriber
	if len(workspaceSubs) > 0 {
		subs = make([]*subscriber, 0, len(workspaceSubs))
		for _, s := range workspaceSubs {
			subs = append(subs, s)
		}
	}
	h.mu.Unlock()

	// Send to all subscribers (select on done so unsubscribe cannot panic)
	for _, sub := range subs {
		select {
		case <-sub.done:
			continue
		case sub.ch <- event:
		default:
			// Channel full - slow consumer, send gap event
			gap := Event{
				Type:        EventGap,
				WorkspaceID: event.WorkspaceID,
				Message:     "Gap detected: events dropped due to slow consumer",
				Time:        time.Now(),
			}
			select {
			case <-sub.done:
			case sub.ch <- gap:
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
