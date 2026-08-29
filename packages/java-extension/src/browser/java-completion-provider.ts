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
import { JavaIntelliSenseProvider } from './java-intellisense-provider';
import {
  adaptIntelliSenseCompletion,
  adaptLspCompletion,
  extractTypeHintFromParameterLabel,
  filterSmartCompletions,
  mergeResolvedCompletion,
  type JavaCompletionResponse,
  type JavaCompletionResponseItem,
} from './java-completion-adapter';
import {
  LSPCompletionItem,
  LSPPublishDiagnosticsParams,
  LSPLocation,
  LSPLocationLink,
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
  LSPDocumentHighlight,
} from '../common/lsp-protocol';

export type { JavaCompletionResponse, JavaCompletionResponseItem } from './java-completion-adapter';

export interface JavaCompletionRequest {
  uri: string;
  line: number;
  character: number;
  triggerKind?: 1 | 2 | 3;
  triggerCharacter?: string;
  /** Text on the current line before the cursor (enables static fallback). */
  linePrefix?: string;
  /** IDEA-like Smart Type Completion (Ctrl+Shift+Space). */
  smart?: boolean;
  /** 0=type filter, 1=members only, 2=all re-ranked — cycles on repeat. */
  smartCycle?: number;
}

export interface JavaDefinitionResponse {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

@injectable()
export class JavaCompletionProvider {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(JavaLanguageClient) protected readonly client!: JavaLanguageClient;
  @inject(JavaIntelliSenseProvider) protected readonly intellisense!: JavaIntelliSenseProvider;

  protected readonly onDiagnosticsEmitter = new Emitter<{ uri: string; diagnostics: LSPPublishDiagnosticsParams['diagnostics'] }>();
  readonly onDiagnostics: Event<{ uri: string; diagnostics: LSPPublishDiagnosticParams['diagnostics'] }> =
    this.onDiagnosticsEmitter.event;

  protected subs: Disposable[] = [];

  /** Tracks the last known source for each URI, used for fallback. */
  private sourceCache = new Map<string, string>();

  @postConstruct()
  protected init(): void {
    this.subs.push(
      this.client.onDiagnostics(params => {
        this.onDiagnosticsEmitter.fire({ uri: params.uri, diagnostics: params.diagnostics });
      }),
    );
  }

  /** Cache the source text of a document for fallback operations. */
  cacheSource(uri: string, source: string): void {
    this.sourceCache.set(uri, source);
  }

  /** Returns the cached source text for a URI, if any. */
  getSource(uri: string): string | undefined {
    return this.sourceCache.get(uri);
  }

  /** Clear cached source when a document is closed. */
  clearSource(uri: string): void {
    this.sourceCache.delete(uri);
  }

  /**
   * Provide completions at a given position. This is the
   * entry point for the monaco
   * registerCompletionItemProvider adapter (see
   * `JavaCompletionProviderRegistration`).
   *
   * When JDT LS is ready, completions come from the LS.
   * Empty LS results are trusted (no keyword fallback) so
   * real "no candidates" contexts stay quiet — matching IDEA.
   * When the LS is not ready or the request fails, a fallback
   * IntelliSense provider supplies keyword/type/snippet items.
   */
  async provideCompletions(req: JavaCompletionRequest): Promise<JavaCompletionResponse> {
    // Interactive suggest must not wait forever on RPC reconnect retries —
    // otherwise Monaco keeps the widget on "Loading…" and hides
    // already-ready Live Templates / Hippie results. Soft budget also caps
    // JDT indexing stalls (A3 3.1).
    const COMPLETION_BUDGET_MS = 5_000;
    const run = async (): Promise<JavaCompletionResponse> => {
      // Prefer quick state for suggest; avoids 3s+ reconnect loops.
      const state = await this.client.fetchStateQuick();
      if (state !== 'ready') {
        return this.maybeSmart(this.fallbackCompletions(req), req);
      }
      try {
        const list = await this.client.completion(req);
        this.logger.info(`[JavaCompletionProvider] completion: ${list.items.length} items from client`);
        if (list.items.length === 0) {
          // Incomplete/empty after soft-timeout or cold index — offer local fallback
          // so "Sys" still yields System instead of a blank/Loading widget.
          const fallback = this.fallbackCompletions(req);
          if (fallback.items.length > 0) {
            return this.maybeSmart({
              isIncomplete: !!list.isIncomplete,
              items: fallback.items,
            }, req);
          }
        }
        const items = list.items.map(adaptLspCompletion);
        return this.maybeSmart({ isIncomplete: !!list.isIncomplete, items }, req);
      } catch (err) {
        this.logger.warn(`[JavaCompletionProvider] completion failed: ${String(err)}`);
        return this.maybeSmart(this.fallbackCompletions(req), req);
      }
    };

    try {
      let budgetTimer: ReturnType<typeof setTimeout> | undefined;
      const budget = new Promise<JavaCompletionResponse>(resolve => {
        budgetTimer = setTimeout(() => {
          this.logger.warn('[JavaCompletionProvider] completion budget exceeded — using fallback');
          resolve(this.fallbackCompletions(req));
        }, COMPLETION_BUDGET_MS);
      });
      try {
        return await Promise.race([run(), budget]);
      } finally {
        if (budgetTimer) {
          clearTimeout(budgetTimer);
        }
      }
    } catch (err) {
      this.logger.warn(`[JavaCompletionProvider] completion error: ${String(err)}`);
      return this.fallbackCompletions(req);
    }
  }

  /** Resolve lazy completion details (docs / additionalTextEdits). */
  async resolveCompletion(item: JavaCompletionResponseItem): Promise<JavaCompletionResponseItem> {
    if (item.data === undefined || item.data === null) {
      return item;
    }
    if (await this.client.fetchStateQuick() !== 'ready') {
      return item;
    }
    try {
      const partial: LSPCompletionItem = {
        label: item.label,
        kind: item.kind,
        detail: item.detail,
        documentation: item.documentation,
        sortText: item.sortText,
        filterText: item.filterText,
        insertText: item.insertText,
        insertTextFormat: item.insertTextFormat,
        textEdit: item.textEdit,
        additionalTextEdits: item.additionalTextEdits,
        commitCharacters: item.commitCharacters,
        command: item.command,
        data: item.data,
      };
      const resolved = await this.client.resolveCompletion(partial);
      return mergeResolvedCompletion(item, resolved);
    } catch (err) {
      this.logger.warn(`[JavaCompletionProvider] resolveCompletion failed: ${String(err)}`);
      return item;
    }
  }

  private async maybeSmart(response: JavaCompletionResponse, req: JavaCompletionRequest): Promise<JavaCompletionResponse> {
    if (!req.smart) {
      return response;
    }
    let expectedType: string | undefined;
    try {
      const help = await Promise.race([
        this.client.signatureHelp({
          uri: req.uri,
          line: req.line,
          character: req.character,
          triggerKind: 1,
        }),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 400)),
      ]);
      if (help && help.signatures.length > 0) {
        const sigIndex = help.activeSignature ?? 0;
        const sig = help.signatures[sigIndex];
        const paramIndex = help.activeParameter ?? sig?.activeParameter ?? 0;
        const param = sig?.parameters?.[paramIndex];
        let paramLabel: string | undefined;
        if (typeof param?.label === 'string') {
          paramLabel = param.label;
        } else if (Array.isArray(param?.label) && typeof sig?.label === 'string') {
          paramLabel = sig.label.slice(param.label[0], param.label[1]);
        }
        expectedType = extractTypeHintFromParameterLabel(paramLabel);
      }
    } catch {
      // signature help is best-effort for smart ranking
    }
    return {
      isIncomplete: false,
      items: filterSmartCompletions(response.items, expectedType, req.smartCycle ?? 0),
    };
  }

  /** Fallback completions using the IntelliSense provider. */
  private fallbackCompletions(req: JavaCompletionRequest): JavaCompletionResponse {
    const source = this.sourceCache.get(req.uri);
    if (!source) {
      if (req.linePrefix !== undefined) {
        const basic = this.intellisense.provideBasicCompletions(req.linePrefix);
        return {
          isIncomplete: basic.isIncomplete,
          items: basic.items.map(adaptIntelliSenseCompletion),
        };
      }
      return { isIncomplete: false, items: [] };
    }
    const result = this.intellisense.provideCompletions(
      source, req.line, req.character, req.triggerCharacter,
    );
    if (result.items.length === 0 && req.linePrefix !== undefined) {
      const basic = this.intellisense.provideBasicCompletions(req.linePrefix);
      return {
        isIncomplete: false,
        items: basic.items.map(adaptIntelliSenseCompletion),
      };
    }
    return {
      isIncomplete: result.isIncomplete,
      items: result.items.map(adaptIntelliSenseCompletion),
    };
  }

  /** Provide Go-to-Definition locations. */
  async provideDefinition(uri: string, line: number, character: number): Promise<JavaDefinitionResponse[]> {
    if (await this.client.fetchState() !== 'ready') {
      return this.fallbackDefinition(uri, line, character);
    }
    try {
      const r = await this.client.definition({ uri, line, character });
      if (!r) return this.fallbackDefinition(uri, line, character);
      const arr = Array.isArray(r) ? r : [r];
      const filtered = arr.filter((x): x is LSPLocation => !!x);
      if (filtered.length === 0) return this.fallbackDefinition(uri, line, character);
      return filtered.map(x => ({
        uri: x.uri,
        range: {
          start: { line: x.range.start.line, character: x.range.start.character },
          end: { line: x.range.end.line, character: x.range.end.character },
        },
      }));
    } catch (err) {
      this.logger.warn(`[JavaCompletionProvider] definition failed: ${String(err)}`);
      return this.fallbackDefinition(uri, line, character);
    }
  }

  /** Fallback definition using the IntelliSense provider. */
  private fallbackDefinition(uri: string, line: number, character: number): JavaDefinitionResponse[] {
    const source = this.sourceCache.get(uri);
    if (!source) return [];
    return this.intellisense.provideDefinition(uri, source, line, character).map(d => ({
      uri: d.uri,
      range: {
        start: { line: d.line, character: d.character },
        end: { line: d.endLine, character: d.endCharacter },
      },
    }));
  }

  async provideImplementation(uri: string, line: number, character: number): Promise<LSPLocation[]> {
    const result = await this.whenReady('implementation', null, () => this.client.implementation({ uri, line, character }));
    const arr = (!result) ? [] : Array.isArray(result) ? result : [result];
    console.info(`[kairo-java] provideImplementation uri=${uri} pos=${line}:${character} -> ${arr.length}`);
    return arr;
  }

  async provideHover(uri: string, line: number, character: number): Promise<LSPHover | null> {
    return this.whenReady('hover', null, () => this.client.hover({ uri, line, character }));
  }

  async provideReferences(uri: string, line: number, character: number, includeDeclaration: boolean): Promise<LSPLocation[]> {
    return this.whenReady('references', [], () => this.client.references({ uri, line, character, includeDeclaration }));
  }

  async provideTypeDefinition(uri: string, line: number, character: number): Promise<(LSPLocation | LSPLocationLink)[]> {
    const result = await this.whenReady('type definition', null, () => this.client.typeDefinition({ uri, line, character }));
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  async provideDocumentHighlights(uri: string, line: number, character: number): Promise<LSPDocumentHighlight[]> {
    return this.whenReady('document highlight', [], () => this.client.documentHighlight({ uri, line, character }));
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
    let st = await this.client.fetchState();
    if (st !== 'ready') {
      // For interactive features like formatting, wait a bit for JDT to become ready
      // (it is often still initializing when the user first triggers a command).
      if (st === 'starting' || st === 'initializing' || st === 'uninitialized') {
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 500));
          st = await this.client.fetchState();
          if (st === 'ready') break;
        }
      }
      if (st !== 'ready') {
        this.logger.warn(`[JavaCompletionProvider] ${feature} skipped: JDT LS state=${st}`);
        return empty;
      }
    }
    try {
      const res = await request();
      this.logger.info(`[JavaCompletionProvider] ${feature} succeeded len=${(res as any)?.length ?? 0}`);
      return res;
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

// Type alias used to avoid pulling in the full LSPCompletionItem
// type for one nested array. Re-exported here to keep the public
// surface stable.
export type LSPPublishDiagnosticParams = LSPPublishDiagnosticsParams;
