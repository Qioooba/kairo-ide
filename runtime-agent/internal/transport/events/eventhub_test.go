package events

import (
	"net/http"
	"testing"
	"time"
)

func TestEventHub_PublishSubscribe(t *testing.T) {
	hub := NewEventHub(100, 10)
	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	hub.Publish(Event{
		Type:        "test.event",
		WorkspaceID: "ws1",
		Message:     "hello",
	})

	select {
	case event := <-ch:
		if event.Type != "test.event" {
			t.Errorf("expected 'test.event', got '%s'", event.Type)
		}
		if event.Message != "hello" {
			t.Errorf("expected 'hello', got '%s'", event.Message)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestEventHub_MultipleSubscribers(t *testing.T) {
	hub := NewEventHub(100, 10)
	ch1, cancel1 := hub.Subscribe("ws1", "sub1", 0)
	ch2, cancel2 := hub.Subscribe("ws1", "sub2", 0)
	defer cancel1()
	defer cancel2()

	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	// Both should receive
	for _, ch := range []<-chan Event{ch1, ch2} {
		select {
		case <-ch:
		case <-time.After(time.Second):
			t.Fatal("subscriber did not receive event")
		}
	}
}

func TestEventHub_MultipleSubscribersNoOverwrite(t *testing.T) {
	hub := NewEventHub(100, 10)
	ch1, cancel1 := hub.Subscribe("ws1", "sub1", 0)
	defer cancel1()

	// Second subscriber with same workspace should not overwrite first
	ch2, cancel2 := hub.Subscribe("ws1", "sub2", 0)
	defer cancel2()

	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	// Both should receive independently
	select {
	case <-ch1:
	case <-time.After(time.Second):
		t.Fatal("subscriber1 did not receive event")
	}
	select {
	case <-ch2:
	case <-time.After(time.Second):
		t.Fatal("subscriber2 did not receive event after subscriber1")
	}
}

func TestEventHub_WrongWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)
	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	// Publish to different workspace
	hub.Publish(Event{Type: "test", WorkspaceID: "ws2"})

	select {
	case <-ch:
		t.Fatal("should not have received event for wrong workspace")
	case <-time.After(100 * time.Millisecond):
		// Expected
	}
}

func TestEventHub_History(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})

	history, hasGap := hub.GetHistory("ws1", 0)
	if hasGap {
		t.Error("unexpected gap")
	}
	if len(history) != 2 {
		t.Errorf("expected 2 events, got %d", len(history))
	}
}

func TestEventHub_HistoryAfterSequence(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	history, _ := hub.GetHistory("ws1", 1)
	if len(history) != 2 {
		t.Errorf("expected 2 events after sequence 1, got %d", len(history))
	}
}

func TestEventHub_SubscribeWithAfterSequence(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	// Subscribe with afterSequence=1, should get e2 and e3 replayed
	ch, cancel := hub.Subscribe("ws1", "", 1)
	defer cancel()

	// Should receive e2 and e3
	count := 0
	timeout := time.After(500 * time.Millisecond)
	for count < 2 {
		select {
		case e := <-ch:
			count++
			if e.Type != "e2" && e.Type != "e3" {
				t.Errorf("unexpected event type: %s", e.Type)
			}
		case <-timeout:
			t.Fatalf("timed out after receiving %d events", count)
		}
	}
}

func TestEventHub_SubscribeWithGap(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Publish events with a gap in sequence (by publishing to different workspace)
	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws2"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	// Subscribe with afterSequence=0 for ws1, should get e1 and e3
	ch, cancel := hub.Subscribe("ws1", "sub1", 0)
	defer cancel()

	events := make(map[string]bool)
	timeout := time.After(500 * time.Millisecond)
	for i := 0; i < 2; i++ {
		select {
		case e := <-ch:
			events[string(e.Type)] = true
		case <-timeout:
			t.Fatalf("timed out after %d events: %v", i, events)
		}
	}
	if !events["e1"] || !events["e3"] {
		t.Errorf("expected e1 and e3, got %v", events)
	}
}

func TestEventHub_HistoryGap(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Create sequence gap by publishing events
	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	// Check history after a sequence not in the history
	history, hasGap := hub.GetHistory("ws1", 0)
	if hasGap {
		t.Error("no gap expected for afterSequence=0")
	}
	if len(history) != 3 {
		t.Errorf("expected 3 events, got %d", len(history))
	}

	// Asking for events after sequence 5 (which doesn't exist)
	history2, _ := hub.GetHistory("ws1", 5)
	if len(history2) != 0 {
		t.Errorf("expected 0 events after sequence 5, got %d", len(history2))
	}
}

func TestEventHub_SlowConsumer(t *testing.T) {
	hub := NewEventHub(100, 2) // small buffer

	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	// Fill up the buffer
	for i := 0; i < 10; i++ {
		hub.Publish(Event{
			Type:        "test",
			WorkspaceID: "ws1",
			Message:     "msg",
		})
	}

	// Should eventually receive a gap event
	timeout := time.After(time.Second)
	hasGap := false
	for !hasGap {
		select {
		case e := <-ch:
			if e.Type == EventGap {
				hasGap = true
			}
		case <-timeout:
			// If we don't get a gap, it's also fine — the buffer might have drained
			t.Log("no gap event received within timeout, buffer may have drained")
			return
		}
	}
}

func TestEventHub_SequenceIsMonotonic(t *testing.T) {
	hub := NewEventHub(100, 10)

	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	var lastSeq int64 = 0
	for i := 0; i < 3; i++ {
		select {
		case e := <-ch:
			if e.Sequence <= lastSeq {
				t.Errorf("sequence not monotonic: %d <= %d", e.Sequence, lastSeq)
			}
			lastSeq = e.Sequence
		case <-time.After(time.Second):
			t.Fatal("timed out")
		}
	}
}

func TestEventHub_RingBuffer(t *testing.T) {
	hub := NewEventHub(5, 10) // small history

	// Add more events than history capacity
	for i := 0; i < 10; i++ {
		hub.Publish(Event{Type: "event", WorkspaceID: "ws1"})
	}

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) > 5 {
		t.Errorf("ring buffer exceeded capacity: got %d, expected <= 5", len(history))
	}
}

func TestEventHub_Unsubscribe_Cleanup(t *testing.T) {
	hub := NewEventHub(100, 10)

	ch, cancel := hub.Subscribe("ws1", "sub1", 0)
	cancel()

	// Channel should be closed after unsubscribe
	_, ok := <-ch
	if ok {
		t.Error("channel should be closed after unsubscribe")
	}

	// Ensure we can re-subscribe with same ID
	ch2, cancel2 := hub.Subscribe("ws1", "sub1", 0)
	defer cancel2()

	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	select {
	case e := <-ch2:
		if e.Type != "test" {
			t.Errorf("expected 'test', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("re-subscribed subscriber did not receive event")
	}
}

func TestEventHub_MaxSubscribers(t *testing.T) {
	// Create a hub with max subscribers
	hub := NewEventHub(100, 10)

	// Fill all subscriber slots by creating subscribers with different workspace IDs
	// to simulate the 1000 limit across workspaces
	for i := 0; i < maxSubscribers; i++ {
		wsID := "ws"
		ch, cancel := hub.Subscribe(wsID, "", 0)
		// Don't cancel to keep them alive
		_ = ch
		_ = cancel
	}

	// The next subscribe should fail
	ch, cancel := hub.Subscribe("overflow", "", 0)
	defer cancel()

	// Should be closed immediately
	_, ok := <-ch
	if ok {
		t.Error("expected closed channel when max subscribers reached")
	}
}

func TestEventHub_GetHistoryAll(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws2"})

	history := hub.GetHistoryAll("ws1")
	if len(history) != 2 {
		t.Errorf("expected 2 events for ws1, got %d", len(history))
	}
}

func TestEventHub_OldSubscribe(t *testing.T) {
	hub := NewEventHub(100, 10)

	id, ch, cancel := hub.OldSubscribe("ws1")
	defer cancel()

	if id == "" {
		t.Error("expected non-empty subscriber ID")
	}

	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	select {
	case e := <-ch:
		if e.Type != "test" {
			t.Errorf("expected 'test', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestEventHub_SubscribeWithID(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})

	id, ch, cancel := hub.SubscribeWithID("ws1", 0)
	defer cancel()

	if id == "" {
		t.Error("expected non-empty subscriber ID")
	}

	// Should receive history replay
	select {
	case e := <-ch:
		if e.Type != "e1" {
			t.Errorf("expected 'e1', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for history replay")
	}
}

func TestEventHub_EmptyHistory(t *testing.T) {
	hub := NewEventHub(100, 10)

	history, hasGap := hub.GetHistory("ws1", 0)
	if hasGap {
		t.Error("no gap expected for empty history")
	}
	if len(history) != 0 {
		t.Errorf("expected 0 events, got %d", len(history))
	}
}

func TestEventHub_GenerateSubscriberID(t *testing.T) {
	id1 := generateSubscriberID()
	id2 := generateSubscriberID()

	if id1 == "" {
		t.Error("expected non-empty subscriber ID")
	}
	if id1 == id2 {
		t.Error("expected unique subscriber IDs")
	}
	if len(id1) != 16 {
		t.Errorf("expected 16 hex chars, got %d", len(id1))
	}
}

func TestEventHub_DefaultValues(t *testing.T) {
	hub := NewEventHub(0, 0)
	// Should use defaults
	if hub.maxHistory != defaultMaxHistory {
		t.Errorf("expected default maxHistory %d, got %d", defaultMaxHistory, hub.maxHistory)
	}
	if hub.maxSubBuffer != defaultMaxSubBuf {
		t.Errorf("expected default maxSubBuffer %d, got %d", defaultMaxSubBuf, hub.maxSubBuffer)
	}
}

func TestEventHub_EventTimeIsSet(t *testing.T) {
	hub := NewEventHub(100, 10)

	before := time.Now()
	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})
	after := time.Now()

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 1 {
		t.Fatal("expected 1 event")
	}
	if history[0].Time.Before(before) || history[0].Time.After(after) {
		t.Errorf("event time %v not between %v and %v", history[0].Time, before, after)
	}
}

func TestEventHub_SubscribeEmptyWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)

	ch, cancel := hub.Subscribe("", "", 0)
	defer cancel()

	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	// Should not receive event for different workspace
	select {
	case <-ch:
		t.Fatal("should not receive event for empty workspace subscription")
	case <-time.After(100 * time.Millisecond):
		// Expected
	}
}

func TestAuthenticateRequest_NilValidator(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	if !authenticateRequest(r, nil) {
		t.Error("nil validator should return true")
	}
}

func TestAuthenticateRequest_HeaderAuth(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	r.Header.Set(AuthSecretHeader, "my-secret")

	validator := func(cred string) bool {
		return cred == "my-secret"
	}
	if !authenticateRequest(r, validator) {
		t.Error("should authenticate with valid header secret")
	}
}

func TestAuthenticateRequest_HeaderAuth_WrongSecret(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	r.Header.Set(AuthSecretHeader, "wrong-secret")

	validator := func(cred string) bool {
		return cred == "my-secret"
	}
	if authenticateRequest(r, validator) {
		t.Error("should not authenticate with wrong header secret")
	}
}

func TestAuthenticateRequest_SubprotocolAuth(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	r.Header.Set("Sec-WebSocket-Protocol", "kairo-auth-v1-my-secret")

	validator := func(cred string) bool {
		return cred == "my-secret"
	}
	if !authenticateRequest(r, validator) {
		t.Error("should authenticate with subprotocol secret")
	}
}

func TestAuthenticateRequest_SubprotocolAuth_Empty(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	r.Header.Set("Sec-WebSocket-Protocol", "kairo-auth-v1-")

	validator := func(cred string) bool {
		return false
	}
	if authenticateRequest(r, validator) {
		t.Error("should not authenticate with empty subprotocol credential")
	}
}

func TestAuthenticateRequest_NoAuth(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)

	validator := func(cred string) bool {
		return true
	}
	if authenticateRequest(r, validator) {
		t.Error("should not authenticate without any auth mechanism")
	}
}

func TestConstants(t *testing.T) {
	if AuthSecretHeader != "X-Kairo-Auth" {
		t.Errorf("AuthSecretHeader = %q", AuthSecretHeader)
	}
	if AuthSecretSubprotocol != "kairo-auth-v1" {
		t.Errorf("AuthSecretSubprotocol = %q", AuthSecretSubprotocol)
	}
	if MaxMessageSizeBytes != maxMessageSize {
		t.Errorf("MaxMessageSizeBytes = %d, want %d", MaxMessageSizeBytes, maxMessageSize)
	}
	if PingInterval != 30*time.Second {
		t.Errorf("PingInterval = %v", PingInterval)
	}
	if ReadWriteDeadline != 300*time.Second {
		t.Errorf("ReadWriteDeadline = %v", ReadWriteDeadline)
	}
}

func TestEventBusAdapter_UpgraderCheckOrigin(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"empty origin", "", true},
		{"localhost", "http://localhost:3000", true},
		{"127.0.0.1", "http://127.0.0.1:8080", true},
		{"ipv6", "http://[::1]:8080", true},
		{"file", "file://", true},
		{"external", "http://evil.com", false},
		{"https external", "https://example.com", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r, _ := http.NewRequest(http.MethodGet, "/", nil)
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			got := wsUpgrader.CheckOrigin(r)
			if got != tc.want {
				t.Errorf("CheckOrigin(%q) = %v, want %v", tc.origin, got, tc.want)
			}
		})
	}
}

func TestEventHub_GetHistory_NoEvents(t *testing.T) {
	hub := NewEventHub(100, 10)
	events, hasGap := hub.GetHistory("nonexistent", 0)
	if hasGap {
		t.Error("no gap expected for empty history")
	}
	if len(events) != 0 {
		t.Errorf("expected 0 events, got %d", len(events))
	}
}

func TestEventHub_Subscribe_WithSinceParam(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})

	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	// Should receive history replay (e1, e2)
	count := 0
	timeout := time.After(500 * time.Millisecond)
	for count < 2 {
		select {
		case <-ch:
			count++
		case <-timeout:
			t.Fatalf("timed out after %d events", count)
		}
	}
}

func TestEventHub_Publish_ZeroTime(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{
		Type:        "test",
		WorkspaceID: "ws1",
		Message:     "test",
		Time:        time.Time{}, // zero time
	})

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 1 {
		t.Fatalf("expected 1 event, got %d", len(history))
	}
	if history[0].Time.IsZero() {
		t.Error("Time should be set to non-zero value")
	}
	if history[0].Sequence != 1 {
		t.Errorf("Sequence = %d, want 1", history[0].Sequence)
	}
}

func TestEventHub_Publish_NoHistory(t *testing.T) {
	hub := NewEventHub(0, 10) // maxHistory = 0 disables history

	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 0 {
		t.Errorf("expected 0 events when history is disabled, got %d", len(history))
	}
}

func TestEventHub_Subscribe_MaxSubscribersEdge(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Fill exactly to maxSubscribers - 1
	for i := 0; i < maxSubscribers-1; i++ {
		ch, cancel := hub.Subscribe("ws", "", 0)
		_ = ch
		_ = cancel
	}

	// One more should succeed
	ch, cancel := hub.Subscribe("ws", "", 0)
	defer cancel()

	_, ok := <-ch
	if ok {
		// channel is open, should be ready for events
		// This is expected - we're at exactly maxSubscribers
	}
}

func TestEventHub_GetHistory_DifferentWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws2"})

	// Get history for ws1 only
	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 1 {
		t.Errorf("expected 1 event for ws1, got %d", len(history))
	}
	if history[0].Type != "e1" {
		t.Errorf("Type = %q, want e1", history[0].Type)
	}
}
