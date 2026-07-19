package domain

import (
	"context"
	"time"
)

type WorkspaceID string
type ProjectID string
type BuildID string
type ServerID string
type RuntimeID string
type BuildToolID string
type DeployAction string
type DeployMode string
type BuildEventType string
type ServerEventType string
type LogStream int
type DesiredServerState string
type ServerState string

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
	LogStreamStdout LogStream = iota
	LogStreamStderr
)

const (
	ServerStateStopped    ServerState = "stopped"
	ServerStatePreparing  ServerState = "preparing"
	ServerStateStarting   ServerState = "starting"
	ServerStateRunning    ServerState = "running"
	ServerStateStopping   ServerState = "stopping"
	ServerStateRestarting ServerState = "restarting"
	ServerStateFailed     ServerState = "failed"
	ServerStateCrashed    ServerState = "crashed"
)

const (
	DesiredServerStateRunning DesiredServerState = "running"
	DesiredServerStateStopped DesiredServerState = "stopped"
)

const (
	ServerEventStateChanged ServerEventType = "state-changed"
	ServerEventStarted      ServerEventType = "started"
	ServerEventStopped      ServerEventType = "stopped"
	ServerEventFailed       ServerEventType = "failed"
	ServerEventCrashed      ServerEventType = "crashed"
	ServerEventRestarting   ServerEventType = "restarting"
	ServerEventLog          ServerEventType = "log"
	ServerEventReconciled   ServerEventType = "reconciled"
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
	Save(ctx context.Context, record ServerRecord) error
	Get(ctx context.Context, workspaceID WorkspaceID, serverID ServerID) (*ServerRecord, error)
	List(ctx context.Context, workspaceID WorkspaceID) ([]ServerRecord, error)
	ListNonTerminal(ctx context.Context) ([]*ServerRecord, error)
	Delete(ctx context.Context, workspaceID WorkspaceID, serverID ServerID) error
}

type RuntimeProviderRegistry interface {
	Get(id string) (RuntimeProvider, bool)
}

type ServerEventPublisher interface {
	PublishServerEvent(ctx context.Context, event ServerEvent) error
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
	WorkspaceID    WorkspaceID `json:"workspaceId"`
	ProjectID      ProjectID   `json:"projectId"`
	ServerID       ServerID    `json:"serverId"`
	RuntimeID      string      `json:"runtimeId"`
	JavaHome       string      `json:"javaHome,omitempty"`
	CatalinaHome   string      `json:"catalinaHome,omitempty"`
	CatalinaBase   string      `json:"catalinaBase"`
	WebappDir      string      `json:"webappDir"`
	DeploymentRoot string      `json:"deploymentRoot"`
	ContextPath    string      `json:"contextPath"`
	HTTPPort       int         `json:"httpPort"`
	ShutdownPort   int         `json:"shutdownPort"`
	DebugPort      int         `json:"debugPort,omitempty"`
	JVMOptions     []string    `json:"jvmOptions,omitempty"`
	Env            []string    `json:"env,omitempty"`
	Generation     uint64      `json:"generation"`
}

func (p RuntimePlan) DeepCopy() RuntimePlan {
	cp := p
	if p.JVMOptions != nil {
		cp.JVMOptions = make([]string, len(p.JVMOptions))
		copy(cp.JVMOptions, p.JVMOptions)
	}
	if p.Env != nil {
		cp.Env = make([]string, len(p.Env))
		copy(cp.Env, p.Env)
	}
	return cp
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

type ProcessIdentity struct {
	PID          int       `json:"pid"`
	Executable   string    `json:"executable"`
	StartTime    time.Time `json:"startTime"`
	CatalinaBase string    `json:"catalinaBase"`
	MarkerToken  string    `json:"markerToken"`
}

func (pi ProcessIdentity) Equal(other ProcessIdentity) bool {
	return pi.PID == other.PID &&
		pi.Executable == other.Executable &&
		pi.CatalinaBase == other.CatalinaBase &&
		pi.MarkerToken == other.MarkerToken &&
		pi.StartTime.Equal(other.StartTime)
}

type ServerRecord struct {
	ID              ServerID           `json:"id"`
	WorkspaceID     WorkspaceID        `json:"workspaceId"`
	ProjectID       ProjectID          `json:"projectId"`
	DesiredState    DesiredServerState `json:"desiredState"`
	ObservedState   ServerState        `json:"observedState"`
	Generation      uint64             `json:"generation"`
	PID             int                `json:"pid,omitempty"`
	ProcessIdentity *ProcessIdentity   `json:"processIdentity,omitempty"`
	RuntimePlan     RuntimePlan        `json:"runtimePlan"`
	LastError       string             `json:"lastError,omitempty"`
	StartedAt       *time.Time         `json:"startedAt,omitempty"`
	StoppedAt       *time.Time         `json:"stoppedAt,omitempty"`
	UpdatedAt       time.Time          `json:"updatedAt"`
}

func (r ServerRecord) DeepCopy() ServerRecord {
	cp := r
	cp.RuntimePlan = r.RuntimePlan.DeepCopy()
	if r.ProcessIdentity != nil {
		pi := *r.ProcessIdentity
		cp.ProcessIdentity = &pi
	}
	if r.StartedAt != nil {
		t := *r.StartedAt
		cp.StartedAt = &t
	}
	if r.StoppedAt != nil {
		t := *r.StoppedAt
		cp.StoppedAt = &t
	}
	return cp
}

type StartServerCommand struct {
	WorkspaceID WorkspaceID `json:"workspaceId"`
	ProjectID   ProjectID   `json:"projectId"`
	ServerID    *ServerID   `json:"serverId,omitempty"`
}

type StopServerCommand struct {
	WorkspaceID WorkspaceID `json:"workspaceId"`
	ProjectID   ProjectID   `json:"projectId"`
	ServerID    ServerID    `json:"serverId"`
	Force       bool        `json:"force"`
}

type RestartServerCommand struct {
	WorkspaceID WorkspaceID `json:"workspaceId"`
	ProjectID   ProjectID   `json:"projectId"`
	ServerID    ServerID    `json:"serverId"`
}

type GetServerQuery struct {
	WorkspaceID WorkspaceID `json:"workspaceId"`
	ServerID    ServerID    `json:"serverId"`
}

type ListServersQuery struct {
	WorkspaceID WorkspaceID `json:"workspaceId"`
}

type ServerEvent struct {
	WorkspaceID   WorkspaceID     `json:"workspaceId"`
	ProjectID     ProjectID       `json:"projectId"`
	ServerID      ServerID        `json:"serverId"`
	Generation    uint64          `json:"generation"`
	Type          ServerEventType `json:"type"`
	OldState      *ServerState    `json:"oldState,omitempty"`
	NewState      *ServerState    `json:"newState,omitempty"`
	Message       string          `json:"message,omitempty"`
	Time          time.Time       `json:"time"`
	Recoverable   bool            `json:"recoverable"`
	CorrelationID string          `json:"correlationId,omitempty"`
}

type LogLine struct {
	Stream     LogStream `json:"stream"`
	Time       time.Time `json:"time"`
	Text       string    `json:"text"`
	Generation uint64    `json:"generation"`
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
	Build(ctx context.Context, plan BuildPlan, sink func(event BuildEvent), logLine func(stream LogStream, line string)) (*BuildOutput, error)
}

type BuildProviderRegistry interface {
	Get(id BuildToolID) (BuildProvider, bool)
}

type PortLease struct {
	HTTPPort     int
	ShutdownPort int
	DebugPort    int
	release      func()
}

func (l *PortLease) Release() {
	if l.release != nil {
		l.release()
		l.release = nil
	}
}

func NewPortLease(http, shutdown, debug int, release func()) *PortLease {
	return &PortLease{
		HTTPPort:     http,
		ShutdownPort: shutdown,
		DebugPort:    debug,
		release:      release,
	}
}

type ProcessObservation struct {
	PID              int
	Identity         ProcessIdentity
	Running          bool
	ExitCode         *int
	IdentityMismatch bool
}

type ServerInstance struct {
	ID          ServerID    `json:"id"`
	WorkspaceID WorkspaceID `json:"workspaceId"`
	ProjectID   ProjectID   `json:"projectId"`
	State       ServerState `json:"state"`
	HTTPPort    int         `json:"httpPort,omitempty"`
	ShutdownPort int        `json:"shutdownPort,omitempty"`
	PID         int         `json:"pid,omitempty"`
	StartTime   time.Time   `json:"startTime,omitempty"`
	Generation  uint64      `json:"generation"`
}

type RuntimeProvider interface {
	ID() string
	Prepare(ctx context.Context, plan RuntimePlan) error
	Start(ctx context.Context, plan RuntimePlan, logSink func(LogLine)) (*ProcessIdentity, *PortLease, error)
	GracefulStop(ctx context.Context, identity ProcessIdentity) error
	ForceStop(ctx context.Context, identity ProcessIdentity) error
	IsReady(ctx context.Context, plan RuntimePlan, identity ProcessIdentity, deadline time.Time) error
	Inspect(ctx context.Context, identity ProcessIdentity) (ProcessObservation, error)
	CleanupBase(ctx context.Context, plan RuntimePlan) error
}

type PlanResolver interface {
	ResolveProject(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID) (*ResolvedProject, error)
	ResolveBuild(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, intent BuildIntent, clean bool, selectedFiles []string) (*BuildPlan, error)
	ResolveDeploy(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, buildID BuildID, target DeploymentTarget) (*DeployPlan, error)
	ResolveRuntime(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, existingServerID *ServerID) (*RuntimePlan, error)
}

var serverStateTransitions = map[ServerState]map[ServerState]bool{
	ServerStateStopped: {
		ServerStatePreparing: true,
	},
	ServerStatePreparing: {
		ServerStateStarting: true,
		ServerStateFailed:   true,
	},
	ServerStateStarting: {
		ServerStateRunning: true,
		ServerStateFailed:  true,
	},
	ServerStateRunning: {
		ServerStateStopping:   true,
		ServerStateRestarting: true,
		ServerStateCrashed:    true,
		ServerStateFailed:     true,
	},
	ServerStateStopping: {
		ServerStateStopped: true,
		ServerStateFailed:  true,
	},
	ServerStateRestarting: {
		ServerStateStarting: true,
		ServerStateFailed:   true,
	},
	ServerStateFailed: {
		ServerStateStarting: true,
		ServerStateStopped:  true,
	},
	ServerStateCrashed: {
		ServerStateStarting: true,
		ServerStateStopped:  true,
	},
}

func CanTransitionServerState(from, to ServerState) bool {
	if from == to {
		return true
	}
	transitions, ok := serverStateTransitions[from]
	if !ok {
		return false
	}
	return transitions[to]
}

func TransitionServerState(from, to ServerState) error {
	if !CanTransitionServerState(from, to) {
		return ErrInvalidStateTransition
	}
	return nil
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

func (s ServerState) IsTerminal() bool {
	return s == ServerStateStopped || s == ServerStateFailed || s == ServerStateCrashed
}

func (s ServerState) IsTransitioning() bool {
	return s == ServerStatePreparing || s == ServerStateStarting ||
		s == ServerStateStopping || s == ServerStateRestarting
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
