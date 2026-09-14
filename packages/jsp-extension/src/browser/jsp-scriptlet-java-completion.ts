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
import { JspPageModelBuilder, convertAdditionalTextEditsToJsp } from './jsp-page-model';
import { defaultVirtualDocumentManager } from './virtual-document-manager';
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
  if (javaClient) {
    defaultVirtualDocumentManager.setClient(javaClient);
  }
  const parser = new JspJavaParser();

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

          // Build whole-page virtual Java (F16 / T40 ~ T43)
          let virtualUri: string;
          let virtualText: string;
          let virtualLine: number;
          let virtualChar: number;

          const pageBuilder = new JspPageModelBuilder();
          const pageResult = await pageBuilder.buildPageVirtualJava(model.uri.toString(), content);
          const mappedVirtual = pageResult.sourceMap.mapJspPositionToVirtual(
            model.uri.toString(),
            position.lineNumber - 1,
            position.column - 1,
          );

          if (mappedVirtual) {
            virtualUri = pageResult.virtualUri;
            virtualText = pageResult.virtualJava;
            virtualLine = mappedVirtual.line;
            virtualChar = mappedVirtual.character;
          } else {
            // Fallback to single block model if position didn't map
            const blockIndex = blocks.findIndex(
              b => b.start === ctx.block!.start && b.end === ctx.block!.end && b.kind === ctx.block!.kind,
            );
            virtualText = buildVirtualJavaFile(blockContent, virtualKind);
            virtualUri = virtualUriForBlock(model.uri.toString(), blockIndex >= 0 ? blockIndex : 0);
            const pos = mapOffsetToVirtualPosition(blockContent, offsetInBlock, virtualKind);
            virtualLine = pos.line;
            virtualChar = pos.character;
          }

          // Acquire unified lease from VirtualDocumentManager (F17 / T38)
          const lease = await defaultVirtualDocumentManager.acquireLease(
            virtualUri,
            virtualText,
            'java',
            model.uri.toString(),
          );

          try {
            javaProvider.cacheSource(virtualUri, virtualText);

            const response = await javaProvider.provideCompletions({
              uri: virtualUri,
              line: virtualLine,
              character: virtualChar,
              triggerKind: (context.triggerKind + 1) as 1 | 2 | 3,
              triggerCharacter: context.triggerCharacter,
            });

            // T39: Discard stale response if lease is no longer current (e.g. document closed while in-flight)
            if (!token.isCancellationRequested && lease.isCurrent() && response.items.length > 0) {
              const javaItems = response.items.map(item => {
                const rank = globalRecentCompletions.rank(item.label);
                // T43: Convert additionalTextEdits for imports into safe JSP page import directives
                const jspEdits = convertAdditionalTextEditsToJsp(content, item.additionalTextEdits).map(e => ({
                  range: new monaco.Range(e.range.startLineNumber, e.range.startColumn, e.range.endLineNumber, e.range.endColumn),
                  text: e.newText,
                }));

                const adapted = adaptCompletionItem(
                  {
                    ...item,
                    sortText: globalRecentCompletions.boostSortText(item.label, item.sortText),
                    preselect: item.preselect === true || rank === 0,
                    textEdit: undefined,
                    insertRange: undefined,
                    replaceRange: undefined,
                    additionalTextEdits: undefined,
                  },
                  range,
                );
                adapted.sortText = '0' + (adapted.sortText ?? adapted.label.toString());
                if (jspEdits.length > 0) {
                  adapted.additionalTextEdits = jspEdits;
                }
                return adapted;
              });
              suggestions.unshift(...javaItems);
            }
          } finally {
            // Disposing the lease decrements activeLeases but does NOT close the shared document.
            lease.dispose();
          }
        } catch {
          // snippets only
        }

        return { suggestions, incomplete: false };
      },
    },
  );
}
