// Package mockjdtls provides a mock JDT Language Server that
// implements the LSP JSON-RPC 2.0 protocol subset needed for
// testing the Go Runtime Agent without real JDK6/Tomcat6/JDT LS.
//
// Usage:
//
//	srv := mockjdtls.NewMockJDTServer()
//	err := srv.Start()
//	defer srv.Stop()
//	fmt.Println("JDT LS listening on", srv.Addr())
package mockjdtls

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sync"
)

// LSP JSON-RPC 2.0 types

// request is an incoming JSON-RPC request.
type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// response is a JSON-RPC success response.
type response struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Result  any    `json:"result,omitempty"`
}

// errorResponse is a JSON-RPC error response.
type errorResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id"`
	Error   rpcError  `json:"error"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// notification is a JSON-RPC notification (no id).
type notification struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// CompletionItem is an LSP completion item.
type CompletionItem struct {
	Label      string `json:"label"`
	Kind       int    `json:"kind,omitempty"`
	Detail     string `json:"detail,omitempty"`
	InsertText string `json:"insertText,omitempty"`
}

// Diagnostic is an LSP diagnostic.
type Diagnostic struct {
	Message  string `json:"message"`
	Severity int    `json:"severity"`
	Range    Range  `json:"range"`
}

// Range is an LSP range.
type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

// Position is an LSP position.
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

// ServerCapabilities is the LSP initialize result capabilities.
type ServerCapabilities struct {
	TextDocumentSync   int                    `json:"textDocumentSync,omitempty"`
	CompletionProvider *CompletionProvider    `json:"completionProvider,omitempty"`
	DefinitionProvider bool                   `json:"definitionProvider,omitempty"`
	HoverProvider      bool                   `json:"hoverProvider,omitempty"`
	ReferencesProvider bool                   `json:"referencesProvider,omitempty"`
}

// CompletionProvider describes completion capabilities.
type CompletionProvider struct {
	ResolveProvider   bool     `json:"resolveProvider,omitempty"`
	TriggerCharacters []string `json:"triggerCharacters,omitempty"`
}

// InitializeResult is the result of the initialize request.
type InitializeResult struct {
	Capabilities ServerCapabilities `json:"capabilities"`
}

// Location is an LSP location.
type Location struct {
	URI   string `json:"uri"`
	Range Range  `json:"range"`
}

// MockJDTServer is a mock JDT Language Server that implements the
// LSP JSON-RPC 2.0 protocol subset needed for testing.
type MockJDTServer struct {
	listener net.Listener
	addr     string
	wg       sync.WaitGroup
	mu       sync.Mutex
	quit     chan struct{}

	// Configuration for test scenarios
	CompletionItems []CompletionItem
	Diagnostics     []Diagnostic
	HasError        bool

	// initializeCount tracks how many times initialize was called.
	initializeCount int
}

// NewMockJDTServer creates a new MockJDTServer with default test data.
func NewMockJDTServer() *MockJDTServer {
	return &MockJDTServer{
		CompletionItems: []CompletionItem{
			{Label: "println", Kind: 6, Detail: "void println(String x)", InsertText: "println(${1})"},
			{Label: "toString", Kind: 6, Detail: "String toString()", InsertText: "toString()"},
			{Label: "equals", Kind: 6, Detail: "boolean equals(Object obj)", InsertText: "equals(${1})"},
			{Label: "hashCode", Kind: 6, Detail: "int hashCode()", InsertText: "hashCode()"},
			{Label: "getClass", Kind: 6, Detail: "Class<?> getClass()", InsertText: "getClass()"},
		},
	}
}

// Start starts the mock JDT LS server on a random port.
func (s *MockJDTServer) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.listener != nil {
		return fmt.Errorf("mockjdtls: server already started")
	}

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("mockjdtls: listen: %w", err)
	}
	s.listener = l
	s.addr = l.Addr().String()
	s.quit = make(chan struct{})

	s.wg.Add(1)
	go s.acceptLoop()

	return nil
}

// Stop gracefully stops the mock JDT LS server.
func (s *MockJDTServer) Stop() {
	s.mu.Lock()
	if s.quit != nil {
		close(s.quit)
	}
	if s.listener != nil {
		s.listener.Close()
	}
	s.mu.Unlock()
	s.wg.Wait()
}

// Addr returns the address the server is listening on.
func (s *MockJDTServer) Addr() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.addr
}

// InitializeCount returns how many times initialize was called.
func (s *MockJDTServer) InitializeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.initializeCount
}

func (s *MockJDTServer) acceptLoop() {
	defer s.wg.Done()
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.quit:
				return
			default:
			}
			return
		}
		s.wg.Add(1)
		go s.handleConn(conn)
	}
}

func (s *MockJDTServer) handleConn(conn net.Conn) {
	defer s.wg.Done()
	defer conn.Close()

	reader := bufio.NewReader(conn)
	writer := conn

	for {
		select {
		case <-s.quit:
			return
		default:
		}

		// Read the Content-Length header
		header, err := readHeader(reader)
		if err != nil {
			if err == io.EOF {
				return
			}
			return
		}

		if header.ContentLength <= 0 {
			continue
		}

		// Read the body
		body := make([]byte, header.ContentLength)
		_, err = io.ReadFull(reader, body)
		if err != nil {
			return
		}

		resp := s.handleMessage(body)
		if resp == nil {
			continue
		}

		// Write response
		respBytes, err := json.Marshal(resp)
		if err != nil {
			continue
		}
		contentLength := len(respBytes)
		headerStr := fmt.Sprintf("Content-Length: %d\r\n\r\n", contentLength)
		writer.Write([]byte(headerStr))
		writer.Write(respBytes)
	}
}

type lspHeader struct {
	ContentLength int
}

func readHeader(reader *bufio.Reader) (lspHeader, error) {
	var h lspHeader
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return h, err
		}
		if line == "\r\n" || line == "\n" {
			break
		}
		// Parse Content-Length: N
		if len(line) > 16 && line[:15] == "Content-Length:" {
			val := line[15:]
			// Trim trailing \r\n
			for len(val) > 0 && (val[len(val)-1] == '\r' || val[len(val)-1] == '\n') {
				val = val[:len(val)-1]
			}
			// Trim leading space
			for len(val) > 0 && val[0] == ' ' {
				val = val[1:]
			}
			fmt.Sscanf(val, "%d", &h.ContentLength)
		}
	}
	return h, nil
}

func (s *MockJDTServer) handleMessage(body []byte) any {
	// Try to parse as a request first
	var req request
	if err := json.Unmarshal(body, &req); err == nil && req.Method != "" {
		return s.handleRequest(req)
	}

	// Try as notification
	var notif notification
	if err := json.Unmarshal(body, &notif); err == nil && notif.Method != "" {
		s.handleNotification(notif)
		return nil
	}

	return nil
}

func (s *MockJDTServer) handleRequest(req request) any {
	switch req.Method {
	case "initialize":
		s.mu.Lock()
		s.initializeCount++
		s.mu.Unlock()
		return response{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: InitializeResult{
				Capabilities: ServerCapabilities{
					TextDocumentSync: 1, // Full sync
					CompletionProvider: &CompletionProvider{
						ResolveProvider:   true,
						TriggerCharacters: []string{".", "@", "#"},
					},
					DefinitionProvider: true,
					HoverProvider:      true,
					ReferencesProvider: true,
				},
			},
		}

	case "textDocument/completion":
		s.mu.Lock()
		items := s.CompletionItems
		s.mu.Unlock()
		return response{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  items,
		}

	case "textDocument/definition":
		return response{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: []Location{
				{
					URI: "file:///src/main/java/com/example/HelloServlet.java",
					Range: Range{
						Start: Position{Line: 5, Character: 0},
						End:   Position{Line: 5, Character: 10},
					},
				},
			},
		}

	case "textDocument/diagnostics":
		s.mu.Lock()
		diags := s.Diagnostics
		hasErr := s.HasError
		s.mu.Unlock()
		if hasErr {
			return errorResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error: rpcError{
					Code:    -32603,
					Message: "Internal error",
				},
			}
		}
		return response{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  diags,
		}

	case "shutdown":
		return response{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  nil,
		}

	case "textDocument/hover":
		return response{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"contents": []map[string]string{
					{"language": "java", "value": "String toString()"},
				},
			},
		}

	default:
		return errorResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error: rpcError{
				Code:    -32601,
				Message: fmt.Sprintf("Method not found: %s", req.Method),
			},
		}
	}
}

func (s *MockJDTServer) handleNotification(notif notification) {
	switch notif.Method {
	case "initialized":
		// No response needed for initialized notification
	case "textDocument/didOpen":
		// No response needed
	case "textDocument/didChange":
		// No response needed
	case "textDocument/didClose":
		// No response needed
	case "exit":
		// No response needed
	}
}

// SetCompletionItems configures the completion items returned by the mock.
func (s *MockJDTServer) SetCompletionItems(items []CompletionItem) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.CompletionItems = items
}

// SetDiagnostics configures the diagnostics returned by the mock.
func (s *MockJDTServer) SetDiagnostics(diags []Diagnostic) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Diagnostics = diags
}

// SetHasError configures whether the mock returns errors.
func (s *MockJDTServer) SetHasError(hasError bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.HasError = hasError
}