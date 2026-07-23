// SPDX-License-Identifier: Apache-2.0
//
// Theia JSON-RPC contract for the JDT LS bridge.
//
// The Theia backend exposes `JdtLsBackendService` (interface
// Symbol) and the browser side implements
// `JdtLsFrontendClient` (interface Symbol). The actual
// `JsonRpcServer` / `JsonRpcProxy` plumbing is provided by
// the Theia messaging framework when these symbols are
// bound to the right classes; this file just defines the
// shapes.

import type { JdtLsState } from '../node/jdt-ls-manager';
import type {
  LSPPublishDiagnosticsParams,
  LSPCompletionList,
  LSPLocation,
  LSPHover,
  LSPSignatureHelp,
  LSPDocumentSymbolResult,
  LSPWorkspaceSymbolResult,
  LSPWorkspaceEdit,
  LSPCodeActionResult,
  LSPDiagnostic,
  LSPRange,
  LSPCodeLens,
  LSPProgressParams,
  LSPCallHierarchyItem,
  LSPCallHierarchyIncomingCall,
  LSPCallHierarchyOutgoingCall,
  LSPTypeHierarchyItem,
  LSPTextEdit,
  LSPInlayHint,
} from './lsp-protocol';

export const JdtLsBackendPath = '/services/jdt-ls-backend';

/** Browser → backend: drive the language server. The
 *  Theia backend's JdtLsService implements this. */
export const JdtLsBackendService = Symbol('JdtLsBackendService');
export interface JdtLsBackendService {
  $start(opts: { rootUri: string; workspaceDataDir: string; sourceLevel?: string; home?: string }): Promise<{ ok: true } | { ok: false; reason: string }>;
  $stop(): Promise<void>;
  $state(): Promise<JdtLsState>;
  $inspect(): Promise<{ ok: true; home: string; jre: string; launcherJar: string } | { ok: false; reason: string }>;
  $didOpen(p: { uri: string; languageId: string; version: number; text: string }): Promise<void>;
  $didChange(p: { uri: string; version: number; changes: { text: string; rangeLength?: number }[] }): Promise<void>;
  $didClose(uri: string): Promise<void>;
  $completion(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string }): Promise<LSPCompletionList>;
  $definition(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null>;
  $implementation(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null>;
  $hover(p: { uri: string; line: number; character: number }): Promise<LSPHover | null>;
  $references(p: { uri: string; line: number; character: number; includeDeclaration: boolean }): Promise<LSPLocation[]>;
  $signatureHelp(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string; isRetrigger?: boolean }): Promise<LSPSignatureHelp | null>;
  $documentSymbols(uri: string): Promise<LSPDocumentSymbolResult>;
  $workspaceSymbols(query: string): Promise<LSPWorkspaceSymbolResult>;
  $codeActions(p: { uri: string; range: LSPRange; diagnostics: LSPDiagnostic[]; only?: string[] }): Promise<LSPCodeActionResult>;
  $rename(p: { uri: string; line: number; character: number; newName: string }): Promise<LSPWorkspaceEdit | null>;
  $classFileContents(uri: string): Promise<string>;
  $recentLogs(): Promise<{ level: 'stdout' | 'stderr'; line: string; ts: number }[]>;
  $prepareCallHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPCallHierarchyItem[]>;
  $incomingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyIncomingCall[]>;
  $outgoingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyOutgoingCall[]>;
  $prepareTypeHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPTypeHierarchyItem[]>;
  $supertypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]>;
  $subtypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]>;
  $codeLens(uri: string): Promise<LSPCodeLens[]>;
  $buildWorkspace(force: boolean): Promise<void>;
  $formatting(uri: string, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]>;
  $rangeFormatting(uri: string, range: LSPRange, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]>;
  $inlayHint(uri: string, range?: LSPRange): Promise<LSPInlayHint[]>;
}

/** Backend → browser: state, log, diagnostics, messages.
 *  The browser's JavaLanguageClient implements this. */
export const JdtLsFrontendClient = Symbol('JdtLsFrontendClient');
export interface JdtLsFrontendClient {
  onStateEvent(state: JdtLsState): void;
  onLogEvent(level: 'stdout' | 'stderr', line: string): void;
  onDiagnosticsEvent(params: LSPPublishDiagnosticsParams): void;
  onMessageEvent(message: string): void;
  onProgressEvent(params: LSPProgressParams): void;
}
