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
}

export interface StartServerRequest {
  projectId: string;
}

export interface BuildResult {
  id: string;
  state: 'queued' | 'running' | 'success' | 'failure' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  /** Structured diagnostics. */
  diagnostics: BuildDiagnostic[];
  /** Output of stdout, truncated. */
  output: string;
  /** Counts for the UI. */
  summary: { errors: number; warnings: number; filesCompiled: number };
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
  /**
   * True iff the LSP `initialize` handshake completed. The UI
   * must NOT advertise completion / hover / etc. until this
   * is true, even when state == "running".
   */
  initializeOk: boolean;
}

export interface JdtStartRequest {
  /** Override the JRE the agent uses to run the JDT LS. */
  jrePath?: string;
  /** Project source level. Defaults to "1.6". */
  sourceLevel?: '1.5' | '1.6' | '1.7' | '1.8' | '9' | '11' | '17';
  /** Workspace root URI passed to the LSP `initialize` request. */
  initializeRootURI?: string;
  /** Hard timeout for the Start call. Default 30s. */
  timeoutMs?: number;
}

export interface JdtProjectRequest {
  workspaceId: string;
  /** The on-disk root of the project; usually the workspace root. */
  rootPath: string;
  /** Optional projectId; default = basename of rootPath. */
  projectId?: string;
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
  'GET /api/v1/workspaces': { request: undefined; response: Workspace[] };
  'POST /api/v1/workspaces': {
    request: { rootPath: string; name?: string };
    response: Workspace;
  };
  'POST /api/v1/workspaces/{workspaceId}/scan': {
    request: { deep?: boolean };
    response: { detected: DetectedProjectLayout[] };
  };
  'GET /api/v1/projects': { request: undefined; response: ProjectConfig[] };
  'GET /api/v1/projects/{projectId}': { request: undefined; response: ProjectConfig };
  'PUT /api/v1/projects/{projectId}': { request: { config: ProjectConfig }; response: ProjectConfig };
  'GET /api/v1/builds': { request: undefined; response: BuildResult[] };
  'POST /api/v1/builds': { request: StartBuildRequest; response: BuildResult };
  'GET /api/v1/builds/{buildId}': { request: undefined; response: BuildResult };
  'DELETE /api/v1/builds/{buildId}': { request: undefined; response: BuildResult };
  'GET /api/v1/deployments': { request: undefined; response: DeploymentResult[] };
  'POST /api/v1/deployments': { request: StartDeploymentRequest; response: DeploymentResult };
  'GET /api/v1/deployments/{deploymentId}': { request: undefined; response: DeploymentResult };
  'GET /api/v1/servers': { request: undefined; response: ServerInstance[] };
  'POST /api/v1/servers': { request: StartServerRequest; response: ServerInstance };
  'GET /api/v1/servers/{serverId}': { request: undefined; response: ServerInstance };
  'POST /api/v1/servers/{serverId}/restart': { request: undefined; response: ServerInstance };
  'DELETE /api/v1/servers/{serverId}': { request: undefined; response: ServerInstance };
  'GET /api/v1/servers/{serverId}/logs': {
    request: { follow?: boolean; since?: number };
    response: { line: string; ts: string }[];
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

export type Endpoint = keyof EndpointMap;
export type RequestFor<E extends Endpoint> = RequestEnvelope<EndpointMap[E]['request']>;
export type ResponseFor<E extends Endpoint> = EndpointMap[E]['response'];

/* ------------------------------------------------------------------ */
/*  WebSocket event stream                                             */
/* ------------------------------------------------------------------ */

export type WsEvent =
  | { type: 'log'; serverId: string; line: string; ts: string }
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
  | { type: 'audit'; event: AuditEvent };

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
