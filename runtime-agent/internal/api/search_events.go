package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/encoding"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/search"
	"github.com/gorilla/websocket"
)

// searchWSUpgrader is a WebSocket upgrader for streaming search.
var searchWSUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		if strings.HasPrefix(origin, "http://localhost") ||
			strings.HasPrefix(origin, "http://127.0.0.1") ||
			strings.HasPrefix(origin, "http://[::1]") {
			return true
		}
		if strings.HasPrefix(origin, "file://") {
			return true
		}
		return false
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// handleSearchStream upgrades the request to a WebSocket and performs
// streaming search. The client sends a JSON search request as the first
// message, and the server responds with SearchStreamEvent batches.
func (s *Server) handleSearchStream(w http.ResponseWriter, r *http.Request) {
	conn, err := searchWSUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Set a read deadline for the initial request message.
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))

	_, msg, err := conn.ReadMessage()
	if err != nil {
		return
	}

	var req struct {
		WorkspaceID    string   `json:"workspaceId"`
		RootPath       string   `json:"rootPath"`
		Query          string   `json:"query"`
		IsRegex        bool     `json:"isRegex"`
		CaseSensitive  bool     `json:"caseSensitive"`
		WholeWord      bool     `json:"wholeWord"`
		Include        []string `json:"include"`
		Exclude        []string `json:"exclude"`
		ContextLines   int      `json:"contextLines"`
		MaxResults     int      `json:"maxResults"`
		PreviewReplace string   `json:"previewReplace"`
	}
	if err := json.Unmarshal(msg, &req); err != nil {
		sendSearchError(conn, "parse request: "+err.Error())
		return
	}

	// Resolve search root.
	root := req.RootPath
	if root == "" && req.WorkspaceID != "" {
		if s.Services.WorkspaceStore != nil {
			if ws, wsErr := s.Services.WorkspaceStore.Get(req.WorkspaceID); wsErr == nil {
				root = ws.RootPath
			}
		}
		if root == "" {
			root = req.WorkspaceID
		}
	}
	if root == "" {
		sendSearchError(conn, "rootPath or workspaceId is required")
		return
	}

	// Clear the read deadline for streaming.
	_ = conn.SetReadDeadline(time.Time{})

	taskID := "search_" + randomID(12)

	opts := search.Options{
		Query:           req.Query,
		IsRegex:         req.IsRegex,
		CaseSensitive:   req.CaseSensitive,
		WholeWord:       req.WholeWord,
		Include:         req.Include,
		Exclude:         req.Exclude,
		ContextLines:    req.ContextLines,
		MaxResults:      req.MaxResults,
		PreviewReplace:  req.PreviewReplace,
		ProjectEncoding: encoding.UTF8,
		Cancel:          r.Context(),
	}

	err = search.SearchStreaming(r.Context(), root, opts, func(batch []search.Match, batchIndex int, total int) error {
		ev := protocol.SearchStreamEvent{
			Kind:       "searchStream",
			TaskID:     taskID,
			BatchIndex: batchIndex,
			Total:      total,
			Done:       false,
		}
		ev.Batch = make([]struct {
			File          string `json:"file"`
			Line          int    `json:"line"`
			Column        int    `json:"column"`
			MatchText     string `json:"matchText"`
			ContextBefore string `json:"contextBefore"`
			ContextAfter  string `json:"contextAfter"`
			Replacement   string `json:"replacement,omitempty"`
		}, len(batch))
		for i, m := range batch {
			ev.Batch[i] = struct {
				File          string `json:"file"`
				Line          int    `json:"line"`
				Column        int    `json:"column"`
				MatchText     string `json:"matchText"`
				ContextBefore string `json:"contextBefore"`
				ContextAfter  string `json:"contextAfter"`
				Replacement   string `json:"replacement,omitempty"`
			}{
				File:          m.File,
				Line:          m.Line,
				Column:        m.Column,
				MatchText:     m.MatchText,
				ContextBefore: m.ContextBefore,
				ContextAfter:  m.ContextAfter,
				Replacement:   m.Replacement,
			}
		}
		return conn.WriteJSON(ev)
	})

	// Send final event.
	if err != nil {
		sendSearchError(conn, err.Error())
		return
	}
	finalEv := protocol.SearchStreamEvent{
		Kind:   "searchStream",
		TaskID: taskID,
		Done:   true,
	}
	_ = conn.WriteJSON(finalEv)
}

func sendSearchError(conn *websocket.Conn, errMsg string) {
	_ = conn.WriteJSON(protocol.SearchStreamEvent{
		Kind:  "searchStream",
		Done:  true,
		Error: errMsg,
	})
}