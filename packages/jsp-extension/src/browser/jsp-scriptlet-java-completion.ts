/**
 * JSP Scriptlet Java Completion — enhanced token-based completion
 * for Java code inside JSP scriptlet blocks.
 *
 * Detects whether the cursor is inside <% %>, <%= %>, or <%! %>
 * blocks and delegates to the JavaCompletionProvider from
 * @kairo/java-extension. Differentiates between scriptlet types
 * to provide context-aware completions.
 *
 * The detection is pure token-based (no DOM/SAX) using the
 * lightweight JspJavaParser, which is both fast and testable
 * without a browser environment.
 */

import * as monaco from '@theia/monaco-editor-core';
import { JavaCompletionProvider } from '@kairo/java-extension';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser, type JavaBlock } from './jsp-java-nav';

/** Scriptlet context type for context-aware completion. */
export type ScriptletContext = 'scriptlet' | 'expression' | 'declaration' | 'directive' | 'none';

/** Result of cursor position analysis inside a JSP file. */
export interface CursorContext {
  /** Whether the cursor is inside a Java block. */
  insideJavaBlock: boolean;
  /** The type of Java block, or 'none' if not inside one. */
  blockKind: ScriptletContext;
  /** The JavaBlock object if inside one, null otherwise. */
  block: JavaBlock | null;
  /** 0-based offset in the document. */
  offset: number;
}

/**
 * Analyze the cursor position in a JSP document to determine
 * whether it's inside a Java block and what type.
 *
 * Pure function — no I/O, testable without Monaco.
 */
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

/**
 * Extract the Java code content of the block around the cursor,
 * useful for context-aware snippet generation.
 */
export function extractBlockContent(
  content: string,
  block: JavaBlock,
): string {
  return content.slice(block.start, block.end);
}

/**
 * Build a context-appropriate Java snippet for the given scriptlet type.
 * This provides fallback completions when the Java language server is
 * not available.
 */
function buildContextCompletions(
  blockKind: ScriptletContext,
  prefix: string,
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  const items: monaco.languages.CompletionItem[] = [];

  switch (blockKind) {
    case 'declaration': {
      // <%! %> — class-level declarations
      const declSnippets: Array<{ label: string; insertText: string; detail: string }> = [
        { label: 'private String', insertText: 'private String ${1:name};', detail: '声明私有 String 字段' },
        { label: 'private int', insertText: 'private int ${1:value} = ${2:0};', detail: '声明私有 int 字段' },
        { label: 'public String', insertText: 'public String ${1:name};', detail: '声明公有 String 字段' },
        { label: 'public void method', insertText: 'public void ${1:methodName}() {\n    ${0}\n}', detail: '声明公有方法' },
        { label: 'private void method', insertText: 'private void ${1:methodName}() {\n    ${0}\n}', detail: '声明私有方法' },
      ];
      for (const s of declSnippets) {
        if (prefix === '' || s.label.startsWith(prefix)) {
          items.push({
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: s.detail,
            insertText: s.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: '0' + s.label,
          });
        }
      }
      break;
    }
    case 'expression': {
      // <%= %> — expressions
      const exprSnippets: Array<{ label: string; insertText: string; detail: string }> = [
        { label: 'request.getParameter', insertText: 'request.getParameter("${1:name}")', detail: '获取请求参数' },
        { label: 'session.getAttribute', insertText: 'session.getAttribute("${1:name}")', detail: '获取会话属性' },
        { label: 'application.getAttribute', insertText: 'application.getAttribute("${1:name}")', detail: '获取应用属性' },
        { label: 'pageContext.getAttribute', insertText: 'pageContext.getAttribute("${1:name}")', detail: '获取页面属性' },
      ];
      for (const s of exprSnippets) {
        if (prefix === '' || s.label.startsWith(prefix)) {
          items.push({
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: s.detail,
            insertText: s.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: '0' + s.label,
          });
        }
      }
      break;
    }
    case 'scriptlet': {
      // <% %> — scriptlets (full Java statements)
      const stmtSnippets: Array<{ label: string; insertText: string; detail: string }> = [
        { label: 'if', insertText: 'if (${1:condition}) {\n    ${0}\n}', detail: 'if 语句' },
        { label: 'for', insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:max}; ${1:i}++) {\n    ${0}\n}', detail: 'for 循环' },
        { label: 'while', insertText: 'while (${1:condition}) {\n    ${0}\n}', detail: 'while 循环' },
        { label: 'try', insertText: 'try {\n    ${1}\n} catch (${2:Exception} ${3:e}) {\n    ${0}\n}', detail: 'try-catch 块' },
        { label: 'out.print', insertText: 'out.print(${1:value});', detail: '输出到页面' },
        { label: 'out.println', insertText: 'out.println(${1:value});', detail: '输出到页面（带换行）' },
        { label: 'request.setAttribute', insertText: 'request.setAttribute("${1:name}", ${2:value});', detail: '设置请求属性' },
        { label: 'session.setAttribute', insertText: 'session.setAttribute("${1:name}", ${2:value});', detail: '设置会话属性' },
        { label: 'String var', insertText: 'String ${1:name} = ${2:value};', detail: '声明 String 变量' },
        { label: 'int var', insertText: 'int ${1:name} = ${2:0};', detail: '声明 int 变量' },
        { label: 'List', insertText: 'java.util.List<${1:String}> ${2:list} = new java.util.ArrayList<>();', detail: '声明 List 变量' },
      ];
      for (const s of stmtSnippets) {
        if (prefix === '' || s.label.startsWith(prefix)) {
          items.push({
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: s.detail,
            insertText: s.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: '0' + s.label,
          });
        }
      }
      break;
    }
  }

  return items;
}

/**
 * Register a completion provider for Java code inside JSP scriptlet
 * blocks. Uses token-based detection via JspJavaParser and delegates
 * to JavaCompletionProvider for real Java intelligence.
 *
 * Also provides context-aware snippet completions based on whether
 * the cursor is in a declaration, expression, or scriptlet block.
 *
 * @param javaProvider The JavaCompletionProvider instance (injected via DI).
 * @returns A disposable that unregisters the completion provider.
 */
export function registerJspScriptletJavaCompletion(
  javaProvider: JavaCompletionProvider,
): monaco.IDisposable {
  const parser = new JspJavaParser();

  return monaco.languages.registerCompletionItemProvider(
    JSP_LANGUAGE_ID,
    {
      triggerCharacters: ['.', '@', '#', '*', ' ', '('],
      provideCompletionItems: async (model, position, context, token) => {
        const content = model.getValue();
        const ctx = analyzeCursorContext(
          content,
          position.lineNumber - 1,
          position.column - 1,
        );

        if (!ctx.insideJavaBlock) {
          return { suggestions: [] };
        }

        // Get the word prefix for filtering
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        const prefix = word.word;

        const suggestions: monaco.languages.CompletionItem[] = [];

        // Always provide context-aware snippet completions as fallback
        const contextCompletions = buildContextCompletions(ctx.blockKind, prefix, range);
        suggestions.push(...contextCompletions);

        // If the Java language server is available, also try to get Java completions
        if (!token.isCancellationRequested) {
          try {
            const response = await javaProvider.provideCompletions({
              uri: model.uri.toString(),
              line: position.lineNumber - 1,
              character: position.column - 1,
              triggerKind: (context.triggerKind + 1) as 1 | 2 | 3,
              triggerCharacter: context.triggerCharacter,
            });

            if (!token.isCancellationRequested && response.items.length > 0) {
              const javaItems = response.items.map(item => ({
                label: item.label,
                kind: (item.kind ?? 0) as monaco.languages.CompletionItemKind,
                detail: item.detail,
                documentation: item.documentation,
                sortText: item.sortText,
                filterText: item.filterText,
                insertText: item.insertText ?? item.label,
                range,
              }));
              // Prepend Java completions (they take priority over snippets)
              suggestions.unshift(...javaItems);
            }
          } catch {
            // Java provider not available — just use snippets
          }
        }

        return {
          suggestions,
          incomplete: true,
        };
      },
    },
  );
}