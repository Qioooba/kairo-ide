package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/build"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

var (
	ErrBuildNotFound      = errors.New("build not found")
	ErrBuildCancelTimeout = errors.New("build cancellation timed out")
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

// RunConfigurationStore persists project-level Tomcat Run/Debug configurations.
// Callers identify an already-authorized workspace; no filesystem path crosses
// the HTTP boundary.
type RunConfigurationStore interface {
	Load(ctx context.Context, workspaceID string) (domain.RunConfigurationDocument, error)
	Replace(ctx context.Context, workspaceID string, document domain.RunConfigurationDocument) (domain.RunConfigurationDocument, error)
	Get(ctx context.Context, workspaceID, configurationID string) (domain.TomcatRunConfiguration, error)
	Create(ctx context.Context, workspaceID string, configuration domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error)
	Update(ctx context.Context, workspaceID, configurationID string, configuration domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error)
	Delete(ctx context.Context, workspaceID, configurationID string) (domain.RunConfigurationDocument, error)
}

// ToolchainRegistry imports and lists toolchains.
type ToolchainRegistry interface {
	List() []json.RawMessage
	Import(path, label string) (json.RawMessage, error)
}

// Searcher runs full-text search.
type Searcher interface {
	Search(ctx context.Context, payload json.RawMessage) (json.RawMessage, error)
}

// Encoder runs encoding detect/recode/validate.
type Encoder interface {
	Detect(payload json.RawMessage) (json.RawMessage, error)
	Recode(payload json.RawMessage) (json.RawMessage, error)
	Validate(payload json.RawMessage) (json.RawMessage, error)
}

// BuildRequest is the typed request to start a build.
type BuildRequest struct {
	ProjectID     string   `json:"projectId"`
	Clean         bool     `json:"clean"`
	Intent        string   `json:"intent,omitempty"`
	SelectedFiles []string `json:"selectedFiles,omitempty"`

	// The remaining fields form the trusted execution plan. The HTTP
	// decoder must never accept them from a caller; handleBuilds derives
	// them from the registered project and validates every path first.
	Files       []string `json:"-"`
	Toolchain   string   `json:"-"`
	SourceLevel string   `json:"-"`
	TargetLevel string   `json:"-"`
	ProjectRoot string   `json:"-"`
	OutputDir   string   `json:"-"`
	Classpath   []string `json:"-"`
	Encoding    string   `json:"-"`
	TraceID     string   `json:"-"`
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
	TraceID       string             `json:"traceId,omitempty"`
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
	Intent    string `json:"intent"`
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
	Cancel(ctx context.Context, id string) (*BuildResult, error)
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
	Debug        bool     `json:"debug,omitempty"`
	JavaHome     string   `json:"javaHome"`
	WebappDir    string   `json:"webappDir"`
	ContextPath  string   `json:"contextPath"`
	HTTPPort     int      `json:"httpPort"`
	ShutdownPort int      `json:"shutdownPort"`
	AJPPort      int      `json:"ajpPort"`
	DebugPort    int      `json:"debugPort"`
	DebugSuspend bool     `json:"debugSuspend"`
	JVMOptions   []string `json:"jvmOptions"`
	// Env is trusted launch-plan data. HTTP callers cannot submit resolved
	// environment values; run-configuration launch resolves references server-side.
	Env []string `json:"-"`
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
	Line    string `json:"line"`
	TS      string `json:"ts"`
	Stream  string `json:"stream,omitempty"`
	Source  string `json:"source,omitempty"`
	Ordinal int64  `json:"ordinal"`
}

// ServerRunner starts/stops a server runtime.
type ServerRunner interface {
	// CatalinaHome returns the Tomcat 6 home the runner deploys
	// into ("" when no Tomcat is available).
	CatalinaHome() string
	Start(req StartServerRequest) (*ServerResponse, error)
	Get(id string) (*ServerResponse, error)
	Stop(id string, force bool) (*ServerResponse, error)
	// Restart stops the server (graceful, with force fallback)
	// and starts it again with the stored parameters.
	Restart(id string) (*ServerResponse, error)
	Debug(id string) (*ServerResponse, error)
	// Logs returns the last tail lines of the server's stdout
	// log (tail <= 0 means a sensible default). A missing log
	// file yields an empty slice, not an error.
	Logs(id string, tail int) ([]ServerLogEntry, error)
	List() []*ServerResponse
	// Recoverable returns the list of servers that were
	// running when the agent last exited and can be
	// re-launched. This is populated at startup by the
	// recovery check.
	Recoverable() []*ServerResponse
	// Recover attempts to re-launch a crashed server by its
	// ID. The server must be in "crashed" state.
	Recover(id string) (*ServerResponse, error)
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
	GetLaunchDescriptor(ctx context.Context, workspaceID string, projectID string, workingDir string) (json.RawMessage, error)
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

// LaunchOrchestrator orchestrates before-launch tasks and starts the server.
type LaunchOrchestrator interface {
	Execute(ctx context.Context, config LaunchOrchestratorConfig) (*ServerResponse, error)
}

// LaunchOrchestratorConfig is the configuration for launch orchestration.
type LaunchOrchestratorConfig struct {
	Configuration domain.TomcatRunConfiguration
	WorkspaceRoot string
	ProjectRoot   string
	ArtifactPath  string
	JavaHome      string
	Env           []string
}
