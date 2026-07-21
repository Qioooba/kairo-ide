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
import type { LSPPublishDiagnosticsParams, LSPCompletionList, LSPLocation } from './lsp-protocol';

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
  $classFileContents(uri: string): Promise<string>;
  $recentLogs(): Promise<{ level: 'stdout' | 'stderr'; line: string; ts: number }[]>;
}

/** Backend → browser: state, log, diagnostics, messages.
 *  The browser's JavaLanguageClient implements this. */
export const JdtLsFrontendClient = Symbol('JdtLsFrontendClient');
export interface JdtLsFrontendClient {
  onStateEvent(state: JdtLsState): void;
  onLogEvent(level: 'stdout' | 'stderr', line: string): void;
  onDiagnosticsEvent(params: LSPPublishDiagnosticsParams): void;
  onMessageEvent(message: string): void;
}
