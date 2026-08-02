import type { SearchMatch } from '@kairo/protocol';

export interface SearchResultGroup {
  file: string;
  matches: readonly SearchMatch[];
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
