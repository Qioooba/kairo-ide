package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/kairo-ide/runtime-agent/internal/domain"
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

// Encoder runs encoding detect/recode/validate.
type Encoder interface {
	Detect(payload json.RawMessage) (json.RawMessage, error)
	Recode(payload json.RawMessage) (json.RawMessage, error)
	Validate(payload json.RawMessage) (json.RawMessage, error)
}

// BuildEngine starts a build and reports its result.
type BuildEngine interface {
	Start(payload json.RawMessage) (json.RawMessage, error)
	Get(id string) (json.RawMessage, error)
	List() json.RawMessage
}

// Deployer publishes a deployment.
type Deployer interface {
	Publish(payload json.RawMessage) (json.RawMessage, error)
	Get(id string) (json.RawMessage, error)
	List() json.RawMessage
}

// ServerRunner starts/stops a server runtime.
type ServerRunner interface {
	Start(payload json.RawMessage) (json.RawMessage, error)
	Get(id string) (json.RawMessage, error)
	Stop(id string, payload json.RawMessage) (json.RawMessage, error)
	Debug(id string) (json.RawMessage, error)
	Logs(id string, follow bool) (json.RawMessage, error)
	List() json.RawMessage
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

// JDTLS owns the Eclipse JDT Language Server distribution and
// exposes launch descriptors to the API layer.
//
// As of Phase 4, the Theia backend owns the JDT LS process
// lifecycle and LSP communication. The Go Agent provides the
// launch descriptor that tells Theia how to start JDT LS, and
// manages the distribution (download, install, verify).
//
// Status returns the current distribution state (downloaded,
// version, JRE, etc.).
//
// GetLaunchDescriptor returns the JVM command-line arguments
// the Theia backend needs to spawn the JDT LS process for a
// given project.
type JDTLS interface {
	Status() (json.RawMessage, error)
	Prepare(ctx context.Context) (json.RawMessage, error)
	GetLaunchDescriptor(ctx context.Context, workspaceID string, projectID string) (json.RawMessage, error)
}

// JDTProjectGenerator writes the JDT LS-readable project
// model (invisible project + .classpath/.project +
// referenced libraries) for a legacy project so the JDT LS
// can produce accurate completion, hover, and outline.
type JDTProjectGenerator interface {
	Generate(payload json.RawMessage) (json.RawMessage, error)
	Status(workspaceID string) (json.RawMessage, error)
}

// ProjectRepo resolves a project by workspace and project ID.
// Used by the JDT LS launch descriptor handler to resolve the
// project model before building the descriptor.
type ProjectRepo interface {
	Get(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*domain.Project, error)
}

// ToolchainRepo resolves a toolchain by its ID.
// Used by the JDT LS launch descriptor handler to resolve the
// Java toolchain before building the descriptor.
type ToolchainRepo interface {
	Get(ctx context.Context, id string) (*domain.Toolchain, error)
}
