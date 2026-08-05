/**
 * Monaco tokenization defaults for large JSP/Java sources.
 *
 * Kairo's large-file policy and Monaco's built-in limits can stop
 * syntax coloring after a few thousand lines; these settings raise
 * the ceilings for code languages.
 */

import * as monaco from '@theia/monaco-editor-core';

/** Languages that must keep Monarch highlighting even in huge files. */
export const KAIRO_SYNTAX_LANGUAGE_IDS = new Set([
  'java',
  'jsp',
  'xml',
  'json',
  'jsonc',
  'properties',
]);

/** Per-editor overrides applied when opening syntax-heavy files. */
export const KAIRO_LANGUAGE_EDITOR_DEFAULTS: monaco.editor.IEditorOptions = {
  // Unlimited rendering — huge-tier policy used to cap at 5_000 lines.
  stopRenderingLineAfter: -1,
};

let applied = false;

/**
 * Set global Monaco defaults once at startup (idempotent).
 * Preference schema in theia-product mirrors these for persistence.
 */
export function applyKairoLanguageEditorDefaults(): void {
  if (applied) {
    return;
  }
  applied = true;
  try {
    const options = (monaco.editor as unknown as { EditorOptions?: { stopRenderingLineAfter?: { defaultValue: number } } }).EditorOptions;
    if (options?.stopRenderingLineAfter) {
      options.stopRenderingLineAfter.defaultValue = -1;
    }
  } catch {
    // Preference schema still applies the same defaults when EditorOptions is unavailable.
  }
}

export function isKairoSyntaxLanguage(languageId: string): boolean {
  return KAIRO_SYNTAX_LANGUAGE_IDS.has(languageId);
}

/**
 * After a model is attached, nudge background tokenization through very
 * large files in idle slices so coloring eventually covers the whole file.
 */
type TokenizableModel = monaco.editor.ITextModel & {
  tokenization: { forceTokenization(lineNumber: number): void };
};

export function scheduleProgressiveTokenization(model: monaco.editor.ITextModel): void {
  if (!isKairoSyntaxLanguage(model.getLanguageId())) {
    return;
  }
  const lineCount = model.getLineCount();
  if (lineCount < 4_000) {
    return;
  }

  const tokenizable = model as TokenizableModel;
  if (typeof tokenizable.tokenization?.forceTokenization !== 'function') {
    return;
  }

  let line = 1;

  const step = (deadline?: IdleDeadline): void => {
    const budgetEnd = Date.now() + (deadline?.timeRemaining?.() ?? 12);
    while (line <= lineCount && Date.now() < budgetEnd) {
      try {
        tokenizable.tokenization.forceTokenization(line);
      } catch {
        return;
      }
      line++;
    }
    if (line <= lineCount) {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(step, { timeout: 2_000 });
      } else {
        setTimeout(() => step(), 16);
      }
    }
  };

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(step, { timeout: 4_000 });
  } else {
    setTimeout(() => step(), 100);
  }
}
