import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { SvnService, SvnStatusEntry, SvnCommitInfo, SvnFileStatus } from './svn-service';
import { SvnWorkingCopyInfo } from './svn-types';

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

  @postConstruct()
  protected init(): void {
    this.svnService.onDidChangeStatus(() => this.refresh());
    this.svnService.onSvnAvailabilityChange((available) => {
      this.state = { ...this.state, available };
      this.onDidChangeEmitter.fire(this.state);
    });
    this.svnService.onDidCommitSuccess(() => {
      this.state = { ...this.state, isCommitting: false, commitMessage: '', selectedFiles: new Set() };
      this.refresh();
    });
    this.svnService.onDidUpdateComplete(() => {
      this.state = { ...this.state, isUpdating: false };
      this.refresh();
    });

    this.state.available = this.svnService.isSvnAvailable();
  }

  getState(): SvnChangesState {
    return { ...this.state, selectedFiles: new Set(this.state.selectedFiles) };
  }

  async setWcRoot(root: string | undefined): Promise<void> {
    this.svnService.setActiveWcRoot(root);
    if (!root) {
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
        selectedFiles: new Set(),
      };
      this.onDidChangeEmitter.fire(this.state);
      return;
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.state = { ...this.state, loading: true, error: undefined };
    this.onDidChangeEmitter.fire(this.state);

    try {
      const status = this.svnService.getCachedStatus();
      const wcInfo = this.svnService.getWcInfoCache();

      const modifiedFiles = status.filter(s => s.status === SvnFileStatus.Modified);
      const addedFiles = status.filter(s => s.status === SvnFileStatus.Added);
      const deletedFiles = status.filter(s => s.status === SvnFileStatus.Deleted);
      const unversionedFiles = status.filter(s => s.status === SvnFileStatus.Unversioned);
      const conflictedFiles = status.filter(s => s.status === SvnFileStatus.Conflict);
      const ignoredFiles = status.filter(s => s.status === SvnFileStatus.Ignored);
      const missingFiles = status.filter(s => s.status === SvnFileStatus.Missing);
      const lockedFiles = status.filter(s => s.isLocked);
      const replacedFiles = status.filter(s => s.status === SvnFileStatus.Replaced);

      const allChanges = [
        ...modifiedFiles,
        ...addedFiles,
        ...deletedFiles,
        ...conflictedFiles,
      ];
      const newSelected = new Set<string>();
      for (const f of allChanges) {
        if (this.state.selectedFiles.has(f.path)) {
          newSelected.add(f.path);
        }
      }
      if (newSelected.size === 0 && allChanges.length > 0) {
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
        selectedFiles: newSelected,
        loading: false,
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
    } else {
      newSelected.add(path);
    }
    this.state = { ...this.state, selectedFiles: newSelected };
    this.onDidChangeEmitter.fire(this.state);
  }

  selectAll(): void {
    const newSelected = new Set<string>();
    for (const f of [
      ...this.state.modifiedFiles,
      ...this.state.addedFiles,
      ...this.state.deletedFiles,
    ]) {
      newSelected.add(f.path);
    }
    this.state = { ...this.state, selectedFiles: newSelected };
    this.onDidChangeEmitter.fire(this.state);
  }

  deselectAll(): void {
    this.state = { ...this.state, selectedFiles: new Set() };
    this.onDidChangeEmitter.fire(this.state);
  }

  setCommitMessage(msg: string): void {
    this.state = { ...this.state, commitMessage: msg };
    this.onDidChangeEmitter.fire(this.state);
  }

  requestDiff(file: string): void {
    this.onDiffRequestEmitter.fire({ file });
  }

  requestHistory(file?: string): void {
    this.onHistoryRequestEmitter.fire({ file });
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

  getTotalChanges(): number {
    return (
      this.state.modifiedFiles.length +
      this.state.addedFiles.length +
      this.state.deletedFiles.length +
      this.state.conflictedFiles.length
    );
  }

  hasConflicts(): boolean {
    return this.state.conflictedFiles.length > 0;
  }
}
