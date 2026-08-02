// SPDX-License-Identifier: Apache-2.0
//
// Monaco-free completion item adaptation helpers.
// Keeps LSP → provider → Monaco mapping testable without
// pulling in the editor.

import type { LSPCompletionItem, LSPRange, LSPTextEdit } from '../common/lsp-protocol';
import type { JavaIntelliSenseCompletionItem } from './java-intellisense-provider';

/** LSP InsertTextFormat: PlainText = 1, Snippet = 2 */
export const INSERT_AS_SNIPPET = 2 as const;
export const INSERT_AS_PLAIN = 1 as const;

export interface JavaCompletionTextEdit {
  range: LSPRange;
  newText: string;
}

export interface JavaCompletionResponseItem {
  label: string;
  labelDetail?: string;
  labelDescription?: string;
  kind: number | undefined;
  detail: string | undefined;
  documentation: string | undefined;
  sortText: string | undefined;
  filterText: string | undefined;
  insertText: string | undefined;
  insertTextFormat?: 1 | 2;
  textEdit?: JavaCompletionTextEdit;
  /** LSP InsertReplaceEdit support (insert/replace ranges). */
  insertRange?: LSPRange;
  replaceRange?: LSPRange;
  additionalTextEdits?: JavaCompletionTextEdit[];
  commitCharacters?: string[];
  command?: { title: string; command: string; arguments?: unknown[] };
  data?: unknown;
  isDeprecated?: boolean;
  score?: number;
  preselect?: boolean;
}

export interface JavaCompletionResponse {
  isIncomplete: boolean;
  items: JavaCompletionResponseItem[];
}

/** True when insertText contains snippet placeholders. */
export function looksLikeSnippet(insertText: string | undefined): boolean {
  return typeof insertText === 'string' && /\$\{|\$\d/.test(insertText);
}

export function adaptLspCompletion(it: LSPCompletionItem): JavaCompletionResponseItem {
  let doc: string | undefined;
  if (typeof it.documentation === 'string') {
    doc = it.documentation;
  } else if (it.documentation && typeof it.documentation === 'object') {
    doc = it.documentation.value;
  }

  const insertText = it.insertText
    ?? it.textEdit?.newText
    ?? (it as { insertTextEdit?: { newText: string } }).insertTextEdit?.newText
    ?? it.label;
  let insertTextFormat = it.insertTextFormat;
  if (insertTextFormat === undefined && looksLikeSnippet(insertText)) {
    insertTextFormat = INSERT_AS_SNIPPET;
  }

  const insertReplace = it as {
    textEdit?: LSPCompletionItem['textEdit'] & {
      insert?: LSPRange;
      replace?: LSPRange;
      newText?: string;
    };
    labelDetails?: { detail?: string; description?: string };
  };

  let textEdit = it.textEdit
    ? { range: it.textEdit.range, newText: it.textEdit.newText }
    : undefined;
  let insertRange: LSPRange | undefined;
  let replaceRange: LSPRange | undefined;
  if (insertReplace.textEdit && 'insert' in insertReplace.textEdit && insertReplace.textEdit.insert) {
    insertRange = insertReplace.textEdit.insert;
    replaceRange = insertReplace.textEdit.replace;
    textEdit = {
      range: insertReplace.textEdit.replace ?? insertReplace.textEdit.insert,
      newText: insertReplace.textEdit.newText ?? insertText,
    };
  }

  return {
    label: it.label,
    labelDetail: insertReplace.labelDetails?.detail,
    labelDescription: insertReplace.labelDetails?.description,
    kind: it.kind,
    detail: it.detail,
    documentation: doc,
    sortText: it.sortText,
    filterText: it.filterText,
    insertText,
    insertTextFormat,
    textEdit,
    insertRange,
    replaceRange,
    additionalTextEdits: it.additionalTextEdits?.map(e => ({
      range: e.range,
      newText: e.newText,
    })),
    commitCharacters: it.commitCharacters,
    command: it.command,
    data: it.data,
    isDeprecated: (it as { tags?: number[] }).tags?.includes(1) ?? false,
    preselect: (it as { preselect?: boolean }).preselect,
  };
}

export function adaptIntelliSenseCompletion(it: JavaIntelliSenseCompletionItem): JavaCompletionResponseItem {
  const insertText = it.insertText;
  const isSnippetKind = it.kind === 15;
  return {
    label: it.label,
    kind: it.kind,
    detail: it.detail,
    documentation: it.documentation,
    sortText: it.sortText,
    filterText: it.filterText,
    insertText,
    insertTextFormat: isSnippetKind || looksLikeSnippet(insertText) ? INSERT_AS_SNIPPET : INSERT_AS_PLAIN,
    isDeprecated: it.isDeprecated,
  };
}

/**
 * IDEA-like Smart Completion filter: drop keywords/snippets/text
 * noise and prefer type-bearing / member items.
 * When `expectedType` is provided (from signature help), boost items
 * whose label/detail look compatible with that type.
 */
export function filterSmartCompletions(
  items: JavaCompletionResponseItem[],
  expectedType?: string,
  cycle = 0,
): JavaCompletionResponseItem[] {
  const MEMBER_KINDS = new Set([2, 3, 4, 5, 6, 7, 8, 10, 13, 20, 21, 22, 25]);
  const mode = cycle % 3;

  let filtered = items;
  if (mode === 0 || mode === 1) {
    filtered = items.filter(it => it.kind !== undefined && MEMBER_KINDS.has(it.kind));
    if (filtered.length === 0) {
      filtered = items.filter(it => it.kind !== 14 && it.kind !== 15);
    }
    if (filtered.length === 0) {
      filtered = items;
    }
  }

  // Cycle 1: members only, no type boost. Cycle 2: all items, light boost.
  const typeHint = mode === 1 ? undefined : normalizeTypeHint(expectedType);
  return filtered.map(it => {
    let rank = '1';
    if (typeHint && matchesExpectedType(it, typeHint)) {
      rank = '0';
    } else if (mode === 2 && it.kind !== undefined && MEMBER_KINDS.has(it.kind)) {
      rank = '0';
    }
    return {
      ...it,
      sortText: rank + (it.sortText ?? it.label),
      preselect: rank === '0' ? true : it.preselect,
    };
  }).sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
}

/** Extract a simple type name from a signature parameter label. */
export function extractTypeHintFromParameterLabel(label: string | undefined): string | undefined {
  if (!label) {
    return undefined;
  }
  // Examples: "String name", "final List<String> items", "@Nullable Foo bar"
  const cleaned = label
    .replace(/@\w+(?:\([^)]*\))?/g, '')
    .replace(/\b(?:final|volatile|transient|public|private|protected|static)\b/g, '')
    .trim();
  const m = cleaned.match(/^([\w.$]+(?:\s*<[^>]+>)?)/);
  if (!m) {
    return undefined;
  }
  return normalizeTypeHint(m[1]);
}

function normalizeTypeHint(type: string | undefined): string | undefined {
  if (!type) {
    return undefined;
  }
  // List<String> → String for soft matching; also keep List
  const bare = type.replace(/\s+/g, '');
  const simple = bare.replace(/^.*\./, '');
  return simple;
}

function matchesExpectedType(item: JavaCompletionResponseItem, typeHint: string): boolean {
  const hint = typeHint.toLowerCase();
  const hintRoot = hint.replace(/<.*>/, '');
  const hay = `${item.label} ${item.detail ?? ''} ${item.labelDetail ?? ''} ${item.labelDescription ?? ''}`.toLowerCase();
  if (hay.includes(hintRoot)) {
    return true;
  }
  // boolean expect → prefer boolean methods / true/false
  if (hintRoot === 'boolean' && /\b(boolean|true|false|is[a-z]|has[a-z])\b/.test(hay)) {
    return true;
  }
  if ((hintRoot === 'string' || hintRoot === 'charsequence') && /\bstring\b/.test(hay)) {
    return true;
  }
  if ((hintRoot === 'int' || hintRoot === 'integer' || hintRoot === 'long') && /\b(int|integer|long|number)\b/.test(hay)) {
    return true;
  }
  return false;
}

export function mergeResolvedCompletion(
  base: JavaCompletionResponseItem,
  resolved: LSPCompletionItem,
): JavaCompletionResponseItem {
  const adapted = adaptLspCompletion(resolved);
  return {
    ...base,
    detail: adapted.detail ?? base.detail,
    documentation: adapted.documentation ?? base.documentation,
    insertText: adapted.insertText ?? base.insertText,
    insertTextFormat: adapted.insertTextFormat ?? base.insertTextFormat,
    textEdit: adapted.textEdit ?? base.textEdit,
    additionalTextEdits: adapted.additionalTextEdits ?? base.additionalTextEdits,
    commitCharacters: adapted.commitCharacters ?? base.commitCharacters,
    command: adapted.command ?? base.command,
    isDeprecated: adapted.isDeprecated ?? base.isDeprecated,
  };
}

export function lspTextEditToMonacoRange(edit: LSPTextEdit | JavaCompletionTextEdit): {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  newText: string;
} {
  return {
    startLineNumber: edit.range.start.line + 1,
    startColumn: edit.range.start.character + 1,
    endLineNumber: edit.range.end.line + 1,
    endColumn: edit.range.end.character + 1,
    newText: edit.newText,
  };
}
