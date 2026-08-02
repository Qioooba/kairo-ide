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
  protected static readonly TTL_MS = 15_000;

  async listFiles(opts: FileIndexOptions): Promise<FileListEntry[]> {
    const key = JSON.stringify({
      workspaceId: opts.workspaceId,
      rootPath: opts.rootPath ?? '',
      include: opts.include ?? [],
      exclude: opts.exclude ?? [],
      maxFiles: opts.maxFiles ?? 50_000,
    });
    if (this.cache && this.cache.key === key && Date.now() - this.cache.at < FileIndexService.TTL_MS) {
      return this.cache.files;
    }

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

  invalidate(): void {
    this.cache = undefined;
  }
}
