package domain

import (
	"context"
	"time"
)

type WorkspaceID string
type ProjectID string
type BuildID string
type ServerID string
type BuildToolID string
type DeployAction string
type DeployMode string
type BuildEventType string
type Stream int

type DeploymentOwnerToken struct {
	nonce uint64
}

func NewDeploymentOwnerToken() DeploymentOwnerToken {
	return DeploymentOwnerToken{nonce: nextOwnerNonce()}
}

func (t DeploymentOwnerToken) Valid() bool {
	return t.nonce != 0
}

var ownerNonceCounter uint64

func nextOwnerNonce() uint64 {
	ownerNonceCounter++
	return ownerNonceCounter
}

type DeploymentTarget struct {
	WorkspaceID WorkspaceID
	ProjectID   ProjectID
	ServerID    ServerID
	Root        string
	OwnerToken  DeploymentOwnerToken
}

type DeploymentTargetResolver interface {
	ResolveDeploymentTarget(ctx context.Context, ws WorkspaceID, project ProjectID, server ServerID) (DeploymentTarget, error)
}

const (
	BuildToolAnt   BuildToolID = "ant"
	BuildToolJavac BuildToolID = "javac"
)

const (
	DeployActionAdd    DeployAction = "add"
	DeployActionModify DeployAction = "modify"
	DeployActionDelete DeployAction = "delete"
)

const (
	DeployModeMerge  DeployMode = "merge"
	DeployModeMirror DeployMode = "mirror"
)

const (
	BuildStateQueued    BuildState = "queued"
	BuildStateRunning   BuildState = "running"
	BuildStateSucceeded BuildState = "succeeded"
	BuildStateFailed    BuildState = "failed"
	BuildStateCancelled BuildState = "cancelled"
)

const (
	BuildEventQueued            BuildEventType = "queued"
	BuildEventStarted           BuildEventType = "started"
	BuildEventProgress          BuildEventType = "progress"
	BuildEventSucceeded         BuildEventType = "succeeded"
	BuildEventFailed            BuildEventType = "failed"
	BuildEventCancelled         BuildEventType = "cancelled"
	BuildEventPersistenceFailed BuildEventType = "persistence-failed"
)

const (
	StreamStdout Stream = iota
	StreamStderr
)

type WorkspaceRepository interface {
	Get(ctx context.Context, id WorkspaceID) (*Workspace, error)
	List(ctx context.Context) ([]Workspace, error)
	Save(ctx context.Context, ws Workspace) error
	Touch(ctx context.Context, id WorkspaceID) error
	Delete(ctx context.Context, id WorkspaceID) error
}

type ProjectRepository interface {
	Get(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID) (*Project, error)
	List(ctx context.Context, workspaceID WorkspaceID) ([]Project, error)
	Save(ctx context.Context, project Project) error
	Delete(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID) error
	FindByRoot(ctx context.Context, workspaceID WorkspaceID, root string) (*Project, error)
}

type ToolchainRepository interface {
	Get(ctx context.Context, id string) (*Toolchain, error)
	List(ctx context.Context) ([]Toolchain, error)
	Save(ctx context.Context, tc Toolchain) error
	FindByJavaHome(ctx context.Context, javaHome string) (*Toolchain, error)
}

type BuildHistoryRepository interface {
	Save(ctx context.Context, run BuildRun) error
	Get(ctx context.Context, workspaceID WorkspaceID, buildID BuildID) (*BuildRun, error)
	List(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, limit int) ([]BuildRun, error)
}

type ServerHistoryRepository interface {
	Save(ctx context.Context, instance ServerInstance) error
	Get(ctx context.Context, workspaceID WorkspaceID, serverID ServerID) (*ServerInstance, error)
	List(ctx context.Context, workspaceID WorkspaceID) ([]ServerInstance, error)
	Delete(ctx context.Context, workspaceID WorkspaceID, serverID ServerID) error
}

type Workspace struct {
	ID         WorkspaceID `json:"id"`
	Name       string      `json:"name"`
	Root       string      `json:"root"`
	LastOpened time.Time   `json:"lastOpened"`
	CreatedAt  time.Time   `json:"createdAt"`
}

type Project struct {
	ID            ProjectID   `json:"id"`
	WorkspaceID   WorkspaceID `json:"workspaceId"`
	Name          string      `json:"name"`
	Root          string      `json:"root"`
	SourceRoots   []string    `json:"sourceRoots"`
	ResourceRoots []string    `json:"resourceRoots"`
	LibraryDirs   []string    `json:"libraryDirs"`
	WebappDir     string      `json:"webappDir"`
	OutputDir     string      `json:"outputDir"`
	BuildFile     string      `json:"buildFile"`
	BuildTargets  []string    `json:"buildTargets"`
	SourceLevel   string      `json:"sourceLevel"`
	TargetLevel   string      `json:"targetLevel"`
	Encoding      string      `json:"encoding"`
	BuildTool     BuildToolID `json:"buildTool"`
	ContextPath   string      `json:"contextPath"`
	ToolchainID   string      `json:"toolchainId,omitempty"`
	RuntimeID     string      `json:"runtimeId,omitempty"`
	CreatedAt     time.Time   `json:"createdAt"`
	UpdatedAt     time.Time   `json:"updatedAt"`
}

type ResolvedProject struct {
	Project       Project
	Root          string
	SourceRoots   []string
	ResourceRoots []string
	LibraryDirs   []string
	WebappDir     string
	OutputDir     string
	BuildFile     string
	Classpath     []string
}

type Toolchain struct {
	ID          string    `json:"id"`
	JavaHome    string    `json:"javaHome"`
	Version     string    `json:"version"`
	Fingerprint string    `json:"fingerprint"`
	VerifiedAt  time.Time `json:"verifiedAt"`
}

type BuildPlan struct {
	WorkspaceID   WorkspaceID `json:"workspaceId"`
	ProjectID     ProjectID   `json:"projectId"`
	ProjectRoot   string      `json:"projectRoot"`
	BuildTool     BuildToolID `json:"buildTool"`
	BuildFile     string      `json:"buildFile"`
	Targets       []string    `json:"targets"`
	SourceRoots   []string    `json:"sourceRoots"`
	OutputDir     string      `json:"outputDir"`
	Classpath     []string    `json:"classpath"`
	JavaHome      string      `json:"javaHome"`
	SourceLevel   string      `json:"sourceLevel"`
	TargetLevel   string      `json:"targetLevel"`
	Encoding      string      `json:"encoding"`
	Clean         bool        `json:"clean"`
	SelectedFiles []string    `json:"selectedFiles,omitempty"`
}

type RuntimePlan struct {
	ServerID     ServerID `json:"serverId"`
	JavaHome     string   `json:"javaHome"`
	CatalinaHome string   `json:"catalinaHome"`
	CatalinaBase string   `json:"catalinaBase"`
	HTTPPort     int      `json:"httpPort"`
	ShutdownPort int      `json:"shutdownPort"`
	ContextPath  string   `json:"contextPath"`
	WebappDir    string   `json:"webappDir"`
	JVMOptions   []string `json:"jvmOptions"`
}

type DeployPlan struct {
	WorkspaceID    WorkspaceID          `json:"workspaceId"`
	ProjectID      ProjectID            `json:"projectId"`
	BuildID        BuildID              `json:"buildId"`
	DeploymentRoot string               `json:"deploymentRoot"`
	OwnerToken     DeploymentOwnerToken `json:"-"`
	Entries        []DeployEntry        `json:"entries"`
	Mode           DeployMode           `json:"mode"`
}

type DeployEntry struct {
	Source string       `json:"source"`
	Target string       `json:"target"`
	Action DeployAction `json:"action"`
	Size   int64        `json:"size"`
	Mode   int          `json:"mode"`
}

type BuildIntent string

const (
	BuildIntentFull          BuildIntent = "full"
	BuildIntentSelectedFiles BuildIntent = "selected-files"
)

type BuildState string

type BuildRun struct {
	ID          BuildID           `json:"id"`
	WorkspaceID WorkspaceID       `json:"workspaceId"`
	ProjectID   ProjectID         `json:"projectId"`
	State       BuildState        `json:"state"`
	QueuedAt    time.Time         `json:"queuedAt"`
	StartedAt   *time.Time        `json:"startedAt,omitempty"`
	FinishedAt  *time.Time        `json:"finishedAt,omitempty"`
	ExitCode    *int              `json:"exitCode,omitempty"`
	LogPath     string            `json:"logPath,omitempty"`
	Summary     string            `json:"summary,omitempty"`
	Diagnostics []BuildDiagnostic `json:"diagnostics,omitempty"`
}

type BuildDiagnostic struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

type ServerState string

const (
	ServerStateStopped  ServerState = "stopped"
	ServerStateStarting ServerState = "starting"
	ServerStateRunning  ServerState = "running"
	ServerStateStopping ServerState = "stopping"
	ServerStateCrashed  ServerState = "crashed"
	ServerStateError    ServerState = "error"
)

type ServerInstance struct {
	ID          ServerID     `json:"id"`
	WorkspaceID WorkspaceID  `json:"workspaceId"`
	ProjectID   ProjectID    `json:"projectId"`
	State       ServerState  `json:"state"`
	HTTPPort    int          `json:"httpPort"`
	PID         int          `json:"pid"`
	StartTime   time.Time    `json:"startTime"`
	URL         string       `json:"url,omitempty"`
	LastPlan    *RuntimePlan `json:"lastPlan,omitempty"`
	Error       string       `json:"error,omitempty"`
}

type BuildOutput struct {
	ExitCode    int               `json:"exitCode"`
	StartTime   time.Time         `json:"startTime"`
	EndTime     time.Time         `json:"endTime"`
	Diagnostics []BuildDiagnostic `json:"diagnostics,omitempty"`
}

type BuildEvent struct {
	WorkspaceID WorkspaceID    `json:"workspaceId"`
	ProjectID   ProjectID      `json:"projectId"`
	BuildID     BuildID        `json:"buildId"`
	Type        BuildEventType `json:"type"`
	State       BuildState     `json:"state"`
	Message     string         `json:"message"`
	Time        time.Time      `json:"time"`
}

type BuildEventPublisher interface {
	PublishBuildEvent(ctx context.Context, event BuildEvent) error
}

type BuildProvider interface {
	ID() BuildToolID
	Validate(ctx context.Context, plan BuildPlan) error
	Build(ctx context.Context, plan BuildPlan, sink func(event BuildEvent), logLine func(stream Stream, line string)) (*BuildOutput, error)
}

type BuildProviderRegistry interface {
	Get(id BuildToolID) (BuildProvider, bool)
}

type RuntimeProvider interface {
	ID() string
	Prepare(ctx context.Context, project Project) (*RuntimePlan, error)
	Start(ctx context.Context, plan RuntimePlan) (*ServerInstance, error)
	Stop(ctx context.Context, id ServerID, force bool) error
	Inspect(ctx context.Context, id ServerID) (*ServerInstance, error)
}

type PlanResolver interface {
	ResolveProject(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID) (*ResolvedProject, error)
	ResolveBuild(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, intent BuildIntent, clean bool, selectedFiles []string) (*BuildPlan, error)
	ResolveDeploy(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, buildID BuildID, target DeploymentTarget) (*DeployPlan, error)
	ResolveRuntime(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID) (*RuntimePlan, error)
}

func (s BuildState) CanTransitionTo(target BuildState) bool {
	switch s {
	case BuildStateQueued:
		return target == BuildStateRunning || target == BuildStateCancelled
	case BuildStateRunning:
		return target == BuildStateSucceeded || target == BuildStateFailed || target == BuildStateCancelled
	default:
		return false
	}
}

func (b *BuildRun) IsTerminal() bool {
	return b.State == BuildStateSucceeded || b.State == BuildStateFailed || b.State == BuildStateCancelled
}

func (b BuildRun) DeepCopy() BuildRun {
	cp := b
	if b.StartedAt != nil {
		t := *b.StartedAt
		cp.StartedAt = &t
	}
	if b.FinishedAt != nil {
		t := *b.FinishedAt
		cp.FinishedAt = &t
	}
	if b.ExitCode != nil {
		code := *b.ExitCode
		cp.ExitCode = &code
	}
	if b.Diagnostics != nil {
		cp.Diagnostics = make([]BuildDiagnostic, len(b.Diagnostics))
		copy(cp.Diagnostics, b.Diagnostics)
	}
	return cp
}

func UTCNow() time.Time {
	return time.Now().UTC()
}
