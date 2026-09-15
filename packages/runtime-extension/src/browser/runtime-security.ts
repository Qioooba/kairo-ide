/**
 * Runtime Security, Workspace Trust, and Credential Protection (PR16 / F24 / T51 ~ T53).
 *
 * Implements:
 * - T51: AgentEndpointValidator (loopback / same-origin allowlist, blocking secret exfiltration to untrusted URLs).
 * - T52: WorkspaceTrustManager (trust state gating for dangerous auto-scripts, builds, and server start).
 * - T53: DiagnosticLogRedactor (sensitive secret / password / token redaction in logs and exports).
 */

import type {
  WorkspaceTrustState,
  TrustedOperation,
} from '@kairo/protocol';

/* ========================================================================== */
/*  T51: Agent Endpoint Security & Secret Isolation                           */
/* ========================================================================== */

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
];

export class AgentEndpointValidator {
  /**
   * Validate whether an agent URL is safe to receive credentials (agent secret / auth token).
   *
   * Crucial Security Invariant (T51 / F24):
   * Secrets are NEVER sent to unapproved or external endpoints.
   * By default, only loopback addresses and same-origin hosts are allowed.
   */
  static isAllowedAgentUrl(
    urlStr: string,
    customAllowedHosts?: string[],
  ): { allowed: boolean; host?: string; port?: number; reason?: string } {
    if (!urlStr || !urlStr.trim()) {
      return { allowed: false, reason: 'Agent URL is empty' };
    }

    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { allowed: false, reason: `Invalid URL format: "${urlStr}"` };
    }

    const rawHost = parsed.hostname.toLowerCase();
    const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);

    const normalizeHost = (h: string) => {
      const lower = h.toLowerCase();
      return lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;
    };

    // Build allowlist
    const allowed = new Set<string>(DEFAULT_ALLOWED_HOSTS.map(normalizeHost));

    // In browser environment, permit same-origin host
    if (typeof window !== 'undefined' && window.location?.hostname) {
      allowed.add(normalizeHost(window.location.hostname));
    }

    if (customAllowedHosts) {
      for (const h of customAllowedHosts) {
        allowed.add(normalizeHost(h));
      }
    }

    if (allowed.has(host)) {
      return { allowed: true, host, port };
    }

    return {
      allowed: false,
      host,
      port,
      reason: `Agent host "${host}" is not on the approved endpoint allowlist. Refusing to send credentials.`,
    };
  }

  /**
   * Sanitize an agent URL. If untrusted, returns the fallback URL.
   */
  static sanitizeAgentUrl(urlStr: string, fallbackUrl = 'http://127.0.0.1:18080'): string {
    const check = this.isAllowedAgentUrl(urlStr);
    if (check.allowed) {
      return urlStr.trim();
    }
    return fallbackUrl;
  }
}

/* ========================================================================== */
/*  T52: Workspace Trust Manager                                              */
/* ========================================================================== */

export class WorkspaceUntrustedError extends Error {
  constructor(public readonly workspaceUri: string, public readonly operation: TrustedOperation) {
    super(
      `Security violation: Operation "${operation}" is blocked because workspace "${workspaceUri}" is untrusted. Explicit user trust confirmation is required.`,
    );
    this.name = 'WorkspaceUntrustedError';
  }
}

export type WorkspaceTrustListener = (event: { uri: string; state: WorkspaceTrustState }) => void;

export class WorkspaceTrustManager {
  protected trustStates: Map<string, WorkspaceTrustState> = new Map();
  protected listeners: Set<WorkspaceTrustListener> = new Set();

  /**
   * Subscribe to trust state changes.
   */
  onDidTrustChange(listener: WorkspaceTrustListener): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  /**
   * Get the current trust state for a workspace URI.
   * Defaults to 'untrusted' for new/unrecognized workspaces (secure by default).
   */
  getTrustState(workspaceUri: string): WorkspaceTrustState {
    const normalized = this.normalizeUri(workspaceUri);
    return this.trustStates.get(normalized) ?? 'untrusted';
  }

  /**
   * Check if workspace is explicitly trusted.
   */
  isWorkspaceTrusted(workspaceUri: string): boolean {
    return this.getTrustState(workspaceUri) === 'trusted';
  }

  /**
   * Grant trust to a workspace.
   */
  grantTrust(workspaceUri: string): void {
    const normalized = this.normalizeUri(workspaceUri);
    this.trustStates.set(normalized, 'trusted');
    this.fireChange(normalized, 'trusted');
  }

  /**
   * Revoke trust from a workspace.
   */
  revokeTrust(workspaceUri: string): void {
    const normalized = this.normalizeUri(workspaceUri);
    this.trustStates.set(normalized, 'untrusted');
    this.fireChange(normalized, 'untrusted');
  }

  /**
   * Assert that a sensitive operation is allowed.
   * Throws WorkspaceUntrustedError if the workspace is not trusted.
   */
  assertOperationAllowed(workspaceUri: string, operation: TrustedOperation): void {
    if (!this.isWorkspaceTrusted(workspaceUri)) {
      throw new WorkspaceUntrustedError(workspaceUri, operation);
    }
  }

  /**
   * Check if a sensitive operation is permitted without throwing.
   */
  canExecute(workspaceUri: string, operation: TrustedOperation): boolean {
    const isTrusted = this.isWorkspaceTrusted(workspaceUri);
    if (isTrusted) {
      return true;
    }
    // Strict operation-level gating: untrusted workspaces NEVER allow execution of dangerous operations
    switch (operation) {
      case 'build_script':
      case 'server_autostart':
      case 'custom_toolchain':
      case 'remote_attach':
      case 'database_write':
        return false;
      default:
        return false;
    }
  }

  clear(): void {
    this.trustStates.clear();
  }

  protected normalizeUri(uri: string): string {
    let decoded = uri;
    try {
      decoded = decodeURI(uri);
    } catch {
      // ignore
    }
    const clean = decoded.replace(/\/+$/, '');
    // Normalize Windows drive letter paths, but preserve casing for Linux/Unix paths
    if (/^(file:\/\/\/)?[a-zA-Z]:[\\/]/i.test(clean)) {
      return clean.toLowerCase();
    }
    return clean;
  }

  protected fireChange(uri: string, state: WorkspaceTrustState): void {
    for (const listener of this.listeners) {
      try {
        listener({ uri, state });
      } catch {
        // Safe dispatch
      }
    }
  }
}

/* ========================================================================== */
/*  T53: Diagnostic Log Redactor & Credential Masking                         */
/* ========================================================================== */

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /pwd/i,
  /secret/i,
  /token/i,
  /bearer/i,
  /authorization/i,
  /private_?key/i,
  /credential/i,
  /api_?key/i,
];

export class DiagnosticLogRedactor {
  /**
   * Redact sensitive tokens and credentials from arbitrary log text.
   */
  static redactString(text: string): string {
    if (!text) return text;

    let result = text;

    // 1. X-Kairo-Secret headers: "X-Kairo-Secret: abc123xyz"
    result = result.replace(/(X-Kairo-Secret\s*[:=]\s*)([^\s\r\n,;]+)/gi, '$1[REDACTED]');

    // 2. Authorization headers: "Authorization: Bearer <token>" or "Authorization: Basic <hash>"
    result = result.replace(/(Authorization\s*[:=]\s*(?:Bearer|Basic)\s+)([^\s\r\n,;]+)/gi, '$1[REDACTED]');

    // 3. Query params: "?secret=xxx", "&token=xxx", "password=xxx"
    result = result.replace(/([?&](?:secret|token|password|pwd|api_?key|auth)=)([^&\s]+)/gi, '$1[REDACTED]');

    // 4. JDBC / connection string passwords: "password=secret", "pwd=secret"
    result = result.replace(/((?:password|pwd)\s*=\s*)([^\s;]+)/gi, '$1[REDACTED]');

    // 5. WebSocket subprotocols: '["kairo-secret-v1", "secret123"]' or '[\"kairo-secret-v1\", \"secret123\"]'
    result = result.replace(/(\["kairo-secret-v1",\s*")([^"]+)("\])/gi, '$1[REDACTED]$3');
    result = result.replace(/(\[\\"kairo-secret-v1\\",\s*\\")((?:[^"\\]|\\.)*)(\\"\])/gi, '$1[REDACTED]$3');

    // 6. JSON key-values (with unescaped quotes or escaped quotes)
    result = result.replace(/("(?:password|passwd|pwd|secret|token|bearer|authorization|private_?key|credential|api_?key)"\s*[:=]\s*")((?:[^"\\]|\\.)*?)(")/gi, '$1[REDACTED]$3');
    result = result.replace(/(\\"(?:password|passwd|pwd|secret|token|bearer|authorization|private_?key|credential|api_?key)\\"\s*[:=]\s*\\")((?:[^\\]|\\(?!"))*)(\\")/gi, '$1[REDACTED]$3');

    return result;
  }

  /**
   * Recursively redact an object before serialization or diagnostic logging.
   */
  static redactObject<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      if (typeof obj === 'string') {
        return this.redactString(obj) as unknown as T;
      }
      return obj;
    }

    if (obj instanceof Set) {
      const output = new Set<unknown>();
      for (const item of obj) {
        output.add(this.redactObject(item));
      }
      return output as unknown as T;
    }

    if (obj instanceof Map) {
      const output = new Map<unknown, unknown>();
      for (const [key, value] of obj.entries()) {
        const isSensitiveKey = typeof key === 'string' && SENSITIVE_KEY_PATTERNS.some(p => p.test(key));
        if (isSensitiveKey && value !== null && value !== undefined) {
          output.set(key, '[REDACTED]');
        } else {
          output.set(key, this.redactObject(value));
        }
      }
      return output as unknown as T;
    }

    if (obj instanceof Date || obj instanceof RegExp) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactObject(item)) as unknown as T;
    }

    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some(p => p.test(key));
      if (isSensitiveKey && value !== null && value !== undefined) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = this.redactObject(value);
      }
    }
    return output as T;
  }

  /**
   * Redact a URL string, masking sensitive query parameters.
   */
  static redactUrl(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (SENSITIVE_KEY_PATTERNS.some(p => p.test(key))) {
          parsed.searchParams.set(key, '[REDACTED]');
        }
      }
      return parsed.toString();
    } catch {
      return this.redactString(urlStr);
    }
  }
}
