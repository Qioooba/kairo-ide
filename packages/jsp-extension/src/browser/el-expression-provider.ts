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
import type { I18nService } from '@kairo/i18n';
import { injectable } from '@theia/core/shared/inversify';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { setJspI18n, t } from './i18n-context';

interface ElImplicitObjectInfo {
  type: string;
  description: string;
  properties?: Record<string, { type: string; description: string }>;
}

/** EL implicit object type mappings. Built on demand so descriptions follow the current language. */
export function buildElImplicitObjects(): Record<string, ElImplicitObjectInfo> {
  const mapSizeDesc = t('completion.el.member.mapSize.description');
  const isEmptyDesc = t('completion.el.member.isEmpty.description');
  return {
    pageContext: {
      type: 'javax.servlet.jsp.PageContext',
      description: t('completion.el.implicit.pageContext.description'),
      properties: {
        request: { type: 'javax.servlet.http.HttpServletRequest', description: t('completion.el.implicit.pageContext.member.request.description') },
        response: { type: 'javax.servlet.http.HttpServletResponse', description: t('completion.el.implicit.pageContext.member.response.description') },
        session: { type: 'javax.servlet.http.HttpSession', description: t('completion.el.implicit.pageContext.member.session.description') },
        out: { type: 'javax.servlet.jsp.JspWriter', description: t('completion.el.implicit.pageContext.member.out.description') },
        servletContext: { type: 'javax.servlet.ServletContext', description: t('completion.el.implicit.pageContext.member.servletContext.description') },
        servletConfig: { type: 'javax.servlet.ServletConfig', description: t('completion.el.implicit.pageContext.member.servletConfig.description') },
      },
    },
    pageScope: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.pageScope.description'),
      properties: {
        size: { type: 'int', description: mapSizeDesc },
        isEmpty: { type: 'boolean', description: isEmptyDesc },
      },
    },
    requestScope: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.requestScope.description'),
      properties: {
        size: { type: 'int', description: mapSizeDesc },
        isEmpty: { type: 'boolean', description: isEmptyDesc },
      },
    },
    sessionScope: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.sessionScope.description'),
      properties: {
        size: { type: 'int', description: mapSizeDesc },
        isEmpty: { type: 'boolean', description: isEmptyDesc },
      },
    },
    applicationScope: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.applicationScope.description'),
      properties: {
        size: { type: 'int', description: mapSizeDesc },
        isEmpty: { type: 'boolean', description: isEmptyDesc },
      },
    },
    param: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.param.description'),
      properties: {
        size: { type: 'int', description: t('completion.el.member.paramCount.description') },
      },
    },
    paramValues: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.paramValues.description'),
      properties: {
        size: { type: 'int', description: t('completion.el.member.paramCount.description') },
      },
    },
    header: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.header.description'),
      properties: {
        size: { type: 'int', description: t('completion.el.member.headerCount.description') },
      },
    },
    headerValues: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.headerValues.description'),
      properties: {
        size: { type: 'int', description: t('completion.el.member.headerCount.description') },
      },
    },
    cookie: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.cookie.description'),
      properties: {
        size: { type: 'int', description: t('completion.el.member.cookieCount.description') },
      },
    },
    initParam: {
      type: 'java.util.Map',
      description: t('completion.el.implicit.initParam.description'),
      properties: {
        size: { type: 'int', description: t('completion.el.member.paramCount.description') },
      },
    },
  };
}

/** Common bean property patterns for EL completion. Built on demand. */
function buildCommonBeanProperties(): Record<string, { type: string; description: string }> {
  return {
    id: { type: 'java.lang.String', description: t('completion.el.bean.id.description') },
    name: { type: 'java.lang.String', description: t('completion.el.bean.name.description') },
    value: { type: 'java.lang.String', description: t('completion.el.bean.value.description') },
    description: { type: 'java.lang.String', description: t('completion.el.bean.description.description') },
    title: { type: 'java.lang.String', description: t('completion.el.bean.title.description') },
    size: { type: 'int', description: t('completion.el.bean.size.description') },
    length: { type: 'int', description: t('completion.el.bean.length.description') },
    empty: { type: 'boolean', description: t('completion.el.bean.empty.description') },
    class: { type: 'java.lang.Class', description: t('completion.el.bean.class.description') },
    hash: { type: 'int', description: t('completion.el.bean.hash.description') },
    count: { type: 'int', description: t('completion.el.bean.count.description') },
    status: { type: 'java.lang.String', description: t('completion.el.bean.status.description') },
    message: { type: 'java.lang.String', description: t('completion.el.bean.message.description') },
    code: { type: 'java.lang.String', description: t('completion.el.bean.code.description') },
    type: { type: 'java.lang.String', description: t('completion.el.bean.type.description') },
    date: { type: 'java.util.Date', description: t('completion.el.bean.date.description') },
    time: { type: 'java.util.Date', description: t('completion.el.bean.time.description') },
    url: { type: 'java.lang.String', description: t('completion.el.bean.url.description') },
    email: { type: 'java.lang.String', description: t('completion.el.bean.email.description') },
    username: { type: 'java.lang.String', description: t('completion.el.bean.username.description') },
    password: { type: 'java.lang.String', description: t('completion.el.bean.password.description') },
    enabled: { type: 'boolean', description: t('completion.el.bean.enabled.description') },
    active: { type: 'boolean', description: t('completion.el.bean.active.description') },
    created: { type: 'java.util.Date', description: t('completion.el.bean.created.description') },
    updated: { type: 'java.util.Date', description: t('completion.el.bean.updated.description') },
    version: { type: 'java.lang.String', description: t('completion.el.bean.version.description') },
  };
}

/** EL expression pattern: ${...} or #{...} */
const EL_EXPR_RE = /([$#])\{/g;

/** EL operator completions. Built on demand so details follow the current language. */
const buildElOperators = (): Array<{ label: string; insertText: string; detail: string }> => [
  { label: 'empty', insertText: 'empty ', detail: t('completion.el.operator.empty') },
  { label: 'not empty', insertText: 'not empty ', detail: t('completion.el.operator.notEmpty') },
  { label: 'eq', insertText: ' eq ', detail: t('completion.el.operator.eq') },
  { label: 'ne', insertText: ' ne ', detail: t('completion.el.operator.ne') },
  { label: 'lt', insertText: ' lt ', detail: t('completion.el.operator.lt') },
  { label: 'gt', insertText: ' gt ', detail: t('completion.el.operator.gt') },
  { label: 'le', insertText: ' le ', detail: t('completion.el.operator.le') },
  { label: 'ge', insertText: ' ge ', detail: t('completion.el.operator.ge') },
  { label: 'and', insertText: ' and ', detail: t('completion.el.operator.and') },
  { label: 'or', insertText: ' or ', detail: t('completion.el.operator.or') },
  { label: 'not', insertText: ' not ', detail: t('completion.el.operator.not') },
  { label: 'mod', insertText: ' mod ', detail: t('completion.el.operator.mod') },
  { label: 'div', insertText: ' div ', detail: t('completion.el.operator.div') },
  { label: 'null', insertText: 'null', detail: t('completion.el.operator.null') },
  { label: 'true', insertText: 'true', detail: t('completion.el.operator.true') },
  { label: 'false', insertText: 'false', detail: t('completion.el.operator.false') },
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
      for (const [name, info] of Object.entries(buildElImplicitObjects())) {
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
        for (const op of buildElOperators()) {
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
      const implicitInfo = buildElImplicitObjects()[parsed.root];

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
      for (const [propName, propInfo] of Object.entries(buildCommonBeanProperties())) {
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
        { label: 'toString()', insertText: 'toString()', detail: 'java.lang.String', desc: t('completion.el.method.toString.description') },
        { label: 'equals()', insertText: 'equals(${1:obj})', detail: 'boolean', desc: t('completion.el.method.equals.description') },
        { label: 'hashCode()', insertText: 'hashCode()', detail: 'int', desc: t('completion.el.method.hashCode.description') },
        { label: 'getClass()', insertText: 'getClass()', detail: 'java.lang.Class', desc: t('completion.el.method.getClass.description') },
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
    const implicitInfo = buildElImplicitObjects()[label];
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
    const implicitInfo = buildElImplicitObjects()[parsed.root];
    if (implicitInfo) {
      parts.push(t('completion.el.hover.title'));
      parts.push(`\`${expr}\``);
      parts.push('');
      parts.push(t('completion.el.hover.rootObject', { root: parsed.root }));
      parts.push(t('completion.el.hover.type', { type: implicitInfo.type }));
      parts.push(t('completion.el.hover.description', { description: implicitInfo.description }));

      // Show property info if accessing a known property
      if (parsed.path && implicitInfo.properties) {
        const propName = parsed.path.replace(/^\./, '').split('.')[0];
        const propInfo = implicitInfo.properties[propName];
        if (propInfo) {
          parts.push('');
          parts.push(t('completion.el.hover.property', { name: propName, type: propInfo.type }));
          parts.push(propInfo.description);
        }
      }

      return {
        contents: [{ value: parts.join('\n') }],
        range: elInfo.range,
      };
    }

    // Generic EL expression
    parts.push(t('completion.el.hover.title'));
    parts.push(`\`${expr}\``);
    if (elInfo.marker === '#') {
      parts.push('');
      parts.push(t('completion.el.hover.deferred'));
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
export function registerElExpressionProviders(i18n?: I18nService): monaco.IDisposable {
  setJspI18n(i18n);
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