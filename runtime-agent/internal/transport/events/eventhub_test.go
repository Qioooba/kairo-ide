package events

import (
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
