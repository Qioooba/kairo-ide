import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { SvnService, SvnStatusEntry, SvnCommitInfo, SvnFileStatus } from './svn-service';
import { SvnWorkingCopyInfo, SvnResolveChoice } from '../common/svn-types';

export interface SvnChangesState {
  available: boolean;
  wcRoot: string;
  wcInfo?: SvnWorkingCopyInfo;
  branchName: string;
  revision: number;
  modifiedFiles: SvnStatusEntry[];
  addedFiles: SvnStatusEntry[];
  deletedFiles: SvnStatusEntry[];
  unversionedFiles: SvnStatusEntry[];
  conflictedFiles: SvnStatusEntry[];
  ignoredFiles: SvnStatusEntry[];
  missingFiles: SvnStatusEntry[];
  lockedFiles: SvnStatusEntry[];
  replacedFiles: SvnStatusEntry[];
  /** Named changelists → entries (IDEA Local Changes grouping). */
  changelists: Record<string, SvnStatusEntry[]>;
  selectedFiles: Set<string>;
  commitMessage: string;
  loading: boolean;
  isCommitting: boolean;
  isUpdating: boolean;
  error?: string;
}

@injectable()
export class SvnStore {
  @inject(SvnService)
  protected readonly svnService!: SvnService;

  protected state: SvnChangesState = {
    available: false,
    wcRoot: '',
    branchName: '',
    revision: 0,
    modifiedFiles: [],
    addedFiles: [],
    deletedFiles: [],
    unversionedFiles: [],
    conflictedFiles: [],
    ignoredFiles: [],
    missingFiles: [],
    lockedFiles: [],
    replacedFiles: [],
    changelists: {},
    selectedFiles: new Set(),
    commitMessage: '',
    loading: false,
    isCommitting: false,
    isUpdating: false,
  };

  protected readonly onDidChangeEmitter = new Emitter<SvnChangesState>();
  readonly onDidChange: Event<SvnChangesState> = this.onDidChangeEmitter.event;

  protected readonly onDiffRequestEmitter = new Emitter<{ file: string }>();
  readonly onDiffRequest: Event<{ file: string }> = this.onDiffRequestEmitter.event;

  protected readonly onHistoryRequestEmitter = new Emitter<{ file?: string }>();
  readonly onHistoryRequest: Event<{ file?: string }> = this.onHistoryRequestEmitter.event;

  protected readonly onFocusCommitEmitter = new Emitter<void>();
  readonly onFocusCommit: Event<void> = this.onFocusCommitEmitter.event;

  /** When true, applyFromCache will not auto-select all changes on empty selection. */
  protected suppressAutoSelect = false;

  @postConstruct()
  protected init(): void {
    // Status events only re-apply the cache — never re-fetch (avoids loops).
    this.svnService.onDidChangeStatus(() => this.applyFromCache());
    this.svnService.onSvnAvailabilityChange((available) => {
      this.state = { ...this.state, available };
      this.onDidChangeEmitter.fire(this.state);
    });
    this.svnService.onDidCommitSuccess(() => {
      this.suppressAutoSelect = false;
      this.state = { ...this.state, isCommitting: false, commitMessage: '', selectedFiles: new Set() };
      this.applyFromCache();
    });
    this.svnService.onDidUpdateComplete(() => {
      this.state = { ...this.state, isUpdating: false };
      this.applyFromCache();
    });

    this.state.available = this.svnService.isSvnAvailable();
  }

  getState(): SvnChangesState {
    return { ...this.state, selectedFiles: new Set(this.state.selectedFiles) };
  }

  async setWcRoot(root: string | undefined): Promise<void> {
    this.svnService.setActiveWcRoot(root);
    if (!root) {
      this.suppressAutoSelect = false;
      this.state = {
        ...this.state,
        wcRoot: '',
        wcInfo: undefined,
        branchName: '',
        revision: 0,
        modifiedFiles: [],
        addedFiles: [],
        deletedFiles: [],
        unversionedFiles: [],
        conflictedFiles: [],
        ignoredFiles: [],
        missingFiles: [],
        lockedFiles: [],
        replacedFiles: [],
        changelists: {},
        selectedFiles: new Set(),
      };
      this.onDidChangeEmitter.fire(this.state);
      return;
    }
    await this.refresh();
  }

  /** Force a fresh `svn status` round-trip, then update UI state. */
  async refresh(): Promise<void> {
    this.state = { ...this.state, loading: true, error: undefined };
    this.onDidChangeEmitter.fire(this.state);

    try {
      await this.svnService.refreshStatus({ ignoreCache: true });
      this.applyFromCache();
    } catch (err) {
      this.state = {
        ...this.state,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      };
      this.onDidChangeEmitter.fire(this.state);
    }
  }

  protected applyFromCache(): void {
    try {
      const status = this.svnService.getCachedStatus();
      const wcInfo = this.svnService.getWcInfoCache();

      const changelists: Record<string, SvnStatusEntry[]> = {};
      const defaultBucket: SvnStatusEntry[] = [];

      for (const entry of status) {
        if (entry.changelist) {
          if (!changelists[entry.changelist]) changelists[entry.changelist] = [];
          changelists[entry.changelist].push(entry);
        } else {
          defaultBucket.push(entry);
        }
      }

      const modifiedFiles = defaultBucket.filter(s => s.status === SvnFileStatus.Modified);
      const addedFiles = defaultBucket.filter(s => s.status === SvnFileStatus.Added);
      const deletedFiles = defaultBucket.filter(s => s.status === SvnFileStatus.Deleted);
      const unversionedFiles = defaultBucket.filter(s => s.status === SvnFileStatus.Unversioned);
      const conflictedFiles = status.filter(s => s.status === SvnFileStatus.Conflict);
      const ignoredFiles = defaultBucket.filter(s => s.status === SvnFileStatus.Ignored);
      const missingFiles = defaultBucket.filter(s => s.status === SvnFileStatus.Missing);
      const lockedFiles = status.filter(s => s.isLocked);
      const replacedFiles = defaultBucket.filter(s => s.status === SvnFileStatus.Replaced);

      const allChanges = [
        ...modifiedFiles,
        ...addedFiles,
        ...deletedFiles,
        ...conflictedFiles,
        ...replacedFiles,
        ...missingFiles,
        ...Object.values(changelists).flat().filter(s =>
          s.status === SvnFileStatus.Modified ||
          s.status === SvnFileStatus.Added ||
          s.status === SvnFileStatus.Deleted ||
          s.status === SvnFileStatus.Replaced,
        ),
      ];
      const newSelected = new Set<string>();
      for (const f of allChanges) {
        if (this.state.selectedFiles.has(f.path)) {
          newSelected.add(f.path);
        }
      }
      if (newSelected.size === 0 && allChanges.length > 0 && !this.suppressAutoSelect) {
        for (const f of allChanges) {
          newSelected.add(f.path);
        }
      }

      this.state = {
        ...this.state,
        available: this.svnService.isSvnAvailable(),
        wcRoot: this.svnService.getActiveWcRoot() || '',
        wcInfo,
        branchName: wcInfo ? this.svnService.getBranchNameFromUrl(wcInfo.url) : '',
        revision: wcInfo?.revision || 0,
        modifiedFiles,
        addedFiles,
        deletedFiles,
        unversionedFiles,
        conflictedFiles,
        ignoredFiles,
        missingFiles,
        lockedFiles,
        replacedFiles,
        changelists,
        selectedFiles: newSelected,
        loading: false,
        error: undefined,
      };
    } catch (err) {
      this.state = {
        ...this.state,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    this.onDidChangeEmitter.fire(this.state);
  }

  toggleFileSelection(path: string): void {
    const newSelected = new Set(this.state.selectedFiles);
    if (newSelected.has(path)) {
      newSelected.delete(path);
      if (newSelected.size === 0) {
        this.suppressAutoSelect = true;
      }
    } else {
      newSelected.add(path);
      this.suppressAutoSelect = false;
    }
    this.state = { ...this.state, selectedFiles: newSelected };
    this.onDidChangeEmitter.fire(this.state);
  }

  selectAll(): void {
    this.suppressAutoSelect = false;
    const newSelected = new Set<string>();
    for (const f of [
      ...this.state.modifiedFiles,
      ...this.state.addedFiles,
      ...this.state.deletedFiles,
      ...this.state.replacedFiles,
      ...this.state.missingFiles,
      ...Object.values(this.state.changelists).flat(),
    ]) {
      newSelected.add(f.path);
    }
    this.state = { ...this.state, selectedFiles: newSelected };
    this.onDidChangeEmitter.fire(this.state);
  }

  deselectAll(): void {
    this.suppressAutoSelect = true;
    this.state = { ...this.state, selectedFiles: new Set() };
    this.onDidChangeEmitter.fire(this.state);
  }

  /** True after explicit deselect-all / last toggle-off — commit dialog must not re-fill. */
  get shouldSuppressAutoSelect(): boolean {
    return this.suppressAutoSelect;
  }

  setCommitMessage(msg: string): void {
    this.state = { ...this.state, commitMessage: msg };
    this.onDidChangeEmitter.fire(this.state);
  }

  focusCommit(): void {
    this.onFocusCommitEmitter.fire();
  }

  requestDiff(file: string): void {
    this.onDiffRequestEmitter.fire({ file });
    // Route through SvnService so SvnContribution opens the Diff widget.
    this.svnService.requestDiff(file);
  }

  requestHistory(file?: string): void {
    this.onHistoryRequestEmitter.fire({ file });
    if (file) this.svnService.requestHistory(file);
  }

  async commitSelected(): Promise<SvnCommitInfo> {
    const files = Array.from(this.state.selectedFiles);
    if (files.length === 0) {
      throw new Error('No files selected for commit');
    }
    if (!this.state.commitMessage.trim()) {
      throw new Error('Commit message is required');
    }

    this.state = { ...this.state, isCommitting: true, error: undefined };
    this.onDidChangeEmitter.fire(this.state);

    try {
      const unversionedToAdd = files.filter(f =>
        this.state.unversionedFiles.some(u => u.path === f)
      );
      if (unversionedToAdd.length > 0) {
        await this.svnService.add(unversionedToAdd);
      }

      const result = await this.svnService.commit(files, this.state.commitMessage);
      return result;
    } catch (err) {
      this.state = {
        ...this.state,
        isCommitting: false,
        error: err instanceof Error ? err.message : String(err),
      };
      this.onDidChangeEmitter.fire(this.state);
      throw err;
    }
  }

  async update(): Promise<{ revision: number; updatedFiles: number }> {
    this.state = { ...this.state, isUpdating: true, error: undefined };
    this.onDidChangeEmitter.fire(this.state);

    try {
      const result = await this.svnService.update();
      return result;
    } catch (err) {
      this.state = {
        ...this.state,
        isUpdating: false,
        error: err instanceof Error ? err.message : String(err),
      };
      this.onDidChangeEmitter.fire(this.state);
      throw err;
    }
  }

  async addFiles(paths: string[]): Promise<void> {
    await this.svnService.add(paths);
    await this.refresh();
  }

  async revertFiles(paths: string[]): Promise<void> {
    await this.svnService.revert(paths);
    await this.refresh();
  }

  async resolveConflicts(paths: string[], accept: SvnResolveChoice): Promise<void> {
    for (const p of paths) {
      await this.svnService.resolve(p, { accept });
    }
    await this.refresh();
  }

  getTotalChanges(): number {
    const changelistChanges = Object.values(this.state.changelists).flat().filter(s =>
      s.status === SvnFileStatus.Modified ||
      s.status === SvnFileStatus.Added ||
      s.status === SvnFileStatus.Deleted ||
      s.status === SvnFileStatus.Replaced ||
      s.status === SvnFileStatus.Conflict,
    ).length;
    return (
      this.state.modifiedFiles.length +
      this.state.addedFiles.length +
      this.state.deletedFiles.length +
      this.state.conflictedFiles.length +
      this.state.replacedFiles.length +
      changelistChanges
    );
  }

  hasConflicts(): boolean {
    return this.state.conflictedFiles.length > 0;
  }
}
