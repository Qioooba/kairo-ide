/**
 * P3-REMOTE: Remote Sandbox Service
 *
 * Enforces workspace path isolation for remote sessions.
 * Each remote user can only access their assigned workspace roots.
 * All paths are validated against the sandbox before any file operation.
 *
 * Marked as "Experimental" — Phase 3 feature.
 */
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';

/** Sandbox configuration for a remote workspace. */
export interface RemoteSandboxConfig {
  /** Allowed workspace root paths */
  workspaceRoots: string[];
  /** Whether to allow absolute paths outside workspace roots */
  allowAbsolutePaths: boolean;
  /** Maximum file size for remote transfers (bytes) */
  maxFileSize: number;
  /** Forbidden path patterns */
  forbiddenPatterns: string[];
}

/** Result of a sandbox path check. */
export interface SandboxCheckResult {
  allowed: boolean;
  reason?: string;
  resolvedPath?: string;
}

const DEFAULT_SANDBOX: RemoteSandboxConfig = {
  workspaceRoots: [],
  allowAbsolutePaths: false,
  maxFileSize: 50 * 1024 * 1024, // 50 MB
  forbiddenPatterns: [
    '/etc/passwd',
    '/etc/shadow',
    '/proc/',
    '/sys/',
    '/dev/',
    '~/.ssh/',
    '~/.gnupg/',
    '.env',
    'credentials.json',
    '*.pem',
    '*.key',
  ],
};

@injectable()
export class RemoteSandboxService {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  private config: RemoteSandboxConfig = { ...DEFAULT_SANDBOX };

  @postConstruct()
  protected init(): void {
    this.logger.info('[RemoteSandbox] Initialized');
  }

  /** Configure the sandbox. */
  configure(config: Partial<RemoteSandboxConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('[RemoteSandbox] Configured with', this.config.workspaceRoots.length, 'roots');
  }

  /** Check if a path is allowed by the sandbox. */
  checkPath(path: string): SandboxCheckResult {
    // Normalize path
    const normalized = this.normalizePath(path);

    // Check forbidden patterns
    for (const pattern of this.config.forbiddenPatterns) {
      if (this.matchPattern(normalized, pattern)) {
        return {
          allowed: false,
          reason: `Path matches forbidden pattern: ${pattern}`,
        };
      }
    }

    // Check path traversal
    if (normalized.includes('..')) {
      return {
        allowed: false,
        reason: 'Path traversal detected',
      };
    }

    // Check workspace roots
    if (this.config.workspaceRoots.length > 0) {
      let withinRoot = false;
      for (const root of this.config.workspaceRoots) {
        const normalizedRoot = this.normalizePath(root);
        if (normalized.startsWith(normalizedRoot + '/') || normalized === normalizedRoot) {
          withinRoot = true;
          break;
        }
      }
      if (!withinRoot && !this.config.allowAbsolutePaths) {
        return {
          allowed: false,
          reason: `Path is outside allowed workspace roots`,
          resolvedPath: normalized,
        };
      }
    }

    return {
      allowed: true,
      resolvedPath: normalized,
    };
  }

  /** Check if a file size is within limits. */
  checkFileSize(size: number): SandboxCheckResult {
    if (size > this.config.maxFileSize) {
      return {
        allowed: false,
        reason: `File size ${size} exceeds maximum ${this.config.maxFileSize}`,
      };
    }
    return { allowed: true };
  }

  /** Validate a remote operation (path + size). */
  validateOperation(path: string, size?: number): SandboxCheckResult {
    const pathCheck = this.checkPath(path);
    if (!pathCheck.allowed) {
      return pathCheck;
    }
    if (size !== undefined) {
      return this.checkFileSize(size);
    }
    return pathCheck;
  }

  /** Get the sandbox configuration. */
  getConfig(): RemoteSandboxConfig {
    return { ...this.config };
  }

  private normalizePath(path: string): string {
    // Remove trailing slashes, normalize separators
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  private matchPattern(path: string, pattern: string): boolean {
    // Simple glob matching
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(regex).test(path) || path.includes(pattern);
  }
}