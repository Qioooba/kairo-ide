/**
 * JSP Scriptlet Diagnostics Provider — real-time Java error checking
 * inside <% %> blocks.
 *
 * Extracts Java code blocks from JSP content, wraps them in a virtual
 * Java class, sends them to JDT LS for diagnostics, then maps the
 * resulting diagnostic positions back to JSP coordinates.
 */

import * as monaco from '@theia/monaco-editor-core';
import { JavaLanguageClient } from '@kairo/java-extension';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser } from './jsp-java-nav';
import {
  buildVirtualJavaFile,
  mapVirtualPositionToBlockOffset,
  parseVirtualUri,
  virtualUriForBlock,
  type JspVirtualKind,
} from './jsp-virtual-java';

/** Minimal LSP diagnostic shape we need for mapping. */
interface LSPDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: 1 | 2 | 3 | 4;
  code?: number | string;
  source?: string;
  message: string;
}

/** Debounce interval for sending diagnostics requests (ms). */
const DIAGNOSTICS_DEBOUNCE_MS = 500;

/**
 * Map an LSP diagnostic from the virtual Java file back to the JSP
 * document coordinate space.
 *
 * Accounts for the block's starting column on the first content line
 * and subtracts the expression rewrite prefix (`Object __expr = `).
 */
export function mapDiagnosticToJsp(
  jspContent: string,
  blockStart: number,
  blockContent: string,
  javaDiagnostic: LSPDiagnostic,
  kind: JspVirtualKind = 'scriptlet',
): monaco.editor.IMarkerData {
  const parser = new JspJavaParser();
  const blockOrigin = parser.offsetToPosition(jspContent, blockStart);

  const mapPos = (javaLine: number, javaChar: number): { line: number; character: number } => {
    const mapped = mapVirtualPositionToBlockOffset(blockContent, javaLine, javaChar, kind);
    if (!mapped) {
      return blockOrigin;
    }
    if (mapped.lineInBlock === 0) {
      return {
        line: blockOrigin.line,
        character: blockOrigin.character + mapped.characterInBlock,
      };
    }
    return {
      line: blockOrigin.line + mapped.lineInBlock,
      character: mapped.characterInBlock,
    };
  };

  const start = mapPos(javaDiagnostic.range.start.line, javaDiagnostic.range.start.character);
  const end = mapPos(javaDiagnostic.range.end.line, javaDiagnostic.range.end.character);

  return {
    severity: severityToMarkerSeverity(javaDiagnostic.severity),
    message: javaDiagnostic.message,
    source: javaDiagnostic.source,
    code: javaDiagnostic.code === undefined ? undefined : String(javaDiagnostic.code),
    startLineNumber: Math.max(1, start.line + 1),
    startColumn: Math.max(1, start.character + 1),
    endLineNumber: Math.max(1, end.line + 1),
    endColumn: Math.max(1, end.character + 1),
  };
}

/** Convert LSP DiagnosticSeverity to monaco.MarkerSeverity. */
function severityToMarkerSeverity(severity: 1 | 2 | 3 | 4 | undefined): monaco.MarkerSeverity {
  switch (severity) {
    case 1: return monaco.MarkerSeverity.Error;
    case 2: return monaco.MarkerSeverity.Warning;
    case 3: return monaco.MarkerSeverity.Info;
    case 4: return monaco.MarkerSeverity.Hint;
    default: return monaco.MarkerSeverity.Error;
  }
}

/** Per-model tracking state. */
interface ModelState {
  jspUri: string;
  model: monaco.editor.ITextModel;
  changeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Active virtual URIs that have been sent to JDT LS. */
  activeVirtualUris: Set<string>;
  /** Disposable for the model's content change listener. */
  contentChangeDisposable: monaco.IDisposable;
}

/**
 * Register real-time Java diagnostics for JSP scriptlet blocks.
 *
 * @param client The JavaLanguageClient (JDT LS bridge).
 * @returns A disposable that unregisters all listeners.
 */
export function registerJspScriptletDiagnostics(
  client: JavaLanguageClient,
): monaco.IDisposable {
  const parser = new JspJavaParser();
  const modelStates = new Map<string, ModelState>();

  /**
   * Run diagnostics for a single JSP model.
   */
  function runDiagnostics(state: ModelState): void {
    const content = state.model.getValue();
    const blocks = parser.findJavaBlocks(content);

    const newVirtualUris = new Set<string>();

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.kind === 'directive') {
        continue;
      }
      const blockContent = content.slice(block.start, block.end);
      const virtualUri = virtualUriForBlock(state.jspUri, i);
      newVirtualUris.add(virtualUri);

      const kind = block.kind === 'declaration' ? 'declaration'
        : block.kind === 'expression' ? 'expression'
          : 'scriptlet';
      const virtualJava = buildVirtualJavaFile(blockContent, kind);
      try {
        client.didOpen({
          uri: virtualUri,
          languageId: 'java',
          version: state.model.getVersionId(),
          text: virtualJava,
        });
      } catch {
        // JDT LS may not be ready; skip silently.
      }
    }

    // Close virtual URIs that are no longer active.
    for (const oldUri of state.activeVirtualUris) {
      if (!newVirtualUris.has(oldUri)) {
        try {
          client.didClose(oldUri);
        } catch {
          // Ignore close errors.
        }
      }
    }
    state.activeVirtualUris = newVirtualUris;
  }

  /**
   * Schedule a debounced diagnostics run for a model.
   */
  function scheduleDiagnostics(state: ModelState): void {
    if (state.changeTimer) {
      clearTimeout(state.changeTimer);
    }
    state.changeTimer = setTimeout(() => {
      state.changeTimer = undefined;
      runDiagnostics(state);
    }, DIAGNOSTICS_DEBOUNCE_MS);
  }

  // ── Attach diagnostics to a JSP model ────────────────────────
  function attachModel(model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    if (modelStates.has(uri)) {
      return;
    }

    // Listen for content changes on this specific model.
    const contentChangeDisposable = model.onDidChangeContent(() => {
      const state = modelStates.get(uri);
      if (!state) {
        return;
      }
      scheduleDiagnostics(state);
    });

    const state: ModelState = {
      jspUri: uri,
      model,
      changeTimer: undefined,
      activeVirtualUris: new Set(),
      contentChangeDisposable,
    };
    modelStates.set(uri, state);

    // Run initial diagnostics immediately.
    scheduleDiagnostics(state);
  }

  function detachModel(model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    const state = modelStates.get(uri);
    if (!state) {
      return;
    }
    if (state.changeTimer) {
      clearTimeout(state.changeTimer);
    }
    state.contentChangeDisposable.dispose();
    // Close all virtual URIs for this model.
    for (const virtualUri of state.activeVirtualUris) {
      try {
        client.didClose(virtualUri);
      } catch {
        // Ignore.
      }
    }
    modelStates.delete(uri);
    monaco.editor.setModelMarkers(model, 'jsp-scriptlet-java', []);
  }

  // ── Listen for JSP model creation ────────────────────────────
  const createDisposable = monaco.editor.onDidCreateModel(model => {
    if (model.getLanguageId() === JSP_LANGUAGE_ID) {
      attachModel(model);
    }
  });

  // Already-open JSP models (created before this provider registered) — JV-P2-8
  for (const model of monaco.editor.getModels()) {
    if (model.getLanguageId() === JSP_LANGUAGE_ID) {
      attachModel(model);
    }
  }

  // Language id switches (e.g. plain text → jsp) — JV-P2-8
  const languageDisposable = monaco.editor.onDidChangeModelLanguage(e => {
    const newLanguage = e.model.getLanguageId();
    if (e.oldLanguage === JSP_LANGUAGE_ID && newLanguage !== JSP_LANGUAGE_ID) {
      detachModel(e.model);
    } else if (newLanguage === JSP_LANGUAGE_ID) {
      attachModel(e.model);
    }
  });

  // ── Listen for model disposal ────────────────────────────────
  const disposeDisposable = monaco.editor.onWillDisposeModel(model => {
    detachModel(model);
  });

  // ── Listen for diagnostics from JDT LS ───────────────────────
  const diagnosticsDisposable = client.onDiagnostics(params => {
    const parsed = parseVirtualUri(params.uri);
    if (!parsed) {
      return; // Not a JSP virtual URI — ignore.
    }

    const state = modelStates.get(parsed.jspUri);
    if (!state) {
      return;
    }

    const model = state.model;
    const content = model.getValue();
    const blocks = parser.findJavaBlocks(content);

    if (parsed.blockIndex >= blocks.length) {
      return;
    }

    const block = blocks[parsed.blockIndex];
    const blockContent = content.slice(block.start, block.end);
    const kind: JspVirtualKind = block.kind === 'declaration' ? 'declaration'
      : block.kind === 'expression' ? 'expression'
        : 'scriptlet';

    const markers = params.diagnostics.map(d =>
      mapDiagnosticToJsp(content, block.start, blockContent, d, kind),
    );

    // Set markers on the JSP model using the JSP diagnostics owner.
    monaco.editor.setModelMarkers(model, 'jsp-scriptlet-java', markers);
  });

  return {
    dispose(): void {
      createDisposable.dispose();
      languageDisposable.dispose();
      disposeDisposable.dispose();
      diagnosticsDisposable.dispose();
      // Clean up all model states.
      for (const state of modelStates.values()) {
        if (state.changeTimer) {
          clearTimeout(state.changeTimer);
        }
        state.contentChangeDisposable.dispose();
        for (const virtualUri of state.activeVirtualUris) {
          try {
            client.didClose(virtualUri);
          } catch {
            // Ignore.
          }
        }
      }
      modelStates.clear();
    },
  };
}