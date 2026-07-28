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
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { CommandService } from '@theia/core/lib/common/command';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { JAVA_LANGUAGE_ID } from '../common/java-common';
import { JAVA_MONARCH } from './java-monarch';
import { JavaLanguageClient } from './java-language-client';
import { JdtClassFileFsProvider } from './jdt-fs-provider';
import { JavaCompletionProvider, JavaCompletionResponseItem, JavaDefinitionResponse } from './java-completion-provider';
import { registerJavaLiveTemplates } from './java-live-templates';
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
  LSPCodeAction,
  LSPDiagnostic,
  LSPCodeLens,
  LSPInlayHint,
  LSPRange,
  LSPDocumentHighlight,
} from '../common/lsp-protocol';

@injectable()
export class JavaMonacoRegistrationContribution implements FrontendApplicationContribution, Disposable {
  @inject(JavaCompletionProvider)
  protected readonly provider!: JavaCompletionProvider;
  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;
  @inject(JdtClassFileFsProvider)
  protected readonly jdtFs!: JdtClassFileFsProvider;
  @inject(FileService)
  protected readonly fileService!: FileService;
  @inject(JavaRunService) @optional()
  protected readonly javaRunService?: JavaRunService;
  @inject(CommandService) @optional()
  protected readonly commandService?: CommandService;
  @inject(WorkspaceService) @optional()
  protected readonly workspaceService?: WorkspaceService;

  protected subs: Disposable[] = [];

  onStart(): void {
    console.log('[KAIRO-JAVA-DEBUG] JavaMonacoRegistrationContribution.onStart() called!');
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
    this.subs.push(monaco.editor.onDidCreateModel(model => {
      this.provider.cacheSource(model.uri.toString(), model.getValue());
      this.subs.push(model.onDidChangeContent(() => {
        this.provider.cacheSource(model.uri.toString(), model.getValue());
      }));
    }));
    this.subs.push(
      monaco.editor.onWillDisposeModel(model => {
        this.provider.clearSource(model.uri.toString());
      }),
    );

    this.subs.push(registerJavaLiveTemplates(JAVA_LANGUAGE_ID));
    this.subs.push(
      monaco.languages.registerCompletionItemProvider(JAVA_LANGUAGE_ID, {
        triggerCharacters: ['.', '@', '#', '*', ' '],
        provideCompletionItems: async (model, position, context, token) => {
          if (token.isCancellationRequested) return { suggestions: [] };
          const response = await this.provider.provideCompletions({
            uri: model.uri.toString(),
            // Monaco positions are 1-based; the provider speaks
            // 0-based LSP positions.
            line: position.lineNumber - 1,
            character: position.column - 1,
            triggerKind: context.triggerKind + 1 as 1 | 2 | 3,
            triggerCharacter: context.triggerCharacter,
          });
          if (token.isCancellationRequested) return { suggestions: [] };
          console.info(`[kairo-java] monaco provideCompletionItems lang=${model.getLanguageId()} items=${response.items.length}`);
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          );
          return {
            suggestions: response.items.map(item => adaptCompletionItem(item, range)),
            incomplete: response.isIncomplete,
          };
        },
      }),
      monaco.languages.registerDefinitionProvider(JAVA_LANGUAGE_ID, {
        provideDefinition: async (model, position, token) => {
          if (token.isCancellationRequested) return [];
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
          const result = await this.provider.provideImplementation(
            model.uri.toString(), position.lineNumber - 1, position.column - 1,
          );
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

  protected ensureJavaQuickSuggestions(): void {
    const applyJavaOptions = (editor: monaco.editor.ICodeEditor): void => {
      const model = editor.getModel();
      if (!model) return;
      const langId = model.getLanguageId();
      if (langId !== JAVA_LANGUAGE_ID) return;
      console.log('[KAIRO-JAVA-DEBUG] Applying Java editor options for quick suggestions');
      editor.updateOptions({
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },
        suggestOnTriggerCharacters: true,
        quickSuggestionsDelay: 10,
        suggest: {
          localityBonus: true,
          snippetsPreventQuickSuggestions: false,
          showWords: false,
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

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this.subs = [];
  }
}

function adaptCompletionItem(
  item: JavaCompletionResponseItem,
  range: monaco.Range,
): monaco.languages.CompletionItem {
  return {
    label: item.label,
    kind: toMonacoCompletionItemKind(item.kind),
    detail: item.detail,
    documentation: item.documentation,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText: item.insertText ?? item.label,
    range,
  };
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
  const edits: monaco.languages.IWorkspaceTextEdit[] = [];
  for (const [uri, textEdits] of Object.entries(edit.changes ?? {})) {
    edits.push(...textEdits.map(textEdit => adaptTextEdit(uri, textEdit, undefined)));
  }
  for (const change of edit.documentChanges ?? []) {
    if ('kind' in change) {
      return { edits: [], rejectReason: `Rename requires unsupported file operation: ${change.kind}.` };
    }
    const version = change.textDocument.version ?? undefined;
    edits.push(...change.edits.map(textEdit => adaptTextEdit(change.textDocument.uri, textEdit, version)));
  }
  return { edits };
}

function isEditableCodeAction(action: { command: string } | LSPCodeAction): action is LSPCodeAction & { edit: LSPWorkspaceEdit } {
  if (typeof action.command === 'string') return false;
  const candidate = action as LSPCodeAction;
  // Reject actions that only execute a command (no edit to apply).
  if (candidate.command) return false;
  return !!candidate.edit && !candidate.disabled;
}

function adaptCodeAction(action: LSPCodeAction & { edit: LSPWorkspaceEdit }): monaco.languages.CodeAction {
  const edit = adaptWorkspaceEdit(action.edit);
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
