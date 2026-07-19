package events

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // 同源请求没有 Origin 头
		}
		// 允许 localhost
		if strings.HasPrefix(origin, "http://localhost") ||
			strings.HasPrefix(origin, "http://127.0.0.1") ||
			strings.HasPrefix(origin, "http://[::1]") {
			return true
		}
		// 允许 file:// 协议（Electron/Desktop）
		if strings.HasPrefix(origin, "file://") {
			return true
		}
		return false
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// ServeWS handles WebSocket connections for event streaming.
func (h *EventHub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		return
	}

	// Set read deadline for ping/pong (5min for IDE long-lived connections)
	conn.SetReadDeadline(time.Now().Add(300 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(300 * time.Second))
		return nil
	})

	// Send ping every 15 seconds
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	// Subscribe
	_, ch, unsubscribe := h.Subscribe(workspaceID)
	defer unsubscribe()

	// Send history
	events, hasGap := h.GetHistory(workspaceID, 0)
	if hasGap {
		conn.WriteJSON(Event{
			Type:        EventSnapshotRequired,
			WorkspaceID: workspaceID,
			Message:     "Please re-sync snapshot",
		})
	}
	for _, e := range events {
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := conn.WriteJSON(e); err != nil {
			return
		}
	}

	// Forward events
	for event := range ch {
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := conn.WriteJSON(event); err != nil {
			return
		}
	}
}
