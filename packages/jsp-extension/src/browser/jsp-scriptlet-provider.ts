/**
 * JSP scriptlet Java code completion, hover, and definition providers.
 *
 * Detects whether the cursor is inside a <% %>, <%= %>, or <%! %>
 * Java block and delegates to the JavaCompletionProvider from
 * @kairo/java-extension for language intelligence.
 */

import * as monaco from '@theia/monaco-editor-core';
import { JavaCompletionProvider } from '@kairo/java-extension';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser } from './jsp-java-nav';

/**
 * Check whether the given offset is inside a Java code block
 * (<% %>, <%= %>, or <%! %>).
 */
function isInsideJavaBlock(content: string, offset: number): boolean {
  const blocks = new JspJavaParser().findJavaBlocks(content);
  return blocks.some(block => offset >= block.start && offset <= block.end);
}

/**
 * Register Monaco completion, hover, and definition providers for
 * Java code inside JSP scriptlet blocks.
 *
 * @param javaProvider The JavaCompletionProvider instance (injected via DI).
 * @returns A disposable that unregisters all three providers.
 */
export function registerJspScriptletProviders(
  javaProvider: JavaCompletionProvider,
): monaco.IDisposable {
  const parser = new JspJavaParser();

  // ── Completion provider ──────────────────────────────────────
  const completionDisposable = monaco.languages.registerCompletionItemProvider(
    JSP_LANGUAGE_ID,
    {
      triggerCharacters: ['.', '@', '#', '*', ' '],
      provideCompletionItems: async (model, position, context, token) => {
        const content = model.getValue();
        const offset = parser.positionToOffset(
          content,
          position.lineNumber - 1,
          position.column - 1,
        );

        if (!isInsideJavaBlock(content, offset)) {
          return { suggestions: [] };
        }

        if (token.isCancellationRequested) return { suggestions: [] };

        const response = await javaProvider.provideCompletions({
          uri: model.uri.toString(),
          line: position.lineNumber - 1,
          character: position.column - 1,
          triggerKind: (context.triggerKind + 1) as 1 | 2 | 3,
          triggerCharacter: context.triggerCharacter,
        });

        if (token.isCancellationRequested) return { suggestions: [] };

        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );

        return {
          suggestions: response.items.map(item => ({
            label: item.label,
            kind: (item.kind ?? 0) as monaco.languages.CompletionItemKind,
            detail: item.detail,
            documentation: item.documentation,
            sortText: item.sortText,
            filterText: item.filterText,
            insertText: item.insertText ?? item.label,
            range,
          })),
          incomplete: response.isIncomplete,
        };
      },
    },
  );

  // ── Hover provider ───────────────────────────────────────────
  const hoverDisposable = monaco.languages.registerHoverProvider(
    JSP_LANGUAGE_ID,
    {
      provideHover: async (model, position, token) => {
        const content = model.getValue();
        const offset = parser.positionToOffset(
          content,
          position.lineNumber - 1,
          position.column - 1,
        );

        if (!isInsideJavaBlock(content, offset)) {
          return null;
        }

        if (token.isCancellationRequested) return null;

        const result = await javaProvider.provideHover(
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1,
        );

        if (token.isCancellationRequested || !result) return null;

        const raw = Array.isArray(result.contents)
          ? result.contents
          : [result.contents];
        const contents = raw.map(content => {
          if (typeof content === 'string') return { value: content };
          if ('kind' in content) return { value: content.value };
          return { value: `\`\`\`${content.language}\n${content.value}\n\`\`\`` };
        });

        return {
          contents,
          range: result.range
            ? new monaco.Range(
                result.range.start.line + 1,
                result.range.start.character + 1,
                result.range.end.line + 1,
                result.range.end.character + 1,
              )
            : undefined,
        };
      },
    },
  );

  // ── Definition provider ──────────────────────────────────────
  const definitionDisposable = monaco.languages.registerDefinitionProvider(
    JSP_LANGUAGE_ID,
    {
      provideDefinition: async (model, position, token) => {
        const content = model.getValue();
        const offset = parser.positionToOffset(
          content,
          position.lineNumber - 1,
          position.column - 1,
        );

        if (!isInsideJavaBlock(content, offset)) {
          return [];
        }

        if (token.isCancellationRequested) return [];

        const definitions = await javaProvider.provideDefinition(
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1,
        );

        if (token.isCancellationRequested) return [];

        return definitions.map(def => ({
          uri: monaco.Uri.parse(def.uri),
          range: new monaco.Range(
            def.range.start.line + 1,
            def.range.start.character + 1,
            def.range.end.line + 1,
            def.range.end.character + 1,
          ),
        }));
      },
    },
  );

  return {
    dispose(): void {
      completionDisposable.dispose();
      hoverDisposable.dispose();
      definitionDisposable.dispose();
    },
  };
}