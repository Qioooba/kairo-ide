/**
 * Workspace file index via the Agent ListFiles API.
 * Used by Find File and Search Everywhere so frontend never walks large trees.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import type { FileListEntry, FileListResponse } from '@kairo/protocol';
import { RuntimeConnectionService } from '@kairo/runtime-extension';

export interface FileIndexOptions {
  workspaceId: string;
  rootPath?: string;
  include?: string[];
  exclude?: string[];
  maxFiles?: number;
  signal?: AbortSignal;
}

@injectable()
export class FileIndexService {
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  protected cache: { key: string; files: FileListEntry[]; at: number } | undefined;
  protected inFlight = new Map<string, Promise<FileListEntry[]>>();
  public static readonly TTL_MS = 60_000;
  protected static readonly MAX_STALE_MS = 300_000;

  async listFiles(opts: FileIndexOptions): Promise<FileListEntry[]> {
    const key = JSON.stringify({
      workspaceId: opts.workspaceId,
      rootPath: opts.rootPath ?? '',
      include: opts.include ?? [],
      exclude: opts.exclude ?? [],
      maxFiles: opts.maxFiles ?? 50_000,
    });

    const now = Date.now();
    if (this.cache && this.cache.key === key) {
      const age = now - this.cache.at;
      if (age < FileIndexService.TTL_MS) {
        return this.cache.files;
      }
      if (age < FileIndexService.MAX_STALE_MS) {
        // Stale-while-revalidate: return immediately and refresh in background
        this.revalidateInBackground(key, opts);
        return this.cache.files;
      }
    }

    if (this.inFlight.has(key)) {
      return this.inFlight.get(key)!;
    }

    const fetchPromise = this.fetchFiles(key, opts);
    this.inFlight.set(key, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  protected async fetchFiles(key: string, opts: FileIndexOptions): Promise<FileListEntry[]> {
    const response = await this.runtime.request('POST /api/v1/search/files', {
      workspaceId: opts.workspaceId,
      rootPath: opts.rootPath,
      include: opts.include,
      exclude: opts.exclude,
      maxFiles: opts.maxFiles ?? 50_000,
    }, { signal: opts.signal }) as FileListResponse;

    const files = response?.files ?? [];
    this.cache = { key, files, at: Date.now() };
    return files;
  }

  protected revalidateInBackground(key: string, opts: FileIndexOptions): void {
    if (this.inFlight.has(key)) return;
    const fetchPromise = this.fetchFiles(key, { ...opts, signal: undefined })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, fetchPromise);
  }

  invalidate(): void {
    this.cache = undefined;
    this.inFlight.clear();
  }
}
