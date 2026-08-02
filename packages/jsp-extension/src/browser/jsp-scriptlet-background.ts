/**
 * JSP scriptlet / expression / declaration region decorations.
 *
 * Kind-specific left borders + backgrounds make injected Java easier
 * to scan than IDEA's uniform injected-fragment tint.
 */

import * as monaco from '@theia/monaco-editor-core';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser, type JavaBlock } from './jsp-java-nav';

const DEBOUNCE_MS = 80;

const CLASS_BY_KIND: Record<Exclude<JavaBlock['kind'], 'directive'>, string> = {
  scriptlet: 'kairo-jsp-scriptlet-line',
  expression: 'kairo-jsp-expr-line',
  declaration: 'kairo-jsp-decl-line',
};

interface ModelDecorState {
  model: monaco.editor.ITextModel;
  ids: string[];
  timer: ReturnType<typeof setTimeout> | undefined;
  contentSub: monaco.IDisposable;
  langSub: monaco.IDisposable;
}

function openTagStart(content: string, block: JavaBlock): number {
  const slice = content.slice(0, block.start);
  const m = /<%[=!@]?\s*$/.exec(slice);
  return m ? block.start - m[0].length : block.start;
}

function closeTagEnd(content: string, block: JavaBlock): number {
  return content.startsWith('%>', block.end) ? block.end + 2 : block.end;
}

export function decorationsFor(model: monaco.editor.ITextModel): monaco.editor.IModelDeltaDecoration[] {
  const content = model.getValue();
  const blocks = new JspJavaParser().findJavaBlocks(content);
  const out: monaco.editor.IModelDeltaDecoration[] = [];

  for (const block of blocks) {
    if (block.kind === 'directive') continue;
    const from = openTagStart(content, block);
    const to = closeTagEnd(content, block);
    if (to <= from) continue;
    const start = model.getPositionAt(from);
    const end = model.getPositionAt(Math.min(to, content.length));
    out.push({
      range: new monaco.Range(
        start.lineNumber,
        1,
        end.lineNumber,
        model.getLineMaxColumn(end.lineNumber),
      ),
      options: {
        isWholeLine: true,
        className: CLASS_BY_KIND[block.kind],
        overviewRuler: {
          color: block.kind === 'expression'
            ? 'rgba(106,135,89,0.7)'
            : block.kind === 'declaration'
              ? 'rgba(187,181,41,0.7)'
              : 'rgba(104,151,187,0.7)',
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    });
  }
  return out;
}

function applyDecorations(state: ModelDecorState): void {
  if (state.model.isDisposed() || state.model.getLanguageId() !== JSP_LANGUAGE_ID) {
    state.ids = state.model.isDisposed() ? [] : state.model.deltaDecorations(state.ids, []);
    return;
  }
  state.ids = state.model.deltaDecorations(state.ids, decorationsFor(state.model));
}

export function registerJspScriptletBackgrounds(): Disposable {
  const subs = new DisposableCollection();
  const states = new Map<string, ModelDecorState>();

  const attach = (model: monaco.editor.ITextModel): void => {
    const uri = model.uri.toString();
    if (states.has(uri)) return;

    const state: ModelDecorState = {
      model,
      ids: [],
      timer: undefined,
      contentSub: model.onDidChangeContent(() => {
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => applyDecorations(state), DEBOUNCE_MS);
      }),
      langSub: model.onDidChangeLanguage(() => applyDecorations(state)),
    };
    states.set(uri, state);
    applyDecorations(state);
  };

  for (const model of monaco.editor.getModels()) {
    if (model.getLanguageId() === JSP_LANGUAGE_ID) attach(model);
  }

  subs.push(monaco.editor.onDidCreateModel(model => {
    if (model.getLanguageId() === JSP_LANGUAGE_ID) {
      attach(model);
      return;
    }
    const langOnce = model.onDidChangeLanguage(() => {
      if (model.getLanguageId() === JSP_LANGUAGE_ID) {
        attach(model);
        langOnce.dispose();
      }
    });
    subs.push(langOnce);
  }));

  subs.push(monaco.editor.onWillDisposeModel(model => {
    const uri = model.uri.toString();
    const state = states.get(uri);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.contentSub.dispose();
    state.langSub.dispose();
    if (state.ids.length && !model.isDisposed()) {
      model.deltaDecorations(state.ids, []);
    }
    states.delete(uri);
  }));

  subs.push(Disposable.create(() => {
    for (const state of states.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.contentSub.dispose();
      state.langSub.dispose();
      if (!state.model.isDisposed() && state.ids.length) {
        state.model.deltaDecorations(state.ids, []);
      }
    }
    states.clear();
  }));

  return subs;
}
