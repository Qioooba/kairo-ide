import { injectable } from '@theia/core/shared/inversify';

export type SearchScope = 'project' | 'directory' | 'module' | 'current-file' | 'selection';
export type GroupMode = 'by-directory' | 'by-file' | 'flat';

export interface SearchFilter {
  scope: SearchScope;
  groupMode: GroupMode;
  fileTypes: string;
  modifiedOnly: boolean;
  excludeGenerated: boolean;
}

export interface SearchHistoryEntry {
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  scope: SearchScope;
  timestamp: number;
}

export interface SearchScopeOption {
  value: SearchScope;
  label: string;
}

export interface GroupModeOption {
  value: GroupMode;
  label: string;
}

const MAX_HISTORY = 50;
const MAX_PINNED = 10;
const HISTORY_STORAGE_KEY = 'kairo-search-history';
const PINNED_STORAGE_KEY = 'kairo-search-pinned';
const LIMITS_STORAGE_KEY = 'kairo-search-limits';

/** Search result limits shared by the Search Center and the Find tool window. */
export interface SearchResultLimits {
  /**
   * Backend match cap. undefined = server default (100_000);
   * -1 = unlimited; >0 = custom cap.
   */
  maxResults?: number;
  /** Frontend preview cap. undefined = show all; >0 = render at most N. */
  displayLimit?: number;
}

/** Parse the "max matches" box: empty = server default, 0 = unlimited (-1). */
export function parseMaxResultsInput(value: string): number | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  const n = Number(text);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  if (n <= 0) {
    return -1;
  }
  return Math.floor(n);
}

/** Parse the "max displayed" box: empty/non-positive = show all. */
export function parseDisplayLimitInput(value: string): number | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return Math.floor(n);
}

/** Render a stored limit back into the textbox: -1 shows as 0 (=unlimited). */
export function limitToInput(value: number | undefined): string {
  if (value === undefined) {
    return '';
  }
  if (value < 0) {
    return '0';
  }
  return String(value);
}

export const SCOPE_OPTIONS: SearchScopeOption[] = [
  { value: 'project', label: 'Project' },
  { value: 'directory', label: 'Directory' },
  { value: 'module', label: 'Module' },
  { value: 'current-file', label: 'Current File' },
  { value: 'selection', label: 'Selection' },
];

export const GROUP_MODE_OPTIONS: GroupModeOption[] = [
  { value: 'by-directory', label: 'Group by Directory' },
  { value: 'by-file', label: 'Group by File' },
  { value: 'flat', label: 'Flat' },
];

@injectable()
export class SearchScopeModel {
  protected filter: SearchFilter = {
    scope: 'project',
    groupMode: 'by-file',
    fileTypes: '',
    modifiedOnly: false,
    excludeGenerated: true,
  };

  protected history: SearchHistoryEntry[] = [];
  protected pinned: SearchHistoryEntry[] = [];
  protected limits: SearchResultLimits = {};

  constructor() {
    this.loadFromStorage();
  }

  get currentFilter(): SearchFilter { return { ...this.filter }; }

  setScope(scope: SearchScope): void { this.filter.scope = scope; }
  setGroupMode(groupMode: GroupMode): void { this.filter.groupMode = groupMode; }
  setFileTypes(fileTypes: string): void { this.filter.fileTypes = fileTypes; }
  setModifiedOnly(modifiedOnly: boolean): void { this.filter.modifiedOnly = modifiedOnly; }
  setExcludeGenerated(excludeGenerated: boolean): void { this.filter.excludeGenerated = excludeGenerated; }

  getLimits(): SearchResultLimits { return { ...this.limits }; }

  setMaxResults(maxResults: number | undefined): void {
    if (maxResults === undefined) {
      delete this.limits.maxResults;
    } else {
      this.limits.maxResults = maxResults;
    }
    this.saveLimits();
  }

  setDisplayLimit(displayLimit: number | undefined): void {
    if (displayLimit === undefined) {
      delete this.limits.displayLimit;
    } else {
      this.limits.displayLimit = displayLimit;
    }
    this.saveLimits();
  }

  getHistory(): readonly SearchHistoryEntry[] { return this.history; }
  getRecentQueries(limit = 10): readonly SearchHistoryEntry[] {
    return this.history.slice(0, limit);
  }

  addToHistory(entry: SearchHistoryEntry): void {
    const normalizedEntry = { ...entry, query: entry.query.trim() };
    if (!normalizedEntry.query) {
      return;
    }
    this.history = [
      normalizedEntry,
      ...this.history.filter(
        existing => !(existing.query === normalizedEntry.query
          && existing.isRegex === normalizedEntry.isRegex
          && existing.caseSensitive === normalizedEntry.caseSensitive
          && existing.wholeWord === normalizedEntry.wholeWord)
      ),
    ].slice(0, MAX_HISTORY);
    this.saveToStorage();
  }

  getPinned(): readonly SearchHistoryEntry[] { return this.pinned; }

  pinQuery(entry: SearchHistoryEntry): void {
    const normalizedEntry = { ...entry, query: entry.query.trim() };
    if (!normalizedEntry.query) {
      return;
    }
    if (this.pinned.length >= MAX_PINNED) return;
    if (this.pinned.some(existing => existing.query === normalizedEntry.query)) return;
    this.pinned = [...this.pinned, normalizedEntry];
    this.savePinned();
  }

  unpinQuery(query: string): void {
    this.pinned = this.pinned.filter(entry => entry.query !== query);
    this.savePinned();
  }

  isPinned(query: string): boolean {
    return this.pinned.some(entry => entry.query === query);
  }

  clearHistory(): void {
    this.history = [];
    this.saveToStorage();
  }

  removeFromHistory(entry: SearchHistoryEntry): void {
    this.history = this.history.filter(existing => !sameHistoryEntry(existing, entry));
    this.saveToStorage();
  }

  clearPinned(): void {
    this.pinned = [];
    this.savePinned();
  }

  protected loadFromStorage(): void {
    try {
      const storage = globalThis.localStorage;
      if (!storage) return;
      const historyRaw = storage.getItem(HISTORY_STORAGE_KEY);
      if (historyRaw) {
        const parsed = JSON.parse(historyRaw);
        if (Array.isArray(parsed)) {
          this.history = parsed.filter(isHistoryEntry).slice(0, MAX_HISTORY);
        }
      }
      const pinnedRaw = storage.getItem(PINNED_STORAGE_KEY);
      if (pinnedRaw) {
        const parsed = JSON.parse(pinnedRaw);
        if (Array.isArray(parsed)) {
          this.pinned = parsed.filter(isHistoryEntry).slice(0, MAX_PINNED);
        }
      }
      const limitsRaw = storage.getItem(LIMITS_STORAGE_KEY);
      if (limitsRaw) {
        try {
          const parsedLimits = JSON.parse(limitsRaw);
          if (parsedLimits && typeof parsedLimits === 'object') {
            const rec = parsedLimits as Record<string, unknown>;
            if (typeof rec.maxResults === 'number' && Number.isFinite(rec.maxResults)) {
              this.limits.maxResults = rec.maxResults;
            }
            if (typeof rec.displayLimit === 'number' && Number.isFinite(rec.displayLimit)) {
              this.limits.displayLimit = rec.displayLimit;
            }
          }
        } catch {
          // Ignore corrupted limits
        }
      }
    } catch {
      // Ignore corrupted storage
    }
  }

  protected saveToStorage(): void {
    try {
      globalThis.localStorage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(this.history));
    } catch {
      // Ignore storage errors
    }
  }

  protected saveLimits(): void {
    try {
      globalThis.localStorage?.setItem(LIMITS_STORAGE_KEY, JSON.stringify(this.limits));
    } catch {
      // Ignore storage errors
    }
  }

  protected savePinned(): void {
    try {
      globalThis.localStorage?.setItem(PINNED_STORAGE_KEY, JSON.stringify(this.pinned));
    } catch {
      // Ignore storage errors
    }
  }
}

function sameHistoryEntry(a: SearchHistoryEntry, b: SearchHistoryEntry): boolean {
  return a.query === b.query
    && a.isRegex === b.isRegex
    && a.caseSensitive === b.caseSensitive
    && a.wholeWord === b.wholeWord
    && a.scope === b.scope;
}

function isHistoryEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Partial<SearchHistoryEntry>;
  return typeof entry.query === 'string'
    && typeof entry.isRegex === 'boolean'
    && typeof entry.caseSensitive === 'boolean'
    && typeof entry.wholeWord === 'boolean'
    && typeof entry.scope === 'string'
    && SCOPE_OPTIONS.some(option => option.value === entry.scope)
    && typeof entry.timestamp === 'number'
    && Number.isFinite(entry.timestamp);
}
