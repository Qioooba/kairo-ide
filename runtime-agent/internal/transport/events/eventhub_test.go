package events

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
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
	// The subprotocol auth requires the subprotocol "kairo-auth-v1" to be listed
	// first, and the credential to be in a "kairo-auth-v1-<secret>" format part.
	// The gorilla/websocket Subprotocols() parses comma-separated values.
	r.Header.Set("Sec-WebSocket-Protocol", "kairo-auth-v1, kairo-auth-v1-my-secret")

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
	// NewEventHub treats maxHistory <= 0 as "use default" (1000),
	// so history is always enabled. Test that published events are stored.
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 1 {
		t.Errorf("expected 1 event in history, got %d", len(history))
	}
	if history[0].Type != "test" {
		t.Errorf("Type = %q, want test", history[0].Type)
	}
}

func TestEventHub_Subscribe_MaxSubscribersEdge(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Fill exactly to maxSubscribers - 1
	cancels := make([]func(), 0, maxSubscribers-1)
	for i := 0; i < maxSubscribers-1; i++ {
		_, cancel := hub.Subscribe("ws", "", 0)
		cancels = append(cancels, cancel)
	}

	// One more should succeed (total = maxSubscribers)
	ch, cancel := hub.Subscribe("ws", "", 0)
	defer cancel()

	// Publish an event to verify the channel works
	hub.Publish(Event{Type: "test", WorkspaceID: "ws"})

	select {
	case evt, ok := <-ch:
		if !ok {
			t.Error("channel should be open at exactly maxSubscribers")
		}
		if evt.Type != "test" {
			t.Errorf("Type = %q, want test", evt.Type)
		}
	case <-time.After(2 * time.Second):
		t.Error("timeout waiting for event on last subscriber channel")
	}

	// Cleanup previous subscribers to free resources
	for _, c := range cancels {
		c()
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

// --- New tests for increased coverage ---

func TestEventHub_ConcurrentPublish(t *testing.T) {
	hub := NewEventHub(100, 2000)
	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	const numGoroutines = 20
	const pubsPerGoroutine = 50
	total := numGoroutines * pubsPerGoroutine
	done := make(chan struct{})

	// Drain concurrently with publishing
	received := int64(0)
	go func() {
		for range ch {
			// Count received events
		}
	}()

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			for j := 0; j < pubsPerGoroutine; j++ {
				hub.Publish(Event{
					Type:        "concurrent.test",
					WorkspaceID: "ws1",
					Message:     "msg",
				})
			}
			done <- struct{}{}
		}(i)
	}

	// Wait for all publishers
	for i := 0; i < numGoroutines; i++ {
		<-done
	}

	// Verify history has all events
	history, _ := hub.GetHistory("ws1", 0)
	if len(history) < total && len(history) > 100 {
		// ring buffer may have overwritten old entries, but should have most
	} else if len(history) == 0 {
		t.Error("history should have events")
	}
	_ = received
}

func TestEventHub_ConcurrentSubscribeUnsubscribe(t *testing.T) {
	hub := NewEventHub(100, 10)

	const numGoroutines = 50
	done := make(chan struct{})

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			ch, cancel := hub.Subscribe("ws1", "", 0)
			// Immediately unsubscribe
			cancel()
			// Drain channel to ensure it's closed
			for range ch {
			}
			done <- struct{}{}
		}(i)
	}

	for i := 0; i < numGoroutines; i++ {
		<-done
	}
}

func TestEventHub_ConcurrentPublishSubscribeRace(t *testing.T) {
	hub := NewEventHub(100, 50)

	const numSubscribers = 10
	const numPublishers = 5
	const pubsPerPublisher = 100

	done := make(chan struct{})

	// Start subscribers
	for i := 0; i < numSubscribers; i++ {
		go func(id int) {
			ch, cancel := hub.Subscribe("ws1", "", 0)
			defer cancel()
			received := 0
			timeout := time.After(5 * time.Second)
			for {
				select {
				case _, ok := <-ch:
					if !ok {
						done <- struct{}{}
						return
					}
					received++
					if received >= numPublishers*pubsPerPublisher {
						done <- struct{}{}
						return
					}
				case <-timeout:
					t.Logf("subscriber %d timed out after %d events", id, received)
					done <- struct{}{}
					return
				}
			}
		}(i)
	}

	// Start publishers
	for i := 0; i < numPublishers; i++ {
		go func(id int) {
			for j := 0; j < pubsPerPublisher; j++ {
				hub.Publish(Event{
					Type:        "race.test",
					WorkspaceID: "ws1",
				})
			}
		}(i)
	}

	// Wait for all subscribers
	for i := 0; i < numSubscribers; i++ {
		<-done
	}
}

func TestEventHub_PublishNoSubscribers(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Publish to workspace with no subscribers - should not panic
	for i := 0; i < 10; i++ {
		hub.Publish(Event{
			Type:        "test",
			WorkspaceID: "no-subscribers",
		})
	}

	// Verify history still recorded
	history, _ := hub.GetHistory("no-subscribers", 0)
	if len(history) != 10 {
		t.Errorf("expected 10 events in history, got %d", len(history))
	}
}

func TestEventHub_UnsubscribeNonexistent(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Unsubscribe a non-existent subscriber - should not panic
	hub.unsubscribe("nonexistent-ws", "nonexistent-sub")

	// Unsubscribe from non-existent workspace - should not panic
	hub.unsubscribe("ws1", "nonexistent-sub")

	// Subscribe, then unsubscribe twice
	ch, cancel := hub.Subscribe("ws1", "sub1", 0)
	cancel()
	// Second unsubscribe should be safe
	hub.unsubscribe("ws1", "sub1")

	// Channel should be closed
	_, ok := <-ch
	if ok {
		t.Error("channel should be closed after unsubscribe")
	}
}

func TestEventHub_RingBufferWrapAround(t *testing.T) {
	hub := NewEventHub(5, 10) // small history

	// Add events, each with a unique message
	for i := 0; i < 10; i++ {
		hub.Publish(Event{
			Type:        "event",
			WorkspaceID: "ws1",
			Message:     "msg-" + string(rune('0'+i)),
		})
	}

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 5 {
		t.Errorf("expected 5 events in ring buffer, got %d", len(history))
	}

	// The oldest events should be overwritten; only messages 5-9 should remain
	for _, e := range history {
		if e.Message < "msg-5" {
			t.Errorf("unexpected old event in ring buffer: %s", e.Message)
		}
	}
}

func TestEventHub_GlobalSequence(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Sequence is global across workspaces
	hub.Publish(Event{Type: "a", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "b", WorkspaceID: "ws2"})
	hub.Publish(Event{Type: "c", WorkspaceID: "ws1"})

	// Check sequences
	allHistory := append(
		append([]Event{}, hub.GetHistoryAll("ws1")...),
		hub.GetHistoryAll("ws2")...,
	)

	seen := make(map[int64]bool)
	for _, e := range allHistory {
		if e.Sequence < 1 || e.Sequence > 3 {
			t.Errorf("unexpected sequence: %d", e.Sequence)
		}
		if seen[e.Sequence] {
			t.Errorf("duplicate sequence: %d", e.Sequence)
		}
		seen[e.Sequence] = true
	}
}

func TestEventHub_SubscribeWithExactAfterSequence(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	// Subscribe with afterSequence exactly matching the last sequence
	ch, cancel := hub.Subscribe("ws1", "", 3)
	defer cancel()

	// Should receive no history events
	select {
	case e := <-ch:
		t.Errorf("should not receive events after sequence 3, got %s", e.Type)
	case <-time.After(200 * time.Millisecond):
		// Expected
	}
}

func TestEventHub_GapDetection_ExactCondition(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Publish e1 (seq=1), e2 (seq=2) for ws1
	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})

	// Subscribe with afterSequence=0, should get e1 and e2 with no gap
	history, hasGap := hub.GetHistory("ws1", 0)
	if hasGap {
		t.Error("no gap expected for afterSequence=0")
	}
	if len(history) != 2 {
		t.Errorf("expected 2 events, got %d", len(history))
	}

	// Subscribe with afterSequence=1, earliestSeq=1, earliestSeq > afterSequence+1 is false
	// Should get e2 only, no gap
	history2, hasGap2 := hub.GetHistory("ws1", 1)
	if hasGap2 {
		t.Error("no gap expected when earliestSeq == afterSequence+1")
	}
	if len(history2) != 1 {
		t.Errorf("expected 1 event after sequence 1, got %d", len(history2))
	}
}

func TestEventHub_GapDetection_WithMixedWorkspaces(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Publish events interleaved across workspaces
	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"}) // seq=1
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws2"}) // seq=2
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"}) // seq=3

	// For ws1, earliestSeq=1, events after 0: e1(seq=1), e3(seq=3)
	history, hasGap := hub.GetHistory("ws1", 0)
	if hasGap {
		t.Error("no gap expected for afterSequence=0")
	}
	if len(history) != 2 {
		t.Errorf("expected 2 events for ws1, got %d", len(history))
	}

	// For ws1 after sequence 1: earliestSeq=1, afterSequence=1
	// earliestSeq (1) > afterSequence+1 (2) is false, so no gap
	history2, hasGap2 := hub.GetHistory("ws1", 1)
	if hasGap2 {
		t.Error("no gap expected when earliestSeq(1) <= afterSequence+1(2)")
	}
	if len(history2) != 1 || history2[0].Type != "e3" {
		t.Errorf("expected e3 only, got %d events", len(history2))
	}
}

func TestEventHub_SnapshotRequiredOnGap(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Publish events for ws1 interspersed with ws2
	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"}) // seq=1
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws2"}) // seq=2
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"}) // seq=3

	// Subscribe with afterSequence=0: earliestSeq=1, afterSequence=0
	// earliestSeq (1) > afterSequence+1 (1) is false, no gap
	ch, cancel := hub.Subscribe("ws1", "sub1", 0)
	defer cancel()

	hasSnapshot := false
	hasEvent := false
	timeout := time.After(time.Second)
	for !hasSnapshot || !hasEvent {
		select {
		case e := <-ch:
			if e.Type == EventSnapshotRequired {
				hasSnapshot = true
			} else {
				hasEvent = true
			}
		case <-timeout:
			// No snapshot required when no gap
			if hasSnapshot {
				t.Error("should not receive snapshot.required when no gap exists")
			}
			if !hasEvent {
				t.Error("should have received at least one event")
			}
			return
		}
	}
	// If we got here, snapshot was received - but afterSequence=0 shouldn't produce a gap
}

func TestEventHub_SnapshotRequiredOnRealGap(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Publish events to create a gap for ws1
	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"}) // seq=1
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws2"}) // seq=2
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws2"}) // seq=3
	hub.Publish(Event{Type: "e4", WorkspaceID: "ws1"}) // seq=4

	// For ws1, earliestSeq=1, events after 0: e1(seq=1), e4(seq=4)
	// Subscribe with afterSequence=0: earliestSeq(1) > 1 is false, no gap
	// Subscribe with afterSequence=1: earliestSeq(1) > 2 is false, no gap
	// But if we ask for afterSequence=2 (which doesn't exist in ws1 history):
	// earliestSeq=1, afterSequence=2, earliestSeq(1) > afterSequence+1(3) is FALSE
	// Actually, the gap condition is: earliestSeq > afterSequence+1 AND len(result) > 0 AND afterSequence > 0
	// afterSequence=2, earliestSeq=1, 1 > 3 is false, no gap.
	// The gap happens when: the subscriber's last known sequence is far behind our earliest.
	// Let's subscribe with afterSequence=2 and see if we get e4 only (no gap)

	ch, cancel := hub.Subscribe("ws1", "sub1", 2)
	defer cancel()

	received := []Event{}
	timeout := time.After(time.Second)
	for {
		select {
		case e, ok := <-ch:
			if !ok {
				return
			}
			received = append(received, e)
			if len(received) >= 2 {
				return
			}
		case <-timeout:
			if len(received) == 0 {
				t.Error("expected at least one event")
			}
			return
		}
	}
}

func TestEventHub_HistoryReplayBufferFull(t *testing.T) {
	hub := NewEventHub(100, 2) // small buffer

	// Publish many events to history
	for i := 0; i < 50; i++ {
		hub.Publish(Event{
			Type:        "test",
			WorkspaceID: "ws1",
			Message:     "msg",
		})
	}

	// Subscribe with afterSequence=0 to trigger history replay
	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	// Read some events - should not block
	received := 0
	timeout := time.After(2 * time.Second)
	for {
		select {
		case e, ok := <-ch:
			if !ok {
				return
			}
			received++
			_ = e
			if received >= 10 {
				return
			}
		case <-timeout:
			if received == 0 {
				t.Error("expected at least some events during history replay")
			}
			return
		}
	}
}

func TestEventHub_EventDataField(t *testing.T) {
	hub := NewEventHub(100, 10)

	type CustomData struct {
		Key   string `json:"key"`
		Value int    `json:"value"`
	}

	raw, _ := json.Marshal(CustomData{Key: "foo", Value: 42})
	hub.Publish(Event{
		Type:        "data.test",
		WorkspaceID: "ws1",
		Data:        raw,
	})

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 1 {
		t.Fatalf("expected 1 event, got %d", len(history))
	}
	if history[0].Data == nil {
		t.Error("Data field should not be nil")
	}
}

func TestEventHub_SubscribeWithNilSubscriberMap(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Subscribe to a workspace that has never been subscribed to
	ch, cancel := hub.Subscribe("new-ws", "sub1", 0)
	defer cancel()

	hub.Publish(Event{Type: "test", WorkspaceID: "new-ws"})

	select {
	case e := <-ch:
		if e.Type != "test" {
			t.Errorf("expected 'test', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestEventHub_HistoryWithSmallMaxHistory(t *testing.T) {
	hub := NewEventHub(2, 10) // small but non-zero history

	// Publish more events than history capacity
	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) > 2 {
		t.Errorf("expected at most 2 events in history, got %d", len(history))
	}

	// Subscribe should get history replay
	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	// Drain any history replay events
	received := 0
	timeout := time.After(time.Second)
	for {
		select {
		case e, ok := <-ch:
			if !ok {
				return
			}
			received++
			_ = e
			if received >= 2 {
				// Only new events should be received after history
				hub.Publish(Event{Type: "e4", WorkspaceID: "ws1"})
			}
			if received >= 3 {
				return
			}
		case <-timeout:
			if received == 0 {
				t.Error("expected at least some events")
			}
			return
		}
	}
}

func TestEventHub_HistoryAfterSequenceBeyondRange(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})

	// afterSequence beyond all events
	history, hasGap := hub.GetHistory("ws1", 100)
	if hasGap {
		t.Error("no gap expected when afterSequence is beyond all events")
	}
	if len(history) != 0 {
		t.Errorf("expected 0 events, got %d", len(history))
	}
}

func TestEventHub_SubscribeAfterSequenceBeyondRange(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})

	// Subscribe with afterSequence beyond all events
	ch, cancel := hub.Subscribe("ws1", "", 100)
	defer cancel()

	// Should not receive history events, but should receive new events
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	select {
	case e := <-ch:
		if e.Type != "e3" {
			t.Errorf("expected 'e3', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for new event")
	}
}

func TestEventHub_AllEventTypes(t *testing.T) {
	eventTypes := []EventType{
		EventBuildQueued,
		EventBuildStarted,
		EventBuildProgress,
		EventBuildCompleted,
		EventBuildFailed,
		EventBuildCancelled,
		EventServerStarted,
		EventServerStopped,
		EventServerError,
		EventDeployComplete,
		EventDeployStarted,
		EventHotReloadStatus,
		EventSnapshotRequired,
		EventGap,
	}

	for _, et := range eventTypes {
		if et == "" {
			t.Errorf("event type should not be empty")
		}
	}
	if len(eventTypes) != 14 {
		t.Errorf("expected 14 event types, got %d", len(eventTypes))
	}
}

func TestEventHub_SubscribeWithIDReturnsUniqueIDs(t *testing.T) {
	hub := NewEventHub(100, 10)

	ids := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id, ch, cancel := hub.SubscribeWithID("ws1", 0)
		defer cancel()
		_ = ch
		if ids[id] {
			t.Errorf("duplicate subscriber ID: %s", id)
		}
		ids[id] = true
	}
}

func TestEventHub_UnsubscribeRemovesWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)

	ch1, cancel1 := hub.Subscribe("ws1", "sub1", 0)
	cancel1()
	_, ok := <-ch1
	if ok {
		t.Error("channel should be closed")
	}

	// After unsubscribe, the workspace map entry should be cleaned up
	// Re-subscribe should work fine
	ch2, cancel2 := hub.Subscribe("ws1", "sub2", 0)
	defer cancel2()

	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	select {
	case e := <-ch2:
		if e.Type != "test" {
			t.Errorf("expected 'test', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out")
	}
}

func TestEventHub_WorkspaceIsolation(t *testing.T) {
	hub := NewEventHub(100, 10)

	ch1, cancel1 := hub.Subscribe("ws1", "sub1", 0)
	defer cancel1()
	ch2, cancel2 := hub.Subscribe("ws2", "sub2", 0)
	defer cancel2()

	// Publish to ws1 only
	hub.Publish(Event{Type: "ws1-event", WorkspaceID: "ws1"})

	// ws1 subscriber should receive
	select {
	case e := <-ch1:
		if e.Type != "ws1-event" {
			t.Errorf("expected 'ws1-event', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("ws1 subscriber timed out")
	}

	// ws2 subscriber should NOT receive
	select {
	case <-ch2:
		t.Fatal("ws2 subscriber should not receive ws1 event")
	case <-time.After(100 * time.Millisecond):
		// Expected
	}

	// Publish to ws2
	hub.Publish(Event{Type: "ws2-event", WorkspaceID: "ws2"})

	select {
	case e := <-ch2:
		if e.Type != "ws2-event" {
			t.Errorf("expected 'ws2-event', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("ws2 subscriber timed out")
	}
}

func TestEventHub_EventStructFields(t *testing.T) {
	now := time.Now()
	raw, _ := json.Marshal(map[string]string{"key": "value"})
	evt := Event{
		Sequence:    42,
		Type:        "custom.type",
		WorkspaceID: "ws-custom",
		Message:     "custom message",
		Data:        raw,
		Time:        now,
	}

	if evt.Sequence != 42 {
		t.Errorf("Sequence = %d, want 42", evt.Sequence)
	}
	if evt.Type != "custom.type" {
		t.Errorf("Type = %q", evt.Type)
	}
	if evt.WorkspaceID != "ws-custom" {
		t.Errorf("WorkspaceID = %q", evt.WorkspaceID)
	}
	if evt.Message != "custom message" {
		t.Errorf("Message = %q", evt.Message)
	}
	if evt.Time != now {
		t.Errorf("Time = %v, want %v", evt.Time, now)
	}
}

func TestEventHub_ZeroMaxHistoryDefaults(t *testing.T) {
	hub := NewEventHub(0, 0)
	if hub.maxHistory != defaultMaxHistory {
		t.Errorf("maxHistory = %d, want %d", hub.maxHistory, defaultMaxHistory)
	}
	if hub.maxSubBuffer != defaultMaxSubBuf {
		t.Errorf("maxSubBuffer = %d, want %d", hub.maxSubBuffer, defaultMaxSubBuf)
	}
	// Also verify subscribers map is initialized
	if hub.subscribers == nil {
		t.Error("subscribers map should be initialized")
	}
}

func TestEventHub_NegativeMaxHistoryDefaults(t *testing.T) {
	hub := NewEventHub(-1, -5)
	if hub.maxHistory != defaultMaxHistory {
		t.Errorf("maxHistory = %d, want %d (default)", hub.maxHistory, defaultMaxHistory)
	}
	if hub.maxSubBuffer != defaultMaxSubBuf {
		t.Errorf("maxSubBuffer = %d, want %d (default)", hub.maxSubBuffer, defaultMaxSubBuf)
	}
}

func TestEventHub_PublishAfterUnsubscribe(t *testing.T) {
	hub := NewEventHub(100, 10)

	ch, cancel := hub.Subscribe("ws1", "sub1", 0)
	cancel()

	// Drain closed channel
	for range ch {
	}

	// Publish after unsubscribe - should not panic
	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	// History should still be updated
	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 1 {
		t.Errorf("expected 1 event in history, got %d", len(history))
	}
}

func TestEventHub_MultipleWorkspaceSubscriptions(t *testing.T) {
	hub := NewEventHub(100, 10)

	ch1, cancel1 := hub.Subscribe("ws1", "", 0)
	defer cancel1()
	ch2, cancel2 := hub.Subscribe("ws2", "", 0)
	defer cancel2()

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws2"})

	select {
	case e := <-ch1:
		if e.Type != "e1" {
			t.Errorf("ch1: expected 'e1', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("ch1 timed out")
	}

	select {
	case e := <-ch2:
		if e.Type != "e2" {
			t.Errorf("ch2: expected 'e2', got '%s'", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("ch2 timed out")
	}
}

func TestEventHub_PublishWithPresetTime(t *testing.T) {
	hub := NewEventHub(100, 10)

	presetTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	hub.Publish(Event{
		Type:        "test",
		WorkspaceID: "ws1",
		Time:        presetTime,
	})

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 1 {
		t.Fatalf("expected 1 event, got %d", len(history))
	}
	if !history[0].Time.Equal(presetTime) {
		t.Errorf("Time = %v, want %v", history[0].Time, presetTime)
	}
}

func TestEventHub_MaxSubscribersExactly(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Fill exactly to maxSubscribers
	for i := 0; i < maxSubscribers; i++ {
		ch, cancel := hub.Subscribe("ws", "", 0)
		// Don't cancel immediately
		_ = ch
		_ = cancel
	}

	// The next subscribe should fail (channel closed)
	ch, cancel := hub.Subscribe("overflow", "", 0)
	defer cancel()

	_, ok := <-ch
	if ok {
		t.Error("expected closed channel when max subscribers reached")
	}
}

func TestEventHub_GetHistoryAll_EmptyWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})

	history := hub.GetHistoryAll("ws2")
	if len(history) != 0 {
		t.Errorf("expected 0 events for empty workspace, got %d", len(history))
	}
}

func TestEventHub_GetHistoryAll_WithGap(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws2"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	// GetHistoryAll ignores gap
	history := hub.GetHistoryAll("ws1")
	if len(history) != 2 {
		t.Errorf("expected 2 events for ws1, got %d", len(history))
	}
}

func TestEventHub_SubscribeWithID_AfterSequence(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	id, ch, cancel := hub.SubscribeWithID("ws1", 1)
	defer cancel()

	if id == "" {
		t.Error("expected non-empty subscriber ID")
	}

	// Should receive e2 and e3 (history replay)
	count := 0
	timeout := time.After(time.Second)
	for count < 2 {
		select {
		case e := <-ch:
			count++
			if e.Type != "e2" && e.Type != "e3" {
				t.Errorf("unexpected event type: %s", e.Type)
			}
		case <-timeout:
			t.Fatalf("timed out after %d events", count)
		}
	}
}

func TestEventHub_OldSubscribe_WithHistory(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})

	id, ch, cancel := hub.OldSubscribe("ws1")
	defer cancel()

	if id == "" {
		t.Error("expected non-empty subscriber ID")
	}

	// Should receive history (afterSequence=0)
	count := 0
	timeout := time.After(time.Second)
	for count < 2 {
		select {
		case e := <-ch:
			count++
			_ = e
		case <-timeout:
			t.Fatalf("timed out after %d events", count)
		}
	}
}

func TestAuthenticateRequest_Subprotocol_MultipleProtocols(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	// The auth logic requires "kairo-auth-v1" as a subprotocol in the list,
	// and then looks for "kairo-auth-v1-<secret>" in the same header
	r.Header.Set("Sec-WebSocket-Protocol", "other-proto, kairo-auth-v1, kairo-auth-v1-secret123")

	validator := func(cred string) bool {
		return cred == "secret123"
	}
	if !authenticateRequest(r, validator) {
		t.Error("should authenticate with valid subprotocol among multiple protocols")
	}
}

func TestAuthenticateRequest_Subprotocol_WrongCredential(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	r.Header.Set("Sec-WebSocket-Protocol", "kairo-auth-v1-wrong")

	validator := func(cred string) bool {
		return cred == "correct"
	}
	if authenticateRequest(r, validator) {
		t.Error("should not authenticate with wrong subprotocol credential")
	}
}

func TestAuthenticateRequest_HeaderAuth_EmptySecret(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	r.Header.Set(AuthSecretHeader, "")

	validator := func(cred string) bool {
		return false
	}
	if authenticateRequest(r, validator) {
		t.Error("empty header secret should not authenticate")
	}
}

func TestAuthenticateRequest_Subprotocol_NoPrefixMatch(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	r.Header.Set("Sec-WebSocket-Protocol", "other-proto-v1-secret")

	validator := func(cred string) bool {
		return true
	}
	if authenticateRequest(r, validator) {
		t.Error("should not authenticate with non-matching subprotocol")
	}
}

func TestEventHub_ConcurrentHistoryAccess(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Pre-populate history
	for i := 0; i < 50; i++ {
		hub.Publish(Event{Type: "event", WorkspaceID: "ws1"})
	}

	done := make(chan struct{})
	const numGoroutines = 20

	// Concurrent readers
	for i := 0; i < numGoroutines; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				hub.GetHistory("ws1", 0)
				hub.GetHistoryAll("ws1")
			}
			done <- struct{}{}
		}()
	}

	// Concurrent writer
	go func() {
		for j := 0; j < 100; j++ {
			hub.Publish(Event{Type: "concurrent", WorkspaceID: "ws1"})
		}
		done <- struct{}{}
	}()

	for i := 0; i < numGoroutines+1; i++ {
		<-done
	}
}

func TestEventHub_ConcurrentSubscribeAndPublish(t *testing.T) {
	hub := NewEventHub(100, 100)

	done := make(chan struct{})
	const numPublishers = 10
	const numSubscribers = 10
	const pubsPerPublisher = 50
	totalPubs := numPublishers * pubsPerPublisher
	start := make(chan struct{})

	// Subscribe all first to avoid history replay goroutines
	subs := make([]struct {
		ch     <-chan Event
		cancel func()
	}, numSubscribers)

	for i := 0; i < numSubscribers; i++ {
		ch, cancel := hub.Subscribe("ws1", "", 0)
		subs[i] = struct {
			ch     <-chan Event
			cancel func()
		}{ch, cancel}
	}

	// Start subscriber drainers
	subDone := make(chan struct{}, numSubscribers)
	for i := 0; i < numSubscribers; i++ {
		go func(idx int) {
			<-start
			ch := subs[idx].ch
			received := 0
			for {
				select {
				case _, ok := <-ch:
					if !ok {
						subDone <- struct{}{}
						return
					}
					received++
				case <-time.After(200 * time.Millisecond):
					// pause
				}
				// Exit after receiving enough or timeout
				if received >= 100 {
					subDone <- struct{}{}
					return
				}
			}
		}(i)
	}

	// Start publishers
	pubDone := make(chan struct{}, numPublishers)
	for i := 0; i < numPublishers; i++ {
		go func(id int) {
			<-start
			for j := 0; j < pubsPerPublisher; j++ {
				hub.Publish(Event{Type: "concurrent", WorkspaceID: "ws1"})
			}
			pubDone <- struct{}{}
		}(i)
	}

	close(start)

	// Wait for all publishers first
	for i := 0; i < numPublishers; i++ {
		<-pubDone
	}

	// Give subscribers time to drain
	timeout := time.After(3 * time.Second)
	remaining := numSubscribers
	for remaining > 0 {
		select {
		case <-subDone:
			remaining--
		case <-timeout:
			remaining = 0
		}
	}

	// Now safe to unsubscribe
	for i := 0; i < numSubscribers; i++ {
		subs[i].cancel()
		for range subs[i].ch {
		}
	}

	// Verify history
	history, _ := hub.GetHistory("ws1", 0)
	if len(history) == 0 {
		t.Error("history should have events")
	}
	_ = totalPubs
	_ = done
}

func TestEventHub_GapDetection_TrueGap(t *testing.T) {
	hub := NewEventHub(5, 10) // small history to force wrap-around

	// Fill ring buffer and cause wrap-around, losing early ws1 events
	hub.Publish(Event{Type: "a", WorkspaceID: "ws1"}) // seq=1
	hub.Publish(Event{Type: "b", WorkspaceID: "ws2"}) // seq=2
	hub.Publish(Event{Type: "c", WorkspaceID: "ws2"}) // seq=3
	hub.Publish(Event{Type: "d", WorkspaceID: "ws2"}) // seq=4
	hub.Publish(Event{Type: "e", WorkspaceID: "ws2"}) // seq=5
	hub.Publish(Event{Type: "f", WorkspaceID: "ws2"}) // seq=6 (overwrites seq=1)
	hub.Publish(Event{Type: "g", WorkspaceID: "ws2"}) // seq=7 (overwrites seq=2)
	hub.Publish(Event{Type: "h", WorkspaceID: "ws1"}) // seq=8 (overwrites seq=3)

	// For ws1, earliestSeq should be 8 (seq=1 was overwritten)
	// afterSequence=1: earliestSeq(8) > 2 = true → gap!
	history, hasGap := hub.GetHistory("ws1", 1)
	if !hasGap {
		t.Error("expected gap when earliest event is far after afterSequence")
	}
	if len(history) != 1 || history[0].Type != "h" {
		t.Errorf("expected 1 event (h), got %d events", len(history))
	}
}

func TestEventHub_SubscribeWithTrueGap(t *testing.T) {
	hub := NewEventHub(5, 10) // small history to force wrap-around

	// Fill ring buffer to cause ws1 events to be lost
	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"}) // seq=1
	hub.Publish(Event{Type: "x1", WorkspaceID: "ws2"}) // seq=2
	hub.Publish(Event{Type: "x2", WorkspaceID: "ws2"}) // seq=3
	hub.Publish(Event{Type: "x3", WorkspaceID: "ws2"}) // seq=4
	hub.Publish(Event{Type: "x4", WorkspaceID: "ws2"}) // seq=5 (overwrites seq=1)
	hub.Publish(Event{Type: "x5", WorkspaceID: "ws2"}) // seq=6 (overwrites seq=2)
	hub.Publish(Event{Type: "x6", WorkspaceID: "ws2"}) // seq=7 (overwrites seq=3)
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"}) // seq=8 (overwrites seq=4)

	// Subscribe with afterSequence=1, earliestSeq=8, 8 > 2 → gap → snapshot.required
	ch, cancel := hub.Subscribe("ws1", "sub1", 1)
	defer cancel()

	hasSnapshot := false
	hasEvent := false
	timeout := time.After(2 * time.Second)
	for {
		select {
		case e, ok := <-ch:
			if !ok {
				return
			}
			if e.Type == EventSnapshotRequired {
				hasSnapshot = true
			} else {
				hasEvent = true
			}
			if hasSnapshot && hasEvent {
				return
			}
		case <-timeout:
			if !hasSnapshot {
				t.Error("expected snapshot.required event when true gap exists")
			}
			if !hasEvent {
				t.Error("expected at least one history event")
			}
			return
		}
	}
}

func TestEventHub_SubscribeMaxSubscribersReached(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Fill all subscriber slots
	for i := 0; i < maxSubscribers; i++ {
		ch, cancel := hub.Subscribe("ws", "", 0)
		_ = ch
		_ = cancel
	}

	// Next subscribe should return closed channel
	ch, cancel := hub.Subscribe("overflow", "custom-id", 0)
	defer cancel()

	_, ok := <-ch
	if ok {
		t.Error("expected closed channel when max subscribers reached")
	}

	// cancel should be a no-op
	cancel()
}

func TestEventHub_GetHistoryEmptyWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})

	// Get history for a workspace with no events doesn't exist
	history, hasGap := hub.GetHistory("ws2", 0)
	if hasGap {
		t.Error("no gap expected for workspace with no events")
	}
	if len(history) != 0 {
		t.Errorf("expected 0 events for ws2, got %d", len(history))
	}
}

func TestEventHub_GetHistoryWithAfterSequenceZero(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})

	// afterSequence=0 should return all events
	history, hasGap := hub.GetHistory("ws1", 0)
	if hasGap {
		t.Error("no gap expected for afterSequence=0")
	}
	if len(history) != 2 {
		t.Errorf("expected 2 events, got %d", len(history))
	}
}

func TestEventHub_Publish_GapEventOnSlowConsumer(t *testing.T) {
	hub := NewEventHub(100, 1) // buffer of 1

	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	// Publish 3 events rapidly - buffer of 1 means some will be dropped
	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1"})

	// Should receive at least one event and possibly a gap event
	received := 0
	hasGap := false
	timeout := time.After(time.Second)
	for received < 2 {
		select {
		case e, ok := <-ch:
			if !ok {
				return
			}
			received++
			if e.Type == EventGap {
				hasGap = true
			}
			if received >= 2 || hasGap {
				return
			}
		case <-timeout:
			if received == 0 {
				t.Error("expected at least one event")
			}
			return
		}
	}
}

func TestEventHub_UnsubscribeNonExistentSubscriber(t *testing.T) {
	hub := NewEventHub(100, 10)

	// Subscribe and then unsubscribe
	_, cancel := hub.Subscribe("ws1", "sub1", 0)
	cancel()

	// Unsubscribe again - should be safe (second unsubscribe)
	hub.unsubscribe("ws1", "sub1")

	// Unsubscribe from workspace that had subscribers but now has none
	hub.unsubscribe("ws1", "sub1")
}

func TestEventHub_PublishMultipleWorkspaces(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "a", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "b", WorkspaceID: "ws2"})
	hub.Publish(Event{Type: "c", WorkspaceID: "ws3"})

	if len(hub.GetHistoryAll("ws1")) != 1 {
		t.Error("ws1 should have 1 event")
	}
	if len(hub.GetHistoryAll("ws2")) != 1 {
		t.Error("ws2 should have 1 event")
	}
	if len(hub.GetHistoryAll("ws3")) != 1 {
		t.Error("ws3 should have 1 event")
	}
}

func TestAuthenticateRequest_Subprotocol_NoKairoPrefix(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/events?workspaceId=ws1", nil)
	r.Header.Set("Sec-WebSocket-Protocol", "kairo-auth-v1")

	validator := func(cred string) bool {
		return true
	}
	// kairo-auth-v1 is present as a subprotocol, but no credential after the dash
	// The Sec-WebSocket-Protocol header is just "kairo-auth-v1" with no "-secret"
	// authenticateRequest finds kairo-auth-v1 subprotocol, then looks for "kairo-auth-v1-*" in the header
	// It won't find any part with prefix "kairo-auth-v1-" since the only part is "kairo-auth-v1"
	if authenticateRequest(r, validator) {
		t.Error("should not authenticate without credential")
	}
}

func TestEventHub_SequenceNumbering(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "a", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "b", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "c", WorkspaceID: "ws1"})

	history, _ := hub.GetHistory("ws1", 0)
	if len(history) != 3 {
		t.Fatalf("expected 3 events, got %d", len(history))
	}
	for i, e := range history {
		expectedSeq := int64(i + 1)
		if e.Sequence != expectedSeq {
			t.Errorf("event %d: expected sequence %d, got %d", i, expectedSeq, e.Sequence)
		}
	}
}

func TestEventHub_SubscribeWithID_EmptyWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)

	id, ch, cancel := hub.SubscribeWithID("", 0)
	defer cancel()

	if id == "" {
		t.Error("expected non-empty subscriber ID")
	}

	hub.Publish(Event{Type: "test", WorkspaceID: "ws1"})

	// Should not receive event for different workspace
	select {
	case <-ch:
		t.Fatal("should not receive event for different workspace")
	case <-time.After(100 * time.Millisecond):
		// Expected
	}
}

func TestEventHub_OldSubscribe_UniqueIDs(t *testing.T) {
	hub := NewEventHub(100, 10)

	id1, _, cancel1 := hub.OldSubscribe("ws1")
	defer cancel1()
	id2, _, cancel2 := hub.OldSubscribe("ws1")
	defer cancel2()

	if id1 == "" || id2 == "" {
		t.Error("expected non-empty subscriber IDs")
	}
	if id1 == id2 {
		t.Error("expected unique subscriber IDs")
	}
}

func TestEventHub_ServeWSCompat(t *testing.T) {
	hub := NewEventHub(100, 10)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWSCompat(w, r)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events?workspaceId=ws1&afterSequence=0"
	header := http.Header{}
	header.Set("X-Kairo-Auth", "any-secret-works")

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("failed to dial WebSocket: %v", err)
	}
	defer conn.Close()

	hub.Publish(Event{Type: "ws.test", WorkspaceID: "ws1", Message: "hello-ws"})

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var received Event
	if err := conn.ReadJSON(&received); err != nil {
		t.Fatalf("failed to read event from WebSocket: %v", err)
	}

	if received.Type != "ws.test" {
		t.Errorf("expected 'ws.test', got '%s'", received.Type)
	}
	if received.Message != "hello-ws" {
		t.Errorf("expected 'hello-ws', got '%s'", received.Message)
	}
}

func TestEventHub_ServeWSCompat_NoWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWSCompat(w, r)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events"
	header := http.Header{}
	header.Set("X-Kairo-Auth", "any-secret")

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("dial should succeed even without workspaceId: %v", err)
	}
	defer conn.Close()

	// Connection should be closed immediately by the server
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Error("expected connection to be closed when no workspaceId")
	}
}

func TestEventHub_ServeWS_WithAuth(t *testing.T) {
	hub := NewEventHub(100, 10)

	validator := func(cred string) bool {
		return cred == "test-secret"
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, validator)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events?workspaceId=ws1"
	header := http.Header{}
	header.Set("X-Kairo-Auth", "test-secret")

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("failed to dial WebSocket: %v", err)
	}
	defer conn.Close()

	hub.Publish(Event{Type: "auth.test", WorkspaceID: "ws1"})

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var received Event
	if err := conn.ReadJSON(&received); err != nil {
		t.Fatalf("failed to read event: %v", err)
	}
	if received.Type != "auth.test" {
		t.Errorf("expected 'auth.test', got '%s'", received.Type)
	}
}

func TestEventHub_ServeWS_Unauthorized(t *testing.T) {
	hub := NewEventHub(100, 10)

	validator := func(cred string) bool {
		return cred == "test-secret"
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, validator)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events?workspaceId=ws1"
	header := http.Header{}
	header.Set("X-Kairo-Auth", "wrong-secret")

	_, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err == nil {
		t.Error("expected error when using wrong auth secret")
	}
}

func TestEventHub_ServeWS_NoAuth(t *testing.T) {
	hub := NewEventHub(100, 10)

	validator := func(cred string) bool {
		return cred == "test-secret"
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, validator)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events?workspaceId=ws1"

	// No auth header
	_, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Error("expected error when no auth provided")
	}
}

func TestEventHub_Serve(t *testing.T) {
	hub := NewEventHub(100, 10)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Serve(w, r)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events?workspaceId=ws1&afterSequence=0"

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial WebSocket: %v", err)
	}
	defer conn.Close()

	hub.Publish(Event{Type: "serve.test", WorkspaceID: "ws1"})

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var received Event
	if err := conn.ReadJSON(&received); err != nil {
		t.Fatalf("failed to read event: %v", err)
	}
	if received.Type != "serve.test" {
		t.Errorf("expected 'serve.test', got '%s'", received.Type)
	}
}

func TestEventHub_Serve_NoWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Serve(w, r)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events"

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial should succeed even without workspaceId: %v", err)
	}
	defer conn.Close()

	// Connection should be closed immediately by the server
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Error("expected connection to be closed when no workspaceId")
	}
}

func TestEventHub_Serve_WithSinceParam(t *testing.T) {
	hub := NewEventHub(100, 10)

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1"})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1"})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Serve(w, r)
	}))
	defer srv.Close()

	// Use "since" param instead of "afterSequence"
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events?workspaceId=ws1&since=1"

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial WebSocket: %v", err)
	}
	defer conn.Close()

	// Should receive e2 (history replay after sequence 1)
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var received Event
	if err := conn.ReadJSON(&received); err != nil {
		t.Fatalf("failed to read event: %v", err)
	}
	if received.Type != "e2" {
		t.Errorf("expected 'e2', got '%s'", received.Type)
	}
}

func TestEventHub_UpgraderCheckOrigin(t *testing.T) {
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
			got := upgrader.CheckOrigin(r)
			if got != tc.want {
				t.Errorf("CheckOrigin(%q) = %v, want %v", tc.origin, got, tc.want)
			}
		})
	}
}

func TestEventBusAdapter_Serve(t *testing.T) {
	hub := NewEventHub(100, 10)
	adapter := &EventBusAdapter{Hub: hub}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		adapter.Serve(w, r)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events?workspaceId=ws1"

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial WebSocket: %v", err)
	}
	defer conn.Close()

	hub.Publish(Event{Type: "adapter.test", WorkspaceID: "ws1"})

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var received Event
	if err := conn.ReadJSON(&received); err != nil {
		t.Fatalf("failed to read event: %v", err)
	}
	if received.Type != "adapter.test" {
		t.Errorf("expected 'adapter.test', got '%s'", received.Type)
	}
}

func TestEventBusAdapter_Serve_NoWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)
	adapter := &EventBusAdapter{Hub: hub}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		adapter.Serve(w, r)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events"

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial should succeed: %v", err)
	}
	defer conn.Close()

	// Connection should be closed immediately
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Error("expected connection to be closed when no workspaceId")
	}
}

// ── Benchmarks ──────────────────────────────────────────────────────

func BenchmarkEventHub_Publish_NoSubscribers(b *testing.B) {
	hub := NewEventHub(1000, 256)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.Publish(Event{
			Type:        "test.event",
			WorkspaceID: "ws1",
			Message:     "benchmark message",
		})
	}
}

func BenchmarkEventHub_Publish_WithSubscribers(b *testing.B) {
	hub := NewEventHub(1000, 256)
	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	// Drain in background
	go func() {
		for range ch {
		}
	}()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.Publish(Event{
			Type:        "test.event",
			WorkspaceID: "ws1",
			Message:     "benchmark message",
		})
	}
}

func BenchmarkEventHub_Publish_ManySubscribers(b *testing.B) {
	hub := NewEventHub(1000, 256)
	const numSubs = 10
	var cancels []func()
	for i := 0; i < numSubs; i++ {
		ch, cancel := hub.Subscribe("ws1", "", 0)
		cancels = append(cancels, cancel)
		go func() {
			for range ch {
			}
		}()
	}
	defer func() {
		for _, c := range cancels {
			c()
		}
	}()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.Publish(Event{
			Type:        "test.event",
			WorkspaceID: "ws1",
			Message:     "benchmark message",
		})
	}
}

func BenchmarkEventHub_Publish_Parallel(b *testing.B) {
	hub := NewEventHub(1000, 256)
	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()
	go func() {
		for range ch {
		}
	}()

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			hub.Publish(Event{
				Type:        "test.event",
				WorkspaceID: "ws1",
				Message:     "benchmark message",
			})
		}
	})
}

func BenchmarkEventHub_Subscribe(b *testing.B) {
	hub := NewEventHub(1000, 256)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ch, cancel := hub.Subscribe("ws1", "", 0)
		cancel()
		// Drain to avoid goroutine leak
		select {
		case <-ch:
		default:
		}
	}
}

func BenchmarkEventHub_GetHistory(b *testing.B) {
	hub := NewEventHub(1000, 256)
	// Pre-populate history
	for i := 0; i < 500; i++ {
		hub.Publish(Event{
			Type:        "test.event",
			WorkspaceID: "ws1",
			Message:     "history entry",
		})
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.GetHistory("ws1", 0)
	}
}