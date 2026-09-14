// Package protocol is the hand-written Go mirror of
// packages/protocol/src/index.ts. It MUST stay in lock-step with
// the TypeScript source. A script to assert structural equivalence
// will be added in Phase 1.
package protocol

import "github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"

// PROTOCOL_VERSION is the wire protocol major version. It lives
// in the URL prefix (`/api/v1`).
const PROTOCOL_VERSION = "v1"

const RUN_CONFIGURATION_VERSION = domain.RunConfigurationVersion

type RunConfigurationDocument = domain.RunConfigurationDocument
type TomcatRunConfiguration = domain.TomcatRunConfiguration
type RunConfigurationBuild = domain.RunConfigurationBuild
type RunConfigurationServer = domain.RunConfigurationServer
type RunConfigurationDeploy = domain.RunConfigurationDeploy

type RunConfigurationLaunchRequest struct {
	Mode string `json:"mode"`
}

// KairoErrorCode is the closed enum of stable, machine-readable
// error codes. Add new codes here AND in the TypeScript mirror.
type KairoErrorCode string

const (
	// 4xx-style
	ErrUnauthenticated      KairoErrorCode = "unauthenticated"
	ErrForbidden            KairoErrorCode = "forbidden"
	ErrNotFound             KairoErrorCode = "not_found"
	ErrConflict             KairoErrorCode = "conflict"
	ErrRateLimited          KairoErrorCode = "rate_limited"
	ErrInvalidRequest       KairoErrorCode = "invalid_request"
	ErrPathForbidden        KairoErrorCode = "path_forbidden"
	ErrToolchainMissing     KairoErrorCode = "toolchain_missing"
	ErrRuntimeMissing       KairoErrorCode = "runtime_missing"
	ErrUnsupportedJDKTarget KairoErrorCode = "unsupported_jdk_target"
	ErrTargetAmbiguous      KairoErrorCode = "target_ambiguous"
	ErrTargetNotFound       KairoErrorCode = "target_not_found"
	ErrStaleTarget          KairoErrorCode = "stale_target"

	// 5xx-style
	ErrInternal           KairoErrorCode = "internal"
	ErrIOError            KairoErrorCode = "io_error"
	ErrProcessSpawnFailed KairoErrorCode = "process_spawn_failed"
	ErrCompileFailed      KairoErrorCode = "compile_failed"
	ErrDeployFailed       KairoErrorCode = "deploy_failed"
	ErrDebugAttachFailed  KairoErrorCode = "debug_attach_failed"
	ErrCancelled          KairoErrorCode = "cancelled"
	ErrTimeout            KairoErrorCode = "timeout"
	ErrPluginCrashed      KairoErrorCode = "plugin_crashed"
	ErrUnsupported        KairoErrorCode = "unsupported"
)

// DebugTargetBinding represents an immutable debug target binding
// contract (PR03 / F03). It disambiguates servers, sessions and instances.
type DebugTargetBinding struct {
	ProjectID              string `json:"projectId"`
	ServerID               string `json:"serverId,omitempty"`
	RunConfigurationID     string `json:"runConfigurationId,omitempty"`
	RuntimeInstanceID      string `json:"runtimeInstanceId,omitempty"`
	DeploymentGeneration   int    `json:"deploymentGeneration,omitempty"`
	DebugSessionID         string `json:"debugSessionId,omitempty"`
	DebugSessionGeneration int    `json:"debugSessionGeneration,omitempty"`
	RequestKind            string `json:"requestKind,omitempty"`
	OwnsDebuggee           bool   `json:"ownsDebuggee,omitempty"`
	ClassLoaderID          string `json:"classLoaderId,omitempty"`
}

// KairoError is the wire format for an error response.
type KairoError struct {
	Code      KairoErrorCode `json:"code"`
	Message   string         `json:"message"`
	Details   any            `json:"details,omitempty"`
	Retryable bool           `json:"retryable,omitempty"`
}

// AgentState represents the state of the Kairo Runtime Agent process (DK-P1-2 / F18).
// Persisted atomically in <dataDir>/agent-state.json for process discovery and handover.
type AgentState struct {
	InstanceID  string `json:"instanceId"`
	Generation  int    `json:"generation"`
	PID         int    `json:"pid"`
	Port        int    `json:"port"`
	BindAddress string `json:"bindAddress"`
	StartedAt   string `json:"startedAt"`
	Status      string `json:"status"` // starting | ready | handing_over | shutting_down | stopped | failed
	Error       string `json:"error,omitempty"`
}

// RequestEnvelope is the universal request envelope. The
// workspaceId is assigned by the agent after auth, never trusted
// from the client. The requestId is client-generated.
type RequestEnvelope struct {
	WorkspaceID   string `json:"workspaceId"`
	ProjectID     string `json:"projectId,omitempty"`
	RequestID     string `json:"requestId"`
	CorrelationID string `json:"correlationId,omitempty"`
}

// ResponseEnvelope is a successful response.
type ResponseEnvelope struct {
	RequestID     string `json:"requestId"`
	CorrelationID string `json:"correlationId,omitempty"`
	OK            bool   `json:"ok"`
	Payload       any    `json:"payload,omitempty"`
}

// ErrorResponse is an error response.
type ErrorResponse struct {
	RequestID     string     `json:"requestId"`
	CorrelationID string     `json:"correlationId,omitempty"`
	OK            bool       `json:"ok"`
	Error         KairoError `json:"error"`
}

// EnvelopeResult is a small helper that the HTTP layer uses to
// serialize either a successful payload or an error.
type EnvelopeResult struct {
	RequestID     string
	CorrelationID string
	Payload       any
	Error         *KairoError
}

// IsError returns true if the result carries an error.
func (r EnvelopeResult) IsError() bool { return r.Error != nil }

// RuntimeEndpoints is the response of GET /api/v1/endpoints.
// The runtime client uses it to discover the dynamic
// host:port chosen by the agent at startup (the frontend
// used to hardcode 18099). The shape is kept stable so the
// same client works whether the agent binds a single port
// for both HTTP and events, or splits them later.
//
// Per docs/hotfix-windows-test-readiness.md 搂2.
type RuntimeEndpoints struct {
	// HTTP is "host:port" for the /api/v1/* REST surface.
	HTTP string `json:"http"`
	// Events is "host:port" for /api/v1/events (WebSocket).
	// Today this is the same as HTTP. Kept separate so
	// future agents can attach the WS endpoint to a Unix
	// socket without breaking the wire.
	Events string `json:"events"`
}

// HealthResponse is the response of GET /api/v1/health.
type HealthResponse struct {
	OK           bool   `json:"ok"`
	Version      string `json:"version"`
	AgentVersion string `json:"agentVersion"`
	UptimeSec    int64  `json:"uptimeSec"`
	Platform     struct {
		OS   string `json:"os"`
		Arch string `json:"arch"`
	} `json:"platform"`
	BindAddress    string `json:"bindAddress"`
	Port           int    `json:"port"`
	ActiveSessions int    `json:"activeSessions"`
}

// Encoding IDs. We keep this open: aliases registered by the user
// are valid EncodingIDs too. These are the well-known ones.
const (
	EncodingUTF8     = "utf-8"
	EncodingUTF8BOM  = "utf-8-bom"
	EncodingUTF16LE  = "utf-16le"
	EncodingUTF16BE  = "utf-16be"
	EncodingGBK      = "gbk"
	EncodingGB18030  = "gb18030"
	EncodingISO88591 = "iso-8859-1"
	EncodingUSASCII  = "us-ascii"
)

// ---------------------------------------------------------------------------
//  Frozen wire contract request/response types (mirrors TS protocol)
// ---------------------------------------------------------------------------

// StartBuildRequest is the POST /api/v1/builds request body.
// The client only sends stable IDs and intent; the agent resolves
// execution paths from the trusted Project/Toolchain repository.
type StartBuildRequest struct {
	ProjectID     string   `json:"projectId"`
	Clean         bool     `json:"clean,omitempty"`
	Intent        string   `json:"intent,omitempty"` // "full" | "selected-files"
	SelectedFiles []string `json:"selectedFiles,omitempty"`
}

// StartDeploymentRequest is the POST /api/v1/deployments request body.
type StartDeploymentRequest struct {
	ProjectID string `json:"projectId"`
	BuildID   string `json:"buildId"`
	Scope     string `json:"scope"` // "all" | "classes" | "webapp" | "resources"
}

// StartServerRequest is the POST /api/v1/servers request body.
type StartServerRequest struct {
	ProjectID string `json:"projectId"`
	Debug     bool   `json:"debug,omitempty"`
}

// BuildResult is the wire format for a build run (mirrors TS BuildResult).
type BuildResult struct {
	ID          string            `json:"id"`
	State       string            `json:"state"` // queued | running | success | failure | cancelled
	StartedAt   string            `json:"startedAt"`
	FinishedAt  string            `json:"finishedAt,omitempty"`
	Diagnostics []BuildDiagnostic `json:"diagnostics"`
	Output      string            `json:"output"`
	Summary     BuildSummary      `json:"summary"`
}

// BuildDiagnostic is a single compiler diagnostic (mirrors TS BuildDiagnostic).
type BuildDiagnostic struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Column    int    `json:"column"`
	EndLine   int    `json:"endLine,omitempty"`
	EndColumn int    `json:"endColumn,omitempty"`
	Severity  string `json:"severity"` // error | warning | info | hint
	Code      string `json:"code,omitempty"`
	Message   string `json:"message"`
}

// BuildSummary is a summary of build results (mirrors TS BuildResult.summary).
type BuildSummary struct {
	Errors        int `json:"errors"`
	Warnings      int `json:"warnings"`
	FilesCompiled int `json:"filesCompiled"`
}

// DeploymentResult is the wire format for a deployment (mirrors TS DeploymentResult).
type DeploymentResult struct {
	ID            string `json:"id"`
	State         string `json:"state"` // queued | running | success | failure | cancelled
	StartedAt     string `json:"startedAt"`
	FinishedAt    string `json:"finishedAt,omitempty"`
	FilesTouched  int    `json:"filesTouched"`
	Bytes         int64  `json:"bytes"`
	Trigger       string `json:"trigger"`       // manual | auto | post-save
	HotReloadMode string `json:"hotReloadMode"` // staticSync | compileOnly | classHotSwap | contextReload
	Error         string `json:"error,omitempty"`
}

// ServerInstance is the wire format for a server (mirrors TS ServerInstance).
type ServerInstance struct {
	ID           string        `json:"id"`
	ProjectID    string        `json:"projectId"`
	Type         string        `json:"type"`
	State        string        `json:"state"` // stopped | starting | running | stopping | error | crashed
	PID          int           `json:"pid,omitempty"`
	Ports        ServerPorts   `json:"ports"`
	StartedAt    string        `json:"startedAt,omitempty"`
	LastError    string        `json:"lastError,omitempty"`
	CatalinaBase string        `json:"catalinaBase"`
	Memory       *ServerMemory `json:"memory,omitempty"`
}

// ServerPorts represents the allocated ports of a server instance.
type ServerPorts struct {
	HTTP     int `json:"http,omitempty"`
	Shutdown int `json:"shutdown,omitempty"`
	AJP      int `json:"ajp,omitempty"`
	JMX      int `json:"jmx,omitempty"`
	Debug    int `json:"debug,omitempty"`
}

// ServerMemory represents the memory usage of a server instance.
type ServerMemory struct {
	HeapUsedMb float64 `json:"heapUsedMb,omitempty"`
	HeapMaxMb  float64 `json:"heapMaxMb,omitempty"`
}

// Workspace is the wire format for a workspace (mirrors TS Workspace).
type Workspace struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	RootPath     string `json:"rootPath"`
	CreatedAt    string `json:"createdAt"`
	LastOpenedAt string `json:"lastOpenedAt"`
	UserID       string `json:"userId"`
}

// ProjectConfig is the wire format for a project configuration.
type ProjectConfig struct {
	SchemaVersion int                 `json:"schemaVersion"`
	ID            string              `json:"id"`
	Name          string              `json:"name"`
	RootPath      string              `json:"rootPath"`
	SourceLayout  SourceLayout        `json:"sourceLayout"`
	Encoding      EncodingConfig      `json:"encoding"`
	Java          JavaConfig          `json:"java"`
	ServerRuntime ServerRuntimeConfig `json:"serverRuntime"`
	Build         BuildConfig         `json:"build"`
	Deploy        DeployConfig        `json:"deploy"`
	HotReload     HotReloadConfig     `json:"hotReload"`
}

// SourceLayout describes the project source layout.
type SourceLayout struct {
	Src       []string `json:"src"`
	WebRoot   string   `json:"webRoot"`
	Config    []string `json:"config"`
	Lib       string   `json:"lib,omitempty"`
	TestSrc   []string `json:"testSrc,omitempty"`
	Resources []string `json:"resources,omitempty"`
	BuildXML  string   `json:"buildXml,omitempty"`
}

// EncodingConfig describes the project encoding settings.
type EncodingConfig struct {
	Default      string            `json:"default"`
	Aliases      map[string]string `json:"aliases,omitempty"`
	PerExtension map[string]string `json:"perExtension,omitempty"`
}

// JavaConfig describes the Java toolchain configuration.
type JavaConfig struct {
	LanguageServer ToolchainRef   `json:"languageServer"`
	Compiler       CompilerConfig `json:"compiler"`
	Runtime        ToolchainRef   `json:"runtime"`
}

// ToolchainRef references a toolchain by ID.
type ToolchainRef struct {
	ToolchainID string `json:"toolchainId"`
	Fingerprint string `json:"fingerprint"`
	Label       string `json:"label,omitempty"`
}

// CompilerConfig describes the Java compiler settings.
type CompilerConfig struct {
	ToolchainRef
	SourceLevel string   `json:"sourceLevel"`
	TargetLevel string   `json:"targetLevel"`
	Args        []string `json:"args,omitempty"`
	EmulatedV6  bool     `json:"emulatedV6,omitempty"`
}

// ServerRuntimeConfig describes the server runtime configuration.
type ServerRuntimeConfig struct {
	Type   string                `json:"type"`
	Config ServerRuntimeSettings `json:"config"`
}

// ServerRuntimeSettings contains the detailed server runtime settings.
type ServerRuntimeSettings struct {
	HTTPPort     int               `json:"httpPort,omitempty"`
	ShutdownPort int               `json:"shutdownPort,omitempty"`
	AJPPort      int               `json:"ajpPort,omitempty"`
	JMXPort      int               `json:"jmxPort,omitempty"`
	DebugPort    int               `json:"debugPort,omitempty"`
	ContextPath  string            `json:"contextPath,omitempty"`
	Env          map[string]string `json:"env,omitempty"`
	JVM          *JVMConfig        `json:"jvm,omitempty"`
}

// JVMConfig describes JVM heap and argument settings.
type JVMConfig struct {
	MaxHeapMb int      `json:"maxHeapMb,omitempty"`
	PermGenMb int      `json:"permGenMb,omitempty"`
	ExtraArgs []string `json:"extraArgs,omitempty"`
}

// BuildConfig describes the build tool settings.
type BuildConfig struct {
	Mode          string   `json:"mode"` // ant | javac | custom
	AntFile       string   `json:"antFile,omitempty"`
	CustomCommand string   `json:"customCommand,omitempty"`
	Excludes      []string `json:"excludes,omitempty"`
}

// DeployConfig describes the deployment settings.
type DeployConfig struct {
	Mode        string `json:"mode"` // copy | direct
	Target      string `json:"target"`
	ClassesPath string `json:"classesPath,omitempty"`
	LibPath     string `json:"libPath,omitempty"`
}

// HotReloadConfig describes the hot reload settings.
type HotReloadConfig struct {
	Mode             string `json:"mode"` // staticSync | compileOnly | classHotSwap | contextReload
	DebounceMs       int    `json:"debounceMs,omitempty"`
	FallbackToReload bool   `json:"fallbackToReload,omitempty"`
}

// Toolchain is the wire format for a JDK toolchain.
type Toolchain struct {
	ID           string   `json:"id"`
	Kind         string   `json:"kind"`
	Home         string   `json:"home"`
	Vendor       string   `json:"vendor"`
	Version      string   `json:"version"`
	SourceLevels []string `json:"sourceLevels"`
	Fingerprint  string   `json:"fingerprint"`
	ImportedAt   string   `json:"importedAt"`
}

// DetectedProjectLayout is the result of a workspace scan.
type DetectedProjectLayout struct {
	RootPath            string            `json:"rootPath"`
	Layout              SourceLayout      `json:"layout"`
	DetectedJDK         *DetectedJDK      `json:"detectedJdk,omitempty"`
	DetectedServer      *DetectedServer   `json:"detectedServer,omitempty"`
	WebXML              *WebXMLSummary    `json:"webXml,omitempty"`
	BuildSystem         string            `json:"buildSystem"` // ant | maven | gradle | none
	EncodingByExtension map[string]string `json:"encodingByExtension"`
	Confidence          float64           `json:"confidence"`
	Warnings            []string          `json:"warnings"`
}

// DetectedJDK is a JDK detected during workspace scan.
type DetectedJDK struct {
	Home    string `json:"home"`
	Version string `json:"version"`
}

// DetectedServer is a server runtime detected during workspace scan.
type DetectedServer struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
	Home    string `json:"home,omitempty"`
}

// WebXMLSummary is a summary of web.xml content.
type WebXMLSummary struct {
	ServletCount  int               `json:"servletCount"`
	URLPatterns   []string          `json:"urlPatterns"`
	ContextParams map[string]string `json:"contextParams"`
}

// ProjectDetection is the Go mirror of the TS ProjectDetection
// type. It holds the result of auto-detecting a legacy Java web
// project structure from a directory.
type ProjectDetection struct {
	SourceDirs      []string `json:"sourceDirs"`
	WebRoot         string   `json:"webRoot"`
	LibDirs         []string `json:"libDirs"`
	BuildScript     string   `json:"buildScript"`
	DefaultEncoding string   `json:"defaultEncoding"`
	JDKVersion      string   `json:"jdkVersion"`
	SourceVersion   string   `json:"sourceVersion"`
	TargetVersion   string   `json:"targetVersion"`
	OutputDir       string   `json:"outputDir"`
	BuildSystem     string   `json:"buildSystem"`
	Confidence      float64  `json:"confidence"`
	Warnings        []string `json:"warnings"`
}

// ProjectImportConfirmRequest is the Go mirror of the TS
// ProjectImportConfirmRequest type.
type ProjectImportConfirmRequest struct {
	WorkspaceID     string   `json:"workspaceId"`
	RootPath        string   `json:"rootPath"`
	Name            string   `json:"name"`
	SourceDirs      []string `json:"sourceDirs"`
	WebRoot         string   `json:"webRoot"`
	LibDirs         []string `json:"libDirs"`
	BuildScript     string   `json:"buildScript"`
	DefaultEncoding string   `json:"defaultEncoding"`
	JDKVersion      string   `json:"jdkVersion"`
	SourceVersion   string   `json:"sourceVersion"`
	TargetVersion   string   `json:"targetVersion"`
	OutputDir       string   `json:"outputDir"`
	BuildTool       string   `json:"buildTool"`
	ContextPath     string   `json:"contextPath"`
}

// RecentProject is the Go mirror of the TS RecentProject type.
type RecentProject struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	RootPath     string `json:"rootPath"`
	LastOpenedAt string `json:"lastOpenedAt"`
}

// SearchStreamEvent is a streamed search result batch sent over WebSocket.
type SearchStreamEvent struct {
	Kind       string `json:"kind"`
	TaskID     string `json:"taskId"`
	Batch      []struct {
		File          string `json:"file"`
		Line          int    `json:"line"`
		Column        int    `json:"column"`
		MatchText     string `json:"matchText"`
		ContextBefore string `json:"contextBefore"`
		ContextAfter  string `json:"contextAfter"`
		Replacement   string `json:"replacement,omitempty"`
	} `json:"batch"`
	BatchIndex    int    `json:"batchIndex"`
	Total         int    `json:"total"`
	Done          bool   `json:"done"`
	Error         string `json:"error,omitempty"`
	Skipped       int    `json:"skipped,omitempty"`
	Truncated     bool   `json:"truncated,omitempty"`
	Cancelled     bool   `json:"cancelled,omitempty"`
	DurationMs    int64  `json:"durationMs,omitempty"`
	FilesSearched int    `json:"filesSearched,omitempty"`
}
