package api

import (
	"encoding/json"
	"net/http"
)

// WorkspaceStore manages workspace metadata.
type WorkspaceStore interface {
	List() []WorkspaceRecord
	Open(rootPath, name string) (WorkspaceRecord, error)
	Get(id string) (WorkspaceRecord, error)
	Close(id string) error
}

// WorkspaceRecord is the persisted workspace shape.
type WorkspaceRecord struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	RootPath   string `json:"rootPath"`
	CreatedAt  string `json:"createdAt"`
	LastOpened string `json:"lastOpenedAt"`
	UserID     string `json:"userId"`
}

// ProjectStore manages project configs.
type ProjectStore interface {
	List() []json.RawMessage
	Get(id string) (json.RawMessage, error)
	Update(id string, cfg any) (json.RawMessage, error)
}

// ToolchainRegistry imports and lists toolchains.
type ToolchainRegistry interface {
	List() []json.RawMessage
	Import(path, label string) (json.RawMessage, error)
}

// Searcher runs full-text search.
type Searcher interface {
	Search(payload json.RawMessage) (json.RawMessage, error)
}

// Encoder runs encoding detect/recode.
type Encoder interface {
	Detect(payload json.RawMessage) (json.RawMessage, error)
	Recode(payload json.RawMessage) (json.RawMessage, error)
}

// BuildEngine starts a build and reports its result.
type BuildEngine interface {
	Start(payload json.RawMessage) (json.RawMessage, error)
	Get(id string) (json.RawMessage, error)
}

// Deployer publishes a deployment.
type Deployer interface {
	Publish(payload json.RawMessage) (json.RawMessage, error)
	Get(id string) (json.RawMessage, error)
}

// ServerRunner starts/stops a server runtime.
type ServerRunner interface {
	Start(payload json.RawMessage) (json.RawMessage, error)
	Get(id string) (json.RawMessage, error)
	Stop(id string, payload json.RawMessage) (json.RawMessage, error)
	Debug(id string) (json.RawMessage, error)
	Logs(id string, follow bool) (json.RawMessage, error)
}

// Authenticator handles login/logout.
type Authenticator interface {
	Login(payload json.RawMessage, w http.ResponseWriter) (json.RawMessage, error)
	Logout(r *http.Request, w http.ResponseWriter) error
}

// EventBus serves the WebSocket event stream.
type EventBus interface {
	Serve(w http.ResponseWriter, r *http.Request)
}

// JDTLS owns the Eclipse JDT Language Server process and
// surfaces its lifecycle to the API layer.
//
// Start / Stop are synchronous w.r.t. the user-visible state
// transition: Start does not return until the process is up
// and the JDT LS has been told (via the Initialize LSP request)
// to be ready; Stop does not return until the process is gone.
//
// Status returns the current state plus enough metadata to
// render the IDE status bar (state, pid, jre, jar, version).
//
// The HTTP layer does NOT poll; the agent's event bus is the
// canonical source of state-change events. Status is what the
// UI asks for once on connection and after a reconnect.
type JDTLS interface {
	Status() (json.RawMessage, error)
	Start(payload json.RawMessage) (json.RawMessage, error)
	Stop() (json.RawMessage, error)
}
