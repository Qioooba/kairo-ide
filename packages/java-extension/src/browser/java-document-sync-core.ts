// SPDX-License-Identifier: Apache-2.0
//
// Document sync core for the JDT LS bridge — monaco-free so
// it stays unit-testable headless (the monaco import cannot
// be require()'d in plain node). The browser-side
// JavaDocumentSyncContribution (java-document-sync.ts) feeds
// Monaco model events into this class; this class decides
// when didOpen / didChange / didClose reach the language
// client.
//
// Semantics:
//   * didOpen is only sent once the client reports 'ready';
//     documents opened earlier are buffered and flushed when
//     the state transitions to 'ready'.
//   * didChange is debounced (default 100 ms). Incremental
//     edits accumulate as ranged content changes (the manager
//     negotiates TextDocumentSyncKind.Incremental); a shadow
//     copy of the text is maintained locally so a late didOpen
//     (server restart) still sends the full buffer. Call
//     flushPending() before completion so the LS sees the
//     latest buffer.
//   * didClose is sent only for documents whose didOpen was
//     actually delivered.
//   * All client calls are guarded: failures are logged via
//     ILogger, never thrown.

import { LSPDiagnostic } from '../common/lsp-protocol';

/** LSP Position (0-based line/character). */
export interface LspPosition { line: number; character: number; }

/** LSP Range with 0-based positions. */
export interface LspRange { start: LspPosition; end: LspPosition; }

/**
 * LSP TextDocumentContentChangeEvent plus internal fast-path offsets
 * (`offset`/`endOffset`) supplied by the Monaco adapter so shadow-text
 * splicing needs no line scanning. They are stripped before transport.
 */
export interface LspContentChange {
  range?: LspRange;
  rangeLength?: number;
  text: string;
  /** Internal: absolute start offset of the replaced span. */
  offset?: number;
  /** Internal: absolute end offset of the replaced span. */
  endOffset?: number;
}

/** Minimal structural view of JavaLanguageClient used here. */
export interface JavaDocumentSyncClient {
  state(): string;
  didOpen(p: { uri: string; languageId: string; version: number; text: string }): void;
  didChange(p: { uri: string; version: number; changes: LspContentChange[] }): void;
  didClose(uri: string): void;
}

/** Minimal structural view of ILogger used here. */
export interface JavaDocumentSyncLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface JavaDocumentSnapshot {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

interface TrackedDocument {
  languageId: string;
  version: number;
  /** Shadow of the document buffer (used for didOpen / full-text fallback). */
  text: string;
  /** Ranged changes accumulated since the last flushed didChange. */
  pendingChanges: LspContentChange[];
  /** didOpen was delivered to the server. */
  openSent: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export const JAVA_DOCUMENT_SYNC_DEBOUNCE_MS = 100;

export class JavaDocumentSync {
  private readonly docs = new Map<string, TrackedDocument>();

  constructor(
    private readonly client: JavaDocumentSyncClient,
    private readonly logger: JavaDocumentSyncLogger,
    private readonly debounceMs: number = JAVA_DOCUMENT_SYNC_DEBOUNCE_MS,
  ) {}

  /**
   * Last state reported through handleStateChange, or undefined
   * until the first transition arrives. The client's sync
   * `state()` reads the in-process service — permanently
   * 'uninitialized' in the web product (backend RPC hosting,
   * KAIRO-RC-WEB-251) — so guards prefer this tracked value
   * (fed by RPC-delivered onState events) and only fall back to
   * the client before the first event.
   */
  protected currentState: string | undefined;

  protected effectiveState(): string {
    return this.currentState ?? this.client.state();
  }

  /** A Java model appeared in the editor. */
  openDocument(snapshot: JavaDocumentSnapshot): void {
    const existing = this.docs.get(snapshot.uri);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    this.docs.set(snapshot.uri, {
      languageId: snapshot.languageId,
      version: snapshot.version,
      text: snapshot.text,
      pendingChanges: [],
      openSent: existing?.openSent ?? false,
      timer: undefined,
    });
    this.flushOpen(snapshot.uri);
  }

  /** Model content changed; sync is debounced, full-text (legacy path). */
  changeDocument(uri: string, version: number, text: string): void {
    const doc = this.docs.get(uri);
    if (!doc) {
      return;
    }
    doc.version = version;
    doc.text = text;
    // Full-text replaces any accumulated ranged edits.
    doc.pendingChanges = [{ text }];
    this.scheduleFlush(uri, doc);
  }

  /**
   * Model content changed with Monaco-provided ranged edits. The shadow
   * text is spliced locally so a later didOpen still sends a correct
   * full buffer; the accumulated ranges go out in one debounced didChange.
   */
  changeDocumentIncremental(uri: string, version: number, changes: LspContentChange[]): void {
    const doc = this.docs.get(uri);
    if (!doc || changes.length === 0) {
      return;
    }
    doc.version = version;
    for (const change of changes) {
      doc.text = applyContentChange(doc.text, change, this.logger);
      doc.pendingChanges.push({ range: change.range, rangeLength: change.rangeLength, text: change.text });
    }
    this.scheduleFlush(uri, doc);
  }

  private scheduleFlush(uri: string, doc: TrackedDocument): void {
    if (doc.timer) {
      clearTimeout(doc.timer);
    }
    doc.timer = setTimeout(() => {
      doc.timer = undefined;
      this.flushChange(uri);
    }, this.debounceMs);
  }

  /** Model was disposed. */
  closeDocument(uri: string): void {
    const doc = this.docs.get(uri);
    if (!doc) {
      return;
    }
    if (doc.timer) {
      clearTimeout(doc.timer);
    }
    this.docs.delete(uri);
    if (doc.openSent && this.effectiveState() === 'ready') {
      try {
        this.client.didClose(uri);
      } catch (err) {
        this.logger.warn(`[JavaDocumentSync] didClose failed for ${uri}: ${String(err)}`);
      }
    }
  }

  /**
   * Client state transition. On 'ready', flush buffered
   * didOpens; on any other state, mark documents as not yet
   * opened so a later 'ready' re-sends them (server restart).
   */
  handleStateChange(state: string): void {
    this.currentState = state;
    if (state === 'ready') {
      for (const uri of this.docs.keys()) {
        this.flushOpen(uri);
      }
      return;
    }
    for (const doc of this.docs.values()) {
      doc.openSent = false;
    }
  }

  /** Number of tracked documents (test/diagnostics hook). */
  get size(): number {
    return this.docs.size;
  }

  /**
   * Immediately flush any pending debounced didChange for one
   * URI (or all tracked URIs). Call before completion / hover
   * so the language server is not answering against a stale buffer.
   */
  flushPending(uri?: string): void {
    if (uri) {
      const doc = this.docs.get(uri);
      if (doc?.timer) {
        clearTimeout(doc.timer);
        doc.timer = undefined;
        this.flushChange(uri);
      }
      return;
    }
    for (const [trackedUri, doc] of this.docs) {
      if (doc.timer) {
        clearTimeout(doc.timer);
        doc.timer = undefined;
        this.flushChange(trackedUri);
      }
    }
  }

  dispose(): void {
    for (const [uri, doc] of this.docs) {
      if (doc.timer) {
        clearTimeout(doc.timer);
      }
      if (doc.openSent && this.effectiveState() === 'ready') {
        try {
          this.client.didClose(uri);
        } catch (err) {
          this.logger.warn(`[JavaDocumentSync] didClose failed on dispose for ${uri}: ${String(err)}`);
        }
      }
    }
    this.docs.clear();
  }

  /**
   * Reset all tracked documents on workspace switch (T46).
   * Ensures documents from the old workspace do not leak to the new workspace.
   */
  resetWorkspace(): void {
    this.dispose();
  }

  private flushOpen(uri: string): void {
    const doc = this.docs.get(uri);
    if (!doc || doc.openSent || this.effectiveState() !== 'ready') {
      return;
    }
    try {
      this.client.didOpen({ uri, languageId: doc.languageId, version: doc.version, text: doc.text });
      doc.openSent = true;
      // The server now has the full buffer; ranged edits start fresh.
      doc.pendingChanges = [];
    } catch (err) {
      this.logger.warn(`[JavaDocumentSync] didOpen failed for ${uri}: ${String(err)}`);
    }
  }

  private flushChange(uri: string): void {
    const doc = this.docs.get(uri);
    if (!doc || this.effectiveState() !== 'ready') {
      return;
    }
    if (!doc.openSent) {
      this.flushOpen(uri);
      return;
    }
    try {
      // Incremental when ranged edits accumulated; full-text fallback
      // otherwise (legacy changeDocument path).
      const changes = doc.pendingChanges.length > 0
        ? doc.pendingChanges
        : [{ text: doc.text }];
      doc.pendingChanges = [];
      this.client.didChange({ uri, version: doc.version, changes });
    } catch (err) {
      this.logger.warn(`[JavaDocumentSync] didChange failed for ${uri}: ${String(err)}`);
    }
  }
}

/**
 * Splices a content change into the shadow text. Prefers the adapter's
 * absolute offsets; falls back to LSP range math. On unrecoverable drift
 * the previous shadow is returned and the problem logged.
 */
function applyContentChange(text: string, change: LspContentChange, logger: JavaDocumentSyncLogger): string {
  const insert = change.text ?? '';
  if (change.offset !== undefined && change.endOffset !== undefined) {
    const { offset, endOffset } = change;
    if (offset >= 0 && endOffset >= offset && endOffset <= text.length) {
      return text.slice(0, offset) + insert + text.slice(endOffset);
    }
  }
  if (change.range) {
    const start = positionToOffset(text, change.range.start);
    const end = positionToOffset(text, change.range.end);
    if (start >= 0 && end >= start && end <= text.length) {
      return text.slice(0, start) + insert + text.slice(end);
    }
  }
  logger.warn('[JavaDocumentSync] incremental change out of bounds; shadow text may be stale');
  return text;
}

/** Converts an LSP position to an absolute offset; -1 when out of range. */
function positionToOffset(text: string, pos: LspPosition): number {
  if (pos.line < 0 || pos.character < 0) return -1;
  let offset = 0;
  for (let line = 0; line < pos.line; line++) {
    const nl = text.indexOf('\n', offset);
    if (nl < 0) return -1;
    offset = nl + 1;
  }
  const target = offset + pos.character;
  if (target > text.length) return -1;
  return target;
}

/* ------------------------------------------------------------------ */
/*  Diagnostics → Monaco markers (pure conversions)                    */
/* ------------------------------------------------------------------ */

/**
 * Numeric values matching monaco.MarkerSeverity
 * (Hint=1, Info=2, Warning=4, Error=8). Declared as literals
 * so this module never imports monaco.
 */
export type MonacoMarkerSeverityValue = 1 | 2 | 4 | 8;

/** Map LSP DiagnosticSeverity (1=Error … 4=Hint) to monaco.MarkerSeverity. */
export function toMonacoMarkerSeverity(severity: 1 | 2 | 3 | 4 | undefined): MonacoMarkerSeverityValue {
  switch (severity) {
    case 1: return 8; // Error
    case 2: return 4; // Warning
    case 3: return 2; // Information
    case 4: return 1; // Hint
    default: return 8; // LSP: missing severity means the client decides; treat as error
  }
}

/** Plain-object mirror of monaco.editor.IMarkerData (1-based positions). */
export interface JavaMarkerData {
  severity: MonacoMarkerSeverityValue;
  message: string;
  source?: string;
  code?: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** Convert LSP diagnostics (0-based) to monaco marker data (1-based). */
export function lspDiagnosticsToMarkers(diagnostics: LSPDiagnostic[]): JavaMarkerData[] {
  return diagnostics.map(d => ({
    severity: toMonacoMarkerSeverity(d.severity),
    message: d.message,
    source: d.source,
    code: d.code === undefined ? undefined : String(d.code),
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
  }));
}
