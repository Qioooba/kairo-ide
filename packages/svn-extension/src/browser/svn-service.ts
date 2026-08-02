// SPDX-License-Identifier: Apache-2.0
//
// Kairo SvnService (browser side) — delegates all child_process / fs work
// to the backend SvnBackendServiceImpl via JSON-RPC, mirroring the
// JavaLanguageClient pattern used in java-extension so we never hit the
// browser's JSPM child_process shim.

import { injectable, inject, postConstruct, optional } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider';
import * as path from 'node:path';
import {
  SvnBackendService,
  SvnBackendPath,
  SvnFrontendClient,
} from '../common/svn-protocol';
import {
  SvnInstallation,
  SvnStatusEntry,
  SvnCommitInfo,
  SvnLogEntry,
  SvnBlameLine,
  SvnDiffOptions,
  RepoEntry,
  FolderDiffResult,
  FolderDiffEntry,
  SvnFileStatus,
  SvnCredential,
  SvnResolveChoice,
  SvnInfo,
} from './svn-types';
import { parseListXml } from './svn-parser';

export { SvnFileStatus } from './svn-types';
export type {
  SvnStatusEntry,
  SvnInfo as SvnWorkingCopyInfo,
  SvnCommitInfo,
  SvnLogEntry,
  SvnBlameLine,
  SvnDiffOptions,
  SvnChangedPath,
  RepoEntry,
  FolderDiffResult,
  SvnInstallation,
  SvnCredential as SvnCredentials,
  SvnProgressEvent,
} from './svn-types';

export interface SvnStatusRefreshOptions {
  ignoreCache?: boolean;
}

@injectable()
export class SvnService implements SvnFrontendClient {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(WebSocketConnectionProvider)
  @optional()
  protected readonly connectionProvider?: WebSocketConnectionProvider;

  // Single-process fallback (unit tests): bind the real SvnBackendServiceImpl directly
  @inject(SvnBackendService)
  @optional()
  protected readonly directBackend?: SvnBackendService;

  protected readonly onDidChangeStatusEmitter = new Emitter<SvnStatusEntry[]>();
  readonly onDidChangeStatus: Event<SvnStatusEntry[]> = this.onDidChangeStatusEmitter.event;

  protected readonly onDidCommitSuccessEmitter = new Emitter<SvnCommitInfo>();
  readonly onDidCommitSuccess: Event<SvnCommitInfo> = this.onDidCommitSuccessEmitter.event;

  protected readonly onDidUpdateCompleteEmitter = new Emitter<{ revision: number; updated: number }>();
  readonly onDidUpdateComplete: Event<{ revision: number; updated: number }> = this.onDidUpdateCompleteEmitter.event;

  protected readonly onSvnAvailabilityChangeEmitter = new Emitter<boolean>();
  readonly onSvnAvailabilityChange: Event<boolean> = this.onSvnAvailabilityChangeEmitter.event;

  protected readonly onDidChangeWcRootEmitter = new Emitter<string | undefined>();
  readonly onDidChangeWcRoot: Event<string | undefined> = this.onDidChangeWcRootEmitter.event;

  protected readonly onDiffRequestEmitter = new Emitter<{ filePath: string; baseRevision?: string | number; targetRevision?: string | number; }>();
  readonly onDiffRequest: Event<{ filePath: string; baseRevision?: string | number; targetRevision?: string | number; }> = this.onDiffRequestEmitter.event;

  protected readonly onHistoryRequestEmitter = new Emitter<{ filePath: string }>();
  readonly onHistoryRequest: Event<{ filePath: string }> = this.onHistoryRequestEmitter.event;

  /** Backend → browser notification (SvnFrontendClient). */
  onCommandEvent(event: { id: string; kind: 'start' | 'end' | 'error'; args: string[]; cwd: string }): void {
    this.logger.debug('[svn] command event', event);
  }

  protected activeWcRoot: string | undefined;
  protected wcInfo: SvnInfo | undefined;
  protected cachedStatus: SvnStatusEntry[] = [];
  protected pollingTimer: ReturnType<typeof setInterval> | undefined;
  protected svnAvailable = false;
  protected cachedInstallation: SvnInstallation | undefined;
  protected credentials: SvnCredential | undefined;

  /** JSON-RPC proxy to the backend; created lazily. */
  protected rpcProxy: SvnBackendService | undefined;
  protected rpcFailed = false;

  @postConstruct()
  protected init(): void {
    this.detectSvn().catch(() => {/* ignore */});
  }

  dispose(): void {
    this.stopStatusPolling();
    this.onDidChangeStatusEmitter.dispose();
    this.onDidCommitSuccessEmitter.dispose();
    this.onDidUpdateCompleteEmitter.dispose();
    this.onSvnAvailabilityChangeEmitter.dispose();
    this.onDidChangeWcRootEmitter.dispose();
    this.onDiffRequestEmitter.dispose();
    this.onHistoryRequestEmitter.dispose();
  }

  // ---------------------------------------------------------------------------
  // Backend proxy management (mirrors JavaLanguageClient pattern)
  // ---------------------------------------------------------------------------

  protected proxy(): SvnBackendService | undefined {
    // Only use directBackend if it is actually a backend service instance
    // (has RPC methods). In browser builds the DI container can bind
    // SvnBackendService to a stub Function which would silently cause all
    // $-prefixed calls to return undefined, so we guard against it.
    if (this.directBackend && typeof this.directBackend === 'object' && typeof (this.directBackend as any).$detectSvn === 'function') {
      return this.directBackend;
    }
    if (this.rpcFailed || !this.connectionProvider) return undefined;
    if (!this.rpcProxy) {
      try {
        this.rpcProxy = this.connectionProvider.createProxy<SvnBackendService>(SvnBackendPath, this);
      } catch (err) {
        this.logger.warn(`[SvnService] backend proxy unavailable: ${String(err)}`);
        this.rpcFailed = true;
        return undefined;
      }
    }
    return this.rpcProxy;
  }

  protected markRpcFailed(err: unknown): void {
    this.rpcFailed = true;
    this.rpcProxy = undefined;
    this.logger.warn(`[SvnService] backend RPC failed, falling back: ${String(err)}`);
  }

  protected requireProxy(): SvnBackendService {
    const p = this.proxy();
    if (!p) throw new Error('SVN backend service is unavailable (no WebSocket connection or handler)');
    return p;
  }

  // ---------------------------------------------------------------------------
  // Detection / availability
  // ---------------------------------------------------------------------------

  isSvnAvailable(): boolean {
    return this.svnAvailable;
  }

  getSvnInstallation(): SvnInstallation | undefined {
    return this.cachedInstallation;
  }

  async detectSvn(): Promise<void> {
    try {
      const p = this.proxy();
      if (!p) {
        this.svnAvailable = false;
        return;
      }
      const installation = await p.$detectSvn();
      this.cachedInstallation = installation || undefined;
      const wasAvailable = this.svnAvailable;
      this.svnAvailable = !!installation;
      if (wasAvailable !== this.svnAvailable) {
        this.onSvnAvailabilityChangeEmitter.fire(this.svnAvailable);
      }
    } catch (e) {
      this.markRpcFailed(e);
      this.logger.error('SVN detection failed:', e);
      this.svnAvailable = false;
    }
  }

  setCredentials(credentials: SvnCredential | undefined): void {
    this.credentials = credentials;
    this.proxy()?.$setCredentials(credentials).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // WC discovery
  // ---------------------------------------------------------------------------

  async findWcRoot(cwd: string): Promise<string | undefined> {
    if (!this.svnAvailable) {
      await this.detectSvn();
      if (!this.svnAvailable) return undefined;
    }
    try {
      return await this.requireProxy().$findWcRoot(cwd);
    } catch (e) {
      this.markRpcFailed(e);
      return undefined;
    }
  }

  async getWcInfo(p?: string): Promise<SvnInfo | undefined> {
    const cwd = p || this.activeWcRoot;
    if (!cwd) return undefined;
    try {
      return await this.requireProxy().$getWcInfo(cwd);
    } catch (_e) {
      return undefined;
    }
  }

  setActiveWcRoot(root: string | undefined): void {
    const previous = this.activeWcRoot;
    this.activeWcRoot = root;
    if (root) {
      this.refreshStatus().catch(() => {});
      this.startStatusPolling();
    } else {
      this.stopStatusPolling();
      this.cachedStatus = [];
      this.wcInfo = undefined;
    }
    if (previous !== root) {
      this.onDidChangeWcRootEmitter.fire(root);
    }
  }

  getActiveWcRoot(): string | undefined {
    return this.activeWcRoot;
  }

  getWcInfoCache(): SvnInfo | undefined {
    return this.wcInfo;
  }

  // ---------------------------------------------------------------------------
  // Polling + status
  // ---------------------------------------------------------------------------

  startStatusPolling(interval: number = 3000): void {
    this.stopStatusPolling();
    this.pollingTimer = setInterval(() => {
      if (this.activeWcRoot) {
        this.refreshStatus().catch(() => {});
      }
    }, interval);
  }

  stopStatusPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  async refreshStatus(_options: SvnStatusRefreshOptions = {}): Promise<SvnStatusEntry[]> {
    if (!this.activeWcRoot) return [];
    try {
      const entries = await this.requireProxy().$getStatus(this.activeWcRoot);
      this.cachedStatus = entries;
      this.onDidChangeStatusEmitter.fire(entries);
      // Always refresh WC info so revision / URL stay current after update/commit.
      this.wcInfo = await this.getWcInfo(this.activeWcRoot) || undefined;
      return entries;
    } catch (_e) {
      return this.cachedStatus;
    }
  }

  /** Incoming changes from the repository (`svn status -u`). */
  async getIncomingStatus(): Promise<SvnStatusEntry[]> {
    if (!this.activeWcRoot) return [];
    try {
      const entries = await this.requireProxy().$getStatus(this.activeWcRoot, true);
      return entries.filter(e =>
        !!e.reposStatus &&
        e.reposStatus !== SvnFileStatus.Normal &&
        e.reposStatus !== SvnFileStatus.None,
      );
    } catch {
      return [];
    }
  }

  getCachedStatus(): SvnStatusEntry[] {
    return this.cachedStatus;
  }

  getFileStatus(relPath: string): SvnStatusEntry | undefined {
    const normalized = relPath.replace(/\\/g, '/');
    return this.cachedStatus.find(s => s.path === normalized || s.path === relPath);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async update(paths?: string[], options?: {
    revision?: number;
    depth?: 'infinity' | 'immediates' | 'files' | 'empty';
    accept?: 'postpone' | 'working' | 'base' | 'mine-conflict' | 'theirs-conflict' | 'mine-full' | 'theirs-full';
  }): Promise<{ revision: number; updatedFiles: number }> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    const args = ['update'];
    if (options?.revision) args.push('-r', String(options.revision));
    if (options?.depth) args.push('--depth', options.depth);
    if (options?.accept) args.push('--accept', options.accept);
    if (paths && paths.length > 0) args.push(...paths);
    const { stdout } = await this.requireProxy().$exec(args, this.activeWcRoot, 'write');
    let revision = 0;
    let updatedFiles = 0;
    for (const line of stdout.split('\n')) {
      const revMatch = line.match(/(?:At|Updated to) revision (\d+)/);
      if (revMatch) revision = parseInt(revMatch[1], 10);
      if (/^[ADUGRC]\s/.test(line.trim())) updatedFiles++;
    }
    await this.refreshStatus({ ignoreCache: true });
    this.onDidUpdateCompleteEmitter.fire({ revision, updated: updatedFiles });
    return { revision, updatedFiles };
  }

  async commit(paths: string[], message: string, options?: {
    keepLocks?: boolean;
    changelist?: string;
  }): Promise<SvnCommitInfo> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    if (!message || !message.trim()) throw new Error('Commit message is required');
    const conflicted = this.cachedStatus.filter(s => s.status === SvnFileStatus.Conflict);
    if (conflicted.length > 0) {
      throw new Error(`Cannot commit: ${conflicted.length} conflicted file(s) must be resolved first`);
    }
    const args = ['commit', '-m', message];
    if (options?.keepLocks) args.push('--no-unlock');
    if (options?.changelist) args.push('--changelist', options.changelist);
    else args.push(...paths);
    const { stdout } = await this.requireProxy().$exec(args, this.activeWcRoot, 'write');
    const revMatch = stdout.match(/Committed revision (\d+)/);
    const revision = revMatch ? parseInt(revMatch[1], 10) : 0;
    const commitInfo: SvnCommitInfo = {
      revision,
      author: this.credentials?.username || '',
      date: new Date(),
      message,
      changedPaths: paths.map(p => {
        const status = this.getFileStatus(p);
        let action: 'A' | 'M' | 'D' | 'R' = 'M';
        if (status) {
          if (status.status === 'added' || status.status === 'unversioned') action = 'A';
          else if (status.status === 'deleted') action = 'D';
          else if (status.status === 'replaced') action = 'R';
        }
        return { path: p, action };
      }),
    };
    await this.refreshStatus({ ignoreCache: true });
    this.onDidCommitSuccessEmitter.fire(commitInfo);
    return commitInfo;
  }

  async add(paths: string[]): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$add(this.activeWcRoot, paths);
    await this.refreshStatus();
  }

  async revert(paths: string[]): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$revert(this.activeWcRoot, paths);
    await this.refreshStatus();
  }

  async cleanup(path?: string): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$cleanup(path || this.activeWcRoot);
    await this.refreshStatus();
  }

  async delete(paths: string[], options?: { force?: boolean }): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$delete(this.activeWcRoot, paths, !!options?.force);
    await this.refreshStatus();
  }

  async resolve(filePath: string, options?: {
    accept: SvnResolveChoice;
    recursive?: boolean;
  }): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    const paths = options?.recursive ? [filePath] : [filePath];
    await this.requireProxy().$resolve(this.activeWcRoot, paths, options?.accept || 'working');
    await this.refreshStatus();
  }

  async lock(paths: string[], comment?: string, stealLock = false): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$lock(this.activeWcRoot, paths, comment, stealLock);
    await this.refreshStatus();
  }

  async unlock(paths: string[], breakLock = false): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$unlock(this.activeWcRoot, paths, breakLock);
    await this.refreshStatus();
  }

  async ignore(paths: string[], _ignore = true): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    // Compute basename patterns for each input path
    const patterns = paths.map(p => {
      try {
        const base = path.basename(p);
        return base || p;
      } catch { return p; }
    });
    await this.requireProxy().$ignore(this.activeWcRoot, patterns);
    await this.refreshStatus();
  }

  // ---------------------------------------------------------------------------
  // History / annotate / diff
  // ---------------------------------------------------------------------------

  async getLog(p?: string, options?: {
    startRevision?: number;
    endRevision?: number;
    limit?: number;
    author?: string;
    searchMessage?: string;
    stopOnCopy?: boolean;
    includeChangedPaths?: boolean;
  }): Promise<SvnLogEntry[]> {
    const cwd = this.activeWcRoot;
    if (!cwd) return [];
    try {
      const revision =
        options?.startRevision !== undefined && options?.endRevision !== undefined
          ? `${options.startRevision}:${options.endRevision}`
          : options?.startRevision !== undefined
            ? String(options.startRevision)
            : undefined;
      const files = p ? [p] : [];
      let entries = await this.requireProxy().$getLog(cwd, files, options?.limit || 100, revision);
      if (options?.author) entries = entries.filter(e => e.author === options.author);
      if (options?.searchMessage) {
        const q = options.searchMessage.toLowerCase();
        entries = entries.filter(e => e.message.toLowerCase().includes(q));
      }
      return entries;
    } catch { return []; }
  }

  async getLogEntry(revision: number, p?: string): Promise<SvnLogEntry | undefined> {
    const entries = await this.getLog(p, { startRevision: revision, endRevision: revision, limit: 1, includeChangedPaths: true });
    return entries[0];
  }

  async annotate(filePath: string, options?: {
    startRevision?: number;
    ignoreWhitespace?: boolean;
  }): Promise<SvnBlameLine[]> {
    const cwd = this.activeWcRoot;
    if (!cwd) return [];
    try {
      let lines = await this.requireProxy().$annotate(
        cwd,
        filePath,
        options?.startRevision ? String(options.startRevision) : undefined,
      );
      // Try to attach content by catting the file through backend
      try {
        const { stdout } = await this.requireProxy().$exec(['cat', filePath], cwd, 'read');
        const fileLines = stdout.split('\n');
        lines = lines.map((ln, idx) => ({
          ...ln,
          line: idx + 1,
          content: fileLines[idx] || '',
        }));
      } catch { /* ignore content fetch failure */ }
      return lines;
    } catch { return []; }
  }

  async getDiff(filePath: string, options?: SvnDiffOptions): Promise<string> {
    const cwd = this.activeWcRoot;
    if (!cwd) return '';
    try {
      const revision =
        options?.oldRevision !== undefined && options?.revision !== undefined
          ? `${options.oldRevision}:${options.revision}`
          : options?.revision !== undefined
            ? String(options.revision)
            : undefined;
      const r = await this.requireProxy().$getDiff(cwd, [filePath], revision);
      return r.content || '';
    } catch { return ''; }
  }

  async getUnifiedDiff(filePath: string, options?: SvnDiffOptions): Promise<string> {
    return this.getDiff(filePath, options);
  }

  async getFolderDiff(url1: string, rev1: number, url2: string, rev2: number): Promise<FolderDiffResult> {
    try {
      const args = ['diff', '--summarize', '--xml', `${url1}@${rev1}`, `${url2}@${rev2}`];
      const cwd = this.activeWcRoot || '/';
      const { stdout } = await this.requireProxy().$exec(args, cwd, 'read');
      const entries: FolderDiffEntry[] = [];
      const pathRegex = /<path[^>]*item="([^"]*)"[^>]*>([^<]*)<\/path>/g;
      let match;
      while ((match = pathRegex.exec(stdout)) !== null) {
        const item = match[1];
        const status: FolderDiffEntry['status'] =
          item === 'added' ? 'added' :
          item === 'deleted' ? 'deleted' :
          item === 'modified' ? 'modified' : 'none';
        entries.push({ path: match[2], status });
      }
      return { entries };
    } catch { return { entries: [] }; }
  }

  // ---------------------------------------------------------------------------
  // Checkout / switch / branch ops
  // ---------------------------------------------------------------------------

  async checkout(url: string, checkoutPath: string, options?: {
    revision?: number;
    username?: string;
    password?: string;
  }): Promise<void> {
    if (options?.username || options?.password) {
      await this.requireProxy().$setCredentials({
        username: options?.username || '',
        password: options?.password || '',
      });
    }
    await this.requireProxy().$checkout(url, checkoutPath, options?.revision ? String(options.revision) : undefined);
  }

  async switch(url: string, options?: {
    revision?: number;
    force?: boolean;
  }): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    const args = ['switch'];
    if (options?.revision) args.push('-r', String(options.revision));
    if (options?.force) args.push('--force');
    args.push(url);
    await this.requireProxy().$exec(args, this.activeWcRoot, 'write');
    await this.refreshStatus({ ignoreCache: true });
  }

  async copy(src: string, dst: string, options?: {
    message?: string;
    revision?: number;
    parents?: boolean;
  }): Promise<SvnCommitInfo> {
    const cwd = this.activeWcRoot;
    if (!cwd) throw new Error('No active SVN working copy');
    const args = ['copy'];
    if (options?.revision) args.push('-r', String(options.revision));
    if (options?.parents) args.push('--parents');
    if (options?.message) args.push('-m', options.message);
    args.push(src, dst);
    const { stdout } = await this.requireProxy().$exec(args, cwd, 'write');
    const revMatch = stdout.match(/Committed revision (\d+)/);
    await this.refreshStatus({ ignoreCache: true });
    return {
      revision: revMatch ? parseInt(revMatch[1], 10) : 0,
      author: this.credentials?.username || '',
      date: new Date(),
      message: options?.message || '',
      changedPaths: [{ path: dst, action: 'A' }],
    };
  }

  async listRepository(url: string, options?: {
    revision?: number;
    depth?: 'immediates' | 'infinity';
  }): Promise<RepoEntry[]> {
    const cwd = this.activeWcRoot || '/';
    const args = ['list', '--xml'];
    if (options?.revision) args.push('-r', String(options.revision));
    if (options?.depth === 'immediates') args.push('--depth', 'immediates');
    args.push(url);
    try {
      const { stdout } = await this.requireProxy().$exec(args, cwd, 'read');
      return parseListXml(stdout);
    } catch { return []; }
  }

  async mkdir(url: string, message?: string, parents?: boolean): Promise<SvnCommitInfo> {
    const cwd = this.activeWcRoot || '/';
    const args = ['mkdir'];
    if (parents) args.push('--parents');
    if (message) args.push('-m', message);
    args.push(url);
    const { stdout } = await this.requireProxy().$exec(args, cwd, 'write');
    const revMatch = stdout.match(/Committed revision (\d+)/);
    return {
      revision: revMatch ? parseInt(revMatch[1], 10) : 0,
      author: this.credentials?.username || '',
      date: new Date(),
      message: message || '',
      changedPaths: [{ path: url, action: 'A' }],
    };
  }

  async addToChangelist(paths: string[], changelist: string): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$exec(['changelist', changelist, ...paths], this.activeWcRoot, 'write');
    await this.refreshStatus();
  }

  async removeFromChangelist(paths: string[]): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$exec(['changelist', '--remove', ...paths], this.activeWcRoot, 'write');
    await this.refreshStatus();
  }

  async getChangelists(): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!this.activeWcRoot) return result;
    for (const entry of this.cachedStatus) {
      if (entry.changelist) {
        if (!result.has(entry.changelist)) result.set(entry.changelist, []);
        result.get(entry.changelist)!.push(entry.path);
      }
    }
    return result;
  }

  async export(src: string, dstPath: string, options?: {
    revision?: number;
    force?: boolean;
  }): Promise<void> {
    const cwd = this.activeWcRoot || '/';
    const args = ['export'];
    if (options?.revision) args.push('-r', String(options.revision));
    if (options?.force) args.push('--force');
    args.push(src, dstPath);
    await this.requireProxy().$exec(args, cwd, 'write');
  }

  getBranchNameFromUrl(url: string): string {
    if (!url) return '';
    const parts = url.replace(/\/$/, '').split('/');
    return parts[parts.length - 1] || '';
  }

  async merge(sourceUrl: string, revisionRange?: string, options?: {
    dryRun?: boolean;
    recordOnly?: boolean;
    force?: boolean;
  }): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    const args = ['merge'];
    if (options?.dryRun) args.push('--dry-run');
    if (options?.recordOnly) args.push('--record-only');
    if (options?.force) args.push('--force');
    if (revisionRange) args.push('-r', revisionRange);
    args.push(sourceUrl);
    await this.requireProxy().$exec(args, this.activeWcRoot, 'write');
    await this.refreshStatus();
  }

  async importFile(filePath: string, repoUrl: string, message?: string): Promise<SvnCommitInfo> {
    const cwd = this.activeWcRoot || '/';
    const args = ['import'];
    if (message) args.push('-m', message);
    args.push(filePath, repoUrl);
    const { stdout } = await this.requireProxy().$exec(args, cwd, 'write');
    const revMatch = stdout.match(/Committed revision (\d+)/);
    return {
      revision: revMatch ? parseInt(revMatch[1], 10) : 0,
      author: this.credentials?.username || '',
      date: new Date(),
      message: message || '',
      changedPaths: [{ path: filePath, action: 'A' }],
    };
  }

  async move(src: string, dst: string, options?: { force?: boolean; parents?: boolean }): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    const args = ['move'];
    if (options?.force) args.push('--force');
    if (options?.parents) args.push('--parents');
    args.push(src, dst);
    await this.requireProxy().$exec(args, this.activeWcRoot, 'write');
    await this.refreshStatus();
  }

  async removeFromRepo(urls: string[], message?: string): Promise<SvnCommitInfo> {
    const cwd = this.activeWcRoot || '/';
    const args = ['remove'];
    if (message) args.push('-m', message);
    args.push(...urls);
    const { stdout } = await this.requireProxy().$exec(args, cwd, 'write');
    const revMatch = stdout.match(/Committed revision (\d+)/);
    return {
      revision: revMatch ? parseInt(revMatch[1], 10) : 0,
      author: this.credentials?.username || '',
      date: new Date(),
      message: message || '',
      changedPaths: urls.map(u => ({ path: u, action: 'D' as const })),
    };
  }

  async getIgnoredPatterns(dirPath: string): Promise<string[]> {
    try {
      const { stdout } = await this.requireProxy().$exec(
        ['propget', 'svn:ignore', dirPath],
        this.activeWcRoot || dirPath,
        'read',
      );
      return stdout.trim().split('\n').filter(l => l.length > 0);
    } catch { return []; }
  }

  async setIgnoredPatterns(dirPath: string, patterns: string[]): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$ignore(this.activeWcRoot, patterns);
    await this.refreshStatus();
  }

  // ---------------------------------------------------------------------------
  // Revision-targeted file operations (used by History / Diff UI)
  // ---------------------------------------------------------------------------

  /**
   * Cat a file at a specific revision from the working copy.
   * Returns the raw file content as string (decoded by the backend based on locale).
   */
  async getFileAtRevision(relPath: string, revision: string | number): Promise<string> {
    if (!this.activeWcRoot) return '';
    try {
      const r = await this.requireProxy().$getFileAtRevision(this.activeWcRoot, relPath, revision);
      return r.stdout || '';
    } catch { return ''; }
  }

  /**
   * Export a file at a specific revision to a local output path.
   * The caller is responsible for ensuring outPath is writable.
   */
  async exportAtRevision(relPath: string, revision: string | number, outPath: string): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$exportAtRevision(this.activeWcRoot, relPath, revision, outPath);
  }

  /**
   * Revert a file in the working copy to a specific historical revision.
   * Uses `svn merge -r HEAD:revision` to bring file content back to that state.
   */
  async revertToRevision(relPath: string, revision: string | number): Promise<void> {
    if (!this.activeWcRoot) throw new Error('No active SVN working copy');
    await this.requireProxy().$revertToRevision(this.activeWcRoot, relPath, revision);
    await this.refreshStatus({ ignoreCache: true });
  }

  // ---------------------------------------------------------------------------
  // UI request events
  //
  // Components that need to open the diff / history view (e.g. the
  // "SVN Diff" / "SVN History" context-menu actions in the file
  // explorer) fire these events. SvnContribution listens and routes
  // them to the right widget, decoupling the caller from the widget
  // implementation — same pattern used by Theia for git operations.
  // ---------------------------------------------------------------------------

  /**
   * Request the SVN Diff widget to be opened for a specific file.
   * If baseRevision / targetRevision are omitted, defaults to
   * local-vs-BASE.
   */
  requestDiff(filePath: string, baseRevision?: string | number, targetRevision?: string | number): void {
    this.onDiffRequestEmitter.fire({ filePath, baseRevision, targetRevision });
  }

  /**
   * Request the SVN History widget to be opened for a specific file.
   */
  requestHistory(filePath: string): void {
    this.onHistoryRequestEmitter.fire({ filePath });
  }
}
