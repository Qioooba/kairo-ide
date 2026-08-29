// SPDX-License-Identifier: Apache-2.0
//
// Monaco language-feature registration for Java.
//
// JavaCompletionProvider exposes monaco-agnostic hooks
// (provideCompletions / provideDefinition with 0-based LSP
// positions); this contribution adapts them to Monaco's
// 1-based API and registers the providers for language
// 'java' at application start. Registration mirrors the
// JSP language contribution (KairoJspLanguageContribution):
// monaco is imported as a module, never via window.monaco.

import * as monaco from '@theia/monaco-editor-core';
import { FrontendApplicationContribution, QuickInputService } from '@theia/core/lib/browser';
import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';
import { CommandContribution, CommandRegistry, CommandService } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-menu';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { ResourceEdit } from '@theia/monaco-editor-core/esm/vs/editor/browser/services/bulkEditService';
import { JAVA_LANGUAGE_ID } from '../common/java-common';
import { JAVA_MONARCH } from './java-monarch';
import {
  applyKairoLanguageEditorDefaults,
  scheduleProgressiveTokenization,
} from './monaco-tokenization-config';
import { JavaLanguageClient } from './java-language-client';
import { JdtClassFileFsProvider } from './jdt-fs-provider';
import { JavaCompletionProvider, JavaDefinitionResponse } from './java-completion-provider';
import type { JavaCompletionResponseItem } from './java-completion-adapter';
import { INSERT_AS_SNIPPET, looksLikeSnippet } from './java-completion-adapter';
import { registerJavaLiveTemplates } from './java-live-templates';
import { computeCompleteStatement } from './java-complete-statement';
import { SURROUND_TEMPLATES, computeSurroundEdit, findSurroundTemplate } from './java-surround-with';
import { computeUnwrapEdit } from './java-unwrap';
import { globalRecentCompletions } from './java-recent-completions';
import { JavaUserLiveTemplatesService } from './java-user-templates';
import { cycleHippieCompletion, registerHippieCompletion } from './java-hippie-completion';
import { JavaDocumentSyncContribution } from './java-document-sync';
import { JavaRefactoring } from './java-refactoring';
import { JavaRunService } from './java-run-service';
import { JAVA_RUN_COMMANDS } from './java-run-protocol';
import type {
  LSPDocumentSymbol,
  LSPDocumentSymbolResult,
  LSPHover,
  LSPLocation,
  LSPLocationLink,
  LSPSignatureHelp,
  LSPSymbolInformation,
  LSPTextEdit,
  LSPWorkspaceEdit,
  LSPWorkspaceSymbolResult,
  LSPCodeAction,
  LSPDiagnostic,
  LSPCodeLens,
  LSPInlayHint,
  LSPRange,
  LSPDocumentHighlight,
} from '../common/lsp-protocol';

/**
 * Kairo-owned provider registries on the Monaco languages namespace.
 * Monaco 1.108 exposes neither `_documentSymbolProviders` nor
 * `_workspaceSymbolProviders`; these well-known fields give tool windows
 * (Quick Outline, Go to Type) access to the registered providers.
 */
interface KairoWorkspaceSymbolEntry {
  name: string;
  containerName?: string;
  kind: number;
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  uriString: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kairoSymbolRegistries(languagesNs: any): {
  document: Array<{ provideDocumentSymbols: (model: unknown, token: unknown) => Promise<unknown> }>;
  workspace: Array<{ provideWorkspaceSymbols: (query: string | { query?: string }, token: unknown) => Promise<KairoWorkspaceSymbolEntry[] | undefined> }>;
} {
  if (!languagesNs.__kairoDocumentSymbolProviders) {
    languagesNs.__kairoDocumentSymbolProviders = [];
  }
  if (!languagesNs.__kairoWorkspaceSymbolProviders) {
    languagesNs.__kairoWorkspaceSymbolProviders = [];
  }
  return {
    document: languagesNs.__kairoDocumentSymbolProviders,
    workspace: languagesNs.__kairoWorkspaceSymbolProviders,
  };
}

/** Set by Smart Completion command; consumed by the next provideCompletionItems.
 * Repeated Ctrl+Shift+Space cycles filter strictness (IDEA-like). */
let pendingSmartCompletion = false;
let smartCompletionCycle = 0;

export function requestSmartCompletion(): void {
  pendingSmartCompletion = true;
  smartCompletionCycle = (smartCompletionCycle + 1) % 3;
}

export function consumeSmartCompletionFlag(): boolean {
  const value = pendingSmartCompletion;
  pendingSmartCompletion = false;
  return value;
}

/** 0 = expected-type filter, 1 = methods/fields only, 2 = all (re-ranked). */
export function consumeSmartCompletionCycle(): number {
  return smartCompletionCycle;
}

@injectable()
export class JavaMonacoRegistrationContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution, Disposable {
  @inject(JavaCompletionProvider)
  protected readonly provider!: JavaCompletionProvider;
  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;
  @inject(JdtClassFileFsProvider)
  protected readonly jdtFs!: JdtClassFileFsProvider;
  @inject(FileService)
  protected readonly fileService!: FileService;
  @inject(MonacoWorkspace) @optional()
  protected readonly monacoWorkspace?: MonacoWorkspace;
  @inject(JavaDocumentSyncContribution) @optional()
  protected readonly documentSync?: JavaDocumentSyncContribution;
  @inject(JavaRunService) @optional()
  protected readonly javaRunService?: JavaRunService;
  @inject(CommandService) @optional()
  protected readonly commandService?: CommandService;
  @inject(WorkspaceService) @optional()
  protected readonly workspaceService?: WorkspaceService;
  @inject(QuickInputService) @optional()
  protected readonly quickInput?: QuickInputService;
  @inject(JavaUserLiveTemplatesService) @optional()
  protected readonly userTemplates?: JavaUserLiveTemplatesService;
  @inject(JavaRefactoring) @optional()
  protected readonly refactoring?: JavaRefactoring;
  @inject(MessageService) @optional()
  protected readonly messages?: MessageService;

  protected subs: Disposable[] = [];
  /** Per-model content listeners — disposed on model dispose so `subs` does not grow forever. */
  protected modelContentSubs = new Map<string, Disposable>();

  onStart(): void {
    applyKairoLanguageEditorDefaults();
    // Theia's monaco-editor-core ships no basic-languages, so
    // .java opened as Plain Text: no highlighting, and the
    // completion/definition providers below never fired
    // (KAIRO-RC-WEB-251). Register the language first.
    if (!monaco.languages.getLanguages().some(l => l.id === JAVA_LANGUAGE_ID)) {
      monaco.languages.register({
        id: JAVA_LANGUAGE_ID,
        extensions: ['.java'],
        aliases: ['Java', 'java'],
        mimetypes: ['text/x-java-source', 'text/x-java'],
      });
    }
    monaco.languages.setMonarchTokensProvider(JAVA_LANGUAGE_ID, JAVA_MONARCH as monaco.languages.IMonarchLanguage);

    monaco.languages.setLanguageConfiguration(JAVA_LANGUAGE_ID, {
      comments: {
        lineComment: '//',
        blockComment: ['/*', '*/'],
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
      indentationRules: {
        increaseIndentPattern: /^.*\{[^}"']*$/,
        decreaseIndentPattern: /^(.*\*\/)?\s*\}[;\s]*$/,
      },
      folding: {
        markers: {
          start: /^\s*\/\/\s*#region\b/,
          end: /^\s*\/\/\s*#endregion\b/,
        },
      },
    });

    // jdt:// content: the LS answers go-to-definition into
    // library jars with jdt:// URIs; without an fs provider for
    // the scheme, monaco cannot open them and F12 appears dead
    // (KAIRO-RC-WEB-251 live evidence: definition resolved to
    // jdt://…/HttpServletResponse.class, nothing opened).
    this.subs.push(this.fileService.registerProvider('jdt', this.jdtFs));

    // Cache source text for fallback IntelliSense when LS is unavailable.
    const cacheModel = (model: monaco.editor.ITextModel): void => {
      this.provider.cacheSource(model.uri.toString(), model.getValue());
      scheduleProgressiveTokenization(model);
    };
    const attachContentListener = (model: monaco.editor.ITextModel): void => {
      const uri = model.uri.toString();
      this.modelContentSubs.get(uri)?.dispose();
      this.modelContentSubs.set(uri, model.onDidChangeContent(() => {
        this.provider.cacheSource(model.uri.toString(), model.getValue());
      }));
    };
    for (const model of monaco.editor.getModels()) {
      if (model.getLanguageId() === JAVA_LANGUAGE_ID) {
        cacheModel(model);
        attachContentListener(model);
      }
    }
    this.subs.push(monaco.editor.onDidCreateModel(model => {
      cacheModel(model);
      attachContentListener(model);
    }));
    this.subs.push(
      monaco.editor.onWillDisposeModel(model => {
        const uri = model.uri.toString();
        this.provider.clearSource(uri);
        const sub = this.modelContentSubs.get(uri);
        if (sub) {
          sub.dispose();
          this.modelContentSubs.delete(uri);
        }
      }),
    );

    this.subs.push(registerJavaLiveTemplates(JAVA_LANGUAGE_ID, {
      getExtraTemplates: () => this.userTemplates?.list() ?? [],
    }));
    void this.userTemplates?.ensureLoaded();
    this.subs.push(registerHippieCompletion(JAVA_LANGUAGE_ID));
    this.subs.push(registerHippieCompletion('jsp'));
    this.subs.push(
      monaco.languages.registerCompletionItemProvider(JAVA_LANGUAGE_ID, {
        triggerCharacters: ['.', '@', '#', '*'],
        provideCompletionItems: async (model, position, context, token) => {
          if (token.isCancellationRequested) return { suggestions: [] };
          const uri = model.uri.toString();
          this.provider.cacheSource(uri, model.getValue());
          this.documentSync?.flushPending(uri);
          const smart = consumeSmartCompletionFlag();
          const smartCycle = smart ? consumeSmartCompletionCycle() : 0;
          const response = await this.provider.provideCompletions({
            uri,
            // Monaco positions are 1-based; the provider speaks
            // 0-based LSP positions.
            line: position.lineNumber - 1,
            character: position.column - 1,
            linePrefix: model.getLineContent(position.lineNumber).substring(0, position.column - 1),
            triggerKind: context.triggerKind + 1 as 1 | 2 | 3,
            triggerCharacter: context.triggerCharacter,
            smart,
            smartCycle,
          });
          if (token.isCancellationRequested) return { suggestions: [] };
          console.info(`[kairo-java] monaco provideCompletionItems lang=${model.getLanguageId()} items=${response.items.length} smart=${smart}`);
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          );
          return {
            suggestions: response.items.map(item => {
              const rank = globalRecentCompletions.rank(item.label);
              const boosted = {
                ...item,
                sortText: globalRecentCompletions.boostSortText(item.label, item.sortText),
                preselect: item.preselect === true || rank === 0,
              };
              return adaptCompletionItem(boosted, range);
            }),
            // Preserve JDT isIncomplete so truncated lists keep re-querying.
            incomplete: !!response.isIncomplete,
          };
        },
        resolveCompletionItem: async (item, token) => {
          if (token.isCancellationRequested) return item;
          const raw = item as MonacoCompletionItemWithData;
          if (raw._kairoData === undefined && !raw._kairoNeedsResolve) {
            return item;
          }
          const resolved = await this.provider.resolveCompletion({
            label: typeof item.label === 'string' ? item.label : item.label.label,
            kind: undefined,
            detail: typeof item.detail === 'string' ? item.detail : undefined,
            documentation: typeof item.documentation === 'string'
              ? item.documentation
              : item.documentation && 'value' in item.documentation
                ? item.documentation.value
                : undefined,
            sortText: item.sortText,
            filterText: item.filterText,
            insertText: typeof item.insertText === 'string' ? item.insertText : undefined,
            insertTextFormat: item.insertTextRules === monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              ? INSERT_AS_SNIPPET
              : undefined,
            data: raw._kairoData,
            additionalTextEdits: undefined,
            textEdit: undefined,
            commitCharacters: item.commitCharacters,
            command: undefined,
          });
          if (token.isCancellationRequested) return item;
          const wordRange = completionItemWordRange(item as MonacoCompletionItemWithData);
          return adaptCompletionItem(resolved, wordRange);
        },
      }),
      monaco.languages.registerDefinitionProvider(JAVA_LANGUAGE_ID, {
        provideDefinition: async (model, position, token) => {
          if (token.isCancellationRequested) return [];
          this.provider.cacheSource(model.uri.toString(), model.getValue());
          const definitions = await this.provider.provideDefinition(
            model.uri.toString(),
            position.lineNumber - 1,
            position.column - 1,
          );
          if (token.isCancellationRequested) return [];
          return definitions.map(adaptDefinition);
        },
      }),
      monaco.languages.registerImplementationProvider(JAVA_LANGUAGE_ID, {
        provideImplementation: async (model, position, token) => {
          if (token.isCancellationRequested) return [];
          console.info(`[kairo-java] monaco provideImplementation uri=${model.uri.toString()} pos=${position.lineNumber - 1}:${position.column - 1}`);
          const result = await this.provider.provideImplementation(
            model.uri.toString(), position.lineNumber - 1, position.column - 1,
          );
          console.info(`[kairo-java] monaco provideImplementation result=${result.length}`);
          return token.isCancellationRequested ? [] : result.map(adaptLocation);
        },
      }),
      monaco.languages.registerHoverProvider(JAVA_LANGUAGE_ID, {
        provideHover: async (model, position, token) => {
          if (token.isCancellationRequested) return null;
          const result = await this.provider.provideHover(
            model.uri.toString(), position.lineNumber - 1, position.column - 1,
          );
          return token.isCancellationRequested ? null : adaptHover(result);
        },
      }),
      monaco.languages.registerReferenceProvider(JAVA_LANGUAGE_ID, {
        provideReferences: async (model, position, context, token) => {
          if (token.isCancellationRequested) return [];
          const result = await this.provider.provideReferences(
            model.uri.toString(), position.lineNumber - 1, position.column - 1, context.includeDeclaration,
          );
          return token.isCancellationRequested ? [] : result.map(adaptLocation);
        },
      }),
      monaco.languages.registerTypeDefinitionProvider(JAVA_LANGUAGE_ID, {
        provideTypeDefinition: async (model, position, token) => {
          if (token.isCancellationRequested) return [];
          const result = await this.provider.provideTypeDefinition(
            model.uri.toString(), position.lineNumber - 1, position.column - 1,
          );
          if (token.isCancellationRequested) return [];
          return result.map(loc => isLocationLink(loc) ? adaptLocationLink(loc) : adaptLocation(loc));
        },
      }),
      monaco.languages.registerDocumentHighlightProvider(JAVA_LANGUAGE_ID, {
        provideDocumentHighlights: async (model, position, token) => {
          if (token.isCancellationRequested) return [];
          const result = await this.provider.provideDocumentHighlights(
            model.uri.toString(), position.lineNumber - 1, position.column - 1,
          );
          return token.isCancellationRequested ? [] : result.map(adaptDocumentHighlight);
        },
      }),
      monaco.languages.registerSignatureHelpProvider(JAVA_LANGUAGE_ID, {
        signatureHelpTriggerCharacters: ['(', ','],
        signatureHelpRetriggerCharacters: [','],
        provideSignatureHelp: async (model, position, _token, context) => {
          if (_token.isCancellationRequested) return null;
          const result = adaptSignatureHelp(await this.provider.provideSignatureHelp({
            uri: model.uri.toString(),
            line: position.lineNumber - 1,
            character: position.column - 1,
            triggerKind: context.triggerKind as 1 | 2 | 3,
            triggerCharacter: context.triggerCharacter,
            isRetrigger: context.isRetrigger,
          }));
          return result && !_token.isCancellationRequested ? { value: result, dispose: () => undefined } : null;
        },
      }),
      monaco.languages.registerDocumentSymbolProvider(JAVA_LANGUAGE_ID, {
        displayName: 'Kairo Java',
        provideDocumentSymbols: async (model, token) => {
          if (token.isCancellationRequested) return [];
          const result = await this.provider.provideDocumentSymbols(model.uri.toString());
          return token.isCancellationRequested ? [] : adaptDocumentSymbols(result);
        },
      }),
      (() => {
        // Monaco has no public workspace-symbol API in 1.108; expose via Kairo registry
        const registries = kairoSymbolRegistries(monaco.languages);
        registries.workspace.push({
          provideWorkspaceSymbols: async (query, token) => {
            const text = typeof query === 'string'
              ? query
              : (query as { query?: string } | undefined)?.query ?? '';
            if ((token as { isCancellationRequested?: boolean })?.isCancellationRequested || !text.trim()) return [];
            const result = await this.provider.provideWorkspaceSymbols(text);
            if ((token as { isCancellationRequested?: boolean })?.isCancellationRequested) return [];
            return adaptWorkspaceSymbols(result);
          },
        });
        return Disposable.create(() => {
          // no-op: registry lives for the app lifetime
        });
      })(),
      monaco.languages.registerRenameProvider(JAVA_LANGUAGE_ID, {
        provideRenameEdits: async (model, position, newName, token) => {
          if (token.isCancellationRequested) return { edits: [], rejectReason: 'Rename cancelled.' };
          const result = await this.provider.provideRename(
            model.uri.toString(), position.lineNumber - 1, position.column - 1, newName,
          );
          return token.isCancellationRequested
            ? { edits: [], rejectReason: 'Rename cancelled.' }
            : adaptWorkspaceEdit(result);
        },
      }),
      monaco.languages.registerCodeActionProvider(JAVA_LANGUAGE_ID, {
        provideCodeActions: async (model, range, context, token) => {
          if (token.isCancellationRequested) return { actions: [], dispose: () => undefined };
          const diagnostics = context.markers.map(adaptMarkerToDiagnostic);
          const result = await this.provider.provideCodeActions(
            model.uri.toString(),
            {
              start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
              end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
            },
            diagnostics,
            context.only ? [context.only] : undefined,
          );
          const actions = token.isCancellationRequested ? [] : (result ?? [])
            .filter(isEditableCodeAction)
            .map(action => adaptCodeAction(action));
          return { actions, dispose: () => undefined };
        },
      }, { providedCodeActionKinds: ['quickfix', 'refactor', 'source'] }),
      monaco.languages.registerCodeLensProvider(JAVA_LANGUAGE_ID, {
        provideCodeLenses: async (model, token) => {
          if (token.isCancellationRequested) return { lenses: [], dispose: () => undefined };
          const allLenses: monaco.languages.CodeLens[] = [];
          try {
            const lenses = await this.provider.provideCodeLens(model.uri.toString());
            if (!token.isCancellationRequested) {
              allLenses.push(...lenses.map(adaptCodeLens));
            }
          } catch (e) {
            console.warn('[kairo-java] JDT LS codeLens failed', e);
          }
          if (this.javaRunService && !token.isCancellationRequested) {
            try {
              const runLenses = await this.provideRunDebugCodeLenses(model);
              allLenses.push(...runLenses);
            } catch (e) {
              console.warn('[kairo-java] run codelens failed', e);
            }
          }
          return { lenses: allLenses, dispose: () => undefined };
        },
      }),
      monaco.languages.registerDocumentFormattingEditProvider(JAVA_LANGUAGE_ID, {
        provideDocumentFormattingEdits: async (model, options, token) => {
          if (token.isCancellationRequested) return [];
          const edits = await this.provider.provideFormatting(model.uri.toString(), {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          });
          return token.isCancellationRequested ? [] : edits.map(e => adaptTextEdit(model.uri.toString(), e, undefined).textEdit);
        },
      }),
      monaco.languages.registerDocumentRangeFormattingEditProvider(JAVA_LANGUAGE_ID, {
        provideDocumentRangeFormattingEdits: async (model, range, options, token) => {
          if (token.isCancellationRequested) return [];
          const lspRange: LSPRange = {
            start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
            end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
          };
          const edits = await this.provider.provideRangeFormatting(model.uri.toString(), lspRange, {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          });
          return token.isCancellationRequested ? [] : edits.map(e => adaptTextEdit(model.uri.toString(), e, undefined).textEdit);
        },
      }),
      monaco.languages.registerInlayHintsProvider(JAVA_LANGUAGE_ID, {
        provideInlayHints: async (model, range, token) => {
          if (token.isCancellationRequested) return { hints: [], dispose: () => undefined };
          const lspRange: LSPRange | undefined = range ? {
            start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
            end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
          } : undefined;
          const hints = await this.provider.provideInlayHints(model.uri.toString(), lspRange);
          if (token.isCancellationRequested) return { hints: [], dispose: () => undefined };
          return { hints: hints.map(adaptInlayHint), dispose: () => undefined };
        },
      }),
    );
    this.registerRunCommands();
    this.ensureJavaQuickSuggestions();
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(
      { id: 'kairo.java.smartCompletion', label: 'Smart Type Completion', category: 'Java' },
      {
        execute: async () => {
          requestSmartCompletion();
          if (this.commandService) {
            await this.commandService.executeCommand('editor.action.triggerSuggest');
          }
        },
      },
    );
    registry.registerCommand(
      { id: 'editor.action.completeStatement', label: 'Complete Statement', category: 'Java' },
      {
        execute: () => this.executeCompleteStatement(),
      },
    );
    registry.registerCommand(
      { id: 'editor.action.surroundWith', label: 'Surround With…', category: 'Java' },
      {
        execute: () => this.executeSurroundWith(),
      },
    );
    registry.registerCommand(
      { id: 'editor.action.unwrap', label: 'Unwrap', category: 'Java' },
      {
        execute: () => this.executeUnwrap(),
      },
    );
    registry.registerCommand(
      { id: 'kairo.java.liveTemplates.add', label: 'Add Live Template...', category: 'Java' },
      {
        execute: () => this.executeAddLiveTemplate(),
      },
    );
    registry.registerCommand(
      { id: 'kairo.java.liveTemplates.manage', label: 'Manage Live Templates...', category: 'Java' },
      {
        execute: () => this.executeManageLiveTemplates(),
      },
    );
    registry.registerCommand(
      { id: 'editor.action.hippieCompletion', label: 'Hippie Completion', category: 'Java' },
      {
        execute: () => {
          cycleHippieCompletion(false);
        },
      },
    );
    registry.registerCommand(
      { id: 'editor.action.hippieCompletionBackward', label: 'Hippie Completion (Backward)', category: 'Java' },
      {
        execute: () => {
          cycleHippieCompletion(true);
        },
      },
    );
    // IDEA keymap IDs (kairo-idea-windows-keymap) — wire to JavaRefactoring / codeActions.
    registry.registerCommand(
      { id: 'editor.action.extractMethod', label: 'Extract Method…', category: 'Java' },
      { execute: () => this.executeRefactor('extractMethod') },
    );
    registry.registerCommand(
      { id: 'editor.action.extractVariable', label: 'Extract Variable…', category: 'Java' },
      { execute: () => this.executeRefactor('extractVariable') },
    );
    registry.registerCommand(
      { id: 'editor.action.extractConstant', label: 'Extract Constant…', category: 'Java' },
      { execute: () => this.executeRefactor('extractConstant') },
    );
    registry.registerCommand(
      { id: 'editor.action.extractField', label: 'Extract Field…', category: 'Java' },
      { execute: () => this.executeRefactor('extractField') },
    );
    registry.registerCommand(
      { id: 'editor.action.changeSignature', label: 'Change Signature…', category: 'Java' },
      { execute: () => this.executeRefactor('changeSignature') },
    );
    registry.registerCommand(
      { id: 'editor.action.generator.generate', label: 'Generate…', category: 'Java' },
      { execute: () => this.executeGenerateMenu() },
    );
    registry.registerCommand(
      { id: 'editor.action.overrideMethod', label: 'Override Methods…', category: 'Java' },
      { execute: () => this.executeSourceAction('source.overrideMethods', 'Override Methods') },
    );
    registry.registerCommand(
      { id: 'editor.action.implementMethods', label: 'Implement Methods…', category: 'Java' },
      { execute: () => this.executeSourceAction('source.overrideMethods', 'Implement Methods') },
    );
    // JDT LS completion items often fire this after accept for auto-import.
    this.subs.push(
      monaco.editor.registerCommand('java.apply.workspaceEdit', (_accessor, ...args: unknown[]) => {
        const edit = args[0] as LSPWorkspaceEdit | undefined;
        if (edit) {
          void this.applyLspWorkspaceEdit(edit);
        }
      }),
    );
    this.subs.push(
      monaco.editor.registerCommand('kairo.java.completionAccepted', async (_accessor, ...args: unknown[]) => {
        const label = String(args[0] ?? '');
        const kind = typeof args[1] === 'number' ? args[1] : undefined;
        if (label) {
          globalRecentCompletions.record(label, kind);
        }
        const original = args[2] as { id: string; title?: string; arguments?: unknown[] } | undefined;
        if (!original?.id) {
          return;
        }
        if (original.id === 'java.apply.workspaceEdit' && original.arguments?.[0]) {
          await this.applyLspWorkspaceEdit(original.arguments[0] as LSPWorkspaceEdit);
          return;
        }
        if (this.commandService) {
          await this.commandService.executeCommand(original.id, ...(original.arguments ?? []));
        }
      }),
    );
  }

  registerMenus(menus: MenuModelRegistry): void {
    const path = EDITOR_CONTEXT_MENU.concat('2_modification', 'kairo.java.completion');
    const actions: Array<{ commandId: string; label: string; order: string }> = [
      { commandId: 'editor.action.completeStatement', label: 'Complete Statement', order: '1' },
      { commandId: 'kairo.java.smartCompletion', label: 'Smart Type Completion', order: '2' },
      { commandId: 'editor.action.surroundWith', label: 'Surround With…', order: '3' },
      { commandId: 'editor.action.unwrap', label: 'Unwrap', order: '4' },
      { commandId: 'editor.action.hippieCompletion', label: 'Hippie Completion', order: '5' },
      { commandId: 'kairo.java.liveTemplates.manage', label: 'Manage Live Templates…', order: '6' },
    ];
    for (const action of actions) {
      try {
        menus.registerMenuAction(path, action);
      } catch {
        // menu path may already exist from other contributions
      }
    }
  }

  protected executeCompleteStatement(): void {
    const editor = monaco.editor.getEditors().find(e => e.hasTextFocus()) ?? monaco.editor.getEditors()[0];
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (!editor || !model || !position) {
      return;
    }
    const langId = model.getLanguageId();
    if (langId !== JAVA_LANGUAGE_ID && langId !== 'jsp') {
      return;
    }
    const lines = model.getLinesContent();
    const edit = computeCompleteStatement({
      lines,
      line: position.lineNumber - 1,
      character: position.column - 1,
    });
    if (!edit) {
      return;
    }
    const ops: monaco.editor.IIdentifiedSingleEditOperation[] = [
      {
        range: new monaco.Range(edit.line + 1, 1, edit.line + 1, model.getLineMaxColumn(edit.line + 1)),
        text: edit.text,
      },
    ];
    if (edit.insertAfter?.length) {
      const insertText = '\n' + edit.insertAfter.join('\n');
      ops.push({
        range: new monaco.Range(edit.line + 1, model.getLineMaxColumn(edit.line + 1), edit.line + 1, model.getLineMaxColumn(edit.line + 1)),
        text: '', // placeholder — replaced below after first edit applies via single compound
      });
      // Apply as one edit: replace line + append following lines
      ops.length = 0;
      const full = edit.text + (edit.insertAfter.length ? '\n' + edit.insertAfter.join('\n') : '');
      ops.push({
        range: new monaco.Range(edit.line + 1, 1, edit.line + 1, model.getLineMaxColumn(edit.line + 1)),
        text: full,
      });
    }
    editor.pushUndoStop();
    editor.executeEdits('kairo.completeStatement', ops);
    editor.setPosition({ lineNumber: edit.cursorLine + 1, column: edit.cursorCharacter + 1 });
    editor.revealPositionInCenterIfOutsideViewport(editor.getPosition()!);
    editor.pushUndoStop();
    editor.focus();
  }

  protected async executeSurroundWith(): Promise<void> {
    const editor = monaco.editor.getEditors().find(e => e.hasTextFocus()) ?? monaco.editor.getEditors()[0];
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection) {
      return;
    }
    const langId = model.getLanguageId();
    if (langId !== JAVA_LANGUAGE_ID && langId !== 'jsp') {
      return;
    }

    let templateId: string | undefined;
    if (this.quickInput) {
      const picked = await this.quickInput.showQuickPick(
        SURROUND_TEMPLATES.map(t => ({
          label: t.label,
          description: t.detail,
        })),
        { placeholder: 'Surround with…', matchOnDescription: true },
      );
      if (picked?.label) {
        templateId = findSurroundTemplate(picked.label)?.id;
      }
    } else {
      // Headless / no QuickInput — default to try/catch
      templateId = 'try';
    }
    if (!templateId) {
      return;
    }
    const template = findSurroundTemplate(templateId);
    if (!template) {
      return;
    }

    const edit = computeSurroundEdit(
      {
        lines: model.getLinesContent(),
        startLine: selection.startLineNumber - 1,
        startCharacter: selection.startColumn - 1,
        endLine: selection.endLineNumber - 1,
        endCharacter: selection.endColumn - 1,
      },
      template,
    );

    editor.pushUndoStop();
    editor.executeEdits('kairo.surroundWith', [
      {
        range: new monaco.Range(
          edit.startLine + 1,
          edit.startCharacter + 1,
          edit.endLine + 1,
          edit.endCharacter + 1,
        ),
        text: '',
      },
    ]);
    // Re-select emptied range and insert as snippet so Tab cycles placeholders.
    editor.setSelection(new monaco.Selection(
      edit.startLine + 1,
      edit.startCharacter + 1,
      edit.startLine + 1,
      edit.startCharacter + 1,
    ));
    insertSnippet(editor, edit.text);
    editor.pushUndoStop();
    editor.focus();
  }

  protected executeUnwrap(): void {
    const editor = monaco.editor.getEditors().find(e => e.hasTextFocus()) ?? monaco.editor.getEditors()[0];
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (!editor || !model || !position) {
      return;
    }
    const langId = model.getLanguageId();
    if (langId !== JAVA_LANGUAGE_ID && langId !== 'jsp') {
      return;
    }
    const edit = computeUnwrapEdit({
      lines: model.getLinesContent(),
      line: position.lineNumber - 1,
      character: position.column - 1,
    });
    if (!edit) {
      return;
    }
    editor.pushUndoStop();
    editor.executeEdits('kairo.unwrap', [
      {
        range: new monaco.Range(
          edit.startLine + 1,
          edit.startCharacter + 1,
          edit.endLine + 1,
          edit.endCharacter + 1,
        ),
        text: edit.text,
      },
    ]);
    editor.setPosition({ lineNumber: edit.cursorLine + 1, column: edit.cursorCharacter + 1 });
    editor.pushUndoStop();
    editor.focus();
  }

  /** Active Java editor URI + selection as 0-based LSP range. */
  protected getActiveJavaSelection(): { uri: string; range: LSPRange } | undefined {
    const editor = monaco.editor.getEditors().find(e => e.hasTextFocus()) ?? monaco.editor.getEditors()[0];
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection) {
      return undefined;
    }
    if (model.getLanguageId() !== JAVA_LANGUAGE_ID) {
      return undefined;
    }
    return {
      uri: model.uri.toString(),
      range: {
        start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
        end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
      },
    };
  }

  protected async executeRefactor(kind: string): Promise<void> {
    if (!this.refactoring) {
      this.messages?.warn('Java refactoring service unavailable.');
      return;
    }
    const sel = this.getActiveJavaSelection();
    if (!sel) {
      this.messages?.info('Place the caret in a Java editor first.');
      return;
    }
    const result = await this.refactoring.refactor(sel.uri, sel.range, kind);
    if (result.success && result.edit) {
      await this.applyLspWorkspaceEdit(result.edit);
      this.messages?.info(result.message);
    } else {
      this.messages?.warn(result.message || `No ${kind} refactoring available.`);
    }
  }

  protected async executeSourceAction(onlyKind: string, label: string): Promise<void> {
    const sel = this.getActiveJavaSelection();
    if (!sel) {
      this.messages?.info('Place the caret in a Java editor first.');
      return;
    }
    if (await this.client.fetchState() !== 'ready') {
      this.messages?.warn('JDT Language Server is not ready.');
      return;
    }
    try {
      const actions = await this.client.codeActions({
        uri: sel.uri,
        range: sel.range,
        diagnostics: [],
        only: [onlyKind],
      });
      const withEdit = (actions ?? []).find(a => !('command' in a) && (a as LSPCodeAction).edit) as LSPCodeAction | undefined;
      if (withEdit?.edit) {
        await this.applyLspWorkspaceEdit(withEdit.edit);
        this.messages?.info(`${label} applied.`);
        return;
      }
      // Prefer interactive command if JDT returned one (prompt UI).
      const withCmd = (actions ?? []).find(a => 'command' in a) as { command: string; arguments?: unknown[] } | undefined;
      if (withCmd?.command && this.commandService) {
        await this.commandService.executeCommand(withCmd.command, ...(withCmd.arguments ?? []));
        return;
      }
      this.messages?.warn(`No ${label} action available at this location.`);
    } catch (err) {
      this.messages?.error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  protected async executeGenerateMenu(): Promise<void> {
    const options: Array<{ label: string; kind: string }> = [
      { label: 'Getter and Setter…', kind: 'source.generate.accessors' },
      { label: 'Constructor…', kind: 'source.generate.constructors' },
      { label: 'toString()…', kind: 'source.generate.toString' },
      { label: 'hashCode() and equals()…', kind: 'source.generate.hashCodeEquals' },
      { label: 'Delegate Methods…', kind: 'source.generate.delegateMethods' },
      { label: 'Override Methods…', kind: 'source.overrideMethods' },
      { label: 'Implement Methods…', kind: 'source.overrideMethods' },
    ];
    let kind = options[0].kind;
    let label = options[0].label;
    if (this.quickInput) {
      const picked = await this.quickInput.showQuickPick(
        options.map(o => ({ label: o.label })),
        { placeholder: 'Generate…' },
      );
      if (!picked?.label) {
        return;
      }
      const match = options.find(o => o.label === picked.label);
      if (!match) {
        return;
      }
      kind = match.kind;
      label = match.label;
    }
    await this.executeSourceAction(kind, label.replace(/…$/, ''));
  }

  protected async executeAddLiveTemplate(): Promise<void> {
    if (!this.quickInput) {
      console.warn('[kairo-java] QuickInput unavailable for Add Live Template');
      return;
    }
    if (!this.userTemplates) {
      console.warn('[kairo-java] JavaUserLiveTemplatesService not bound; cannot persist templates');
      return;
    }
    await this.userTemplates.ensureLoaded();
    const prefix = await this.quickInput.input({
      prompt: 'Abbreviation (e.g. mysout)',
      placeHolder: 'prefix',
    });
    if (!prefix?.trim()) return;
    const body = await this.quickInput.input({
      prompt: 'Template body (use ${1:name} tabstops)',
      placeHolder: 'System.out.println(${1});',
    });
    if (body === undefined) return;
    await this.userTemplates.upsert({
      prefix: prefix.trim(),
      label: prefix.trim(),
      insertText: body,
      detail: 'User template',
      category: 'User',
    });
  }

  protected async executeManageLiveTemplates(): Promise<void> {
    if (!this.quickInput) {
      console.warn('[kairo-java] QuickInput unavailable for Manage Live Templates');
      return;
    }
    if (!this.userTemplates) {
      console.warn('[kairo-java] JavaUserLiveTemplatesService not bound; cannot manage templates');
      await this.quickInput.showQuickPick(
        [{ label: 'User Live Templates service unavailable', description: 'StorageService / DI missing' }],
        { placeholder: 'Manage Live Templates' },
      );
      return;
    }
    await this.userTemplates.ensureLoaded();
    const items = this.userTemplates.list();
    if (items.length === 0) {
      await this.executeAddLiveTemplate();
      return;
    }
    const picked = await this.quickInput.showQuickPick(
      [
        { label: '$(add) Add new template...', description: 'create' },
        ...items.map(t => ({
          label: t.prefix,
          description: t.detail,
          detail: t.insertText.slice(0, 80),
        })),
      ],
      { placeholder: 'Manage Live Templates — select to delete, or add new' },
    );
    if (!picked) return;
    if (picked.description === 'create' || picked.label.includes('Add new')) {
      await this.executeAddLiveTemplate();
      return;
    }
    const confirm = await this.quickInput.showQuickPick(
      [
        { label: 'Delete', description: picked.label },
        { label: 'Cancel' },
      ],
      { placeholder: `Delete template "${picked.label}"?` },
    );
    if (confirm?.label === 'Delete') {
      await this.userTemplates.remove(picked.label);
    }
  }

  protected ensureJavaQuickSuggestions(): void {
    const applyJavaOptions = (editor: monaco.editor.ICodeEditor): void => {
      const model = editor.getModel();
      if (!model) return;
      const langId = model.getLanguageId();
      if (langId !== JAVA_LANGUAGE_ID && langId !== 'jsp') return;
      editor.updateOptions({
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },
        suggestOnTriggerCharacters: true,
        quickSuggestionsDelay: 10,
        acceptSuggestionOnCommitCharacter: true,
        acceptSuggestionOnEnter: 'on',
        tabCompletion: 'on',
        snippetSuggestions: 'top',
        suggest: {
          localityBonus: true,
          snippetsPreventQuickSuggestions: false,
          showWords: false,
          shareSuggestSelections: true,
          filterGraceful: true,
          showIcons: true,
          showInlineDetails: true,
          insertMode: 'insert',
          selectionMode: 'always',
          matchOnWordStartOnly: false,
          preview: true,
          previewMode: 'subwordSmart',
        },
      });
    };

    this.subs.push(monaco.editor.onDidCreateEditor(editor => {
      applyJavaOptions(editor);
      this.subs.push(editor.onDidChangeModel(() => {
        applyJavaOptions(editor);
      }));
      this.subs.push(editor.onDidChangeModelLanguage(() => {
        applyJavaOptions(editor);
      }));
    }));

    for (const editor of monaco.editor.getEditors()) {
      applyJavaOptions(editor);
    }
  }

  protected registerRunCommands(): void {
    const self = this;
    this.subs.push(
      monaco.editor.registerCommand(JAVA_RUN_COMMANDS.RUN_MAIN, (_accessor: any, arg?: any) => {
        self.executeRun(arg, false);
      }),
      monaco.editor.registerCommand(JAVA_RUN_COMMANDS.DEBUG_MAIN, (_accessor: any, arg?: any) => {
        self.executeRun(arg, true);
      }),
      monaco.editor.registerCommand(JAVA_RUN_COMMANDS.RUN_TEST, (_accessor: any, arg?: any) => {
        self.executeRun(arg, false);
      }),
      monaco.editor.registerCommand(JAVA_RUN_COMMANDS.DEBUG_TEST, (_accessor: any, arg?: any) => {
        self.executeRun(arg, true);
      }),
    );
  }

  protected async executeRun(arg: { uri?: string; line?: number; method?: any; debug?: boolean } | undefined, debug: boolean): Promise<void> {
    if (!this.javaRunService) return;
    let uri: string | undefined;
    let line: number | undefined;
    if (arg && arg.uri) {
      uri = arg.uri;
      line = arg.line;
    } else {
      const editor = monaco.editor.getEditors()[0];
      if (editor) {
        uri = editor.getModel()?.uri.toString();
        line = editor.getPosition()?.lineNumber;
      }
    }
    if (!uri || !line) return;
    await this.javaRunService.runFromUri(uri, line, arg?.debug ?? debug);
  }

  protected async provideRunDebugCodeLenses(model: monaco.editor.ITextModel): Promise<monaco.languages.CodeLens[]> {
    if (!this.javaRunService) return [];
    const uri = model.uri.toString();
    const info = await this.javaRunService.detectJavaMethods(uri);
    if (!info || !info.methods || info.methods.length === 0) return [];
    const lenses: monaco.languages.CodeLens[] = [];
    for (const method of info.methods) {
      const lineNumber = method.startLine;
      if (method.isMain) {
        lenses.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          command: {
            id: JAVA_RUN_COMMANDS.RUN_MAIN,
            title: `▶▶ Run '${info.className}.main()'`,
            arguments: [{ uri, line: lineNumber, method }],
          },
        });
        lenses.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          command: {
            id: JAVA_RUN_COMMANDS.DEBUG_MAIN,
            title: `| Debug '${info.className}.main()'`,
            arguments: [{ uri, line: lineNumber, method, debug: true }],
          },
        });
      } else if (method.isTest) {
        lenses.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          command: {
            id: JAVA_RUN_COMMANDS.RUN_TEST,
            title: `▶ Run '${method.name}()'`,
            arguments: [{ uri, line: lineNumber, method }],
          },
        });
        lenses.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          command: {
            id: JAVA_RUN_COMMANDS.DEBUG_TEST,
            title: `| Debug '${method.name}()'`,
            arguments: [{ uri, line: lineNumber, method, debug: true }],
          },
        });
      }
    }
    return lenses;
  }

  /**
   * Apply LSP workspace edits through MonacoWorkspace.applyBulkEdit so
   * changes to unopened files are persisted (not only open models).
   */
  protected async applyLspWorkspaceEdit(edit: LSPWorkspaceEdit): Promise<void> {
    const adapted = adaptWorkspaceEdit(edit);
    if (adapted.rejectReason) {
      this.messages?.warn(adapted.rejectReason);
      return;
    }
    if (!adapted.edits?.length) {
      return;
    }
    if (this.monacoWorkspace) {
      try {
        const resourceEdits = ResourceEdit.convert(adapted);
        await this.monacoWorkspace.applyBulkEdit(resourceEdits);
        return;
      } catch (err) {
        this.messages?.warn(
          `Workspace edit via MonacoWorkspace failed, falling back to open editors: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // Fallback: only open models (previous behaviour).
    applyLspWorkspaceEditToOpenModels(edit);
  }

  dispose(): void {
    if (this.modelContentSubs) {
      for (const d of this.modelContentSubs.values()) d.dispose();
      this.modelContentSubs.clear();
    }
    for (const d of (this.subs ?? [])) d.dispose();
    this.subs = [];
  }
}

function adaptCompletionItem(
  item: JavaCompletionResponseItem,
  defaultRange: monaco.Range,
): monaco.languages.CompletionItem {
  const insertText = item.insertText ?? item.label;
  const asSnippet = item.insertTextFormat === INSERT_AS_SNIPPET || looksLikeSnippet(insertText);
  let range: monaco.Range | monaco.languages.CompletionItemRanges = defaultRange;
  let finalInsert = insertText;

  if (item.textEdit) {
    const r = item.textEdit.range;
    range = new monaco.Range(
      r.start.line + 1,
      r.start.character + 1,
      r.end.line + 1,
      r.end.character + 1,
    );
    finalInsert = item.textEdit.newText;
  } else if (item.insertRange && item.replaceRange) {
    range = {
      insert: new monaco.Range(
        item.insertRange.start.line + 1,
        item.insertRange.start.character + 1,
        item.insertRange.end.line + 1,
        item.insertRange.end.character + 1,
      ),
      replace: new monaco.Range(
        item.replaceRange.start.line + 1,
        item.replaceRange.start.character + 1,
        item.replaceRange.end.line + 1,
        item.replaceRange.end.character + 1,
      ),
    };
  }

  const label: string | monaco.languages.CompletionItemLabel =
    item.labelDetail || item.labelDescription
      ? {
          label: item.label,
          detail: item.labelDetail,
          description: item.labelDescription,
        }
      : item.label;

  const suggestion: MonacoCompletionItemWithData = {
    label,
    kind: toMonacoCompletionItemKind(item.kind),
    detail: item.detail,
    documentation: item.documentation,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText: finalInsert,
    range,
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map(edit => ({
      range: new monaco.Range(
        edit.range.start.line + 1,
        edit.range.start.character + 1,
        edit.range.end.line + 1,
        edit.range.end.character + 1,
      ),
      text: edit.newText,
    })),
    tags: item.isDeprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
    preselect: item.preselect,
    command: {
      id: 'kairo.java.completionAccepted',
      title: 'Record completion',
      arguments: [
        item.label,
        item.kind,
        item.command
          ? { id: item.command.command, title: item.command.title, arguments: item.command.arguments }
          : undefined,
      ],
    },
  };

  if (asSnippet) {
    suggestion.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  }
  if (item.data !== undefined) {
    suggestion._kairoData = item.data;
    suggestion._kairoNeedsResolve = true;
  }
  if (range instanceof monaco.Range) {
    suggestion._kairoWordRange = range;
  } else {
    const insert = (range as monaco.languages.CompletionItemRanges).insert;
    suggestion._kairoWordRange = insert
      ? new monaco.Range(insert.startLineNumber, insert.startColumn, insert.endLineNumber, insert.endColumn)
      : defaultRange;
  }

  return suggestion;
}

/** Word range captured during provideCompletionItems for resolve fallback (JV-P1-9). */
function completionItemWordRange(item: MonacoCompletionItemWithData): monaco.Range {
  if (item._kairoWordRange) {
    return item._kairoWordRange;
  }
  if (item.range instanceof monaco.Range) {
    return item.range;
  }
  if (item.range && typeof item.range === 'object') {
    const ranges = item.range as { insert?: monaco.IRange; replace?: monaco.IRange; insertText?: monaco.IRange; inserting?: monaco.IRange };
    const r = ranges.insert ?? ranges.replace ?? ranges.inserting ?? ranges.insertText;
    if (r) {
      return new monaco.Range(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn);
    }
  }
  return new monaco.Range(1, 1, 1, 1);
}

interface MonacoCompletionItemWithData extends monaco.languages.CompletionItem {
  _kairoData?: unknown;
  _kairoNeedsResolve?: boolean;
  _kairoWordRange?: monaco.Range;
}

export { adaptCompletionItem };

/** Insert a TextMate-style snippet at the current caret via Monaco's snippet controller. */
function insertSnippet(editor: monaco.editor.ICodeEditor, snippet: string): void {
  const contribution = editor.getContribution('snippetController2') as {
    insert?: (template: string) => void;
  } | null;
  if (contribution?.insert) {
    contribution.insert(snippet);
    return;
  }
  const pos = editor.getPosition();
  if (!pos) {
    return;
  }
  const plain = snippet
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}/g, '')
    .replace(/\$\d+/g, '')
    .replace(/\$0/g, '');
  editor.executeEdits('kairo.snippetFallback', [
    {
      range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
      text: plain,
    },
  ]);
}

/**
 * Apply an LSP workspace edit via MonacoWorkspace so unopened files
 * and resource operations are not silently dropped.
 * Exported for unit tests of the conversion path.
 */
export function lspWorkspaceEditToMonacoEdits(
  edit: LSPWorkspaceEdit,
): monaco.languages.WorkspaceEdit & monaco.languages.Rejection {
  return adaptWorkspaceEdit(edit);
}

/** Last-resort apply when MonacoWorkspace is unavailable. */
function applyLspWorkspaceEditToOpenModels(edit: LSPWorkspaceEdit): void {
  const changes = edit.changes ?? {};
  for (const [uri, textEdits] of Object.entries(changes)) {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model || !textEdits?.length) {
      continue;
    }
    const operations = textEdits.map(te => ({
      range: new monaco.Range(
        te.range.start.line + 1,
        te.range.start.character + 1,
        te.range.end.line + 1,
        te.range.end.character + 1,
      ),
      text: te.newText,
    }));
    operations.sort((a, b) => {
      if (b.range.startLineNumber !== a.range.startLineNumber) {
        return b.range.startLineNumber - a.range.startLineNumber;
      }
      return b.range.startColumn - a.range.startColumn;
    });
    model.pushEditOperations([], operations, () => null);
  }
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ('kind' in change) continue;
      const model = monaco.editor.getModel(monaco.Uri.parse(change.textDocument.uri));
      if (!model) continue;
      const operations = change.edits.map(te => ({
        range: new monaco.Range(
          te.range.start.line + 1,
          te.range.start.character + 1,
          te.range.end.line + 1,
          te.range.end.character + 1,
        ),
        text: te.newText,
      }));
      operations.sort((a, b) => {
        if (b.range.startLineNumber !== a.range.startLineNumber) {
          return b.range.startLineNumber - a.range.startLineNumber;
        }
        return b.range.startColumn - a.range.startColumn;
      });
      model.pushEditOperations([], operations, () => null);
    }
  }
}

function adaptDefinition(def: JavaDefinitionResponse): monaco.languages.Location {
  return {
    uri: monaco.Uri.parse(def.uri),
    range: new monaco.Range(
      // LSP ranges are 0-based; Monaco ranges are 1-based.
      def.range.start.line + 1,
      def.range.start.character + 1,
      def.range.end.line + 1,
      def.range.end.character + 1,
    ),
  };
}

export function adaptLocation(location: LSPLocation): monaco.languages.Location {
  return {
    uri: monaco.Uri.parse(location.uri),
    range: adaptRange(location.range),
  };
}

export function adaptHover(hover: LSPHover | null): monaco.languages.Hover | null {
  if (!hover) return null;
  const raw = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  const contents = raw.map(content => {
    if (typeof content === 'string') return { value: content };
    if ('kind' in content) return { value: content.value };
    return { value: `\`\`\`${content.language}\n${content.value}\n\`\`\`` };
  });
  return {
    contents,
    range: hover.range ? adaptRange(hover.range) : undefined,
  };
}

export function adaptSignatureHelp(help: LSPSignatureHelp | null): monaco.languages.SignatureHelp | null {
  if (!help || help.signatures.length === 0) return null;
  return {
    signatures: help.signatures.map(signature => ({
      label: signature.label,
      documentation: adaptDocumentation(signature.documentation),
      activeParameter: signature.activeParameter,
      parameters: (signature.parameters ?? []).map(parameter => ({
        label: parameter.label,
        documentation: adaptDocumentation(parameter.documentation),
      })),
    })),
    activeSignature: help.activeSignature ?? 0,
    activeParameter: help.activeParameter ?? 0,
  };
}

export function adaptWorkspaceSymbols(result: LSPWorkspaceSymbolResult): KairoWorkspaceSymbolEntry[] {
  if (!result) return [];
  return result.map(symbol => ({
    name: symbol.name,
    containerName: symbol.containerName,
    kind: toMonacoSymbolKind(symbol.kind),
    range: adaptRange(symbol.location.range),
    uriString: symbol.location.uri,
  }));
}

export function adaptDocumentSymbols(result: LSPDocumentSymbolResult): monaco.languages.DocumentSymbol[] {
  if (!result) return [];
  return result.map(symbol => {
    if (isSymbolInformation(symbol)) {
      return {
        name: symbol.name,
        detail: symbol.containerName ?? '',
        kind: toMonacoSymbolKind(symbol.kind),
        tags: adaptSymbolTags(symbol.tags, symbol.deprecated),
        containerName: symbol.containerName,
        range: adaptRange(symbol.location.range),
        selectionRange: adaptRange(symbol.location.range),
      };
    }
    return adaptHierarchicalSymbol(symbol);
  });
}

export function adaptWorkspaceEdit(edit: LSPWorkspaceEdit | null): monaco.languages.WorkspaceEdit & monaco.languages.Rejection {
  if (!edit) return { edits: [], rejectReason: 'JDT LS did not return rename edits.' };
  const edits: Array<monaco.languages.IWorkspaceTextEdit | monaco.languages.IWorkspaceFileEdit> = [];
  for (const [uri, textEdits] of Object.entries(edit.changes ?? {})) {
    edits.push(...textEdits.map(textEdit => adaptTextEdit(uri, textEdit, undefined)));
  }
  for (const change of edit.documentChanges ?? []) {
    if ('kind' in change) {
      const fileEdit = adaptResourceOperation(change);
      if (fileEdit) {
        edits.push(fileEdit);
      } else {
        return { edits: [], rejectReason: `Rename requires unsupported file operation: ${change.kind}.` };
      }
      continue;
    }
    const version = change.textDocument.version ?? undefined;
    edits.push(...change.edits.map(textEdit => adaptTextEdit(change.textDocument.uri, textEdit, version)));
  }
  return { edits };
}

function adaptResourceOperation(
  op: { kind: string; uri?: string; oldUri?: string; newUri?: string },
): monaco.languages.IWorkspaceFileEdit | undefined {
  if (op.kind === 'create' && op.uri) {
    return {
      newResource: monaco.Uri.parse(op.uri),
      options: { overwrite: false, ignoreIfExists: true },
    };
  }
  if (op.kind === 'delete' && op.uri) {
    return {
      oldResource: monaco.Uri.parse(op.uri),
      options: { recursive: true, ignoreIfNotExists: true },
    };
  }
  if (op.kind === 'rename' && op.oldUri && op.newUri) {
    return {
      oldResource: monaco.Uri.parse(op.oldUri),
      newResource: monaco.Uri.parse(op.newUri),
      options: { overwrite: false, ignoreIfExists: false },
    };
  }
  return undefined;
}

function isEditableCodeAction(action: { command: string } | LSPCodeAction): action is LSPCodeAction & { edit: LSPWorkspaceEdit } {
  if (typeof action.command === 'string') return false;
  const candidate = action as LSPCodeAction;
  if (candidate.disabled) return false;
  if (candidate.edit) return true;
  // JDT LS quick fixes carry their workspace edit inside the
  // `java.apply.workspaceEdit` command arguments instead of an `edit`
  // field (BUG-20260826-404: these actions were dropped, so Alt+Enter /
  // the lightbulb offered nothing). Unwrap the embedded edit.
  if (candidate.command?.command === 'java.apply.workspaceEdit') {
    const arg = candidate.command.arguments?.[0];
    return !!arg && typeof arg === 'object';
  }
  return false;
}

/** Extract the workspace edit a code action applies, unwrapping
 *  JDT's command-embedded edits. */
function codeActionEdit(action: LSPCodeAction): LSPWorkspaceEdit | undefined {
  if (action.edit) return action.edit;
  if (action.command?.command === 'java.apply.workspaceEdit') {
    const arg = action.command.arguments?.[0];
    if (arg && typeof arg === 'object') return arg as LSPWorkspaceEdit;
  }
  return undefined;
}

function adaptCodeAction(action: LSPCodeAction): monaco.languages.CodeAction {
  const rawEdit = codeActionEdit(action);
  if (!rawEdit) {
    return { title: action.title, kind: action.kind };
  }
  const edit = adaptWorkspaceEdit(rawEdit);
  if (edit.rejectReason) {
    return { title: action.title, disabled: edit.rejectReason };
  }
  return {
    title: action.title,
    kind: action.kind,
    isPreferred: action.isPreferred,
    edit,
  };
}

function adaptMarkerToDiagnostic(marker: monaco.editor.IMarkerData): LSPDiagnostic {
  return {
    range: {
      start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
      end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
    },
    severity: marker.severity === monaco.MarkerSeverity.Error ? 1
      : marker.severity === monaco.MarkerSeverity.Warning ? 2
        : marker.severity === monaco.MarkerSeverity.Info ? 3 : 4,
    code: typeof marker.code === 'object' ? marker.code.value : marker.code,
    source: marker.source,
    message: marker.message,
  };
}

function adaptHierarchicalSymbol(symbol: LSPDocumentSymbol): monaco.languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: symbol.detail ?? '',
    kind: toMonacoSymbolKind(symbol.kind),
    tags: adaptSymbolTags(symbol.tags, symbol.deprecated),
    range: adaptRange(symbol.range),
    selectionRange: adaptRange(symbol.selectionRange),
    children: symbol.children?.map(adaptHierarchicalSymbol),
  };
}

function isSymbolInformation(symbol: LSPDocumentSymbol | LSPSymbolInformation): symbol is LSPSymbolInformation {
  return 'location' in symbol;
}

function adaptTextEdit(uri: string, edit: LSPTextEdit, versionId: number | undefined): monaco.languages.IWorkspaceTextEdit {
  return {
    resource: monaco.Uri.parse(uri),
    textEdit: { range: adaptRange(edit.range), text: edit.newText },
    versionId,
  };
}

function adaptDocumentation(doc: string | { kind: 'markdown' | 'plaintext'; value: string } | undefined): string | monaco.IMarkdownString | undefined {
  if (!doc) return undefined;
  return typeof doc === 'string' ? doc : { value: doc.value };
}

function adaptRange(range: { start: { line: number; character: number }; end: { line: number; character: number } }): monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function adaptSymbolTags(tags: number[] | undefined, deprecated: boolean | undefined): monaco.languages.SymbolTag[] {
  return tags?.includes(1) || deprecated ? [monaco.languages.SymbolTag.Deprecated] : [];
}

function toMonacoSymbolKind(kind: number): monaco.languages.SymbolKind {
  const zeroBased = kind - 1;
  return zeroBased >= monaco.languages.SymbolKind.File && zeroBased <= monaco.languages.SymbolKind.TypeParameter
    ? zeroBased as monaco.languages.SymbolKind
    : monaco.languages.SymbolKind.Object;
}

/**
 * Map LSP CompletionItemKind (1-based enum per LSP 3.17) to
 * monaco.languages.CompletionItemKind. Unknown kinds fall
 * back to Text.
 */
function toMonacoCompletionItemKind(kind: number | undefined): monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 1: return K.Text;
    case 2: return K.Method;
    case 3: return K.Function;
    case 4: return K.Constructor;
    case 5: return K.Field;
    case 6: return K.Variable;
    case 7: return K.Class;
    case 8: return K.Interface;
    case 9: return K.Module;
    case 10: return K.Property;
    case 11: return K.Unit;
    case 12: return K.Value;
    case 13: return K.Enum;
    case 14: return K.Keyword;
    case 15: return K.Snippet;
    case 16: return K.Color;
    case 17: return K.File;
    case 18: return K.Reference;
    case 19: return K.Folder;
    case 20: return K.EnumMember;
    case 21: return K.Constant;
    case 22: return K.Struct;
    case 23: return K.Event;
    case 24: return K.Operator;
    case 25: return K.TypeParameter;
    default: return K.Text;
  }
}

function adaptCodeLens(lens: LSPCodeLens): monaco.languages.CodeLens {
  return {
    range: adaptRange(lens.range),
    command: lens.command ? {
      id: lens.command.command,
      title: lens.command.title,
      arguments: lens.command.arguments,
    } : undefined,
  };
}

function adaptInlayHint(hint: LSPInlayHint): monaco.languages.InlayHint {
  return {
    position: { lineNumber: hint.position.line + 1, column: hint.position.character + 1 },
    label: typeof hint.label === 'string' ? hint.label : hint.label.map(part => {
      if (typeof part === 'string') return part;
      return { label: part.value };
    }),
    kind: hint.kind !== undefined
      ? hint.kind === 1 ? monaco.languages.InlayHintKind.Type : monaco.languages.InlayHintKind.Parameter
      : undefined,
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight,
    tooltip: hint.tooltip,
  };
}

function isLocationLink(loc: LSPLocation | LSPLocationLink): loc is LSPLocationLink {
  return 'targetUri' in loc;
}

function adaptLocationLink(link: LSPLocationLink): monaco.languages.LocationLink {
  return {
    uri: monaco.Uri.parse(link.targetUri),
    range: adaptRange(link.targetRange),
    originSelectionRange: link.originSelectionRange ? adaptRange(link.originSelectionRange) : undefined,
    targetSelectionRange: adaptRange(link.targetSelectionRange),
  };
}

function adaptDocumentHighlight(highlight: LSPDocumentHighlight): monaco.languages.DocumentHighlight {
  return {
    range: adaptRange(highlight.range),
    kind: highlight.kind !== undefined
      ? highlight.kind === 1
        ? monaco.languages.DocumentHighlightKind.Text
        : highlight.kind === 2
          ? monaco.languages.DocumentHighlightKind.Read
          : monaco.languages.DocumentHighlightKind.Write
      : monaco.languages.DocumentHighlightKind.Text,
  };
}
