/**
 * Protocol and data types for Kairo IDE highlighting and tokenization service.
 * Pure logic — no DOM or Theia UI dependencies.
 */

export interface TextEditChange {
  /** UTF-16 offset in the document before edit */
  rangeOffset: number;
  /** Length of replaced text in UTF-16 code units */
  rangeLength: number;
  /** Inserted text */
  text: string;
}

export interface DocumentSnapshotMessage {
  type: 'snapshot';
  modelInstanceId: string;
  uri: string;
  languageId: string;
  dialect?: string;
  version: number;
  text: string;
  eol: '\n' | '\r\n';
  activeViewport?: {
    startLine: number;
    endLine: number;
  };
}

export interface DocumentEditMessage {
  type: 'edit';
  modelInstanceId: string;
  uri: string;
  beforeVersion: number;
  afterVersion: number;
  changes: TextEditChange[];
  activeViewport?: {
    startLine: number;
    endLine: number;
  };
}

export interface ViewportChangeMessage {
  type: 'viewport';
  modelInstanceId: string;
  startLine: number;
  endLine: number;
}

export interface DisposeModelMessage {
  type: 'dispose';
  modelInstanceId: string;
}

export type WorkerInboundMessage =
  | DocumentSnapshotMessage
  | DocumentEditMessage
  | ViewportChangeMessage
  | DisposeModelMessage;

export interface TokenBatchMessage {
  type: 'tokens';
  modelInstanceId: string;
  documentVersion: number;
  startLineNumber: number;
  endLineNumber: number;
  /** Array of packed token uint32 arrays, one per line (startLineNumber to endLineNumber) */
  lineTokens: Uint32Array[];
  /** Serialized lexer state for end of line endLineNumber */
  endState?: unknown;
  /** True when tokenization has covered from line 1 to EOF for this version */
  isCompleted: boolean;
}

export interface WorkerErrorMessage {
  type: 'error';
  modelInstanceId?: string;
  message: string;
  stack?: string;
}

export type WorkerOutboundMessage =
  | TokenBatchMessage
  | WorkerErrorMessage;

/**
 * Diagnostic & inspection snapshot data for "Kairo: Inspect Highlighting".
 * Sanitized of user source code and sensitive absolute paths.
 */
export interface HighlightInspectionData {
  buildSha: string;
  theiaVersion: string;
  monacoVersion: string;
  uri: string;
  modelInstanceId: string;
  languageId: string;
  dialect: string;
  tokenizerOwner: string;
  tokenizationMode: 'worker' | 'native' | 'fallback';
  documentVersion: number;
  characterCount: number;
  lineCount: number;
  maxLineLength: number;
  isTooLargeForMonaco: boolean;
  completedLineCount: number;
  completedPercentage: number;
  isCompleted: boolean;
  longLineMode: boolean;
  workerStatus: 'idle' | 'busy' | 'restarting' | 'stopped' | 'disabled';
  semanticStatus: {
    available: boolean;
    provider: string;
    tokensCount?: number;
    lastResultId?: string;
  };
  tokenCacheBytes: number;
  checkpointCount: number;
  lastError?: string;
}
