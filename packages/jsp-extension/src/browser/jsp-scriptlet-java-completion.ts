/**
 * JSP Scriptlet Java Completion — virtual CU + context snippets.
 *
 * Detects <% %>, <%= %>, <%! %> contexts, wraps the block in a
 * virtual Java file (with JSP implicits), asks JavaCompletionProvider,
 * and merges IDEA-like scriptlet snippets.
 */

import * as monaco from '@theia/monaco-editor-core';
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
      push('private String', 'private String ${1:name};', '声明私有 String 字段');
      push('public void method', 'public void ${1:methodName}() {\n    ${0}\n}', '声明公有方法');
      break;
    case 'expression':
      push('request.getParameter', 'request.getParameter("${1:name}")', '获取请求参数');
      push('session.getAttribute', 'session.getAttribute("${1:name}")', '获取会话属性');
      push('out', 'out', 'JspWriter');
      break;
    case 'scriptlet':
      push('out.println', 'out.println(${1:value});', '输出到页面');
      push('request.setAttribute', 'request.setAttribute("${1:name}", ${2:value});', '设置请求属性');
      push('if', 'if (${1:condition}) {\n    ${0}\n}', 'if 语句');
      push('for', 'for (int ${1:i} = 0; ${1:i} < ${2:max}; ${1:i}++) {\n    ${0}\n}', 'for 循环');
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
): monaco.IDisposable {
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
          const blockIndex = blocks.indexOf(ctx.block);
          const blockContent = content.slice(ctx.block.start, ctx.block.end);
          const offsetInBlock = Math.max(0, ctx.offset - ctx.block.start);
          const virtualKind = toVirtualKind(ctx.blockKind);
          const virtualText = buildVirtualJavaFile(blockContent, virtualKind);
          const virtualUri = virtualUriForBlock(model.uri.toString(), blockIndex >= 0 ? blockIndex : 0);
          const virtualPos = mapOffsetToVirtualPosition(blockContent, offsetInBlock, virtualKind);

          if (javaClient) {
            try {
              javaClient.didOpen({
                uri: virtualUri,
                languageId: 'java',
                version: virtualVersion++,
                text: virtualText,
              });
            } catch {
              // ignore — completion may still work via fallback
            }
          }

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
        } catch {
          // snippets only
        }

        return { suggestions, incomplete: false };
      },
    },
  );
}
