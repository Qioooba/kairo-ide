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

  constructor() {
    this.loadFromStorage();
  }

  get currentFilter(): SearchFilter { return { ...this.filter }; }

  setScope(scope: SearchScope): void { this.filter.scope = scope; }
  setGroupMode(groupMode: GroupMode): void { this.filter.groupMode = groupMode; }
  setFileTypes(fileTypes: string): void { this.filter.fileTypes = fileTypes; }
  setModifiedOnly(modifiedOnly: boolean): void { this.filter.modifiedOnly = modifiedOnly; }
  setExcludeGenerated(excludeGenerated: boolean): void { this.filter.excludeGenerated = excludeGenerated; }

  getHistory(): readonly SearchHistoryEntry[] { return this.history; }
  getRecentQueries(limit = 10): readonly SearchHistoryEntry[] {
    return this.history.slice(0, limit);
  }

  addToHistory(entry: SearchHistoryEntry): void {
    this.history = [
      entry,
      ...this.history.filter(
        existing => !(existing.query === entry.query
          && existing.isRegex === entry.isRegex
          && existing.caseSensitive === entry.caseSensitive
          && existing.wholeWord === entry.wholeWord)
      ),
    ].slice(0, MAX_HISTORY);
    this.saveToStorage();
  }

  getPinned(): readonly SearchHistoryEntry[] { return this.pinned; }

  pinQuery(entry: SearchHistoryEntry): void {
    if (this.pinned.length >= MAX_PINNED) return;
    if (this.pinned.some(existing => existing.query === entry.query)) return;
    this.pinned = [...this.pinned, entry];
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

  clearPinned(): void {
    this.pinned = [];
    this.savePinned();
  }

  protected loadFromStorage(): void {
    try {
      const historyRaw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (historyRaw) {
        this.history = JSON.parse(historyRaw);
      }
      const pinnedRaw = localStorage.getItem(PINNED_STORAGE_KEY);
      if (pinnedRaw) {
        this.pinned = JSON.parse(pinnedRaw);
      }
    } catch {
      // Ignore corrupted storage
    }
  }

  protected saveToStorage(): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(this.history));
    } catch {
      // Ignore storage errors
    }
  }

  protected savePinned(): void {
    try {
      localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(this.pinned));
    } catch {
      // Ignore storage errors
    }
  }
}