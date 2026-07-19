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
  };
  additionalTextEdits?: { range: LSPRange; newText: string }[];
  commitCharacters?: string[];
  command?: { title: string; command: string; arguments?: unknown[] };
  data?: unknown;
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
  private buffer: Buffer = Buffer.alloc(0);

  /** Push a chunk of raw bytes; return any complete messages. */
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
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
    return this.buffer.length;
  }

  /** Drop any buffered state — used after a fatal framing error. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  private tryParseOne(): unknown | undefined {
    const headerEnd = this.buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      return undefined;
    }
    const headerStr = this.buffer.slice(0, headerEnd).toString('ascii');
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
    if (this.buffer.length < totalLength) {
      return undefined;
    }
    const body = this.buffer.slice(headerEnd + 4, totalLength);
    this.buffer = this.buffer.slice(totalLength);
    return JSON.parse(body.toString('utf-8'));
  }
}
