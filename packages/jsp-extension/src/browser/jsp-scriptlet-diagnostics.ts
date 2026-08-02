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
  parseVirtualUri,
  virtualUriForBlock,
  virtualWrapperLineCount,
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
 * Convert a 0-based offset to a 0-based line number.
 */
function offsetToLine(content: string, offset: number): number {
  const textBefore = content.substring(0, Math.min(offset, content.length));
  return textBefore.split('\n').length - 1;
}

/**
 * Map an LSP diagnostic from the virtual Java file back to the JSP
 * document coordinate space.
 */
function mapDiagnosticToJsp(
  blockContentStartLine: number,
  javaDiagnostic: LSPDiagnostic,
  wrapperLineCount: number = virtualWrapperLineCount('scriptlet'),
): monaco.editor.IMarkerData {
  const diagLine = javaDiagnostic.range.start.line;
  const diagEndLine = javaDiagnostic.range.end.line;

  const jspStartLine = blockContentStartLine + (diagLine - wrapperLineCount);
  const jspEndLine = blockContentStartLine + (diagEndLine - wrapperLineCount);

  return {
    severity: severityToMarkerSeverity(javaDiagnostic.severity),
    message: javaDiagnostic.message,
    source: javaDiagnostic.source,
    code: javaDiagnostic.code === undefined ? undefined : String(javaDiagnostic.code),
    startLineNumber: Math.max(1, jspStartLine + 1),
    startColumn: javaDiagnostic.range.start.character + 1,
    endLineNumber: Math.max(1, jspEndLine + 1),
    endColumn: javaDiagnostic.range.end.character + 1,
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
    const _markers: monaco.editor.IMarkerData[] = [];

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

  // ── Listen for JSP model creation ────────────────────────────
  const createDisposable = monaco.editor.onDidCreateModel(model => {
    const langId = model.getLanguageId();
    if (langId !== JSP_LANGUAGE_ID) {
      return;
    }

    const uri = model.uri.toString();

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
  });

  // ── Listen for model disposal ────────────────────────────────
  const disposeDisposable = monaco.editor.onWillDisposeModel(model => {
    const uri = model.uri.toString();
    const state = modelStates.get(uri);
    if (state) {
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
    }
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
    const kind = block.kind === 'declaration' ? 'declaration'
      : block.kind === 'expression' ? 'expression'
        : 'scriptlet';

    // Calculate the JSP line where the block content starts.
    // If the first character is a newline, the content starts on the next line.
    const blockTagLine = offsetToLine(content, block.start);
    const contentStartLine = blockContent.startsWith('\n')
      ? blockTagLine + 1
      : blockTagLine;

    const markers = params.diagnostics.map(d =>
      mapDiagnosticToJsp(contentStartLine, d, virtualWrapperLineCount(kind)),
    );

    // Set markers on the JSP model using the JSP diagnostics owner.
    monaco.editor.setModelMarkers(model, 'jsp-scriptlet-java', markers);
  });

  return {
    dispose(): void {
      createDisposable.dispose();
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