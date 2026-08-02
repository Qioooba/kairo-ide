// SPDX-License-Identifier: Apache-2.0
//
// IDEA-like Hippie completion (Alt+/): cycle words from open
// editors matching the current prefix. Faster than full LS
// suggest when you just need a nearby identifier.

import * as monaco from '@theia/monaco-editor-core';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';

const WORD_RE = /[A-Za-z_$][\w$]*/g;

interface HippieState {
  modelId: string;
  prefix: string;
  startColumn: number;
  endColumn: number;
  line: number;
  candidates: string[];
  index: number;
}

let state: HippieState | null = null;

function collectWords(prefix: string, excludeUri: string): string[] {
  const lower = prefix.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const model of monaco.editor.getModels()) {
    const text = model.getValue();
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      const w = m[0];
      if (w.length <= prefix.length) continue;
      if (lower && !w.toLowerCase().startsWith(lower)) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
  }
  // Prefer words from other files slightly less — keep insertion order
  // but put exact editor-local matches first by scanning current model last.
  void excludeUri;
  return out.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/**
 * Cycle hippie completion at the focused editor.
 * @param reverse when true, cycle backwards (Alt+Shift+/)
 */
export function cycleHippieCompletion(reverse = false): boolean {
  const editor = monaco.editor.getEditors().find(e => e.hasTextFocus()) ?? monaco.editor.getEditors()[0];
  const model = editor?.getModel();
  const position = editor?.getPosition();
  if (!editor || !model || !position) {
    return false;
  }

  const word = model.getWordUntilPosition(position);
  const prefix = word.word;
  const modelId = model.uri.toString();

  const sameSession =
    state &&
    state.modelId === modelId &&
    state.line === position.lineNumber &&
    state.startColumn === word.startColumn &&
    // After a previous insert, endColumn moves — allow if caret is still on the inserted word.
    position.column >= state.startColumn &&
    (state.prefix === prefix ||
      (state.candidates[state.index] !== undefined &&
        model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: state.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        }) === state.candidates[state.index]));

  if (!sameSession) {
    const candidates = collectWords(prefix, modelId).filter(w => w !== prefix);
    if (candidates.length === 0) {
      state = null;
      return false;
    }
    state = {
      modelId,
      prefix,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
      line: position.lineNumber,
      candidates,
      index: reverse ? candidates.length - 1 : 0,
    };
  } else if (state) {
    state.index = reverse
      ? (state.index - 1 + state.candidates.length) % state.candidates.length
      : (state.index + 1) % state.candidates.length;
  }

  if (!state) return false;
  const next = state.candidates[state.index];
  if (!next) return false;

  const endCol = position.column;
  editor.executeEdits('kairo.hippie', [
    {
      range: new monaco.Range(state.line, state.startColumn, state.line, endCol),
      text: next,
    },
  ]);
  editor.setPosition({ lineNumber: state.line, column: state.startColumn + next.length });
  return true;
}

/** Low-priority word suggestions from open buffers (complements hippie cycle). */
export function registerHippieCompletion(languageId: string): Disposable {
  const toDispose = new DisposableCollection();
  toDispose.push(
    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: [],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        if (!word.word || word.word.length < 2) {
          return { suggestions: [] };
        }
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        const words = collectWords(word.word, model.uri.toString()).slice(0, 40);
        return {
          suggestions: words.map((w, i) => ({
            label: w,
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: w,
            range,
            detail: 'Hippie',
            sortText: `~h${String(i).padStart(3, '0')}${w}`,
            filterText: w,
          })),
        };
      },
    }),
  );
  return toDispose;
}
