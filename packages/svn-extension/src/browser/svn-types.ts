export enum SvnFileStatus {
  Normal = 'normal',
  Modified = 'modified',
  Added = 'added',
  Deleted = 'deleted',
  Conflict = 'conflicted',
  Missing = 'missing',
  Unversioned = 'unversioned',
  Ignored = 'ignored',
  Replaced = 'replaced',
  Obstructed = 'obstructed',
  Locked = 'locked',
  Switched = 'switched',
  External = 'external',
  None = 'none',
}

export interface SvnInstallation {
  path: string;
  version: string;
  versionMajor: number;
  versionMinor: number;
  source: 'path' | 'registry' | 'common-location' | 'user-config';
}

export interface SvnStatusEntry {
  path: string;
  status: SvnFileStatus;
  props?: SvnFileStatus;
  /** Remote/incoming status from `svn status -u` (repos-status). */
  reposStatus?: SvnFileStatus;
  revision?: number;
  lastChangedRevision?: number;
  lastChangedAuthor?: string;
  lastChangedDate?: Date;
  switchedUrl?: string;
  reposRootUrl?: string;
  reposUuid?: string;
  changelist?: string;
  isCopied?: boolean;
  isLocked?: boolean;
  lockOwner?: string;
  lockComment?: string;
  treeConflict?: boolean;
  conflictOld?: string;
  conflictNew?: string;
  conflictWorking?: string;
}

export interface SvnInfo {
  wcRoot: string;
  url: string;
  reposRootUrl: string;
  reposUuid: string;
  revision: number;
  lastChangedRev: number;
  lastChangedDate: string;
  lastChangedAuthor: string;
  schedule?: 'normal' | 'add' | 'delete' | 'replace';
  depth?: 'infinity' | 'immediates' | 'files' | 'empty';
}

/** Backward-compat alias — newer code should use `SvnInfo`. */
export type SvnWorkingCopyInfo = SvnInfo;

export type SvnStatus = SvnStatusEntry;

export type SvnAnnotation = SvnBlameLine;

export interface SvnDiffResult {
  content: string;
  perFile?: { [relPath: string]: string };
}

export interface SvnCredential {
  username: string;
  password: string;
}

export type SvnResolveChoice =
  | 'mine-full'
  | 'theirs-full'
  | 'working'
  | 'base'
  | 'mine-conflict'
  | 'theirs-conflict';

export interface SvnCommitInfo {
  revision: number;
  author: string;
  date: Date;
  message: string;
  changedPaths: SvnChangedPath[];
}

export interface SvnChangedPath {
  path: string;
  action: 'A' | 'D' | 'M' | 'R';
  copyFromPath?: string;
  copyFromRev?: number;
}

export interface SvnBlameLine {
  revision: number;
  author: string;
  date: Date;
  line: number;
  content: string;
  mergedRevision?: number;
  mergedPath?: string;
  mergedAuthor?: string;
}

export interface SvnLogEntry {
  revision: number;
  author: string;
  date: Date;
  message: string;
  changedPaths: SvnChangedPath[];
  hasChildren: boolean;
}

export interface SvnDiffOptions {
  revision?: number | 'BASE' | 'HEAD' | 'PREV' | 'COMMITTED';
  pegRevision?: number;
  oldUrl?: string;
  oldRevision?: number;
  depth?: 'infinity' | 'immediates' | 'files' | 'empty';
  ignoreWhitespace?: boolean;
  ignoreEolStyle?: boolean;
  showCopiesAsAdds?: boolean;
}

export interface SvnProgressEvent {
  operation: string;
  current: number;
  total: number;
  path?: string;
}

export interface FolderDiffEntry {
  path: string;
  status: 'same' | 'modified' | 'added' | 'deleted' | 'none';
}

export interface FolderDiffResult {
  entries: FolderDiffEntry[];
}

export interface RepoEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size?: number;
  lastChangedRevision?: number;
  lastChangedAuthor?: string;
  lastChangedDate?: Date;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SvnCredentials {
  username: string;
  password: string;
}

export function mapSvnItemStatus(item: string): SvnFileStatus {
  switch (item) {
    case 'normal':
    case 'unmodified':
      return SvnFileStatus.Normal;
    case 'modified':
      return SvnFileStatus.Modified;
    case 'added':
      return SvnFileStatus.Added;
    case 'deleted':
      return SvnFileStatus.Deleted;
    case 'conflicted':
      return SvnFileStatus.Conflict;
    case 'missing':
      return SvnFileStatus.Missing;
    case 'unversioned':
      return SvnFileStatus.Unversioned;
    case 'ignored':
      return SvnFileStatus.Ignored;
    case 'replaced':
      return SvnFileStatus.Replaced;
    case 'obstructed':
      return SvnFileStatus.Obstructed;
    case 'locked':
      return SvnFileStatus.Locked;
    case 'switched':
      return SvnFileStatus.Switched;
    case 'external':
      return SvnFileStatus.External;
    case 'none':
    default:
      return SvnFileStatus.None;
  }
}

export function getStatusLabel(status: SvnFileStatus): string {
  switch (status) {
    case SvnFileStatus.Modified:
      return 'Modified';
    case SvnFileStatus.Added:
      return 'Added';
    case SvnFileStatus.Deleted:
      return 'Deleted';
    case SvnFileStatus.Conflict:
      return 'Conflict';
    case SvnFileStatus.Missing:
      return 'Missing';
    case SvnFileStatus.Unversioned:
      return 'Unversioned';
    case SvnFileStatus.Ignored:
      return 'Ignored';
    case SvnFileStatus.Replaced:
      return 'Replaced';
    case SvnFileStatus.Obstructed:
      return 'Obstructed';
    case SvnFileStatus.Locked:
      return 'Locked';
    case SvnFileStatus.Switched:
      return 'Switched';
    case SvnFileStatus.External:
      return 'External';
    default:
      return '';
  }
}
