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
//   * didChange is debounced (default 100 ms) and sends the
//     full document text (the manager's LSP connection does
//     not negotiate incremental sync). Call flushPending()
//     before completion so the LS sees the latest buffer.
//   * didClose is sent only for documents whose didOpen was
//     actually delivered.
//   * All client calls are guarded: failures are logged via
//     ILogger, never thrown.

import { LSPDiagnostic } from '../common/lsp-protocol';

/** Minimal structural view of JavaLanguageClient used here. */
export interface JavaDocumentSyncClient {
  state(): string;
  didOpen(p: { uri: string; languageId: string; version: number; text: string }): void;
  didChange(p: { uri: string; version: number; changes: { text: string; rangeLength?: number }[] }): void;
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
  text: string;
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
      openSent: existing?.openSent ?? false,
      timer: undefined,
    });
    this.flushOpen(snapshot.uri);
  }

  /** Model content changed; sync is debounced, full-text. */
  changeDocument(uri: string, version: number, text: string): void {
    const doc = this.docs.get(uri);
    if (!doc) {
      return;
    }
    doc.version = version;
    doc.text = text;
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
    for (const doc of this.docs.values()) {
      if (doc.timer) {
        clearTimeout(doc.timer);
      }
    }
    this.docs.clear();
  }

  private flushOpen(uri: string): void {
    const doc = this.docs.get(uri);
    if (!doc || doc.openSent || this.effectiveState() !== 'ready') {
      return;
    }
    try {
      this.client.didOpen({ uri, languageId: doc.languageId, version: doc.version, text: doc.text });
      doc.openSent = true;
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
      this.client.didChange({ uri, version: doc.version, changes: [{ text: doc.text }] });
    } catch (err) {
      this.logger.warn(`[JavaDocumentSync] didChange failed for ${uri}: ${String(err)}`);
    }
  }
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
