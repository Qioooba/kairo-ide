/**
 * Kairo Remote File System Provider.
 *
 * Implements Theia's FileSystemProvider interface for remote files
 * accessed via the remote Kairo Agent's HTTP API. Uses the
 * `kairo-remote://` URI scheme.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { ILogger } from '@theia/core/lib/common/logger';
import {
  FileSystemProvider,
  FileSystemProviderCapabilities,
  FileType,
  FileChange,
  Stat,
  WatchOptions,
  FileDeleteOptions,
  FileOverwriteOptions,
  FileWriteOptions,
} from '@theia/filesystem/lib/common/files';
import { KairoRemoteAgentService } from './kairo-remote-agent-service';

export const KAIRO_REMOTE_SCHEME = 'kairo-remote';

/** File size threshold for warning (bytes). */
const LARGE_FILE_WARN_BYTES = 10 * 1024 * 1024; // 10 MB

/** File size threshold for rejection (bytes). */
const LARGE_FILE_REJECT_BYTES = 50 * 1024 * 1024; // 50 MB

/** Max retry count for transient network errors. */
const MAX_RETRIES = 1;

/** Delay between retries (ms). */
const RETRY_DELAY_MS = 500;

interface RemoteStat {
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
  ctime: number;
}

interface RemoteDirectoryEntry {
  name: string;
  type: 'file' | 'directory';
}

@injectable()
export class KairoRemoteFileSystemProvider implements FileSystemProvider {
  @inject(KairoRemoteAgentService)
  protected readonly agent!: KairoRemoteAgentService;

  @inject(ILogger)
  protected readonly logger!: ILogger;

  // FileSystemProviderCapabilities.FileReadWrite (2) |
  // FileSystemProviderCapabilities.FileFolderCopy (8)
  readonly capabilities: FileSystemProviderCapabilities = 2 | 8;
  readonly onDidChangeCapabilities = Event.None;
  readonly onDidChangeFile: Event<readonly FileChange[]> = Event.None;
  readonly onFileWatchError = Event.None;

  protected readonly toDispose = new DisposableCollection();

  watch(_resource: URI, _opts: WatchOptions): Disposable {
    return Disposable.NULL;
  }

  async stat(resource: URI): Promise<Stat> {
    const path = this.toRemotePath(resource);
    try {
      const s = await this.agent.apiRequest<RemoteStat>('GET', `/api/v1/files/stat?path=${encodeURIComponent(path)}`);
      return {
        type: s.type === 'directory' ? FileType.Directory : FileType.File,
        ctime: s.ctime,
        mtime: s.mtime,
        size: s.size,
      };
    } catch (err) {
      throw this.handleApiError(err, `stat`, path);
    }
  }

  async mkdir(resource: URI): Promise<void> {
    const path = this.toRemotePath(resource);
    try {
      await this.agent.apiRequest('POST', `/api/v1/files/mkdir`, { path });
    } catch (err) {
      throw this.handleApiError(err, `mkdir`, path);
    }
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    const path = this.toRemotePath(resource);
    try {
      const entries = await this.agent.apiRequest<RemoteDirectoryEntry[]>('GET', `/api/v1/files/list?path=${encodeURIComponent(path)}`);
      // Handle empty directories gracefully
      if (!entries || entries.length === 0) {
        this.logger.info(`[kairo-remote-fs] Empty directory: ${path}`);
        return [];
      }
      return entries.map(e => [
        e.name,
        e.type === 'directory' ? FileType.Directory : FileType.File,
      ]);
    } catch (err) {
      throw this.handleApiError(err, `readdir`, path);
    }
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    const path = this.toRemotePath(resource);

    // Check file size before reading
    try {
      const fileStat = await this.agent.apiRequest<RemoteStat>('GET', `/api/v1/files/stat?path=${encodeURIComponent(path)}`);
      if (fileStat.size > LARGE_FILE_REJECT_BYTES) {
        const sizeMB = (fileStat.size / (1024 * 1024)).toFixed(1);
        throw new Error(`File too large (${sizeMB} MB). Maximum supported size is ${LARGE_FILE_REJECT_BYTES / (1024 * 1024)} MB.`);
      }
      if (fileStat.size > LARGE_FILE_WARN_BYTES) {
        const sizeMB = (fileStat.size / (1024 * 1024)).toFixed(1);
        this.logger.warn(`[kairo-remote-fs] Reading large file (${sizeMB} MB): ${path}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('File too large')) {
        throw err;
      }
      // If stat fails, try reading anyway
    }

    try {
      const data = await this.retryRequest<{ content: string; encoding: string }>(
        () => this.agent.apiRequest<{ content: string; encoding: string }>('GET', `/api/v1/files/read?path=${encodeURIComponent(path)}`),
      );
      // The remote API returns base64-encoded content
      if (data.encoding === 'base64') {
        const binary = atob(data.content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      }
      return new TextEncoder().encode(data.content);
    } catch (err) {
      throw this.handleApiError(err, `readFile`, path);
    }
  }

  async writeFile(resource: URI, content: Uint8Array, _opts: FileWriteOptions): Promise<void> {
    const path = this.toRemotePath(resource);

    // Check content size
    if (content.length > LARGE_FILE_REJECT_BYTES) {
      const sizeMB = (content.length / (1024 * 1024)).toFixed(1);
      throw new Error(`File too large (${sizeMB} MB). Maximum supported size is ${LARGE_FILE_REJECT_BYTES / (1024 * 1024)} MB.`);
    }
    if (content.length > LARGE_FILE_WARN_BYTES) {
      const sizeMB = (content.length / (1024 * 1024)).toFixed(1);
      this.logger.warn(`[kairo-remote-fs] Writing large file (${sizeMB} MB): ${path}`);
    }

    try {
      // Send as base64 to preserve binary content
      let binary = '';
      for (let i = 0; i < content.length; i++) {
        binary += String.fromCharCode(content[i]);
      }
      const base64Content = btoa(binary);
      await this.retryRequest<void>(
        () => this.agent.apiRequest('POST', `/api/v1/files/write`, {
          path,
          content: base64Content,
          encoding: 'base64',
        }),
      );
    } catch (err) {
      throw this.handleApiError(err, `writeFile`, path);
    }
  }

  async delete(resource: URI, _opts: FileDeleteOptions): Promise<void> {
    const path = this.toRemotePath(resource);
    try {
      await this.agent.apiRequest('DELETE', `/api/v1/files/delete?path=${encodeURIComponent(path)}`);
    } catch (err) {
      throw this.handleApiError(err, `delete`, path);
    }
  }

  async rename(from: URI, to: URI, _opts: FileOverwriteOptions): Promise<void> {
    const fromPath = this.toRemotePath(from);
    const toPath = this.toRemotePath(to);
    try {
      await this.agent.apiRequest('POST', `/api/v1/files/rename`, {
        from: fromPath,
        to: toPath,
      });
    } catch (err) {
      throw this.handleApiError(err, `rename`, fromPath);
    }
  }

  async copy(from: URI, to: URI, _opts: FileOverwriteOptions): Promise<void> {
    const fromPath = this.toRemotePath(from);
    const toPath = this.toRemotePath(to);
    try {
      await this.agent.apiRequest('POST', `/api/v1/files/copy`, {
        from: fromPath,
        to: toPath,
      });
    } catch (err) {
      throw this.handleApiError(err, `copy`, fromPath);
    }
  }

  dispose(): void {
    this.toDispose.dispose();
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                             */
  /* ------------------------------------------------------------------ */

  protected toRemotePath(uri: URI): string {
    // Strip the kairo-remote:// scheme and authority, return the path
    const path = uri.path.toString();
    // Remove leading slash if present
    return path.startsWith('/') ? path.slice(1) : path;
  }

  /** Build a kairo-remote:// URI from a remote workspace-relative path. */
  static buildUri(workspacePath: string, relativePath: string): URI {
    const encoded = encodeURI(relativePath);
    return new URI(`${KAIRO_REMOTE_SCHEME}://${workspacePath}/${encoded}`);
  }

  /* ------------------------------------------------------------------ */
  /*  Error Handling                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Handle API errors and convert them to user-friendly messages.
   * Detects connection loss, 404, 403, and other errors.
   */
  protected handleApiError(err: unknown, operation: string, path: string): Error {
    const msg = err instanceof Error ? err.message : String(err);

    // Connection loss / network errors
    if (msg.includes('Not connected') || msg.includes('Network error') || msg.includes('Unable to reach')) {
      this.logger.error(`[kairo-remote-fs] Connection lost during ${operation} on ${path}: ${msg}`);
      return new Error(`Connection lost: Cannot ${operation} remote file. Please check your connection to the remote agent.`);
    }

    // File not found (404)
    if (msg.includes('not found') || msg.includes('404')) {
      this.logger.warn(`[kairo-remote-fs] File not found during ${operation}: ${path}`);
      return new Error(`File not found: ${path}`);
    }

    // Permission denied (403)
    if (msg.includes('Permission denied') || msg.includes('403') || msg.includes('do not have access')) {
      this.logger.warn(`[kairo-remote-fs] Permission denied during ${operation}: ${path}`);
      return new Error(`Permission denied: Cannot ${operation} ${path}`);
    }

    // Generic error
    this.logger.error(`[kairo-remote-fs] Error during ${operation} on ${path}: ${msg}`);
    return new Error(`Remote file operation failed: ${msg}`);
  }

  /**
   * Retry a request on transient network errors.
   */
  protected async retryRequest<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        this.logger.info(`[kairo-remote-fs] Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms`);
        await this.delay(RETRY_DELAY_MS);
      }

      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!this.isTransientError(lastError)) {
          throw lastError;
        }
        this.logger.warn(`[kairo-remote-fs] Transient error (attempt ${attempt + 1}): ${lastError.message}`);
      }
    }

    throw lastError!;
  }

  /** Check if an error is transient and should be retried. */
  protected isTransientError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('connection lost') ||
      msg.includes('temporarily unavailable')
    );
  }

  /** Delay helper. */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}