/**
 * JSP Scriptlet Diagnostics Core Engine — KAIRO-W07
 * Pure diagnostics coordinator handling whole-page primacy, fallback block aggregation,
 * SourceMap coordinate translation, and mode gating.
 */

import { JspJavaParser } from './jsp-java-nav';
import {
  buildVirtualJavaFile,
  mapVirtualPositionToBlockOffset,
  parseVirtualUri,
  virtualUriForBlock,
  type JspVirtualKind,
} from './jsp-virtual-java';
import { JspPageModelBuilder, type PageVirtualJavaResult, type JspIncludeResolver, createDefaultJspIncludeResolver } from './jsp-page-model';
import { defaultVirtualDocumentManager } from './virtual-document-manager';

export interface LSPDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: 1 | 2 | 3 | 4;
  code?: number | string;
  source?: string;
  message: string;
}

export interface JspMarkerData {
  severity: number; // 1=Hint, 2=Info, 4=Warning, 8=Error (Monaco MarkerSeverity compatible)
  message: string;
  source?: string;
  code?: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export const JspMarkerSeverity = {
  Hint: 1,
  Info: 2,
  Warning: 4,
  Error: 8,
} as const;

export function lspSeverityToMarkerSeverity(severity: 1 | 2 | 3 | 4 | undefined): number {
  switch (severity) {
    case 1: return JspMarkerSeverity.Error;
    case 2: return JspMarkerSeverity.Warning;
    case 3: return JspMarkerSeverity.Info;
    case 4: return JspMarkerSeverity.Hint;
    default: return JspMarkerSeverity.Error;
  }
}

export interface JspDiagnosticsModel {
  uri: string;
  getValue(): string;
  isDisposed?(): boolean;
}

export interface JspMarkerSink {
  setModelMarkers(modelUri: string, owner: string, markers: JspMarkerData[]): void;
  getOpenModelUris?(): string[];
}

export interface JspDiagnosticsModelState {
  jspUri: string;
  model: JspDiagnosticsModel;
  changeTimer?: any;
  activeVirtualUris: Set<string>;
  contentChangeDisposable?: { dispose(): void };
  pageResult?: PageVirtualJavaResult;
  sequence: number;
  activeDiagnosticMode: 'page' | 'block';
  blockDiagnostics: Map<string, JspMarkerData[]>;
}

export function mapDiagnosticToJsp(
  jspContent: string,
  blockStart: number,
  blockContent: string,
  javaDiagnostic: LSPDiagnostic,
  kind: JspVirtualKind = 'scriptlet',
): JspMarkerData {
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
    severity: lspSeverityToMarkerSeverity(javaDiagnostic.severity),
    message: javaDiagnostic.message,
    source: javaDiagnostic.source ?? 'jsp-java',
    code: javaDiagnostic.code !== undefined ? String(javaDiagnostic.code) : undefined,
    startLineNumber: start.line + 1,
    startColumn: start.character + 1,
    endLineNumber: end.line + 1,
    endColumn: Math.max(1, end.character + 1),
  };
}

export class JspDiagnosticsEngine {
  private parser = new JspJavaParser();
  private modelStates = new Map<string, JspDiagnosticsModelState>();
  private markerSink: JspMarkerSink;
  private includeResolver?: JspIncludeResolver;

  constructor(markerSink: JspMarkerSink, includeResolver?: JspIncludeResolver) {
    this.markerSink = markerSink;
    this.includeResolver = includeResolver;
  }

  getModelState(uri: string): JspDiagnosticsModelState | undefined {
    return this.modelStates.get(uri);
  }

  attachModel(model: JspDiagnosticsModel, initialSequence = 0): JspDiagnosticsModelState {
    const uri = model.uri;
    const existing = this.modelStates.get(uri);
    if (existing) {
      return existing;
    }

    const state: JspDiagnosticsModelState = {
      jspUri: uri,
      model,
      activeVirtualUris: new Set(),
      sequence: initialSequence,
      activeDiagnosticMode: 'page',
      blockDiagnostics: new Map(),
    };
    this.modelStates.set(uri, state);
    return state;
  }

  detachModel(uri: string): void {
    const state = this.modelStates.get(uri);
    if (!state) return;
    if (state.changeTimer) {
      clearTimeout(state.changeTimer);
    }
    if (state.contentChangeDisposable) {
      state.contentChangeDisposable.dispose();
    }
    defaultVirtualDocumentManager.closeAllForJsp(uri);
    this.modelStates.delete(uri);
    this.markerSink.setModelMarkers(uri, 'jsp-scriptlet-java', []);
  }

  async runDiagnostics(state: JspDiagnosticsModelState, seq: number): Promise<void> {
    const content = state.model.getValue();
    const blocks = this.parser.findJavaBlocks(content);

    // 1. Whole-page model synchronization as primary source (W07, F16 / T40 ~ T42)
    const pageBuilder = new JspPageModelBuilder();
    let pageResult: PageVirtualJavaResult | undefined;
    const resolver = this.includeResolver ?? createDefaultJspIncludeResolver();
    try {
      pageResult = await pageBuilder.buildPageVirtualJava(state.jspUri, content, resolver);
    } catch {
      // ignore
    }

    if (state.sequence !== seq || (state.model.isDisposed && state.model.isDisposed())) {
      return;
    }

    const newVirtualUris = new Set<string>();

    if (pageResult) {
      state.activeDiagnosticMode = 'page';
      state.pageResult = pageResult;
      state.blockDiagnostics.clear();
      newVirtualUris.add(pageResult.virtualUri);
      defaultVirtualDocumentManager.syncDocument(pageResult.virtualUri, pageResult.virtualJava, 'java', state.jspUri);

      // Close all per-block virtual documents when in whole-page mode
      for (const oldUri of state.activeVirtualUris) {
        if (oldUri !== pageResult.virtualUri) {
          defaultVirtualDocumentManager.closeDocument(oldUri);
        }
      }
      state.activeVirtualUris = newVirtualUris;
      return;
    }

    // 2. Fallback to per-block mode only when whole-page compilation failed
    state.activeDiagnosticMode = 'block';
    state.pageResult = undefined;
    state.blockDiagnostics.clear();

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
      defaultVirtualDocumentManager.syncDocument(virtualUri, virtualJava, 'java', state.jspUri);
    }

    // Close virtual URIs that are no longer active in this JSP file.
    for (const oldUri of state.activeVirtualUris) {
      if (!newVirtualUris.has(oldUri)) {
        defaultVirtualDocumentManager.closeDocument(oldUri);
      }
    }
    state.activeVirtualUris = newVirtualUris;
  }

  handleDiagnosticsNotification(params: { uri: string; diagnostics: LSPDiagnostic[] }): void {
    const parsed = parseVirtualUri(params.uri);
    if (!parsed) {
      return; // Not a JSP virtual URI — ignore.
    }

    const state = this.modelStates.get(parsed.jspUri);
    if (!state || (state.model.isDisposed && state.model.isDisposed())) {
      return;
    }

    const model = state.model;
    const content = model.getValue();

    // Mode gating: drop diagnostics from inactive mode (W07)
    if (state.activeDiagnosticMode === 'page' && !parsed.isPage) {
      return; // Ignore stale per-block diagnostic when whole-page mode is active
    }
    if (state.activeDiagnosticMode === 'block' && parsed.isPage) {
      return; // Ignore stale page diagnostic when fallback block mode is active
    }

    // Whole-page diagnostic mapping via SourceMap (T42 / W07)
    if (parsed.isPage && state.pageResult) {
      const markersForMain: JspMarkerData[] = [];
      const markersForIncluded = new Map<string, JspMarkerData[]>();

      for (const diag of params.diagnostics) {
        const mappedStart = state.pageResult.sourceMap.mapVirtualPositionToJsp(
          diag.range.start.line,
          diag.range.start.character,
        );
        if (mappedStart && mappedStart.inUserCode) {
          const mappedEnd = state.pageResult.sourceMap.mapVirtualPositionToJsp(
            diag.range.end.line,
            diag.range.end.character,
          );
          const marker: JspMarkerData = {
            severity: lspSeverityToMarkerSeverity(diag.severity),
            message: diag.message,
            source: diag.source ?? 'jsp-java',
            code: diag.code !== undefined ? String(diag.code) : undefined,
            startLineNumber: mappedStart.line + 1,
            startColumn: mappedStart.character + 1,
            endLineNumber: (mappedEnd?.line ?? mappedStart.line) + 1,
            endColumn: (mappedEnd?.character ?? mappedStart.character + 1) + 1,
          };

          if (mappedStart.sourceUri === state.jspUri) {
            markersForMain.push(marker);
          } else {
            let list = markersForIncluded.get(mappedStart.sourceUri);
            if (!list) {
              list = [];
              markersForIncluded.set(mappedStart.sourceUri, list);
            }
            list.push(marker);
          }
        }
      }

      // Set markers on main JSP model
      this.markerSink.setModelMarkers(state.jspUri, 'jsp-scriptlet-java', markersForMain);

      // Set markers on included open models without polluting the main model
      if (this.markerSink.getOpenModelUris) {
        const openUris = new Set(this.markerSink.getOpenModelUris());
        for (const [incUri, incMarkers] of markersForIncluded.entries()) {
          if (openUris.has(incUri)) {
            this.markerSink.setModelMarkers(incUri, 'jsp-scriptlet-java', incMarkers);
          }
        }
      }
      return;
    }

    // Fallback: per-block diagnostic aggregation (W07)
    if (parsed.blockIndex === undefined) {
      return;
    }

    const blocks = this.parser.findJavaBlocks(content);
    if (parsed.blockIndex >= blocks.length) {
      return;
    }

    const block = blocks[parsed.blockIndex];
    const blockContent = content.slice(block.start, block.end);
    const kind: JspVirtualKind = block.kind === 'declaration' ? 'declaration'
      : block.kind === 'expression' ? 'expression'
        : 'scriptlet';

    const blockMarkers: JspMarkerData[] = [];
    for (const diag of params.diagnostics) {
      const marker = mapDiagnosticToJsp(content, block.start, blockContent, diag, kind);
      blockMarkers.push(marker);
    }

    // Aggregate into state.blockDiagnostics map and flush all blocks together
    state.blockDiagnostics.set(params.uri, blockMarkers);

    const aggregatedMarkers: JspMarkerData[] = [];
    for (const markers of state.blockDiagnostics.values()) {
      aggregatedMarkers.push(...markers);
    }
    this.markerSink.setModelMarkers(state.jspUri, 'jsp-scriptlet-java', aggregatedMarkers);
  }
}
