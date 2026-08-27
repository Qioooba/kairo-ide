package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/encoding"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/search"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
	"github.com/gorilla/websocket"
)

// searchWSUpgrader is a WebSocket upgrader for streaming search.
// Origin policy matches the events upgrader (exact loopback hostname / file://;
// empty Origin only from loopback RemoteAddr).
var searchWSUpgrader = websocket.Upgrader{
	CheckOrigin:     security.IsSafeWebSocketOrigin,
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// handleSearchStream upgrades the request to a WebSocket and performs
// streaming search. Auth matches /api/v1/events: when the agent has a
// secret, the browser must offer Sec-WebSocket-Protocol:
//
//	["kairo-secret-v1", "<secret>"]
//
// and the server echoes the secret as the selected subprotocol so the
// handshake completes. Without that echo, Chromium rejects the upgrade
// (observed in desktop as "WebSocket connection error").
func (s *Server) handleSearchStream(w http.ResponseWriter, r *http.Request) {
	responseHeader := http.Header{}
	if s.secret != "" {
		offered := parseSubprotocols(r.Header.Get("Sec-WebSocket-Protocol"))
		var presented string
		for i, p := range offered {
			if p == WebSocketSubprotocol {
				if i+1 < len(offered) {
					presented = offered[i+1]
				}
				break
			}
			if eq := strings.SplitN(p, "=", 2); len(eq) == 2 && eq[0] == WebSocketSubprotocol {
				presented = eq[1]
				break
			}
		}
		if presented == "" || subtle.ConstantTimeCompare([]byte(presented), []byte(s.secret)) != 1 {
			writeError(w, "", "", protocol.KairoError{
				Code:    protocol.ErrUnauthenticated,
				Message: "missing or invalid WebSocket subprotocol",
			})
			return
		}
		responseHeader.Set("Sec-WebSocket-Protocol", presented)
	}

	conn, err := searchWSUpgrader.Upgrade(w, r, responseHeader)
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
		WorkspaceID     string   `json:"workspaceId"`
		RootPath        string   `json:"rootPath"`
		Query           string   `json:"query"`
		IsRegex         bool     `json:"isRegex"`
		CaseSensitive   bool     `json:"caseSensitive"`
		WholeWord       bool     `json:"wholeWord"`
		Include         []string `json:"include"`
		Exclude         []string `json:"exclude"`
		ContextLines    int      `json:"contextLines"`
		MaxResults      int      `json:"maxResults"`
		PreviewReplace  string   `json:"previewReplace"`
		ProjectEncoding string   `json:"projectEncoding"`
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

	if s.Services != nil && s.Services.Sandbox != nil {
		authorized, authErr := s.Services.Sandbox.AuthorizeReadAbs(root)
		if authErr != nil {
			sendSearchError(conn, authErr.Error())
			return
		}
		root = authorized
	}

	// Clear the initial request read deadline; keepalive below manages
	// deadlines from here on.
	_ = conn.SetReadDeadline(time.Time{})

	// r.Context() is NOT cancelled when a hijacked (WebSocket) connection
	// closes — the http.Server keeps it alive until ServeHTTP returns. To
	// make client disconnects actually abort the filesystem scan we derive
	// our own context and cancel it from close frames, pong timeouts, and
	// ping write failures.
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	const pongWait = 30 * time.Second
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	conn.SetCloseHandler(func(code int, text string) error {
		cancel()
		_ = conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(code, ""),
			time.Now().Add(5*time.Second),
		)
		return nil
	})

	// Pump reads so control frames are processed: gorilla only observes
	// close/pong frames during Read calls.
	go func() {
		defer cancel()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
			_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		}
	}()

	// Ping ticker: browsers answer pongs while alive; a dead or crashed
	// peer stops answering and the read deadline / WriteControl error
	// triggers cancellation.
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	taskID := "search_" + randomID(12)

	projectEncoding := encoding.ID(req.ProjectEncoding)
	if projectEncoding == "" {
		projectEncoding = encoding.UTF8
	}

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
		ProjectEncoding: projectEncoding,
		Cancel:          ctx,
	}

	err = search.SearchStreaming(ctx, root, opts, func(batch []search.Match, batchIndex int, total int) error {
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