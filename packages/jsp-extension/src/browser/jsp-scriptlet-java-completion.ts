/**
 * JSP Scriptlet Java Completion — virtual CU + context snippets.
 *
 * Detects <% %>, <%= %>, <%! %> contexts, wraps the block in a
 * virtual Java file (with JSP implicits), asks JavaCompletionProvider,
 * and merges IDEA-like scriptlet snippets.
 */

import * as monaco from '@theia/monaco-editor-core';
import type { I18nService } from '@kairo/i18n';
import { JavaCompletionProvider, adaptCompletionItem, globalRecentCompletions } from '@kairo/java-extension';
import type { JavaLanguageClient } from '@kairo/java-extension';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser, type JavaBlock } from './jsp-java-nav';
import {
  buildVirtualJavaFile,
  mapOffsetToVirtualPosition,
  virtualUriForBlock,
  type JspVirtualKind,
} from './jsp-virtual-java';
import { setJspI18n, t } from './i18n-context';

export type ScriptletContext = 'scriptlet' | 'expression' | 'declaration' | 'directive' | 'none';

export interface CursorContext {
  insideJavaBlock: boolean;
  blockKind: ScriptletContext;
  block: JavaBlock | null;
  offset: number;
}

export function analyzeCursorContext(
  content: string,
  line: number,
  column: number,
): CursorContext {
  const parser = new JspJavaParser();
  const offset = parser.positionToOffset(content, line, column);
  const blocks = parser.findJavaBlocks(content);
  const block = parser.findBlockAt(blocks, offset);

  if (!block) {
    return { insideJavaBlock: false, blockKind: 'none', block: null, offset };
  }

  return { insideJavaBlock: true, blockKind: block.kind, block, offset };
}

function toVirtualKind(kind: ScriptletContext): JspVirtualKind {
  if (kind === 'declaration') return 'declaration';
  if (kind === 'expression') return 'expression';
  return 'scriptlet';
}

function buildContextCompletions(
  blockKind: ScriptletContext,
  prefix: string,
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  const items: monaco.languages.CompletionItem[] = [];
  const push = (label: string, insertText: string, detail: string) => {
    if (prefix === '' || label.toLowerCase().startsWith(prefix.toLowerCase())) {
      items.push({
        label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail,
        insertText,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: '1' + label,
      });
    }
  };

  switch (blockKind) {
    case 'declaration':
      push('private String', 'private String ${1:name};', t('completion.scriptlet.declarePrivateString'));
      push('public void method', 'public void ${1:methodName}() {\n    ${0}\n}', t('completion.scriptlet.declarePublicMethod'));
      break;
    case 'expression':
      push('request.getParameter', 'request.getParameter("${1:name}")', t('completion.scriptlet.requestGetParameter'));
      push('session.getAttribute', 'session.getAttribute("${1:name}")', t('completion.scriptlet.sessionGetAttribute'));
      push('out', 'out', t('completion.scriptlet.outWriter'));
      break;
    case 'scriptlet':
      push('out.println', 'out.println(${1:value});', t('completion.scriptlet.outPrintln'));
      push('request.setAttribute', 'request.setAttribute("${1:name}", ${2:value});', t('completion.scriptlet.requestSetAttribute'));
      push('if', 'if (${1:condition}) {\n    ${0}\n}', t('completion.scriptlet.ifStatement'));
      push('for', 'for (int ${1:i} = 0; ${1:i} < ${2:max}; ${1:i}++) {\n    ${0}\n}', t('completion.scriptlet.forLoop'));
      break;
  }
  return items;
}

/**
 * Register scriptlet Java completion. Prefer virtual CU via JDT when ready.
 */
export function registerJspScriptletJavaCompletion(
  javaProvider: JavaCompletionProvider,
  javaClient?: JavaLanguageClient,
  i18n?: I18nService,
): monaco.IDisposable {
  setJspI18n(i18n);
  const parser = new JspJavaParser();
  let virtualVersion = 1;

  return monaco.languages.registerCompletionItemProvider(
    JSP_LANGUAGE_ID,
    {
      triggerCharacters: ['.', '@', '#', '*', '('],
      provideCompletionItems: async (model, position, context, token) => {
        const content = model.getValue();
        const ctx = analyzeCursorContext(
          content,
          position.lineNumber - 1,
          position.column - 1,
        );

        if (!ctx.insideJavaBlock || !ctx.block) {
          return { suggestions: [] };
        }

        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        const prefix = word.word;
        const suggestions: monaco.languages.CompletionItem[] = [
          ...buildContextCompletions(ctx.blockKind, prefix, range),
        ];

        if (token.isCancellationRequested) {
          return { suggestions };
        }

        try {
          const blocks = parser.findJavaBlocks(content);
          // Match by offsets/kind — block objects are not identity-equal across parses.
          const blockIndex = blocks.findIndex(
            b => b.start === ctx.block!.start && b.end === ctx.block!.end && b.kind === ctx.block!.kind,
          );
          const blockContent = content.slice(ctx.block.start, ctx.block.end);
          const offsetInBlock = Math.max(0, ctx.offset - ctx.block.start);
          const virtualKind = toVirtualKind(ctx.blockKind);
          const virtualText = buildVirtualJavaFile(blockContent, virtualKind);
          const virtualUri = virtualUriForBlock(model.uri.toString(), blockIndex >= 0 ? blockIndex : 0);
          const virtualPos = mapOffsetToVirtualPosition(blockContent, offsetInBlock, virtualKind);

          let openedVirtual = false;
          if (javaClient) {
            try {
              javaClient.didOpen({
                uri: virtualUri,
                languageId: 'java',
                version: virtualVersion++,
                text: virtualText,
              });
              openedVirtual = true;
            } catch {
              // ignore — completion may still work via fallback
            }
          }

          try {
            javaProvider.cacheSource(virtualUri, virtualText);

            const response = await javaProvider.provideCompletions({
              uri: virtualUri,
              line: virtualPos.line,
              character: virtualPos.character,
              triggerKind: (context.triggerKind + 1) as 1 | 2 | 3,
              triggerCharacter: context.triggerCharacter,
            });

            if (!token.isCancellationRequested && response.items.length > 0) {
              const javaItems = response.items.map(item => {
                const rank = globalRecentCompletions.rank(item.label);
                // Strip virtual-file textEdit ranges — apply as simple insert at cursor word.
                const adapted = adaptCompletionItem(
                  {
                    ...item,
                    sortText: globalRecentCompletions.boostSortText(item.label, item.sortText),
                    preselect: item.preselect === true || rank === 0,
                    textEdit: undefined,
                    insertRange: undefined,
                    replaceRange: undefined,
                    // Keep additionalTextEdits only if they target the same virtual doc — drop them for JSP.
                    additionalTextEdits: undefined,
                  },
                  range,
                );
                adapted.sortText = '0' + (adapted.sortText ?? adapted.label.toString());
                return adapted;
              });
              suggestions.unshift(...javaItems);
            }
          } finally {
            // Ephemeral completion docs must be closed (diagnostics re-opens its own).
            if (openedVirtual && javaClient) {
              try {
                javaClient.didClose(virtualUri);
              } catch {
                // ignore
              }
            }
          }
        } catch {
          // snippets only
        }

        return { suggestions, incomplete: false };
      },
    },
  );
}
