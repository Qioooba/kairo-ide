package events

import (
	"encoding/json"
	"testing"
	"time"
)

// --- EventHub creation benchmarks ---

func BenchmarkNewEventHub(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewEventHub(1000, 256)
	}
}

func BenchmarkNewEventHub_Default(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewEventHub(0, 0)
	}
}

// --- Publish benchmarks ---

func BenchmarkPublish_SingleSubscriber(b *testing.B) {
	hub := NewEventHub(1000, 1000)
	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	// Drain channel in background to avoid blocking
	go func() {
		for range ch {
		}
	}()

	event := Event{
		Type:        EventBuildProgress,
		WorkspaceID: "ws1",
		Message:     "building...",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.Publish(event)
	}
}

func BenchmarkPublish_MultipleSubscribers(b *testing.B) {
	hub := NewEventHub(1000, 1000)
	for j := 0; j < 10; j++ {
		ch, cancel := hub.Subscribe("ws1", "", 0)
		defer cancel()
		go func() {
			for range ch {
			}
		}()
	}

	event := Event{
		Type:        EventBuildProgress,
		WorkspaceID: "ws1",
		Message:     "building...",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.Publish(event)
	}
}

func BenchmarkPublish_WithHistory(b *testing.B) {
	hub := NewEventHub(1000, 1000)
	ch, cancel := hub.Subscribe("ws1", "", 0)
	defer cancel()

	go func() {
		for range ch {
		}
	}()

	event := Event{
		Type:        EventBuildProgress,
		WorkspaceID: "ws1",
		Message:     "building...",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.Publish(event)
	}
}

func BenchmarkPublish_NoSubscribers(b *testing.B) {
	hub := NewEventHub(1000, 256)

	event := Event{
		Type:        EventBuildProgress,
		WorkspaceID: "ws1",
		Message:     "building...",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.Publish(event)
	}
}

// --- Subscribe benchmarks ---

func BenchmarkSubscribe(b *testing.B) {
	hub := NewEventHub(1000, 256)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, cancel := hub.Subscribe("ws1", "", 0)
		cancel()
	}
}

func BenchmarkSubscribe_WithHistory(b *testing.B) {
	hub := NewEventHub(1000, 256)
	// Pre-fill history
	for j := 0; j < 100; j++ {
		hub.Publish(Event{
			Type:        EventBuildProgress,
			WorkspaceID: "ws1",
			Message:     "event",
			Time:        time.Now(),
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, cancel := hub.Subscribe("ws1", "", 0)
		cancel()
	}
}

func BenchmarkSubscribeWithID(b *testing.B) {
	hub := NewEventHub(1000, 256)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, cancel := hub.SubscribeWithID("ws1", 0)
		cancel()
	}
}

// --- GetHistory benchmarks ---

func BenchmarkGetHistory(b *testing.B) {
	hub := NewEventHub(1000, 256)
	// Pre-fill history
	for j := 0; j < 500; j++ {
		hub.Publish(Event{
			Type:        EventBuildProgress,
			WorkspaceID: "ws1",
			Message:     "event",
			Time:        time.Now(),
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.GetHistory("ws1", 0)
	}
}

func BenchmarkGetHistory_Large(b *testing.B) {
	hub := NewEventHub(1000, 256)
	// Fill history to max
	for j := 0; j < 1000; j++ {
		hub.Publish(Event{
			Type:        EventBuildProgress,
			WorkspaceID: "ws1",
			Message:     "event",
			Time:        time.Now(),
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.GetHistory("ws1", 0)
	}
}

func BenchmarkGetHistory_AfterSequence(b *testing.B) {
	hub := NewEventHub(1000, 256)
	// Pre-fill history
	for j := 0; j < 500; j++ {
		hub.Publish(Event{
			Type:        EventBuildProgress,
			WorkspaceID: "ws1",
			Message:     "event",
			Time:        time.Now(),
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.GetHistory("ws1", 250)
	}
}

func BenchmarkGetHistoryAll(b *testing.B) {
	hub := NewEventHub(1000, 256)
	// Pre-fill history
	for j := 0; j < 500; j++ {
		hub.Publish(Event{
			Type:        EventBuildProgress,
			WorkspaceID: "ws1",
			Message:     "event",
			Time:        time.Now(),
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.GetHistoryAll("ws1")
	}
}

// --- generateSubscriberID benchmark ---

func BenchmarkGenerateSubscriberID(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		generateSubscriberID()
	}
}

// --- Event JSON serialization benchmarks ---

func BenchmarkJSONMarshal_Event(b *testing.B) {
	e := Event{
		Sequence:    42,
		Type:        EventBuildCompleted,
		WorkspaceID: "ws-1",
		Message:     "Build completed successfully",
		Data:        json.RawMessage(`{"exitCode":0,"duration":"30s"}`),
		Time:        time.Now(),
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(e)
	}
}

func BenchmarkJSONUnmarshal_Event(b *testing.B) {
	data := []byte(`{"sequence":42,"type":"build.completed","workspaceId":"ws-1","message":"Build completed successfully","data":{"exitCode":0,"duration":"30s"},"time":"2024-01-15T10:30:00Z"}`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var e Event
		json.Unmarshal(data, &e)
	}
}

func BenchmarkJSONMarshal_Event_Minimal(b *testing.B) {
	e := Event{
		Type:        EventBuildQueued,
		WorkspaceID: "ws-1",
		Time:        time.Now(),
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(e)
	}
}

// --- OldSubscribe benchmark ---

func BenchmarkOldSubscribe(b *testing.B) {
	hub := NewEventHub(1000, 256)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, cancel := hub.OldSubscribe("ws1")
		cancel()
	}
}