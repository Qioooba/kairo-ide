/**
 * EL expression support — completion + hover.
 *
 * Parses JSP files for EL expressions (${...} and #{...}) and provides:
 *  - Code completion for EL implicit objects
 *  - Bean property completion based on common patterns
 *  - Hover information showing the inferred type of EL expressions
 *
 * Implicit EL objects (JSP 2.0 / 2.1 spec):
 *   pageContext, pageScope, requestScope, sessionScope, applicationScope,
 *   param, paramValues, header, headerValues, cookie, initParam
 *
 * JSP 2.1 Unified EL adds:
 *   - Method calls: ${bean.method()}
 *   - Deferred expressions: #{...}
 */

import * as monaco from '@theia/monaco-editor-core';
import { injectable } from '@theia/core/shared/inversify';
import { JSP_LANGUAGE_ID } from './jsp-monarch';

/** EL implicit object type mappings. */
export const EL_IMPLICIT_OBJECTS: Record<string, { type: string; description: string; properties?: Record<string, { type: string; description: string }> }> = {
  pageContext: {
    type: 'javax.servlet.jsp.PageContext',
    description: '当前页面的 PageContext 对象，提供对 JSP 隐式对象的访问。',
    properties: {
      request: { type: 'javax.servlet.http.HttpServletRequest', description: '获取 HttpServletRequest 对象。' },
      response: { type: 'javax.servlet.http.HttpServletResponse', description: '获取 HttpServletResponse 对象。' },
      session: { type: 'javax.servlet.http.HttpSession', description: '获取 HttpSession 对象。' },
      out: { type: 'javax.servlet.jsp.JspWriter', description: '获取 JspWriter 输出流。' },
      servletContext: { type: 'javax.servlet.ServletContext', description: '获取 ServletContext 对象。' },
      servletConfig: { type: 'javax.servlet.ServletConfig', description: '获取 ServletConfig 对象。' },
    },
  },
  pageScope: {
    type: 'java.util.Map',
    description: '页面作用域的属性集合。',
    properties: {
      size: { type: 'int', description: '返回 Map 中的条目数。' },
      isEmpty: { type: 'boolean', description: '如果 Map 为空返回 true。' },
    },
  },
  requestScope: {
    type: 'java.util.Map',
    description: '请求作用域的属性集合。',
    properties: {
      size: { type: 'int', description: '返回 Map 中的条目数。' },
      isEmpty: { type: 'boolean', description: '如果 Map 为空返回 true。' },
    },
  },
  sessionScope: {
    type: 'java.util.Map',
    description: '会话作用域的属性集合。',
    properties: {
      size: { type: 'int', description: '返回 Map 中的条目数。' },
      isEmpty: { type: 'boolean', description: '如果 Map 为空返回 true。' },
    },
  },
  applicationScope: {
    type: 'java.util.Map',
    description: '应用作用域的属性集合。',
    properties: {
      size: { type: 'int', description: '返回 Map 中的条目数。' },
      isEmpty: { type: 'boolean', description: '如果 Map 为空返回 true。' },
    },
  },
  param: {
    type: 'java.util.Map',
    description: '请求参数的集合，${param.name} 等价于 request.getParameter("name")。',
    properties: {
      size: { type: 'int', description: '返回参数个数。' },
    },
  },
  paramValues: {
    type: 'java.util.Map',
    description: '请求参数的多值集合，${paramValues.name[0]} 获取第一个值。',
    properties: {
      size: { type: 'int', description: '返回参数个数。' },
    },
  },
  header: {
    type: 'java.util.Map',
    description: 'HTTP 请求头的集合，${header["User-Agent"]} 获取请求头。',
    properties: {
      size: { type: 'int', description: '返回请求头个数。' },
    },
  },
  headerValues: {
    type: 'java.util.Map',
    description: 'HTTP 请求头的多值集合。',
    properties: {
      size: { type: 'int', description: '返回请求头个数。' },
    },
  },
  cookie: {
    type: 'java.util.Map',
    description: 'Cookie 的集合，${cookie.name.value} 获取 Cookie 值。',
    properties: {
      size: { type: 'int', description: '返回 Cookie 个数。' },
    },
  },
  initParam: {
    type: 'java.util.Map',
    description: '上下文初始化参数的集合，${initParam.name} 获取参数值。',
    properties: {
      size: { type: 'int', description: '返回参数个数。' },
    },
  },
};

/** Common bean property patterns for EL completion. */
const COMMON_BEAN_PROPERTIES: Record<string, { type: string; description: string }> = {
  id: { type: 'java.lang.String', description: '对象标识符。' },
  name: { type: 'java.lang.String', description: '对象名称。' },
  value: { type: 'java.lang.String', description: '对象值。' },
  description: { type: 'java.lang.String', description: '对象描述。' },
  title: { type: 'java.lang.String', description: '标题。' },
  size: { type: 'int', description: '集合大小。' },
  length: { type: 'int', description: '数组/字符串长度。' },
  empty: { type: 'boolean', description: '是否为空。' },
  class: { type: 'java.lang.Class', description: '对象的类。' },
  hash: { type: 'int', description: '哈希码。' },
  count: { type: 'int', description: '计数。' },
  status: { type: 'java.lang.String', description: '状态。' },
  message: { type: 'java.lang.String', description: '消息。' },
  code: { type: 'java.lang.String', description: '代码。' },
  type: { type: 'java.lang.String', description: '类型。' },
  date: { type: 'java.util.Date', description: '日期。' },
  time: { type: 'java.util.Date', description: '时间。' },
  url: { type: 'java.lang.String', description: 'URL 地址。' },
  email: { type: 'java.lang.String', description: '电子邮件地址。' },
  username: { type: 'java.lang.String', description: '用户名。' },
  password: { type: 'java.lang.String', description: '密码。' },
  enabled: { type: 'boolean', description: '是否启用。' },
  active: { type: 'boolean', description: '是否激活。' },
  created: { type: 'java.util.Date', description: '创建时间。' },
  updated: { type: 'java.util.Date', description: '更新时间。' },
  version: { type: 'java.lang.String', description: '版本号。' },
};

/** EL expression pattern: ${...} or #{...} */
const EL_EXPR_RE = /([$#])\{/g;

/** EL operator completions. */
const EL_OPERATORS: Array<{ label: string; insertText: string; detail: string }> = [
  { label: 'empty', insertText: 'empty ', detail: '检查集合是否为空或 null' },
  { label: 'not empty', insertText: 'not empty ', detail: '检查集合非空' },
  { label: 'eq', insertText: ' eq ', detail: '等于 (==)' },
  { label: 'ne', insertText: ' ne ', detail: '不等于 (!=)' },
  { label: 'lt', insertText: ' lt ', detail: '小于 (<)' },
  { label: 'gt', insertText: ' gt ', detail: '大于 (>)' },
  { label: 'le', insertText: ' le ', detail: '小于等于 (<=)' },
  { label: 'ge', insertText: ' ge ', detail: '大于等于 (>=)' },
  { label: 'and', insertText: ' and ', detail: '逻辑与' },
  { label: 'or', insertText: ' or ', detail: '逻辑或' },
  { label: 'not', insertText: ' not ', detail: '逻辑非' },
  { label: 'mod', insertText: ' mod ', detail: '取模' },
  { label: 'div', insertText: ' div ', detail: '除法' },
  { label: 'null', insertText: 'null', detail: 'null 值' },
  { label: 'true', insertText: 'true', detail: '布尔值 true' },
  { label: 'false', insertText: 'false', detail: '布尔值 false' },
];

/** Map a 0-based absolute content offset to 1-based line/column. */
function offsetToLineColumn(content: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const clamped = Math.max(0, Math.min(offset, content.length));
  for (let i = 0; i < clamped; i++) {
    if (content[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

/**
 * Find the EL expression that contains the given position.
 * Returns the expression range and content, or null if not in an EL expression.
 */
export function findElExpressionAt(
  content: string,
  line: number,
  column: number,
): { range: monaco.IRange; content: string; prefix: string; marker: string } | null {
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

      const startPos = offsetToLineColumn(content, match.start);
      const endPos = offsetToLineColumn(content, match.end);
      return {
        range: {
          startLineNumber: startPos.line,
          startColumn: startPos.column,
          endLineNumber: endPos.line,
          endColumn: endPos.column,
        },
        content: elContent,
        prefix: elContent.substring(0, Math.max(0, elOffset)),
        marker: match.marker,
      };
    }
  }
  return null;
}

/**
 * Parse the EL expression prefix to determine what kind of completion to provide.
 * Returns the root variable name and the remaining partial path.
 */
export function parseElPrefix(prefix: string): { root: string; path: string; lastPart: string } {
  const trimmed = prefix.trim();
  const firstDot = trimmed.indexOf('.');
  const firstBracket = trimmed.indexOf('[');

  if (firstDot === -1 && firstBracket === -1) {
    return { root: trimmed, path: '', lastPart: trimmed };
  }

  const root = trimmed.substring(0, firstDot >= 0 ? firstDot : firstBracket);

  // Get the last part after the last dot
  const lastDot = trimmed.lastIndexOf('.');
  const lastPart = lastDot >= 0 ? trimmed.substring(lastDot + 1) : '';

  return { root, path: trimmed.substring(root.length), lastPart };
}

/** Create a completion item with a word-range for replacement. */
function ci(
  range: monaco.IRange,
  partial: Partial<monaco.languages.CompletionItem> & {
    label: string;
    kind: monaco.languages.CompletionItemKind;
    insertText: string;
  },
): monaco.languages.CompletionItem {
  return {
    range,
    ...partial,
  } as monaco.languages.CompletionItem;
}

/**
 * EL expression completion provider.
 */
@injectable()
export class ElExpressionCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['$', '#', '.', ' '];

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
    const parsed = parseElPrefix(prefix);
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    const suggestions: monaco.languages.CompletionItem[] = [];

    // ── Phase 1: Root level — suggest implicit objects ─────────
    if (!parsed.path || parsed.path === '') {
      for (const [name, info] of Object.entries(EL_IMPLICIT_OBJECTS)) {
        if (parsed.root === '' || name.startsWith(parsed.root)) {
          suggestions.push(ci(range, {
            label: name,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: info.type,
            documentation: info.description,
            insertText: name,
            sortText: '0' + name,
          }));
        }
      }

      // Also suggest EL operators when at root level
      if (parsed.root === '') {
        for (const op of EL_OPERATORS) {
          suggestions.push(ci(range, {
            label: op.label,
            kind: monaco.languages.CompletionItemKind.Keyword,
            detail: op.detail,
            insertText: op.insertText,
            sortText: '1' + op.label,
          }));
        }
      }
    }

    // ── Phase 2: Property access — suggest bean properties ─────
    if (parsed.path) {
      const implicitInfo = EL_IMPLICIT_OBJECTS[parsed.root];

      if (implicitInfo?.properties) {
        // Known implicit object with known properties
        for (const [propName, propInfo] of Object.entries(implicitInfo.properties)) {
          if (parsed.lastPart === '' || propName.startsWith(parsed.lastPart)) {
            suggestions.push(ci(range, {
              label: propName,
              kind: monaco.languages.CompletionItemKind.Property,
              detail: propInfo.type,
              documentation: propInfo.description,
              insertText: propName,
              sortText: '0' + propName,
            }));
          }
        }
      }

      // Always suggest common bean properties as fallback
      for (const [propName, propInfo] of Object.entries(COMMON_BEAN_PROPERTIES)) {
        if (parsed.lastPart === '' || propName.startsWith(parsed.lastPart)) {
          // Avoid duplicates if already added from implicit object properties
          if (!suggestions.some(s => (typeof s.label === 'string' ? s.label : s.label.label) === propName)) {
            suggestions.push(ci(range, {
              label: propName,
              kind: monaco.languages.CompletionItemKind.Property,
              detail: propInfo.type,
              documentation: propInfo.description,
              insertText: propName,
              sortText: '1' + propName,
            }));
          }
        }
      }
    }

    // ── Phase 3: Method-style completion suggestions ───────────
    if (parsed.path && parsed.lastPart === '') {
      // Suggest common method invocations when after a dot
      const methodSnippets = [
        { label: 'toString()', insertText: 'toString()', detail: 'java.lang.String', desc: '转换为字符串。' },
        { label: 'equals()', insertText: 'equals(${1:obj})', detail: 'boolean', desc: '比较是否相等。' },
        { label: 'hashCode()', insertText: 'hashCode()', detail: 'int', desc: '获取哈希码。' },
        { label: 'getClass()', insertText: 'getClass()', detail: 'java.lang.Class', desc: '获取类对象。' },
      ];
      for (const ms of methodSnippets) {
        suggestions.push(ci(range, {
          label: ms.label,
          kind: monaco.languages.CompletionItemKind.Method,
          detail: ms.detail,
          documentation: ms.desc,
          insertText: ms.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: '2' + ms.label,
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
    const implicitInfo = EL_IMPLICIT_OBJECTS[label];
    if (implicitInfo && !item.documentation) {
      item.documentation = implicitInfo.description;
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
    const parsed = parseElPrefix(expr);

    const parts: string[] = [];

    // Check if it's an implicit object
    const implicitInfo = EL_IMPLICIT_OBJECTS[parsed.root];
    if (implicitInfo) {
      parts.push('**EL 表达式**');
      parts.push(`\`${expr}\``);
      parts.push('');
      parts.push(`**根对象**: \`${parsed.root}\``);
      parts.push(`**类型**: \`${implicitInfo.type}\``);
      parts.push(`**说明**: ${implicitInfo.description}`);

      // Show property info if accessing a known property
      if (parsed.path && implicitInfo.properties) {
        const propName = parsed.path.replace(/^\./, '').split('.')[0];
        const propInfo = implicitInfo.properties[propName];
        if (propInfo) {
          parts.push('');
          parts.push(`**属性 \`${propName}\`**: \`${propInfo.type}\``);
          parts.push(propInfo.description);
        }
      }

      return {
        contents: [{ value: parts.join('\n') }],
        range: elInfo.range,
      };
    }

    // Generic EL expression
    parts.push('**EL 表达式**');
    parts.push(`\`${expr}\``);
    if (elInfo.marker === '#') {
      parts.push('');
      parts.push('*延迟表达式 (Deferred Expression)* — 在 JSP 生命周期的适当阶段求值。');
    }

    return {
      contents: [{ value: parts.join('\n') }],
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