/**
 * JSP scriptlet hover and definition providers.
 *
 * Completion is handled by registerJspScriptletJavaCompletion
 * (virtual CU + context snippets) — do not register a second
 * completion provider here or suggest widgets double/noise.
 */

import * as monaco from '@theia/monaco-editor-core';
import { JavaCompletionProvider } from '@kairo/java-extension';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser } from './jsp-java-nav';

function isInsideJavaBlock(content: string, offset: number): boolean {
  const blocks = new JspJavaParser().findJavaBlocks(content);
  return blocks.some(block => offset >= block.start && offset <= block.end);
}

/**
 * Register Monaco hover + definition for Java inside JSP scriptlets.
 */
export function registerJspScriptletProviders(
  javaProvider: JavaCompletionProvider,
): monaco.IDisposable {
  const parser = new JspJavaParser();

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
      hoverDisposable.dispose();
      definitionDisposable.dispose();
    },
  };
}
