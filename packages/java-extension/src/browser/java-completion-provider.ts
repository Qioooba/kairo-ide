// SPDX-License-Identifier: Apache-2.0
//
// Java completion + definition + diagnostics providers.
//
// We do not depend on `@theia/monaco` to avoid the heavy
// monaco-editor import when running headless. The provider
// exposes typed hooks the host widget can wire into
// monaco.languages.registerCompletionItemProvider, etc.

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { JavaLanguageClient } from './java-language-client';
import {
  LSPCompletionItem,
  LSPPublishDiagnosticsParams,
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
  LSPTextEdit,
  LSPInlayHint,
} from '../common/lsp-protocol';

export interface JavaCompletionRequest {
  uri: string;
  line: number;
  character: number;
  triggerKind?: 1 | 2 | 3;
  triggerCharacter?: string;
}

export interface JavaCompletionResponseItem {
  label: string;
  kind: number | undefined;
  detail: string | undefined;
  documentation: string | undefined;
  sortText: string | undefined;
  filterText: string | undefined;
  insertText: string | undefined;
  isDeprecated?: boolean;
  score?: number;
}

export interface JavaCompletionResponse {
  isIncomplete: boolean;
  items: JavaCompletionResponseItem[];
}

export interface JavaDefinitionResponse {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

@injectable()
export class JavaCompletionProvider {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(JavaLanguageClient) protected readonly client!: JavaLanguageClient;

  protected readonly onDiagnosticsEmitter = new Emitter<{ uri: string; diagnostics: LSPPublishDiagnosticsParams['diagnostics'] }>();
  readonly onDiagnostics: Event<{ uri: string; diagnostics: LSPPublishDiagnosticParams['diagnostics'] }> =
    this.onDiagnosticsEmitter.event;

  protected subs: Disposable[] = [];

  @postConstruct()
  protected init(): void {
    this.subs.push(
      this.client.onDiagnostics(params => {
        this.onDiagnosticsEmitter.fire({ uri: params.uri, diagnostics: params.diagnostics });
      }),
    );
  }

  /**
   * Provide completions at a given position. This is the
   * entry point for the monaco
   * registerCompletionItemProvider adapter (see
   * `JavaCompletionProviderRegistration`).
   */
  async provideCompletions(req: JavaCompletionRequest): Promise<JavaCompletionResponse> {
    // fetchState() prefers the backend RPC proxy — the sync
    // client.state() reads the in-process service, which is
    // permanently 'uninitialized' in the web product and made
    // every provider short-circuit (KAIRO-RC-WEB-251).
    if (await this.client.fetchState() !== 'ready') {
      return { isIncomplete: false, items: [] };
    }
    try {
      const list = await this.client.completion(req);
      this.logger.info(`[JavaCompletionProvider] completion: ${list.items.length} items from client`);
      return {
        isIncomplete: list.isIncomplete,
        items: list.items.map(adaptLspCompletion),
      };
    } catch (err) {
      this.logger.warn(`[JavaCompletionProvider] completion failed: ${String(err)}`);
      return { isIncomplete: false, items: [] };
    }
  }

  /** Provide Go-to-Definition locations. */
  async provideDefinition(uri: string, line: number, character: number): Promise<JavaDefinitionResponse[]> {
    if (await this.client.fetchState() !== 'ready') {
      return [];
    }
    try {
      const r = await this.client.definition({ uri, line, character });
      if (!r) return [];
      const arr = Array.isArray(r) ? r : [r];
      return arr
        .filter((x): x is LSPLocation => !!x)
        .map(x => ({
          uri: x.uri,
          range: {
            start: { line: x.range.start.line, character: x.range.start.character },
            end: { line: x.range.end.line, character: x.range.end.character },
          },
        }));
    } catch (err) {
      this.logger.warn(`[JavaCompletionProvider] definition failed: ${String(err)}`);
      return [];
    }
  }

  async provideImplementation(uri: string, line: number, character: number): Promise<LSPLocation[]> {
    const result = await this.whenReady('implementation', null, () => this.client.implementation({ uri, line, character }));
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  async provideHover(uri: string, line: number, character: number): Promise<LSPHover | null> {
    return this.whenReady('hover', null, () => this.client.hover({ uri, line, character }));
  }

  async provideReferences(uri: string, line: number, character: number, includeDeclaration: boolean): Promise<LSPLocation[]> {
    return this.whenReady('references', [], () => this.client.references({ uri, line, character, includeDeclaration }));
  }

  async provideSignatureHelp(p: {
    uri: string;
    line: number;
    character: number;
    triggerKind?: 1 | 2 | 3;
    triggerCharacter?: string;
    isRetrigger?: boolean;
  }): Promise<LSPSignatureHelp | null> {
    return this.whenReady('signature help', null, () => this.client.signatureHelp(p));
  }

  async provideDocumentSymbols(uri: string): Promise<LSPDocumentSymbolResult> {
    return this.whenReady('document symbols', null, () => this.client.documentSymbols(uri));
  }

  async provideWorkspaceSymbols(query: string): Promise<LSPWorkspaceSymbolResult> {
    return this.whenReady('workspace symbols', null, () => this.client.workspaceSymbols(query));
  }

  async provideCodeActions(uri: string, range: LSPRange, diagnostics: LSPDiagnostic[], only?: string[]): Promise<LSPCodeActionResult> {
    return this.whenReady('code actions', null, () => this.client.codeActions({ uri, range, diagnostics, only }));
  }

  async provideRename(uri: string, line: number, character: number, newName: string): Promise<LSPWorkspaceEdit | null> {
    return this.whenReady('rename', null, () => this.client.rename({ uri, line, character, newName }));
  }

  async provideCodeLens(uri: string): Promise<LSPCodeLens[]> {
    return this.whenReady('codeLens', [], () => this.client.codeLens(uri));
  }

  async provideFormatting(uri: string, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    return this.whenReady('formatting', [], () => this.client.formatting(uri, options));
  }

  async provideRangeFormatting(uri: string, range: LSPRange, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    return this.whenReady('range formatting', [], () => this.client.rangeFormatting(uri, range, options));
  }

  async provideInlayHints(uri: string, range?: LSPRange): Promise<LSPInlayHint[]> {
    return this.whenReady('inlay hints', [], () => this.client.inlayHint(uri, range));
  }

  protected async whenReady<T>(feature: string, empty: T, request: () => Promise<T>): Promise<T> {
    if (await this.client.fetchState() !== 'ready') {
      return empty;
    }
    try {
      return await request();
    } catch (err) {
      this.logger.warn(`[JavaCompletionProvider] ${feature} failed: ${String(err)}`);
      return empty;
    }
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this.subs = [];
    this.onDiagnosticsEmitter.dispose();
  }
}

function adaptLspCompletion(it: LSPCompletionItem): JavaCompletionResponseItem {
  let doc: string | undefined;
  if (typeof it.documentation === 'string') {
    doc = it.documentation;
  } else if (it.documentation && typeof it.documentation === 'object') {
    doc = it.documentation.value;
  }
  return {
    label: it.label,
    kind: it.kind,
    detail: it.detail,
    documentation: doc,
    sortText: it.sortText,
    filterText: it.filterText,
    insertText: it.insertText ?? it.label,
    isDeprecated: (it as { tags?: number[] }).tags?.includes(1) ?? false,
  };
}

// Type alias used to avoid pulling in the full LSPCompletionItem
// type for one nested array. Re-exported here to keep the public
// surface stable.
export type LSPPublishDiagnosticParams = LSPPublishDiagnosticsParams;
