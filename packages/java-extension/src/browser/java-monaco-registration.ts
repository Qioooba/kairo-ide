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
import { injectable, inject } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';
import { JAVA_LANGUAGE_ID } from '../common/java-common';
import { JavaCompletionProvider, JavaCompletionResponseItem, JavaDefinitionResponse } from './java-completion-provider';

@injectable()
export class JavaMonacoRegistrationContribution implements FrontendApplicationContribution, Disposable {
  @inject(JavaCompletionProvider)
  protected readonly provider!: JavaCompletionProvider;

  protected subs: Disposable[] = [];

  onStart(): void {
    this.subs.push(
      monaco.languages.registerCompletionItemProvider(JAVA_LANGUAGE_ID, {
        triggerCharacters: ['.', '@', '#', '*', ' '],
        provideCompletionItems: async (model, position, context) => {
          const response = await this.provider.provideCompletions({
            uri: model.uri.toString(),
            // Monaco positions are 1-based; the provider speaks
            // 0-based LSP positions.
            line: position.lineNumber - 1,
            character: position.column - 1,
            triggerKind: context.triggerKind + 1 as 1 | 2 | 3,
            triggerCharacter: context.triggerCharacter,
          });
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
        provideDefinition: async (model, position) => {
          const definitions = await this.provider.provideDefinition(
            model.uri.toString(),
            position.lineNumber - 1,
            position.column - 1,
          );
          return definitions.map(adaptDefinition);
        },
      }),
    );
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
