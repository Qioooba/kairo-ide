package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/build"
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
	List() []domain.Project
	Get(id string) (domain.Project, error)
	Update(id string, cfg *domain.Project) (domain.Project, error)
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

// BuildRequest is the typed request to start a build.
type BuildRequest struct {
	ProjectID   string   `json:"projectId"`
	Files       []string `json:"files"`
	Toolchain   string   `json:"toolchainId"`
	SourceLevel string   `json:"sourceLevel"`
	TargetLevel string   `json:"targetLevel"`
	ProjectRoot string   `json:"projectRoot"`
	OutputDir   string   `json:"outputDir"`
	Classpath   []string `json:"classpath"`
	Clean       bool     `json:"clean"`
}

// BuildResult is the typed build result.
type BuildResult struct {
	ID            string             `json:"id"`
	State         string             `json:"state"`
	StartedAt     string             `json:"startedAt"`
	FinishedAt    string             `json:"finishedAt,omitempty"`
	ProjectID     string             `json:"projectId"`
	Toolchain     string             `json:"toolchainId"`
	SourceLevel   string             `json:"sourceLevel"`
	TargetLevel   string             `json:"targetLevel"`
	OutputDir     string             `json:"outputDir"`
	Diagnostics   []build.Diagnostic `json:"diagnostics"`
	FilesCompiled int                `json:"filesCompiled"`
	ElapsedMs     int64              `json:"elapsedMs"`
	Output        string             `json:"output"`
	Error         string             `json:"error,omitempty"`
	ExitCode      int                `json:"exitCode"`
}

// DeployRequest is the typed request to publish a deployment.
type DeployRequest struct {
	ProjectID string `json:"projectId"`
	BuildID   string `json:"buildId"`
	What      string `json:"what"`
	Source    string `json:"source"`
	Target    string `json:"target"`
	Trigger   string `json:"trigger"`
	Mode      string `json:"mode"`
}

// DeployResult is the typed deployment result.
type DeployResult struct {
	ID            string    `json:"id"`
	State         string    `json:"state"`
	StartedAt     time.Time `json:"startedAt"`
	FinishedAt    time.Time `json:"finishedAt"`
	ProjectID     string    `json:"projectId"`
	BuildID       string    `json:"buildId"`
	What          string    `json:"what"`
	Source        string    `json:"source"`
	Target        string    `json:"target"`
	FilesTouched  int       `json:"filesTouched"`
	Bytes         int64     `json:"bytes"`
	FilesAdded    int       `json:"filesAdded"`
	FilesModified int       `json:"filesModified"`
	FilesDeleted  int       `json:"filesDeleted"`
	Trigger       string    `json:"trigger"`
	HotReloadMode string    `json:"hotReloadMode"`
	Error         string    `json:"error,omitempty"`
}

// BuildEngine starts a build and reports its result.
type BuildEngine interface {
	Start(req BuildRequest) (*BuildResult, error)
	Get(id string) (*BuildResult, error)
	List() []*BuildResult
}

// Deployer publishes a deployment.
type Deployer interface {
	Publish(req DeployRequest) (*DeployResult, error)
	Get(id string) (*DeployResult, error)
	List() []*DeployResult
}

// StartServerRequest is the typed request to start a server.
type StartServerRequest struct {
	ProjectID    string   `json:"projectId"`
	JavaHome     string   `json:"javaHome"`
	WebappDir    string   `json:"webappDir"`
	ContextPath  string   `json:"contextPath"`
	HTTPPort     int      `json:"httpPort"`
	ShutdownPort int      `json:"shutdownPort"`
	AJPPort      int      `json:"ajpPort"`
	DebugPort    int      `json:"debugPort"`
	DebugSuspend bool     `json:"debugSuspend"`
	JVMOptions   []string `json:"jvmOptions"`
}

// ServerResponse is the safe API response shape for server info.
type ServerResponse struct {
	ID          string       `json:"id"`
	ProjectID   string       `json:"projectId"`
	Type        string       `json:"type"`
	State       string       `json:"state"`
	PID         int          `json:"pid"`
	Ports       *ServerPorts `json:"ports,omitempty"`
	StartedAt   time.Time    `json:"startedAt"`
	ContextPath string       `json:"contextPath"`
	LastError   string       `json:"lastError,omitempty"`
	URL         string       `json:"url,omitempty"`
}

// ServerPorts exposes only user-facing ports.
type ServerPorts struct {
	HTTP  int `json:"http,omitempty"`
	Debug int `json:"debug,omitempty"`
}

// ServerLogEntry is a single log line with timestamp.
type ServerLogEntry struct {
	Line string `json:"line"`
	TS   string `json:"ts"`
}

// ServerRunner starts/stops a server runtime.
type ServerRunner interface {
	Start(req StartServerRequest) (*ServerResponse, error)
	Get(id string) (*ServerResponse, error)
	Stop(id string, force bool) (*ServerResponse, error)
	Debug(id string) (*ServerResponse, error)
	Logs(id string, follow bool) ([]ServerLogEntry, error)
	List() []*ServerResponse
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
