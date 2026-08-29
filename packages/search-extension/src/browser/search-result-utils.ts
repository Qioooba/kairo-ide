import type { SearchMatch } from '@kairo/protocol';

export interface SearchResultGroup {
  file: string;
  matches: readonly SearchMatch[];
}

export interface MatchPreviewParts {
  before: string;
  highlight: string;
  after: string;
  /** Post-image preview when the search carried `previewReplace`. */
  replacement?: string;
}

/** IDEA-style group header: filename only (no directory). */
export function getSearchFileName(filepath: string): string {
  const parts = filepath.split(/[\\/]/);
  return parts[parts.length - 1] || filepath;
}

/** IDEA-style group header: parent directory path (no filename). */
export function getSearchFileDir(filepath: string): string {
  const parts = filepath.split(/[\\/]/);
  if (parts.length <= 1) {
    return '';
  }
  return parts.slice(0, -1).join('/');
}

export function getSearchFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'java': return 'codicon-symbol-class';
    case 'js': case 'jsx': case 'ts': case 'tsx': return 'codicon-symbol-namespace';
    case 'xml': case 'html': case 'jsp': return 'codicon-symbol-misc';
    case 'css': case 'less': case 'scss': return 'codicon-symbol-color';
    case 'json': return 'codicon-symbol-object';
    case 'md': return 'codicon-symbol-string';
    case 'py': return 'codicon-symbol-namespace';
    case 'go': return 'codicon-symbol-namespace';
    default: return 'codicon-file';
  }
}

/** Same-line preview segments for IDEA result rows. */
export function matchPreviewParts(match: SearchMatch): MatchPreviewParts {
  const { before, after } = sameLineContext(match);
  return {
    before,
    highlight: match.matchText ?? '',
    after,
    replacement: match.replacement,
  };
}

export function groupMatchesByFile(matches: readonly SearchMatch[]): SearchResultGroup[] {
  const groups = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const group = groups.get(match.file);
    if (group) {
      group.push(match);
    } else {
      groups.set(match.file, [match]);
    }
  }
  return [...groups].map(([file, grouped]) => ({ file, matches: grouped }));
}

/**
 * Extract same-line before/after from context fields that may also
 * contain multi-line context (joined with newlines when ContextLines > 0).
 */
export function sameLineContext(match: Pick<SearchMatch, 'contextBefore' | 'contextAfter'>): { before: string; after: string } {
  const beforeRaw = match.contextBefore ?? '';
  const afterRaw = match.contextAfter ?? '';
  const before = beforeRaw.includes('\n') ? beforeRaw.slice(beforeRaw.lastIndexOf('\n') + 1) : beforeRaw;
  const after = afterRaw.includes('\n') ? afterRaw.slice(0, afterRaw.indexOf('\n')) : afterRaw;
  return { before, after };
}

/** Split multi-line context for the preview pane. */
export function multiLineContext(match: Pick<SearchMatch, 'contextBefore' | 'contextAfter' | 'matchText'>): {
  beforeLines: string[];
  afterLines: string[];
  sameBefore: string;
  sameAfter: string;
} {
  const beforeParts = (match.contextBefore ?? '').split('\n');
  const afterParts = (match.contextAfter ?? '').split('\n');
  const sameBefore = beforeParts[beforeParts.length - 1] ?? '';
  const sameAfter = afterParts[0] ?? '';
  const beforeLines = beforeParts.length > 1 ? beforeParts.slice(0, -1) : [];
  const afterLines = afterParts.length > 1 ? afterParts.slice(1) : [];
  return { beforeLines, afterLines, sameBefore, sameAfter };
}
