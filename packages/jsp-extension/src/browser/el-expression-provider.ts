/**
 * EL expression support — completion + hover.
 *
 * Parses JSP files for EL expressions (${...} and #{...}) and provides:
 *  - Code completion for EL implicit objects
 *  - Hover information showing the inferred type of EL expressions
 *
 * Implicit EL objects (JSP 2.0 spec):
 *   pageContext, pageScope, requestScope, sessionScope, applicationScope,
 *   param, paramValues, header, headerValues, cookie, initParam
 */

import * as monaco from '@theia/monaco-editor-core';
import { injectable } from '@theia/core/shared/inversify';
import { JSP_LANGUAGE_ID } from './jsp-monarch';

/** EL implicit object type mappings. */
const EL_IMPLICIT_OBJECTS: Record<string, { type: string; description: string }> = {
  pageContext: {
    type: 'javax.servlet.jsp.PageContext',
    description: '当前页面的 PageContext 对象，提供对 JSP 隐式对象的访问。',
  },
  pageScope: {
    type: 'java.util.Map',
    description: '页面作用域的属性集合。',
  },
  requestScope: {
    type: 'java.util.Map',
    description: '请求作用域的属性集合。',
  },
  sessionScope: {
    type: 'java.util.Map',
    description: '会话作用域的属性集合。',
  },
  applicationScope: {
    type: 'java.util.Map',
    description: '应用作用域的属性集合。',
  },
  param: {
    type: 'java.util.Map',
    description: '请求参数的集合，${param.name} 等价于 request.getParameter("name")。',
  },
  paramValues: {
    type: 'java.util.Map',
    description: '请求参数的多值集合，${paramValues.name[0]} 获取第一个值。',
  },
  header: {
    type: 'java.util.Map',
    description: 'HTTP 请求头的集合，${header["User-Agent"]} 获取请求头。',
  },
  headerValues: {
    type: 'java.util.Map',
    description: 'HTTP 请求头的多值集合。',
  },
  cookie: {
    type: 'java.util.Map',
    description: 'Cookie 的集合，${cookie.name.value} 获取 Cookie 值。',
  },
  initParam: {
    type: 'java.util.Map',
    description: '上下文初始化参数的集合，${initParam.name} 获取参数值。',
  },
};

/** EL expression pattern: ${...} or #{...} */
const EL_EXPR_RE = /([$#])\{/g;

/**
 * Find the EL expression that contains the given position.
 * Returns the expression range and content, or null if not in an EL expression.
 */
function findElExpressionAt(
  content: string,
  line: number,
  column: number,
): { range: monaco.IRange; content: string; prefix: string } | null {
  let offset = 0;
  const lines = content.split('\n');
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  offset += column;

  // Search backwards for the start of the EL expression
  EL_EXPR_RE.lastIndex = 0;
  const matches: Array<{ start: number; end: number; marker: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = EL_EXPR_RE.exec(content)) !== null) {
    const start = m.index + 2; // after ${ or #{
    const marker = m[1];
    // Find closing brace
    let depth = 1;
    let pos = start;
    while (pos < content.length && depth > 0) {
      if (content[pos] === '{') depth++;
      else if (content[pos] === '}') depth--;
      pos++;
    }
    if (depth === 0) {
      matches.push({ start: m.index, end: pos, marker });
    }
  }

  for (const match of matches) {
    if (offset >= match.start && offset <= match.end) {
      const elContent = content.substring(match.start + 2, match.end - 1); // strip ${ and }
      const elOffset = offset - match.start - 2;
      const _lineContent = lines[line];
      const lineStart = match.start - (offset - column);
      const lineEnd = match.end - (offset - column);

      return {
        range: {
          startLineNumber: line + 1,
          startColumn: (lineStart >= 0 ? lineStart : 0) + 1,
          endLineNumber: line + 1,
          endColumn: (lineEnd >= 0 ? lineEnd : 0) + 1,
        },
        content: elContent,
        prefix: elContent.substring(0, elOffset),
      };
    }
  }
  return null;
}

/** Create a completion item with a default range placeholder. */
function ci(partial: Partial<monaco.languages.CompletionItem> & {
  label: string;
  kind: monaco.languages.CompletionItemKind;
  insertText: string;
}): monaco.languages.CompletionItem {
  return {
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
    ...partial,
  } as monaco.languages.CompletionItem;
}

/**
 * EL expression completion provider.
 */
@injectable()
export class ElExpressionCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['$', '#'];

  provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.CompletionContext,
    _token: monaco.CancellationToken,
  ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
    const content = model.getValue();
    const elInfo = findElExpressionAt(content, position.lineNumber - 1, position.column - 1);
    if (!elInfo) return { suggestions: [] };

    const prefix = elInfo.prefix.trim();
    const suggestions: monaco.languages.CompletionItem[] = [];

    // If prefix is empty or doesn't contain a dot, suggest implicit objects
    if (!prefix.includes('.')) {
      for (const [name, info] of Object.entries(EL_IMPLICIT_OBJECTS)) {
        if (name.startsWith(prefix) || prefix === '') {
          suggestions.push(ci({
            label: name,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: info.type,
            documentation: info.description,
            insertText: name,
            sortText: '0' + name,
          }));
        }
      }
    }

    // If prefix contains a dot, we could suggest bean properties
    if (prefix.includes('.')) {
      const parts = prefix.split('.');
      const lastPart = parts[parts.length - 1];
      if (lastPart === '') {
        suggestions.push(ci({
          label: 'value',
          kind: monaco.languages.CompletionItemKind.Property,
          detail: 'java.lang.String',
          documentation: '获取属性值。',
          insertText: 'value',
        }));
        suggestions.push(ci({
          label: 'values',
          kind: monaco.languages.CompletionItemKind.Property,
          detail: 'java.lang.String[]',
          documentation: '获取多个属性值。',
          insertText: 'values',
        }));
      }
    }

    return { suggestions };
  }

  /**
   * Resolve additional details for a completion item (e.g. documentation).
   */
  resolveCompletionItem(
    item: monaco.languages.CompletionItem,
    _token: monaco.CancellationToken,
  ): monaco.languages.ProviderResult<monaco.languages.CompletionItem> {
    const label = typeof item.label === 'string' ? item.label : item.label.label;
    const info = EL_IMPLICIT_OBJECTS[label];
    if (info && !item.documentation) {
      item.documentation = info.description;
    }
    return item;
  }
}

/**
 * EL expression hover provider.
 */
@injectable()
export class ElExpressionHoverProvider implements monaco.languages.HoverProvider {
  provideHover(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _token: monaco.CancellationToken,
  ): monaco.languages.ProviderResult<monaco.languages.Hover> {
    const content = model.getValue();
    const elInfo = findElExpressionAt(content, position.lineNumber - 1, position.column - 1);
    if (!elInfo) return null;

    const expr = elInfo.content.trim();

    // Check if it's an implicit object
    const firstDot = expr.indexOf('.');
    const rootVar = firstDot >= 0 ? expr.substring(0, firstDot) : expr;

    const implicitInfo = EL_IMPLICIT_OBJECTS[rootVar];
    if (implicitInfo) {
      const parts = ['**EL 表达式**'];
      parts.push(`\`${expr}\``);
      parts.push('');
      parts.push(`**类型**: \`${implicitInfo.type}\``);
      parts.push(`**说明**: ${implicitInfo.description}`);
      return {
        contents: [{ value: parts.join('\n') }],
        range: elInfo.range,
      };
    }

    // Generic EL expression
    return {
      contents: [{
        value: `**EL 表达式**\n\n\`${expr}\``,
      }],
      range: elInfo.range,
    };
  }
}

/**
 * Register EL completion and hover providers with Monaco.
 */
export function registerElExpressionProviders(): monaco.IDisposable {
  const completionDisposable = monaco.languages.registerCompletionItemProvider(
    JSP_LANGUAGE_ID,
    new ElExpressionCompletionProvider(),
  );
  const hoverDisposable = monaco.languages.registerHoverProvider(
    JSP_LANGUAGE_ID,
    new ElExpressionHoverProvider(),
  );

  return {
    dispose(): void {
      completionDisposable.dispose();
      hoverDisposable.dispose();
    },
  };
}