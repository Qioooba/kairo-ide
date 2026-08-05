// LSP protocol types used by the Java / JDT LS integration.
//
// These are a minimal subset of the LSP 3.17 types that we need
// to (de)serialize the messages we send to / receive from the
// language server. We re-declare them here so the Java extension
// does not have to pull in `vscode-languageserver-protocol` (which
// is huge and Theia-specific); the shapes match LSP 3.17.
//
// Reference: https://microsoft.github.io/language-server-protocol/

export type LSPID = number | string;

export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPTextDocumentIdentifier {
  uri: string;
}

export interface LSPVersionedTextDocumentIdentifier extends LSPTextDocumentIdentifier {
  version: number;
}

export interface LSPTextDocumentContentChangeEvent {
  range?: LSPRange;
  rangeLength?: number;
  text: string;
}

export interface LSPTextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface LSPCompletionItem {
  label: string;
  labelDetails?: { detail?: string; description?: string };
  kind?: number;
  detail?: string;
  documentation?: string | { kind: 'markdown' | 'plaintext'; value: string };
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: 1 | 2;
  textEdit?: {
    range: LSPRange;
    newText: string;
    insert?: LSPRange;
    replace?: LSPRange;
  };
  additionalTextEdits?: { range: LSPRange; newText: string }[];
  commitCharacters?: string[];
  command?: { title: string; command: string; arguments?: unknown[] };
  data?: unknown;
  tags?: number[];
  preselect?: boolean;
}

export interface LSPCompletionList {
  isIncomplete: boolean;
  items: LSPCompletionItem[];
}

export type LSPCompletionTriggerKind = 1 | 2 | 3;

export interface LSPCompletionContext {
  triggerKind: LSPCompletionTriggerKind;
  triggerCharacter?: string;
}

export interface LSPCompletionParams {
  textDocument: LSPTextDocumentIdentifier;
  position: LSPPosition;
  context?: LSPCompletionContext;
}

export interface LSPDefinitionParams {
  textDocument: LSPTextDocumentIdentifier;
  position: LSPPosition;
}

export interface LSPTextDocumentPositionParams {
  textDocument: LSPTextDocumentIdentifier;
  position: LSPPosition;
}

export interface LSPMarkupContent {
  kind: 'markdown' | 'plaintext';
  value: string;
}

export type LSPMarkedString = string | { language: string; value: string };

export interface LSPHover {
  contents: LSPMarkupContent | LSPMarkedString | LSPMarkedString[];
  range?: LSPRange;
}

export interface LSPReferenceParams extends LSPTextDocumentPositionParams {
  context: { includeDeclaration: boolean };
}

export interface LSPSignatureHelpParams extends LSPTextDocumentPositionParams {
  context?: {
    triggerKind: 1 | 2 | 3;
    triggerCharacter?: string;
    isRetrigger: boolean;
  };
}

export interface LSPParameterInformation {
  label: string | [number, number];
  documentation?: string | LSPMarkupContent;
}

export interface LSPSignatureInformation {
  label: string;
  documentation?: string | LSPMarkupContent;
  parameters?: LSPParameterInformation[];
  activeParameter?: number;
}

export interface LSPSignatureHelp {
  signatures: LSPSignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface LSPDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  tags?: number[];
  deprecated?: boolean;
  range: LSPRange;
  selectionRange: LSPRange;
  children?: LSPDocumentSymbol[];
}

export interface LSPSymbolInformation {
  name: string;
  kind: number;
  tags?: number[];
  deprecated?: boolean;
  location: LSPLocation;
  containerName?: string;
}

export type LSPDocumentSymbolResult = (LSPDocumentSymbol | LSPSymbolInformation)[] | null;
export type LSPWorkspaceSymbolResult = LSPSymbolInformation[] | null;

export interface LSPTextEdit {
  range: LSPRange;
  newText: string;
}

export interface LSPTextDocumentEdit {
  textDocument: LSPVersionedTextDocumentIdentifier & { version: number | null };
  edits: LSPTextEdit[];
}

export interface LSPResourceOperation {
  kind: 'create' | 'rename' | 'delete';
  uri?: string;
  oldUri?: string;
  newUri?: string;
}

export interface LSPWorkspaceEdit {
  changes?: Record<string, LSPTextEdit[]>;
  documentChanges?: (LSPTextDocumentEdit | LSPResourceOperation)[];
}

export interface LSPCommand {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface LSPCodeAction {
  title: string;
  kind?: string;
  diagnostics?: LSPDiagnostic[];
  isPreferred?: boolean;
  disabled?: { reason: string };
  edit?: LSPWorkspaceEdit;
  command?: LSPCommand;
  data?: unknown;
}

export type LSPCodeActionResult = (LSPCommand | LSPCodeAction)[] | null;

export interface LSPDiagnosticRelatedInformation {
  location: {
    uri: string;
    range: LSPRange;
  };
  message: string;
}

export interface LSPDiagnostic {
  range: LSPRange;
  severity?: 1 | 2 | 3 | 4;
  code?: number | string;
  codeDescription?: { href: string };
  source?: string;
  message: string;
  tags?: number[];
  relatedInformation?: LSPDiagnosticRelatedInformation[];
  data?: unknown;
}

export interface LSPPublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: LSPDiagnostic[];
}

export interface LSPInitializeParams {
  processId: number | null;
  clientInfo?: { name: string; version: string };
  locale?: string;
  rootUri: string | null;
  capabilities: {
    workspace?: {
      applyEdit?: boolean;
      configuration?: boolean;
      didChangeConfiguration?: { dynamicRegistration?: boolean };
      didChangeWatchedFiles?: { dynamicRegistration?: boolean };
      executeCommand?: { dynamicRegistration?: boolean };
      workspaceEdit?: { documentChanges?: boolean };
      workspaceFolders?: boolean;
      symbol?: { dynamicRegistration?: boolean };
    };
    textDocument?: {
      synchronization?: { dynamicRegistration?: boolean; willSave?: boolean; didSave?: boolean };
      completion?: {
        dynamicRegistration?: boolean;
        completionItem?: {
          snippetSupport?: boolean;
          commitCharactersSupport?: boolean;
          documentationFormat?: ('markdown' | 'plaintext')[];
          deprecatedSupport?: boolean;
          preselectSupport?: boolean;
          resolveSupport?: { properties?: string[] };
        };
        contextSupport?: boolean;
        insertTextMode?: 1 | 2;
        completionItemKind?: { valueSet?: number[] };
        completionList?: { itemDefaults?: string[] };
      };
      hover?: { dynamicRegistration?: boolean; contentFormat?: ('markdown' | 'plaintext')[] };
      signatureHelp?: { dynamicRegistration?: boolean; signatureInformation?: unknown };
      definition?: { dynamicRegistration?: boolean; linkSupport?: boolean };
      references?: { dynamicRegistration?: boolean };
      documentHighlight?: { dynamicRegistration?: boolean };
      documentSymbol?: { dynamicRegistration?: boolean; symbolKind?: { valueSet?: number[] } };
      codeAction?: { dynamicRegistration?: boolean };
      rename?: { dynamicRegistration?: boolean; prepareSupport?: boolean };
      formatting?: { dynamicRegistration?: boolean };
      rangeFormatting?: { dynamicRegistration?: boolean };
      typeDefinition?: { dynamicRegistration?: boolean; linkSupport?: boolean };
      implementation?: { dynamicRegistration?: boolean; linkSupport?: boolean };
      callHierarchy?: { dynamicRegistration?: boolean };
      typeHierarchy?: { dynamicRegistration?: boolean };
      inlayHint?: { dynamicRegistration?: boolean };
      publishDiagnostics?: { relatedInformation?: boolean; versionSupport?: boolean; codeDescriptionSupport?: boolean; dataSupport?: boolean };
    };
    window?: { showMessage?: { dynamicRegistration?: boolean } };
  };
  initializationOptions?: unknown;
  workspaceFolders?: { uri: string; name: string }[];
  trace?: 'off' | 'messages' | 'verbose';
}

export interface LSPInitializeResult {
  capabilities: unknown;
  serverInfo?: { name: string; version?: string };
}

export interface LSPLocation {
  uri: string;
  range: LSPRange;
}

export interface LSPLocationLink {
  originSelectionRange?: LSPRange;
  targetUri: string;
  targetRange: LSPRange;
  targetSelectionRange: LSPRange;
}

export enum LSPDocumentHighlightKind {
  Text = 1,
  Read = 2,
  Write = 3,
}

export interface LSPDocumentHighlight {
  range: LSPRange;
  kind?: LSPDocumentHighlightKind;
}

/* ------------------------------------------------------------------ */
/*  Call Hierarchy (LSP 3.16+)                                         */
/* ------------------------------------------------------------------ */

export interface LSPCallHierarchyItem {
  name: string;
  kind: number;
  tags?: number[];
  detail?: string;
  uri: string;
  range: LSPRange;
  selectionRange: LSPRange;
  data?: unknown;
}

export interface LSPCallHierarchyIncomingCall {
  from: LSPCallHierarchyItem;
  fromRanges: LSPRange[];
}

export interface LSPCallHierarchyOutgoingCall {
  to: LSPCallHierarchyItem;
  fromRanges: LSPRange[];
}

export interface LSPCallHierarchyPrepareParams {
  textDocument: LSPTextDocumentIdentifier;
  position: LSPPosition;
}

export interface LSPCallHierarchyIncomingCallsParams {
  item: LSPCallHierarchyItem;
}

export interface LSPCallHierarchyOutgoingCallsParams {
  item: LSPCallHierarchyItem;
}

/* ------------------------------------------------------------------ */
/*  Type Hierarchy (LSP 3.16+)                                         */
/* ------------------------------------------------------------------ */

export interface LSPTypeHierarchyItem {
  name: string;
  kind: number;
  tags?: number[];
  detail?: string;
  uri: string;
  range: LSPRange;
  selectionRange: LSPRange;
  data?: unknown;
}

export interface LSPTypeHierarchyPrepareParams {
  textDocument: LSPTextDocumentIdentifier;
  position: LSPPosition;
}

export interface LSPTypeHierarchySupertypesParams {
  item: LSPTypeHierarchyItem;
}

export interface LSPTypeHierarchySubtypesParams {
  item: LSPTypeHierarchyItem;
}

export interface LSPCodeLens {
  range: LSPRange;
  command?: LSPCommand;
  data?: unknown;
}

export interface LSPInlayHint {
  position: LSPPosition;
  label: string | { value: string }[];
  kind?: 1 | 2; // 1=Type, 2=Parameter
  paddingLeft?: boolean;
  paddingRight?: boolean;
  tooltip?: string | LSPMarkupContent;
}

/** LSP 3.17 $/progress notification params */
export interface LSPWorkDoneProgressBegin {
  kind: 'begin';
  title: string;
  cancellable?: boolean;
  message?: string;
  percentage?: number;
}

export interface LSPWorkDoneProgressReport {
  kind: 'report';
  cancellable?: boolean;
  message?: string;
  percentage?: number;
}

export interface LSPWorkDoneProgressEnd {
  kind: 'end';
  message?: string;
}

export interface LSPProgressParams {
  token: string | number;
  value: LSPWorkDoneProgressBegin | LSPWorkDoneProgressReport | LSPWorkDoneProgressEnd;
}

/* ------------------------------------------------------------------ */
/*  Framing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Encode one LSP message into the wire format. Per the LSP
 * spec the body is UTF-8 JSON and the header is
 *   Content-Length: <N>\r\n
 *   \r\n
 * <N>
 * <body>
 *
 * Exported so the unit test can drive the parser/encoder
 * without going through a real child process.
 */
export function encodeLspMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf-8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, body]);
}

/**
 * Stateful LSP message parser. The parser is fed raw bytes
 * (one or more Buffer chunks at a time) and yields one
 * parsed JSON object per complete message. Incomplete
 * headers / bodies are buffered until the next chunk
 * arrives. Malformed messages throw — the caller is
 * expected to catch and decide whether to terminate the
 * language client.
 */
export class LSPMessageParser {
  /** Pending raw chunks; coalesced with a single concat when parsing. */
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;

  /** Push a chunk of raw bytes; return any complete messages. */
  push(chunk: Buffer): unknown[] {
    if (chunk.length === 0) {
      return [];
    }
    this.chunks.push(chunk);
    this.bufferedBytes += chunk.length;
    const out: unknown[] = [];
    while (true) {
      const msg = this.tryParseOne();
      if (msg === undefined) {
        break;
      }
      out.push(msg);
    }
    return out;
  }

  /** Pending bytes still buffered (for diagnostics). */
  pendingBytes(): number {
    return this.bufferedBytes;
  }

  /** Drop any buffered state — used after a fatal framing error. */
  reset(): void {
    this.chunks = [];
    this.bufferedBytes = 0;
  }

  /** Coalesce pending chunks into one buffer (at most one concat). */
  private coalesce(): Buffer {
    if (this.chunks.length === 0) {
      return Buffer.alloc(0);
    }
    if (this.chunks.length === 1) {
      return this.chunks[0];
    }
    const merged = Buffer.concat(this.chunks, this.bufferedBytes);
    this.chunks = [merged];
    return merged;
  }

  private tryParseOne(): unknown | undefined {
    const buffer = this.coalesce();
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      return undefined;
    }
    const headerStr = buffer.slice(0, headerEnd).toString('ascii');
    // Match signed integers so we can reject negatives
    // with a clear error rather than as a "missing
    // header".
    const lengthMatch = /Content-Length:\s*(-?\d+)/i.exec(headerStr);
    if (!lengthMatch) {
      throw new Error(`LSP: missing Content-Length header in: ${headerStr.slice(0, 200)}`);
    }
    const contentLength = Number.parseInt(lengthMatch[1], 10);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new Error(`LSP: invalid Content-Length ${lengthMatch[1]}`);
    }
    const totalLength = headerEnd + 4 + contentLength;
    if (buffer.length < totalLength) {
      return undefined;
    }
    const body = buffer.slice(headerEnd + 4, totalLength);
    const remaining = buffer.slice(totalLength);
    this.chunks = remaining.length > 0 ? [remaining] : [];
    this.bufferedBytes = remaining.length;
    return JSON.parse(body.toString('utf-8'));
  }
}
