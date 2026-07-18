package domain

import (
	"context"
	"time"
)

// WorkspaceID is a unique identifier for a workspace.
type WorkspaceID string

// ProjectID is a unique identifier for a project within a workspace.
type ProjectID string

// BuildID is a unique identifier for a build run.
type BuildID string

// ServerID is a unique identifier for a server instance.
type ServerID string

// WorkspacePath is a canonical absolute path within a workspace.
type WorkspacePath string

// WorkspaceRepository is the persistence interface for workspaces.
type WorkspaceRepository interface {
	Get(ctx context.Context, id WorkspaceID) (*Workspace, error)
	List(ctx context.Context) ([]Workspace, error)
	Save(ctx context.Context, ws Workspace) error
	Delete(ctx context.Context, id WorkspaceID) error
}

// ProjectRepository is the persistence interface for projects.
type ProjectRepository interface {
	Get(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID) (*Project, error)
	List(ctx context.Context, workspaceID WorkspaceID) ([]Project, error)
	Save(ctx context.Context, project Project) error
	Delete(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID) error
}

// ToolchainRepository is the persistence interface for toolchains.
type ToolchainRepository interface {
	Get(ctx context.Context, id string) (*Toolchain, error)
	List(ctx context.Context) ([]Toolchain, error)
	Save(ctx context.Context, tc Toolchain) error
	FindByJavaHome(ctx context.Context, javaHome string) (*Toolchain, error)
}

// BuildHistoryRepository is the persistence interface for build runs.
type BuildHistoryRepository interface {
	Save(ctx context.Context, run BuildRun) error
	Get(ctx context.Context, workspaceID WorkspaceID, buildID BuildID) (*BuildRun, error)
	List(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, limit int) ([]BuildRun, error)
}

// ServerHistoryRepository is the persistence interface for server instances.
type ServerHistoryRepository interface {
	Save(ctx context.Context, instance ServerInstance) error
	Get(ctx context.Context, workspaceID WorkspaceID, serverID ServerID) (*ServerInstance, error)
	List(ctx context.Context, workspaceID WorkspaceID) ([]ServerInstance, error)
	Delete(ctx context.Context, workspaceID WorkspaceID, serverID ServerID) error
}

// Workspace represents a local workspace directory.
type Workspace struct {
	ID         WorkspaceID `json:"id"`
	Name       string      `json:"name"`
	Root       string      `json:"root"` // absolute path
	LastOpened time.Time   `json:"lastOpened"`
}

// Project represents a project configuration stored in .kairo/project.yaml.
// Paths in config are relative to the project root directory.
type Project struct {
	ID          ProjectID `json:"id"`
	WorkspaceID WorkspaceID `json:"workspaceId"`
	Name        string    `json:"name"`
	// SourceRoots are relative paths from project root, e.g. ["src/main/java"]
	SourceRoots   []string `json:"sourceRoots"`
	// ResourceRoots are relative paths, e.g. ["src/main/resources"]
	ResourceRoots []string `json:"resourceRoots"`
	// WebappDir is relative path, e.g. "src/main/webapp" or "WebRoot"
	WebappDir     string `json:"webappDir"`
	// OutputDir is relative path, e.g. "target/classes" or "build/classes"
	OutputDir     string `json:"outputDir"`
	SourceLevel   string `json:"sourceLevel"`
	TargetLevel   string `json:"targetLevel"`
	Encoding      string `json:"encoding"`
	BuildTool     string `json:"buildTool"`    // "ant" | "javac"
	ContextPath   string `json:"contextPath"`  // e.g. "/myapp"
	ToolchainID   string `json:"toolchainId,omitempty"`
	RuntimeID     string `json:"runtimeId,omitempty"`
}

// ResolvedProject contains all paths resolved to absolute paths.
// Only created by PlanResolver, never by client code.
type ResolvedProject struct {
	Project Project
	// Root is the canonical absolute path to the project directory.
	Root string
	// AbsoluteSourceRoots are root + each SourceRoot
	AbsoluteSourceRoots []string
	// AbsoluteResourceRoots are root + each ResourceRoot
	AbsoluteResourceRoots []string
	// AbsoluteWebappDir is root + WebappDir
	AbsoluteWebappDir string
	// AbsoluteOutputDir is root + OutputDir
	AbsoluteOutputDir string
}

// Toolchain represents a JDK installation.
type Toolchain struct {
	ID          string    `json:"id"`
	JavaHome    string    `json:"javaHome"`
	Version     string    `json:"version"`
	Fingerprint string    `json:"fingerprint"` // SHA-256 of key binaries
	VerifiedAt  time.Time `json:"verifiedAt"`
}

// BuildPlan is the resolved plan for a build operation.
// All paths are absolute, resolved by PlanResolver.
type BuildPlan struct {
	WorkspaceID WorkspaceID `json:"workspaceId"`
	ProjectID   ProjectID   `json:"projectId"`
	// AbsoluteSourceRoots are absolute paths for source directories.
	AbsoluteSourceRoots []string `json:"sourceRoots"`
	// AbsoluteOutputDir is the absolute path for build output.
	AbsoluteOutputDir string   `json:"outputDir"`
	Classpath         []string `json:"classpath"`
	SourceLevel       string   `json:"sourceLevel"`
	TargetLevel       string   `json:"targetLevel"`
	Encoding          string   `json:"encoding"`
	BuildTool         string   `json:"buildTool"`
	Clean             bool     `json:"clean"`
}

// RuntimePlan is the resolved plan for starting a server.
type RuntimePlan struct {
	ServerID     ServerID `json:"serverId"`
	JavaHome     string   `json:"javaHome"`
	CatalinaHome string   `json:"catalinaHome"`
	CatalinaBase string   `json:"catalinaBase"`
	HTTPPort     int      `json:"httpPort"`
	ShutdownPort int      `json:"shutdownPort"`
	ContextPath  string   `json:"contextPath"`
	// AbsoluteWebappDir is the absolute path to the webapp directory.
	AbsoluteWebappDir string `json:"webappDir"`
	JVMOptions   []string `json:"jvmOptions"`
}

// DeployPlan is the resolved plan for a deploy operation.
type DeployPlan struct {
	WorkspaceID WorkspaceID   `json:"workspaceId"`
	ProjectID   ProjectID     `json:"projectId"`
	BuildID     BuildID       `json:"buildId"`
	Entries     []DeployEntry `json:"entries"`
	Mode        string        `json:"mode"` // "merge" | "mirror"
}

// DeployEntry represents a single file/directory to deploy.
type DeployEntry struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Action string `json:"action"` // "add" | "modify" | "delete"
}

// BuildIntent is the user's intent for a build.
type BuildIntent string

const (
	BuildIntentFull          BuildIntent = "full"
	BuildIntentSelectedFiles BuildIntent = "selected-files"
)

// BuildState represents the state of a build run.
type BuildState string

const (
	BuildStateQueued    BuildState = "queued"
	BuildStatePending   BuildState = "pending"
	BuildStateRunning   BuildState = "running"
	BuildStateSucceeded BuildState = "succeeded"
	BuildStateFailed    BuildState = "failed"
	BuildStateCancelled BuildState = "cancelled"
)

// BuildRun represents a single build execution.
type BuildRun struct {
	ID          BuildID          `json:"id"`
	WorkspaceID WorkspaceID      `json:"workspaceId"`
	ProjectID   ProjectID        `json:"projectId"`
	State       BuildState       `json:"state"`
	StartTime   time.Time        `json:"startTime"`
	EndTime     *time.Time       `json:"endTime,omitempty"`
	Summary     string           `json:"summary,omitempty"`
	Diagnostics []BuildDiagnostic `json:"diagnostics,omitempty"`
}

// BuildDiagnostic is a single compiler diagnostic.
type BuildDiagnostic struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Severity string `json:"severity"` // "error" | "warning" | "info"
	Message  string `json:"message"`
}

// ServerState represents the state of a server instance.
type ServerState string

const (
	ServerStateStopped  ServerState = "stopped"
	ServerStateStarting ServerState = "starting"
	ServerStateRunning  ServerState = "running"
	ServerStateStopping ServerState = "stopping"
	ServerStateCrashed  ServerState = "crashed"
	ServerStateError    ServerState = "error"
)

// ServerInstance represents a running server.
type ServerInstance struct {
	ID          ServerID    `json:"id"`
	WorkspaceID WorkspaceID `json:"workspaceId"`
	ProjectID   ProjectID   `json:"projectId"`
	State       ServerState `json:"state"`
	HTTPPort    int         `json:"httpPort"`
	PID         int         `json:"pid"`
	StartTime   time.Time   `json:"startTime"`
	URL         string      `json:"url,omitempty"`
	LastPlan    *RuntimePlan `json:"lastPlan,omitempty"`
	Error       string      `json:"error,omitempty"`
}

// BuildOutput is the result of a build execution.
type BuildOutput struct {
	ExitCode    int               `json:"exitCode"`
	StartTime   time.Time         `json:"startTime"`
	EndTime     time.Time         `json:"endTime"`
	RawLog      string            `json:"rawLog"`
	Diagnostics []BuildDiagnostic `json:"diagnostics,omitempty"`
}

// BuildEvent represents a build progress event.
type BuildEvent struct {
	BuildID BuildID   `json:"buildId"`
	Type    string    `json:"type"` // "started", "progress", "completed", "failed"
	Message string    `json:"message"`
	Time    time.Time `json:"time"`
}

// BuildEventSink receives build events.
type BuildEventSink func(event BuildEvent)

// BuildProvider is the interface for build tool implementations.
type BuildProvider interface {
	ID() string
	Validate(ctx context.Context, p Project, tc Toolchain) error
	Build(ctx context.Context, plan BuildPlan, sink BuildEventSink) (*BuildOutput, error)
}

// RuntimeProvider is the interface for runtime implementations.
type RuntimeProvider interface {
	ID() string
	Prepare(ctx context.Context, project Project) (*RuntimePlan, error)
	Start(ctx context.Context, plan RuntimePlan) (*ServerInstance, error)
	Stop(ctx context.Context, id ServerID, force bool) error
	Inspect(ctx context.Context, id ServerID) (*ServerInstance, error)
}

// PlanResolver resolves project-relative paths into absolute execution plans.
// Only PlanResolver creates BuildPlan, RuntimePlan, and DeployPlan.
type PlanResolver interface {
	ResolveBuild(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, intent BuildIntent, clean bool) (*BuildPlan, error)
	ResolveDeploy(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, buildID BuildID) (*DeployPlan, error)
	ResolveRuntime(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID) (*RuntimePlan, error)
}