package events

import (
	"testing"
	"time"
)

func TestEventHub_PublishSubscribe(t *testing.T) {
	hub := NewEventHub(100, 10)
	_, ch, cancel := hub.Subscribe("ws1")
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
	_, ch1, cancel1 := hub.Subscribe("ws1")
	_, ch2, cancel2 := hub.Subscribe("ws1")
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

func TestEventHub_WrongWorkspace(t *testing.T) {
	hub := NewEventHub(100, 10)
	_, ch, cancel := hub.Subscribe("ws1")
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

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1", Sequence: 1})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1", Sequence: 2})

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

	hub.Publish(Event{Type: "e1", WorkspaceID: "ws1", Sequence: 1})
	hub.Publish(Event{Type: "e2", WorkspaceID: "ws1", Sequence: 2})
	hub.Publish(Event{Type: "e3", WorkspaceID: "ws1", Sequence: 3})

	history, _ := hub.GetHistory("ws1", 1)
	if len(history) != 2 {
		t.Errorf("expected 2 events after sequence 1, got %d", len(history))
	}
}
