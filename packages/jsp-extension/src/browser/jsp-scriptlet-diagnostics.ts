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
import { defaultVirtualDocumentManager } from './virtual-document-manager';
import {
  JspDiagnosticsEngine,
  JspMarkerSink,
  JspMarkerData,
  mapDiagnosticToJsp,
  LSPDiagnostic,
  JspMarkerSeverity,
  lspSeverityToMarkerSeverity,
} from './jsp-scriptlet-diagnostics-core';

export {
  mapDiagnosticToJsp,
  LSPDiagnostic,
  JspMarkerData,
  JspMarkerSeverity,
  lspSeverityToMarkerSeverity,
  JspDiagnosticsEngine,
};

/** Debounce interval for sending diagnostics requests (ms). */
const DIAGNOSTICS_DEBOUNCE_MS = 500;

/**
 * Register real-time Java diagnostics for JSP scriptlet blocks.
 *
 * @param client The JavaLanguageClient (JDT LS bridge).
 * @returns A disposable that unregisters all listeners.
 */
export function registerJspScriptletDiagnostics(
  client: JavaLanguageClient,
): monaco.IDisposable {
  defaultVirtualDocumentManager.setClient(client);

  const markerSink: JspMarkerSink = {
    setModelMarkers(modelUri: string, owner: string, markers: JspMarkerData[]) {
      const model = monaco.editor.getModels().find(m => m.uri.toString() === modelUri);
      if (model && !model.isDisposed()) {
        monaco.editor.setModelMarkers(model, owner, markers as monaco.editor.IMarkerData[]);
      }
    },
    getOpenModelUris(): string[] {
      return monaco.editor.getModels().map(m => m.uri.toString());
    },
  };

  const engine = new JspDiagnosticsEngine(markerSink);

  function scheduleModelDiagnostics(uri: string): void {
    const state = engine.getModelState(uri);
    if (!state) return;
    if (state.changeTimer) {
      clearTimeout(state.changeTimer);
    }
    state.sequence++;
    const seq = state.sequence;
    state.changeTimer = setTimeout(() => {
      state.changeTimer = undefined;
      engine.runDiagnostics(state, seq);
    }, DIAGNOSTICS_DEBOUNCE_MS);
  }

  function attachModel(model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    const state = engine.attachModel({
      uri,
      getValue: () => model.getValue(),
      isDisposed: () => model.isDisposed(),
    });

    const disposable = model.onDidChangeContent(() => {
      scheduleModelDiagnostics(uri);
    });
    state.contentChangeDisposable = disposable;

    scheduleModelDiagnostics(uri);
  }

  function detachModel(model: monaco.editor.ITextModel): void {
    engine.detachModel(model.uri.toString());
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
    engine.handleDiagnosticsNotification(params);
  });

  return {
    dispose(): void {
      createDisposable.dispose();
      languageDisposable.dispose();
      disposeDisposable.dispose();
      diagnosticsDisposable.dispose();

      for (const uri of markerSink.getOpenModelUris ? markerSink.getOpenModelUris() : []) {
        engine.detachModel(uri);
      }
    },
  };
}