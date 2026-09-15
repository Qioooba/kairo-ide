// SPDX-License-Identifier: Apache-2.0
//
// IDEA-style reference CodeLens helpers (pure, no Theia/Monaco imports).
//
// JDT LS flow:
//   textDocument/codeLens -> unresolved lenses { range, data=[uri, position, type] }
//   codeLens/resolve      -> resolved lenses { command: { command: 'java.show.references', title: '3 references', arguments: [uri, position, locations] } }
// Without the resolve step Monaco shows nothing (this was the "click method shows no callers" gap).

import type { LSPLocation, LSPCodeLens } from '../common/lsp-protocol';

export const JDT_SHOW_REFERENCES_COMMAND = 'java.show.references';
export const JDT_SHOW_IMPLEMENTATIONS_COMMAND = 'java.show.implementations';

/** Fallback when codeLens/resolve fails: still offer a clickable entry at the lens position. */
export const KAIRO_SHOW_USAGES_AT_LENS_COMMAND = 'kairo.java.showUsagesAtLens';

export interface ShowReferencesLensTarget {
  uri: string;
  line: number;
  character: number;
  locations: LSPLocation[];
}

/**
 * Localize JDT's English lens titles for Chinese users.
 *   "0 references" -> "0 个引用", "1 reference" -> "1 个引用"
 *   "2 implementations" -> "2 个实现"
 * Unknown titles pass through untouched.
 */
export function localizeCodeLensTitle(title: string): string {
  const trimmed = (title ?? '').trim();
  if (!trimmed) return title;
  let m = /^(\d+)\s+references?$/i.exec(trimmed);
  if (m) return `${m[1]} 个引用`;
  m = /^(\d+)\s+implementations?$/i.exec(trimmed);
  if (m) return `${m[1]} 个实现`;
  return title;
}

/** True when the resolved lens is a JDT references lens (any title form). */
export function isReferencesLensCommand(commandId: string | undefined): boolean {
  return commandId === JDT_SHOW_REFERENCES_COMMAND;
}

/** True when the resolved lens is a JDT implementations lens. */
export function isImplementationsLensCommand(commandId: string | undefined): boolean {
  return commandId === JDT_SHOW_IMPLEMENTATIONS_COMMAND;
}

/**
 * Parse `java.show.references` / `java.show.implementations` command arguments
 * as produced by JDT's CodeLensHandler.resolve():
 *   arguments = [uri: string, position: {line, character}, locations: Location[]]
 */
export function parseLensCommandTarget(args: unknown[] | undefined): ShowReferencesLensTarget | undefined {
  if (!Array.isArray(args) || args.length < 2) return undefined;
  const uri = args[0];
  const position = args[1] as { line?: unknown; character?: unknown } | undefined;
  if (typeof uri !== 'string' || !uri) return undefined;
  if (!position || typeof position.line !== 'number' || typeof position.character !== 'number') return undefined;
  const rawLocations = Array.isArray(args[2]) ? (args[2] as unknown[]) : [];
  const locations: LSPLocation[] = [];
  for (const loc of rawLocations) {
    if (!loc || typeof loc !== 'object') continue;
    const l = loc as { uri?: unknown; range?: unknown };
    if (typeof l.uri !== 'string') continue;
    const range = l.range as { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } } | undefined;
    if (!range?.start || !range?.end) continue;
    if (typeof range.start.line !== 'number' || typeof range.start.character !== 'number') continue;
    if (typeof range.end.line !== 'number' || typeof range.end.character !== 'number') continue;
    locations.push({
      uri: l.uri,
      range: {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
      },
    });
  }
  return { uri, line: position.line, character: position.character, locations };
}

/**
 * Rebuild the LSP lens to send to `codeLens/resolve` from a Monaco lens range.
 * Monaco lenses carry no `data` field, so callers must stash the original
 * LSP `data` (see JavaMonacoRegistrationContribution).
 */
export function toResolveRequest(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}, data: unknown): LSPCodeLens {
  return { range, data };
}

/** Key for logging/debugging a lens without leaking full locations. */
export function lensDebugLabel(lens: LSPCodeLens): string {
  const cmd = lens?.command;
  const title = typeof cmd?.title === 'string' ? cmd.title : '(unresolved)';
  const id = typeof cmd?.command === 'string' ? cmd.command : '(no-command)';
  return `${id} "${title}" @${lens?.range?.start?.line}:${lens?.range?.start?.character}`;
}
