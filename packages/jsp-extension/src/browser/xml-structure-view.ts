/**
 * XML/JSP Structure View — Document symbol provider.
 *
 * Provides a document outline (structure view) for:
 *  - XML files: element hierarchy as a tree
 *  - web.xml: servlets, mappings, filters, listeners as top-level items
 *  - TLD files: tags with their attributes
 *  - JSP files: directives, scriptlets, declarations, custom tags
 *
 * Clicking an item in the outline navigates to the corresponding
 * location in the editor.
 */

import * as monaco from '@theia/monaco-editor-core';
import { injectable } from '@theia/core/shared/inversify';
import { JSP_LANGUAGE_ID } from './jsp-monarch';

/** Symbol kind mapping for web.xml elements. */
const WEBXML_SYMBOL_KINDS: Record<string, monaco.languages.SymbolKind> = {
  'web-app': monaco.languages.SymbolKind.Module,
  'servlet': monaco.languages.SymbolKind.Class,
  'servlet-mapping': monaco.languages.SymbolKind.Interface,
  'filter': monaco.languages.SymbolKind.Class,
  'filter-mapping': monaco.languages.SymbolKind.Interface,
  'listener': monaco.languages.SymbolKind.Class,
  'welcome-file-list': monaco.languages.SymbolKind.Array,
  'error-page': monaco.languages.SymbolKind.Event,
  'context-param': monaco.languages.SymbolKind.Property,
  'session-config': monaco.languages.SymbolKind.Struct,
  'mime-mapping': monaco.languages.SymbolKind.Property,
};

/** XML tag pattern for extracting element names. */
const XML_TAG_RE = /<(\/?)([a-zA-Z_][\w.:-]*)(\s[^>]*)?\/?>/g;

/** JSP directive pattern. */
const JSP_DIRECTIVE_RE = /<%@\s*(page|include|taglib|tag|attribute|variable)\b[^%]*%>/gi;

/** JSP scriptlet/declaration/expression pattern. */
const JSP_BLOCK_RE = /<%\s*([!=@]?)\s*/g;

/** JSP custom tag pattern. */
const JSP_CUSTOM_TAG_RE = /<([a-zA-Z_][\w]*:[a-zA-Z_][\w]*)(\s[^>]*)?\/?>/g;

/** JSTL tag pattern. */
const JSTL_TAG_RE = /<(c:if|c:forEach|c:choose|c:when|c:otherwise|c:set|c:out|c:url|c:param|c:import|c:redirect)(\s[^>]*)?\/?>/g;

/**
 * Check if URI corresponds to a web.xml file.
 */
function isWebXml(uri: string): boolean {
  return /WEB-INF[/\\]web\.xml$/i.test(uri);
}

/**
 * Check if URI corresponds to a TLD file.
 */
function isTldFile(uri: string): boolean {
  return /\.tld$/i.test(uri);
}

/**
 * Check if URI corresponds to a JSP file.
 */
function isJspFile(uri: string): boolean {
  return /\.(jsp|jspx|tag|tagx)$/i.test(uri);
}

/**
 * Create a DocumentSymbol with required fields.
 */
function sym(opts: {
  name: string;
  detail?: string;
  kind: monaco.languages.SymbolKind;
  range: monaco.IRange;
  selectionRange: monaco.IRange;
  children?: monaco.languages.DocumentSymbol[];
}): monaco.languages.DocumentSymbol {
  return {
    name: opts.name,
    detail: opts.detail ?? opts.name,
    kind: opts.kind,
    tags: [],
    range: opts.range,
    selectionRange: opts.selectionRange,
    children: opts.children ?? [],
  };
}

/**
 * Extract document symbols for XML files (including web.xml and TLD).
 */
function getXmlSymbols(
  model: monaco.editor.ITextModel,
  _token: monaco.CancellationToken,
): monaco.languages.DocumentSymbol[] {
  const content = model.getValue();
  const webXml = isWebXml(model.uri.path);
  const tld = isTldFile(model.uri.path);

  // Build a tree from XML tags
  const stack: Array<{
    name: string;
    tagStart: number;
    tagEnd: number;
    range: monaco.IRange;
    selectionRange: monaco.IRange;
    children: monaco.languages.DocumentSymbol[];
  }> = [];
  const topLevel: monaco.languages.DocumentSymbol[] = [];

  XML_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = XML_TAG_RE.exec(content)) !== null) {
    const isClosing = m[1] === '/';
    const tagName = m[2];
    const fullMatch = m[0];
    const isSelfClosing = fullMatch.endsWith('/>') && !isClosing;

    if (isClosing) {
      // Pop stack until we find matching tag
      const closed = stack.pop();
      if (closed) {
        const symbol = sym({
          name: closed.name,
          detail: webXml ? getWebXmlSymbolDetail(closed.name, content, closed.tagStart) : undefined,
          kind: webXml
            ? (WEBXML_SYMBOL_KINDS[closed.name] ?? monaco.languages.SymbolKind.Object)
            : (tld ? getTldSymbolKind(closed.name) : monaco.languages.SymbolKind.Object),
          range: closed.range,
          selectionRange: closed.selectionRange,
          children: closed.children,
        });

        const parent = stack.length > 0 ? stack[stack.length - 1] : null;
        if (parent) {
          parent.children.push(symbol);
        } else {
          topLevel.push(symbol);
        }
      }
      continue;
    }

    if (isSelfClosing) continue;

    const line = content.substring(0, m.index).split('\n').length;
    const col = m.index - content.lastIndexOf('\n', m.index);

    stack.push({
      name: tagName,
      tagStart: m.index,
      tagEnd: m.index + fullMatch.length,
      range: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + fullMatch.length,
      },
      selectionRange: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + fullMatch.length,
      },
      children: [],
    });
  }

  return topLevel;
}

/**
 * Get a meaningful detail string for a web.xml element.
 */
function getWebXmlSymbolDetail(tagName: string, content: string, matchIndex: number): string {
  const detailTags: Record<string, string> = {
    'servlet': 'servlet-name',
    'servlet-mapping': 'servlet-name',
    'filter': 'filter-name',
    'filter-mapping': 'filter-name',
    'listener': 'listener-class',
    'error-page': 'error-code',
    'context-param': 'param-name',
    'welcome-file-list': 'welcome-file',
    'mime-mapping': 'extension',
  };

  const detailTag = detailTags[tagName];
  if (!detailTag) return tagName;

  const closeTag = `</${tagName}>`;
  const closeIdx = content.indexOf(closeTag, matchIndex);
  if (closeIdx === -1) return tagName;

  const elementContent = content.substring(matchIndex, closeIdx);
  const detailRe = new RegExp(`<${detailTag}>([^<]*)</${detailTag}>`, 'i');
  const detailMatch = detailRe.exec(elementContent);
  return detailMatch ? detailMatch[1].trim() : tagName;
}

/**
 * Get symbol kind for TLD elements.
 */
function getTldSymbolKind(tagName: string): monaco.languages.SymbolKind {
  switch (tagName) {
    case 'taglib': return monaco.languages.SymbolKind.Module;
    case 'tag': return monaco.languages.SymbolKind.Class;
    case 'attribute': return monaco.languages.SymbolKind.Property;
    case 'name': return monaco.languages.SymbolKind.String;
    case 'tag-class': return monaco.languages.SymbolKind.Class;
    case 'body-content': return monaco.languages.SymbolKind.Enum;
    default: return monaco.languages.SymbolKind.Object;
  }
}

/**
 * Extract document symbols for JSP files.
 */
function getJspSymbols(
  model: monaco.editor.ITextModel,
  _token: monaco.CancellationToken,
): monaco.languages.DocumentSymbol[] {
  const content = model.getValue();
  const symbols: monaco.languages.DocumentSymbol[] = [];

  // JSP directives
  JSP_DIRECTIVE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSP_DIRECTIVE_RE.exec(content)) !== null) {
    const directiveType = m[1];
    const line = content.substring(0, m.index).split('\n').length;
    const col = m.index - content.lastIndexOf('\n', m.index);
    const fullMatch = m[0];

    symbols.push(sym({
      name: `<%@ ${directiveType} %>`,
      detail: `JSP ${directiveType} 指令`,
      kind: monaco.languages.SymbolKind.Key,
      range: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + fullMatch.length,
      },
      selectionRange: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + fullMatch.length,
      },
    }));
  }

  // JSP scriptlets, expressions, declarations
  JSP_BLOCK_RE.lastIndex = 0;
  while ((m = JSP_BLOCK_RE.exec(content)) !== null) {
    const marker = m[1] || '';
    const tagEnd = m.index + m[0].length;
    const closeIdx = content.indexOf('%>', tagEnd);
    if (closeIdx === -1) continue;

    const line = content.substring(0, m.index).split('\n').length;
    const col = m.index - content.lastIndexOf('\n', m.index);

    let name: string;
    let kind: monaco.languages.SymbolKind;
    if (marker === '!') {
      name = '<%! Declaration %>';
      kind = monaco.languages.SymbolKind.Field;
    } else if (marker === '=') {
      name = '<%= Expression %>';
      kind = monaco.languages.SymbolKind.Operator;
    } else {
      name = '<% Scriptlet %>';
      kind = monaco.languages.SymbolKind.Function;
    }

    symbols.push(sym({
      name,
      kind,
      range: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: content.substring(0, closeIdx + 2).split('\n').length,
        endColumn: closeIdx + 2 - content.lastIndexOf('\n', closeIdx + 1),
      },
      selectionRange: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + m[0].length,
      },
    }));
  }

  // JSTL tags
  JSTL_TAG_RE.lastIndex = 0;
  while ((m = JSTL_TAG_RE.exec(content)) !== null) {
    const tagName = m[1];
    const line = content.substring(0, m.index).split('\n').length;
    const col = m.index - content.lastIndexOf('\n', m.index);

    symbols.push(sym({
      name: `<${tagName}>`,
      detail: 'JSTL 标签',
      kind: monaco.languages.SymbolKind.Class,
      range: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + m[0].length,
      },
      selectionRange: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + m[0].length,
      },
    }));
  }

  // Custom taglib tags
  JSP_CUSTOM_TAG_RE.lastIndex = 0;
  while ((m = JSP_CUSTOM_TAG_RE.exec(content)) !== null) {
    const tagName = m[1];
    const fullMatch = m[0];
    const line = content.substring(0, m.index).split('\n').length;
    const col = m.index - content.lastIndexOf('\n', m.index);

    symbols.push(sym({
      name: `<${tagName}>`,
      detail: '自定义标签',
      kind: monaco.languages.SymbolKind.Class,
      range: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + fullMatch.length,
      },
      selectionRange: {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + fullMatch.length,
      },
    }));
  }

  return symbols;
}

/**
 * Document symbol provider for XML, TLD, and JSP files.
 */
@injectable()
export class XmlStructureViewProvider implements monaco.languages.DocumentSymbolProvider {
  provideDocumentSymbols(
    model: monaco.editor.ITextModel,
    token: monaco.CancellationToken,
  ): monaco.languages.ProviderResult<monaco.languages.DocumentSymbol[]> {
    if (token.isCancellationRequested) return [];

    if (isJspFile(model.uri.path)) {
      return getJspSymbols(model, token);
    }

    return getXmlSymbols(model, token);
  }
}

/**
 * Register the XML/JSP document symbol provider with Monaco.
 * Registered for both 'xml' and 'jsp' languages.
 * Also pushed into the Kairo-owned symbol registry so Quick Outline
 * (Ctrl+F12) can enumerate it — Monaco 1.108 has no public provider list.
 */
export function registerXmlStructureView(): monaco.IDisposable {
  const provider = new XmlStructureViewProvider();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const langs = monaco.languages as any;
  if (!langs.__kairoDocumentSymbolProviders) {
    langs.__kairoDocumentSymbolProviders = [];
  }
  langs.__kairoDocumentSymbolProviders.push({
    provideDocumentSymbols: (model: unknown, token: unknown) =>
      provider.provideDocumentSymbols(
        model as monaco.editor.ITextModel,
        token as monaco.CancellationToken,
      ),
  });

  const xmlDisposable = monaco.languages.registerDocumentSymbolProvider(
    'xml',
    provider,
  );
  const jspDisposable = monaco.languages.registerDocumentSymbolProvider(
    JSP_LANGUAGE_ID,
    provider,
  );

  return {
    dispose(): void {
      xmlDisposable.dispose();
      jspDisposable.dispose();
    },
  };
}