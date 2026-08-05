/**
 * Kairo wire protocol — TypeScript types.
 *
 * Hand-written and the single source of truth. The Go Runtime
 * Agent has a parallel hand-written mirror in
 * `runtime-agent/internal/api/protocol/types.go` that this file
 * must keep in sync. A script to assert structural equivalence
 * of the two trees will be added in Phase 1.
 *
 * The major version is `/api/v1`. Breaking changes bump to
 * `/api/v2`.
 */

export { findFreePort } from './network';

export const PROTOCOL_VERSION = 'v1' as const;
export const PROTOCOL_VERSION_PATH = '/api/v1' as const;

/** Universal request envelope. */
export interface RequestEnvelope<P = unknown> {
  /** Assigned by the agent after auth, NOT trusted from the client. */
  workspaceId: string;
  /** Optional. When present, scopes the call. */
  projectId?: string;
  /** Client-generated UUIDv4. Echoed in the response. */
  requestId: string;
  /** Propagated from upstream callers (e.g. UI → agent → plugin). */
  correlationId?: string;
  /** Request-specific payload. */
  payload: P;
}

/** Successful response envelope. */
export interface ResponseEnvelope<P = unknown> {
  requestId: string;
  correlationId?: string;
  ok: true;
  payload: P;
}

/** Error response envelope. */
export interface ErrorEnvelope {
  requestId: string;
  correlationId?: string;
  ok: false;
  error: KairoError;
}

export type Envelope<P = unknown> = ResponseEnvelope<P> | ErrorEnvelope;

/** Stable, machine-readable error code. Add new codes here AND in
 * the Go mirror. */
export type KairoErrorCode =
  // 4xx-style
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'invalid_request'
  | 'path_forbidden'
  | 'toolchain_missing'
  | 'runtime_missing'
  | 'unsupported_jdk_target'
  // 5xx-style
  | 'internal'
  | 'io_error'
  | 'process_spawn_failed'
  | 'compile_failed'
  | 'deploy_failed'
  | 'debug_attach_failed'
  | 'cancelled'
  | 'timeout'
  | 'plugin_crashed'
  | 'unsupported';

export interface KairoError {
  code: KairoErrorCode;
  /** Human-readable, never machine-parsed. */
  message: string;
  /** Free-form structured details, never includes secrets. */
  details?: unknown;
  /** When true, the client may retry the same call after backoff. */
  retryable?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Resources                                                          */
/* ------------------------------------------------------------------ */

export type EncodingId =
  | 'utf-8'
  | 'utf-8-bom'
  | 'utf-16le'
  | 'utf-16be'
  | 'gbk'
  | 'gb18030'
  | 'iso-8859-1'
  | 'us-ascii'
  | (string & {}); // user-registered alias

export type Eol = 'lf' | 'crlf' | 'cr';

export interface DocumentEncoding {
  current: EncodingId;
  declared?: EncodingId;
  provenance:
    | { kind: 'bom'; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' }
    | { kind: 'declared' }
    | { kind: 'detected'; confidence: number; candidates: EncodingId[] };
  eol: Eol;
}

export interface Workspace {
  id: string;
  /** Display name (defaults to folder basename). */
  name: string;
  /** Absolute, canonical path on the host. Server-assigned. */
  rootPath: string;
  createdAt: string; // ISO-8601
  lastOpenedAt: string;
  /** Server-assigned; clients cannot influence this. */
  userId: string;
}

export interface ProjectConfig {
  schemaVersion: 1;
  id: string;
  name: string;
  /** Path relative to workspace root. */
  rootPath: string;
  sourceLayout: {
    src: string[];
    webRoot: string;
    config: string[];
    lib?: string;
    testSrc?: string[];
    resources?: string[];
    buildXml?: string;
  };
  encoding: {
    default: EncodingId;
    aliases?: Record<string, EncodingId>;
    /** Per-extension overrides. */
    perExtension?: Record<string, EncodingId>;
  };
  java: {
    languageServer: ToolchainRef & {
      vmOptions?: string[];
      jvmHeapMb?: number;
    };
    compiler: ToolchainRef & {
      sourceLevel: '1.5' | '1.6' | '1.7' | '1.8' | '9' | '11' | '17';
      targetLevel: '1.5' | '1.6' | '1.7' | '1.8' | '9' | '11' | '17';
      args?: string[];
      /** When the user's compiler is not Java 6 but emulates it. */
      emulatedV6?: boolean;
    };
    runtime: ToolchainRef & {
      vmOptions?: string[];
    };
  };
  serverRuntime: {
    type: string; // resolves to a ServerRuntimeProvider
    config: {
      httpPort?: number;
      shutdownPort?: number;
      ajpPort?: number;
      jmxPort?: number;
      debugPort?: number;
      contextPath?: string;
      env?: Record<string, string>;
      jvm?: {
        maxHeapMb?: number;
        permGenMb?: number;
        extraArgs?: string[];
      };
    };
  };
  build: {
    mode: 'ant' | 'javac' | 'custom';
    antFile?: string;
    customCommand?: string;
    /** Patterns to skip. */
    excludes?: string[];
  };
  deploy: {
    mode: 'copy' | 'direct';
    target: string; // path relative to workspace root
    /** Sync classes (after compile) to this path (relative to deploy target). */
    classesPath?: string;
    /** Sync dependent JARs here. */
    libPath?: string;
  };
  hotReload: {
    /** None of these are real on day one if the plugin says so; the
     * plugin's RuntimeProvider decides. */
    mode: 'staticSync' | 'compileOnly' | 'classHotSwap' | 'contextReload';
    debounceMs?: number;
    fallbackToReload?: boolean;
  };
}

/** Create-only import payload; paths are relative to rootPath unless stated. */
export interface ProjectImportRequest {
  id: string;
  workspaceId: string;
  name: string;
  /** Absolute selected project root; the agent confines it to the workspace. */
  rootPath: string;
  sourceRoots: string[];
  resourceRoots: string[];
  webappDir: string;
  outputDir: string;
  buildFile?: string;
  buildTargets?: string[];
  sourceLevel: '1.5' | '1.6' | '1.7' | '1.8';
  targetLevel: '1.5' | '1.6' | '1.7' | '1.8';
  encoding: EncodingId;
  buildTool: 'ant' | 'javac';
  contextPath: string;
  toolchainId?: string;
}

/* ------------------------------------------------------------------ */
/*  Run configurations                                                 */
/* ------------------------------------------------------------------ */

export const RUN_CONFIGURATION_VERSION = 1 as const;

export type TomcatLaunchMode = 'run' | 'debug';
export type BeforeLaunchTask = 'build' | 'deploy';

export type RunConfigurationBuild =
  | { type: 'ant'; target: string; clean: boolean }
  | { type: 'javac'; clean: boolean }
  | { type: 'custom'; command: string; clean: boolean };

export interface RunConfigurationDeploy {
  mode: 'exploded' | 'war';
  /** Path relative to the configuration's project root. */
  artifact: string;
}

export interface TomcatRunConfiguration {
  /** Stable identifier used by persistence and toolbar selection. */
  id: string;
  name: string;
  type: 'tomcat6';
  projectId: string;
  mode: TomcatLaunchMode;
  /** Only meaningful for Debug; must be false for Run. */
  suspend: boolean;
  jdkRef: string;
  build: RunConfigurationBuild;
  server: {
    /** Stable reference to a saved Tomcat server definition. */
    id: string;
    httpPort: number;
    debugPort: number;
    contextPath: string;
  };
  deploy: RunConfigurationDeploy;
  /** Plain values or `${env:HOST_NAME}` references; secrets must use references. */
  env: Record<string, string>;
  vmOptions: string[];
  /** Ordered, unique tasks executed before the server starts. */
  beforeLaunchTasks: BeforeLaunchTask[];
}

/** Persisted project-level document (`.legacyflow/run-configurations.json`). */
export interface RunConfigurationDocument {
  version: typeof RUN_CONFIGURATION_VERSION;
  configurations: TomcatRunConfiguration[];
  /** Null only when configurations is empty. */
  selectedConfigurationId: string | null;
}

/** Non-sensitive control for launching a persisted configuration. */
export interface RunConfigurationLaunchRequest {
  /** Must match the persisted configuration; prevents accidental Run/Debug inversion. */
  mode: TomcatLaunchMode;
}

export interface ToolchainRef {
  /** Either 'auto' (let the agent pick) or a known toolchain id. */
  toolchainId: string;
  /** SHA-256 of the JDK installation, in the form `sha256:<hex>`. */
  fingerprint: string;
  /** Optional human label. */
  label?: string;
}

export interface Toolchain {
  id: string;
  kind: 'jdk';
  /** Absolute path on the host. */
  home: string;
  vendor: string;
  version: string;
  /** Optional human label. */
  label?: string;
  /** `javac -source` levels this JDK can compile natively. */
  sourceLevels: string[];
  fingerprint: string;
  importedAt: string;
}

export interface ServerInstance {
  id: string;
  projectId: string;
  type: string; // ServerRuntimeProvider id
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'crashed';
  pid?: number;
  ports: {
    http?: number;
    shutdown?: number;
    ajp?: number;
    jmx?: number;
    debug?: number;
  };
  startedAt?: string;
  lastError?: string;
  catalinaBase: string;
  memory?: {
    heapUsedMb?: number;
    heapMaxMb?: number;
  };
}

export interface PortDiagnostics {
  port: number;
  occupied: boolean;
  pid?: number;
  processName?: string;
  suggestion?: string;
}

export interface StartBuildRequest {
  projectId: string;
  clean?: boolean;
  intent?: 'full' | 'selected-files';
  selectedFiles?: string[];
}

export interface StartDeploymentRequest {
  projectId: string;
  buildId: string;
  scope: 'all' | 'classes' | 'webapp' | 'resources';
  intent?: 'publish-static-changes';
}

export interface StartServerRequest {
  projectId: string;
  /** Start Tomcat with a local JDWP listener. */
  debug?: boolean;
}

export interface BuildResult {
  id: string;
  state: 'queued' | 'running' | 'success' | 'failure' | 'cancelled';
  /** Correlates the HTTP request, persisted result and redacted Agent logs. */
  traceId?: string;
  startedAt: string;
  finishedAt?: string;
  /** Structured diagnostics. */
  diagnostics: BuildDiagnostic[] | null;
  /** Output of stdout, truncated. */
  output: string;
  error?: string;
  exitCode?: number;
  filesCompiled?: number;
  elapsedMs?: number;
  /** Counts for the UI. */
  summary?: { errors: number; warnings: number; filesCompiled: number } | null;
}

export interface BuildDiagnostic {
  file: string; // workspace-relative
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  code?: string; // e.g. 'compiler.err.not.statement'
  message: string;
}

export interface DeploymentRequest {
  projectId: string;
  buildId?: string; // if absent, agent builds first
  /** What to publish. */
  what: 'classes' | 'webapp' | 'all';
}

export interface DeploymentResult {
  id: string;
  state: 'queued' | 'running' | 'success' | 'failure' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  filesTouched: number;
  bytes: number;
  trigger: 'manual' | 'auto' | 'post-save';
  hotReloadMode: 'staticSync' | 'compileOnly' | 'classHotSwap' | 'contextReload';
  error?: string;
}

export interface SearchRequest {
  workspaceId: string;
  /** Optional absolute path override (directory or single file). */
  rootPath?: string;
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include?: string[];
  exclude?: string[];
  contextLines?: number;
  maxResults?: number;
  /** If true, also return replace previews. */
  previewReplace?: string;
}

export interface FileListRequest {
  workspaceId: string;
  rootPath?: string;
  include?: string[];
  exclude?: string[];
  maxFiles?: number;
}

export interface FileListEntry {
  path: string;
  name: string;
}

export interface FileListResponse {
  files: FileListEntry[];
  total: number;
}

export interface SearchMatch {
  file: string; // workspace-relative
  line: number;
  column: number;
  matchText: string;
  contextBefore: string;
  contextAfter: string;
  /** Optional replacement preview when `previewReplace` was set. */
  replacement?: string;
}

export interface SearchResponse {
  query: string;
  totalMatches: number;
  truncated: boolean;
  matches: SearchMatch[];
  /** How long the search took in ms. */
  elapsedMs: number;
  /** Files that errored during read. */
  erroredFiles: { file: string; reason: string }[];
}

/** Streamed search result event sent over WebSocket. */
export interface SearchStreamEvent {
  kind: 'searchStream';
  taskId: string;
  batch: SearchMatch[];
  batchIndex: number;
  total: number;
  done: boolean;
  error?: string;
}

export interface EncodingDetectRequest {
  workspaceId: string;
  file: string;
  /** Read up to this many bytes (default 64KB). */
  sampleBytes?: number;
}

export interface EncodingDetectResponse {
  file: string;
  encoding: EncodingId;
  confidence: number;
  candidates: EncodingId[];
  hasBom: boolean;
  eol: Eol;
}

export interface EncodingRecodeRequest {
  workspaceId: string;
  file: string;
  /** Read by this encoding. */
  from: EncodingId;
  /** Write with this encoding. */
  to: EncodingId;
  /** Optional EOL override. */
  eol?: Eol;
}

export interface EncodingRecodeResponse {
  ok: true;
  bytes: number;
}

export interface EncodingValidateRequest {
  text: string;
  encoding: string;
}

export interface EncodingValidateResponse {
  valid: boolean;
  error?: string;
}

export interface HealthResponse {
  ok: true;
  version: string;
  agentVersion: string;
  uptimeSec: number;
  platform: {
    os: 'darwin' | 'linux' | 'windows';
    arch: 'amd64' | 'arm64' | (string & {});
  };
  bindAddress: string;
  port: number;
  activeSessions: number;
}

/* ------------------------------------------------------------------ */
/*  JDT Language Server                                                */
/* ------------------------------------------------------------------ */

// JdtState is the on-the-wire state the agent reports. The
// frontend derives a richer JavaServiceState from this plus
// the install state and the LSP `initialize` handshake.
export type JdtState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

// The frontend's service-level state machine. 'not-installed'
// is the value the user sees when no JDT LS is on disk;
// 'installing' covers a download + extract; 'initializing' is
// the LSP handshake; 'ready' is when the LS has answered
// initialize; 'degraded' is when the LS is up but we know we
// cannot provide the full feature set (e.g. Java 6 source
// compliance in a Java 17 LS); 'crashed' is the terminal
// state that the user must click "Restart" to clear.
export type JavaServiceState =
  | JdtState
  | 'uninitialized'
  | 'not-installed'
  | 'installing'
  | 'initializing'
  | 'ready'
  | 'degraded';

export interface JdtStatus {
  state: JdtState;
  pid?: number;
  /** JDT LS release version baked into the agent. */
  version?: string;
  startedAt?: string;
  stoppedAt?: string;
  /** JRE the agent is using to run the JDT LS. */
  jre?: string;
  /** Resolved path to the JDT LS launcher JAR. */
  jar?: string;
  /** Equinox launcher JAR (same as `jar`; kept for legacy UI). */
  launcherJar?: string;
  /** Per-workspace data dir the JDT LS is using. */
  workspace?: string;
  /** Project source level (e.g. "1.6"). */
  sourceLevel?: string;
  /** When the process exited without a clean Stop. */
  lastError?: string;
  /** Absolute path of the per-run stderr capture file. */
  stderrPath?: string;
  /** Number of auto-restarts since the agent started. */
  restartCount?: number;
}

/**
 * Launch descriptor returned by the Go Agent. The Theia backend
 * uses this to spawn the JDT LS process. The descriptor does NOT
 * include os.Environ() — only the minimal allowlist of env vars.
 */
export interface JdtLaunchDescriptor {
  command: string;
  args: string[];
  workingDir: string;
  envAllowlist: string[];
}

/**
 * Distribution status returned by GET /api/v1/jdtls/distribution.
 * Describes the JDT LS installation state (version, download status,
 * launcher path, etc.).
 */
export interface JdtDistributionStatus {
  installed: boolean;
  version: string;
  home: string;
  launcherJar: string;
  source: string;
  message?: string;
}

export interface JdtProjectRequest {
  workspaceId: string;
  /** The on-disk root of the project; usually the workspace root. */
  rootPath: string;
  /** Optional projectId; default = basename of rootPath. */
  projectId?: string;
  /** Whether to auto-detect classpath from build.xml / lib/ etc. Default true. */
  autoDetectClasspath?: boolean;
  /** Optional explicit build file path (e.g. build.xml). */
  buildFile?: string;
  /**
   * Explicit library/jar paths for the JDT model. When provided with
   * autoDetectClasspath=false, these replace autodetection (BD-P1-13).
   */
  libraries?: string[];
}

export interface JdtProjectResponse {
  workspaceId: string;
  projectId: string;
  projectModel: string;
  classpath: string;
  sourceRoots: string[];
  outputDir: string;
  encoding: string;
  sourceLevel: string;
  targetLevel: string;
  generatedAt: string;
  fromCache: boolean;
  classpathEntries: string[];
  /** How the classpath was resolved: "ant" | "yaml" | "autodetect" | "manual". */
  classpathSource: string;
  /** Jar/dir paths that could not be resolved on disk. */
  unresolvedPaths: string[];
}

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  sessionToken: string;
  csrfToken: string;
  user: { id: string; username: string; role: 'admin' | 'user' };
  expiresAt: string;
}

export interface AuditEvent {
  ts: string;
  level: 'info' | 'warn' | 'error';
  component: string;
  workspaceId?: string;
  projectId?: string;
  requestId?: string;
  correlationId?: string;
  userId?: string;
  action: string;
  target?: string;
  result: 'ok' | 'denied' | 'error';
  fields?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Endpoints (typed request/response pairs)                           */
/* ------------------------------------------------------------------ */

export interface EndpointMap {
  // Liveness (no auth required on the agent)
  'GET /api/v1/health': { request: undefined; response: HealthResponse };
  // Workspaces
  'GET /api/v1/workspaces': { request: undefined; response: Workspace[] };
  'POST /api/v1/workspaces': {
    request: { rootPath: string; name?: string };
    response: Workspace;
  };
  'DELETE /api/v1/workspaces/{workspaceId}': { request: undefined; response: void };
  'POST /api/v1/workspaces/{workspaceId}/scan': {
    request: { deep?: boolean; rootPath?: string };
    response: { detected: DetectedProjectLayout[] };
  };
  'POST /api/v1/workspaces/{workspaceId}/projects/import': {
    request: ProjectImportRequest;
    response: ProjectConfig;
  };
  'GET /api/v1/workspaces/{workspaceId}/run-configurations': {
    request: undefined;
    response: RunConfigurationDocument;
  };
  'POST /api/v1/workspaces/{workspaceId}/run-configurations': {
    request: TomcatRunConfiguration;
    response: RunConfigurationDocument;
  };
  'PUT /api/v1/workspaces/{workspaceId}/run-configurations': {
    request: RunConfigurationDocument;
    response: RunConfigurationDocument;
  };
  'GET /api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}': {
    request: undefined;
    response: TomcatRunConfiguration;
  };
  'PUT /api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}': {
    request: TomcatRunConfiguration;
    response: RunConfigurationDocument;
  };
  'DELETE /api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}': {
    request: undefined;
    response: RunConfigurationDocument;
  };
  'POST /api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}/launch': {
    request: RunConfigurationLaunchRequest;
    response: ServerInstance;
  };
  'POST /api/v1/workspaces/{workspaceId}/java/prepare': {
    request: { projectId: string };
    response: unknown;
  };
  'GET /api/v1/workspaces/{workspaceId}/java/launch-descriptor': {
    request: { projectId: string };
    response: unknown;
  };
  // Projects
  'GET /api/v1/projects': { request: undefined; response: ProjectConfig[] };
  'GET /api/v1/projects/{projectId}': { request: undefined; response: ProjectConfig };
  // The agent unmarshals the body directly into a flat domain.Project (KAIRO-RC-WEB-202).
  'PUT /api/v1/projects/{projectId}': { request: ProjectConfig; response: ProjectConfig };
  // Builds
  'GET /api/v1/builds': { request: undefined; response: BuildResult[] };
  'POST /api/v1/builds': { request: StartBuildRequest; response: BuildResult };
  'GET /api/v1/builds/{buildId}': { request: undefined; response: BuildResult };
  'DELETE /api/v1/builds/{buildId}': { request: undefined; response: BuildResult };
  // Deployments
  'GET /api/v1/deployments': { request: undefined; response: DeploymentResult[] };
  'POST /api/v1/deployments': { request: StartDeploymentRequest; response: DeploymentResult };
  'GET /api/v1/deployments/{deploymentId}': { request: undefined; response: DeploymentResult };
  // Servers
  'GET /api/v1/servers': { request: undefined; response: ServerInstance[] };
  'POST /api/v1/servers': { request: StartServerRequest; response: ServerInstance };
  'GET /api/v1/servers/{serverId}': { request: undefined; response: ServerInstance };
  'POST /api/v1/servers/{serverId}/restart': { request: undefined; response: ServerInstance };
  'POST /api/v1/servers/{serverId}/debug': { request: undefined; response: ServerInstance };
  'DELETE /api/v1/servers/{serverId}': { request: { force?: boolean }; response: ServerInstance };
  'POST /api/v1/servers/{serverId}/reload': { request: undefined; response: { status: string } };
  'GET /api/v1/servers/{serverId}/logs': {
    request: { follow?: boolean; since?: number; tail?: number };
    response: { line: string; ts: string; stream?: 'stdout' | 'stderr' | 'structured'; source?: string; ordinal?: number }[];
  };
  // Search
  'POST /api/v1/search': { request: SearchRequest; response: SearchResponse };
  'POST /api/v1/search/files': { request: FileListRequest; response: FileListResponse };
  // Toolchains
  'GET /api/v1/toolchains': { request: undefined; response: Toolchain[] };
  'POST /api/v1/toolchains/import': {
    request: { path: string; label?: string };
    response: Toolchain;
  };
  // JDT LS
  // GET /api/v1/jdtls — current JDT LS process status (state, version, JRE, etc.)
  // POST /api/v1/jdtls — trigger JDT LS distribution download/install (prepare)
  'GET /api/v1/jdtls': { request: undefined; response: JdtStatus };
  'POST /api/v1/jdtls': { request: undefined; response: JdtStatus };
  // GET /api/v1/jdtls/distribution — JDT LS distribution installation status
  'GET /api/v1/jdtls/distribution': { request: undefined; response: JdtDistributionStatus };
  // GET /api/v1/projects/{projectId}/launch-descriptor — JDT LS launch descriptor
  'GET /api/v1/projects/{projectId}/launch-descriptor': { request: undefined; response: JdtLaunchDescriptor };
  'POST /api/v1/jdtls/project': { request: JdtProjectRequest; response: JdtProjectResponse };
  // Encoding
  'POST /api/v1/encoding/detect': { request: EncodingDetectRequest; response: EncodingDetectResponse };
  'POST /api/v1/encoding/recode': { request: EncodingRecodeRequest; response: EncodingRecodeResponse };
  'POST /api/v1/encoding/validate': { request: EncodingValidateRequest; response: EncodingValidateResponse };
  // Project Detection & Import
  'POST /api/v1/projects/detect': { request: { rootPath: string }; response: ProjectDetection };
  'POST /api/v1/projects/import': { request: ProjectImportConfirmRequest; response: ProjectConfig };
  'GET /api/v1/projects/recent': { request: undefined; response: RecentProject[] };
  // Diagnostics
  'GET /api/v1/diagnostics/port': { request: { port: number }; response: PortDiagnostics };
  // Recovery
  'GET /api/v1/servers/recoverable': { request: undefined; response: ServerInstance[] };
  'POST /api/v1/servers/{serverId}/recover': { request: undefined; response: ServerInstance };
  // Maven
  'POST /api/v1/maven/detect': { request: { rootPath: string }; response: MavenDetectResult };
  'GET /api/v1/maven/dependencies': { request: { rootPath: string; offline?: boolean }; response: MavenDetectResult };
  'POST /api/v1/maven/run': { request: { rootPath: string; task: string; offline?: boolean }; response: MavenRunResult };
  // Custom build
  'POST /api/v1/build/custom': { request: CustomBuildStartRequest; response: CustomBuildStartResponse };
  'GET /api/v1/build/custom/{buildId}': { request: undefined; response: CustomBuildStatusResponse };
  'POST /api/v1/build/custom/{buildId}/cancel': { request: undefined; response: CustomBuildCancelResponse };
  // Ant classpath
  'POST /api/v1/ant/classpath/analyze': { request: AntClasspathAnalyzeRequest; response: AntClasspathAnalyzeResponse };
  // JVM incremental compilation and hot reload
  'POST /api/v1/jvm/compile-incremental': { request: { files?: string[]; projectId?: string }; response: { state: string; filesCompiled?: number; error?: string } };
  'POST /api/v1/jvm/compile': { request: { file: string; projectId?: string }; response: { success: boolean; classPath?: string; error?: string } };
  'POST /api/v1/jvm/redefine': { request: { sourcePath: string; classPath?: string }; response: { success: boolean; error?: string } };
  // Java detect / run (main + JUnit)
  'POST /api/v1/java/detect': {
    request: { filePath: string };
    response: {
      packageName: string;
      className: string;
      methods: Array<{
        name: string;
        line: number;
        isMain: boolean;
        isTest: boolean;
        startLine: number;
        endLine: number;
      }>;
    };
  };
  'POST /api/v1/java/run': {
    request: {
      projectRoot: string;
      filePath: string;
      className: string;
      packageName?: string;
      line?: number;
      debug?: boolean;
      methodType?: 'main' | 'test' | string;
    };
    response: {
      ok: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      buildDir?: string;
      classpath?: string;
      debugPort?: number;
      error?: string;
    };
  };
  // SQL (experimental Oracle)
  'POST /api/v1/sql/execute': {
    request: { connectionId: string; sql: string; maxRows?: number };
    response: {
      columns: Array<{ name: string; type: string; label: string }>;
      rows: Array<Record<string, unknown>>;
      rowCount: number;
      totalRows?: number;
      executionTimeMs: number;
      truncated: boolean;
      error?: string;
    };
  };
  'POST /api/v1/sql/test-connection': {
    request: {
      host: string;
      port: number;
      sid?: string;
      serviceName?: string;
      useServiceName: boolean;
      username: string;
      password: string;
    };
    response: { success: boolean; oracleVersion?: string; instanceName?: string; connectionId?: string };
  };
}

export interface DetectedProjectLayout {
  /** Best-guess project root (absolute path). */
  rootPath: string;
  /** What we think the source layout is. */
  layout: ProjectConfig['sourceLayout'];
  /** What JDK we found in the environment. */
  detectedJdk?: { home: string; version: string };
  /** What Tomcat / server we think the project uses. */
  detectedServer?: { name: string; version?: string; home?: string };
  /** web.xml summary. */
  webXml?: { servletCount: number; urlPatterns: string[]; contextParams: Record<string, string> };
  /** Ant / Maven / Gradle. */
  buildSystem?: 'ant' | 'maven' | 'gradle' | 'none';
  /** Encoding guesses by extension. */
  encodingByExtension: Record<string, EncodingId>;
  /** Confidence 0-1. */
  confidence: number;
  /** Issues we want the user to confirm. */
  warnings: string[];
}

/** Result of auto-detecting a legacy Java web project structure. */
export interface ProjectDetection {
  sourceDirs: string[];
  webRoot: string;
  libDirs: string[];
  buildScript: string;
  defaultEncoding: EncodingId;
  jdkVersion: string;
  sourceVersion: string;
  targetVersion: string;
  outputDir: string;
  buildSystem: string;
  confidence: number;
  warnings: string[];
}

/** Request to import a project with confirmed configuration. */
export interface ProjectImportConfirmRequest {
  workspaceId: string;
  /** Absolute project root path. */
  rootPath: string;
  name: string;
  sourceDirs: string[];
  webRoot: string;
  libDirs: string[];
  buildScript: string;
  defaultEncoding: EncodingId;
  jdkVersion: string;
  sourceVersion: string;
  targetVersion: string;
  outputDir: string;
  buildTool: 'ant' | 'javac';
  contextPath: string;
}

/** Recent project entry for the welcome page. */
export interface RecentProject {
  id: string;
  name: string;
  rootPath: string;
  lastOpenedAt: string;
}

// Maven types

export interface MavenProject {
  groupId: string;
  artifactId: string;
  version: string;
  packaging: string;
  name: string;
  description: string;
  dependencies: MavenDependency[];
  buildDir: string;
  outputDir: string;
}

export interface MavenDependency {
  groupId: string;
  artifactId: string;
  version: string;
  scope: string;
  optional: boolean;
  type: string;
}

export interface MavenDependencyTreeNode {
  groupId: string;
  artifactId: string;
  version: string;
  scope: string;
  optional: boolean;
  type: string;
  children?: MavenDependencyTreeNode[];
}

export interface MavenLifecycleTask {
  id: string;
  label: string;
  description: string;
  phase: string;
}

export interface MavenDetectResult {
  found: boolean;
  project?: MavenProject;
  tasks: MavenLifecycleTask[];
  dependencies: MavenDependency[];
  tree?: MavenDependencyTreeNode[];
  warnings: string[];
}

export interface MavenRunResult {
  task: string;
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

export interface CustomBuildStartRequest {
  command: string;
  projectRoot: string;
  workingDir: string;
  buildId?: string;
  env?: Record<string, string>;
}

export interface CustomBuildStartResponse {
  buildId: string;
  status: string;
}

export interface CustomBuildStatusResponse {
  buildId: string;
  status: string;
  exitCode?: number;
}

export interface CustomBuildCancelResponse {
  buildId: string;
  status: string;
}

export interface AntClasspathAnalyzeRequest {
  projectRoot: string;
  buildFile?: string;
}

export interface AntClasspathWarning {
  file?: string;
  line?: number;
  message: string;
  severity: 'warning' | 'info' | 'error';
}

export interface AntClasspathAnalyzeResponse {
  success: boolean;
  buildFile?: string;
  classpath: string[];
  classpathCount: number;
  sourceRoots: string[];
  outputDir?: string;
  properties: Record<string, string>;
  warnings: AntClasspathWarning[];
  message?: string;
}

export type Endpoint = keyof EndpointMap;
export type RequestFor<E extends Endpoint> = RequestEnvelope<EndpointMap[E]['request']>;
export type ResponseFor<E extends Endpoint> = EndpointMap[E]['response'];

/* ------------------------------------------------------------------ */
/*  WebSocket event stream                                             */
/* ------------------------------------------------------------------ */

export type WsEvent =
  | { type: 'log'; serverId: string; line: string; ts: string; stream?: 'stdout' | 'stderr' | 'structured'; source?: string; ordinal?: number }
  | { type: 'build.progress'; buildId: string; state: BuildResult['state']; currentFile?: string }
  | {
      type: 'deployment.progress';
      deploymentId: string;
      state: DeploymentResult['state'];
      currentFile?: string;
    }
  | {
      type: 'server.state';
      serverId: string;
      state: ServerInstance['state'];
      pid?: number;
      ports?: ServerInstance['ports'];
    }
  | {
      type: 'diagnostic';
      level: 'info' | 'warn' | 'error';
      component: string;
      message: string;
      fields?: Record<string, unknown>;
    }
  | { type: 'audit'; event: AuditEvent }
  | {
      type: 'hotreload.status';
      data?: { status: string };
      message?: string;
    };

/* ------------------------------------------------------------------ */
/*  Helpers (re-exported from index)                                   */
/* ------------------------------------------------------------------ */

export function ok<P>(env: RequestEnvelope, payload: P): ResponseEnvelope<P> {
  return { requestId: env.requestId, correlationId: env.correlationId, ok: true, payload };
}

export function err(
  requestId: string,
  code: KairoErrorCode,
  message: string,
  opts?: { correlationId?: string; details?: unknown; retryable?: boolean },
): ErrorEnvelope {
  return {
    requestId,
    correlationId: opts?.correlationId,
    ok: false,
    error: { code, message, details: opts?.details, retryable: opts?.retryable },
  };
}
