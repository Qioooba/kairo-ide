/**
 * Pure helpers for IDEA-style Show Usages / Find Usages.
 *
 * Kept free of Theia/Monaco UI so unit tests can cover sorting,
 * grouping, declaration tagging, and QuickPick item shaping.
 */

import type { LSPLocation } from '../common/lsp-protocol';

export interface PreparedUsage {
  uri: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  preview: string;
  fileName: string;
  relativePath: string;
  isDeclaration: boolean;
  isCurrentFile: boolean;
}

export interface UsagePickItemShape {
  type?: 'item';
  id: string;
  label: string;
  description: string;
  detail: string;
  iconClasses: string[];
  alwaysShow?: boolean;
  usage: PreparedUsage;
}

export interface UsagePickSeparatorShape {
  type: 'separator';
  label: string;
}

export type UsagePickEntry = UsagePickItemShape | UsagePickSeparatorShape;

export function fileNameFromUri(uri: string): string {
  try {
    const withoutQuery = uri.split('?')[0] ?? uri;
    const segments = withoutQuery.replace(/\\/g, '/').split('/');
    return decodeURIComponent(segments[segments.length - 1] || uri);
  } catch {
    return uri;
  }
}

export function relativePathFromUri(uri: string, workspaceRoot?: string): string {
  try {
    const path = (uri.split('?')[0] ?? uri).replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1');
    const normalized = decodeURIComponent(path.replace(/\\/g, '/'));
    if (!workspaceRoot) {
      return normalized;
    }
    const rootPath = workspaceRoot
      .replace(/^file:\/\//, '')
      .replace(/^\/([A-Za-z]:)/, '$1')
      .replace(/\\/g, '/');
    const decodedRoot = decodeURIComponent(rootPath);
    if (normalized.toLowerCase().startsWith(decodedRoot.toLowerCase())) {
      const trimmed = normalized.slice(decodedRoot.length).replace(/^\//, '');
      return trimmed || fileNameFromUri(uri);
    }
    return normalized;
  } catch {
    return uri;
  }
}

export function locationKey(uri: string, line: number, character: number): string {
  return `${uri}|${line}|${character}`;
}

export function isSameRange(
  loc: LSPLocation,
  other: { uri: string; line: number; character: number; endLine?: number; endCharacter?: number },
): boolean {
  if (loc.uri !== other.uri) return false;
  if (loc.range.start.line !== other.line || loc.range.start.character !== other.character) {
    return false;
  }
  if (other.endLine !== undefined && loc.range.end.line !== other.endLine) return false;
  if (other.endCharacter !== undefined && loc.range.end.character !== other.endCharacter) return false;
  return true;
}

export function prepareUsages(options: {
  references: LSPLocation[];
  declarations?: LSPLocation[];
  currentUri?: string;
  workspaceRoot?: string;
  getPreview: (uri: string, line: number) => string;
}): PreparedUsage[] {
  const declarationKeys = new Set(
    (options.declarations ?? []).map(d => locationKey(d.uri, d.range.start.line, d.range.start.character)),
  );

  return options.references.map(ref => {
    const fileName = fileNameFromUri(ref.uri);
    const relativePath = relativePathFromUri(ref.uri, options.workspaceRoot);
    return {
      uri: ref.uri,
      line: ref.range.start.line,
      character: ref.range.start.character,
      endLine: ref.range.end.line,
      endCharacter: ref.range.end.character,
      preview: options.getPreview(ref.uri, ref.range.start.line),
      fileName,
      relativePath,
      isDeclaration: declarationKeys.has(locationKey(ref.uri, ref.range.start.line, ref.range.start.character)),
      isCurrentFile: !!options.currentUri && ref.uri === options.currentUri,
    };
  });
}

/** Current file first, then path, then line/column. Declarations float to the top within a file. */
export function sortUsages(usages: PreparedUsage[]): PreparedUsage[] {
  return [...usages].sort((a, b) => {
    if (a.isCurrentFile !== b.isCurrentFile) {
      return a.isCurrentFile ? -1 : 1;
    }
    const pathCmp = a.relativePath.localeCompare(b.relativePath);
    if (pathCmp !== 0) return pathCmp;
    if (a.isDeclaration !== b.isDeclaration) {
      return a.isDeclaration ? -1 : 1;
    }
    if (a.line !== b.line) return a.line - b.line;
    return a.character - b.character;
  });
}

export function buildUsagePickEntries(
  usages: PreparedUsage[],
  labels: {
    declaration: string;
    usage: string;
    fileGroup: (fileName: string, count: number) => string;
  },
): UsagePickEntry[] {
  const sorted = sortUsages(usages);
  const entries: UsagePickEntry[] = [];
  let currentFile: string | undefined;
  let groupStart = 0;

  const flushSeparator = (start: number, end: number): void => {
    const slice = sorted.slice(start, end);
    if (slice.length === 0) return;
    entries.push({
      type: 'separator',
      label: labels.fileGroup(slice[0].fileName, slice.length),
    });
    for (let i = start; i < end; i++) {
      const usage = sorted[i];
      entries.push({
        id: locationKey(usage.uri, usage.line, usage.character),
        label: `${usage.line + 1}:${usage.character + 1}`,
        description: usage.isDeclaration ? labels.declaration : labels.usage,
        detail: usage.preview,
        iconClasses: usage.isDeclaration
          ? ['codicon', 'codicon-symbol-class']
          : ['codicon', 'codicon-references'],
        usage,
      });
    }
  };

  for (let i = 0; i < sorted.length; i++) {
    const usage = sorted[i];
    if (currentFile === undefined) {
      currentFile = usage.uri;
      groupStart = i;
      continue;
    }
    if (usage.uri !== currentFile) {
      flushSeparator(groupStart, i);
      currentFile = usage.uri;
      groupStart = i;
    }
  }
  if (currentFile !== undefined) {
    flushSeparator(groupStart, sorted.length);
  }

  return entries;
}

export function filterUsages(usages: PreparedUsage[], query: string): PreparedUsage[] {
  const q = query.trim().toLowerCase();
  if (!q) return usages;
  return usages.filter(u => {
    const haystack = `${u.fileName} ${u.relativePath} ${u.preview} ${u.line + 1}`.toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Resolve a Java-like identifier under / left of a caret on a single line.
 * `column` is 0-based (LSP / Monaco character offset).
 */
export function resolveIdentifierOnLine(
  lineText: string,
  column: number,
): { character: number; symbolName: string } | undefined {
  if (!lineText) return undefined;
  let i = Math.min(Math.max(column, 0), lineText.length);

  // If caret is not on an identifier char, walk left onto one (handles `{`, `;`, spaces).
  if (i >= lineText.length || !/[A-Za-z0-9_$]/.test(lineText[i]!)) {
    i = i - 1;
    while (i >= 0 && /\s/.test(lineText[i]!)) i--;
    if (i >= 0 && !/[A-Za-z0-9_$]/.test(lineText[i]!)) {
      while (i >= 0 && !/[A-Za-z0-9_$]/.test(lineText[i]!) && !/\s/.test(lineText[i]!)) i--;
      while (i >= 0 && /\s/.test(lineText[i]!)) i--;
    }
  }

  if (i < 0 || !/[A-Za-z0-9_$]/.test(lineText[i]!)) return undefined;

  let start = i;
  let end = i + 1;
  while (start > 0 && /[A-Za-z0-9_$]/.test(lineText[start - 1]!)) start--;
  while (end < lineText.length && /[A-Za-z0-9_$]/.test(lineText[end]!)) end++;

  const symbolName = lineText.slice(start, end);
  if (!symbolName || !/^[A-Za-z_$]/.test(symbolName)) return undefined;
  return { character: start, symbolName };
}
