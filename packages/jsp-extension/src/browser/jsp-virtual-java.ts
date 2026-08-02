/**
 * Shared virtual Java CU helpers for JSP scriptlets.
 * Used by diagnostics and completion so both talk to JDT LS
 * through the same wrapper (with JSP implicit objects).
 */

export const JSP_VIRTUAL_URI_PREFIX = 'jsp-scriptlet:';

/** Lines before user content in method-body wrappers. */
export const JSP_VIRTUAL_METHOD_WRAPPER_LINES = 11;
/** Lines before user content in class-body (declaration) wrappers. */
export const JSP_VIRTUAL_CLASS_WRAPPER_LINES = 10;

export type JspVirtualKind = 'scriptlet' | 'expression' | 'declaration';

export function virtualUriForBlock(jspUri: string, blockIndex: number): string {
  return `${JSP_VIRTUAL_URI_PREFIX}//${jspUri}#block${blockIndex}`;
}

export function parseVirtualUri(virtualUri: string): { jspUri: string; blockIndex: number } | null {
  if (!virtualUri.startsWith(JSP_VIRTUAL_URI_PREFIX + '//')) {
    return null;
  }
  const rest = virtualUri.slice(JSP_VIRTUAL_URI_PREFIX.length + 2);
  const hashIdx = rest.lastIndexOf('#block');
  if (hashIdx < 0) {
    return null;
  }
  const jspUri = rest.slice(0, hashIdx);
  const blockIndex = Number.parseInt(rest.slice(hashIdx + '#block'.length), 10);
  if (!Number.isFinite(blockIndex)) {
    return null;
  }
  return { jspUri, blockIndex };
}

const IMPLICIT_FIELDS = [
  'javax.servlet.http.HttpServletRequest request;',
  'javax.servlet.http.HttpServletResponse response;',
  'javax.servlet.jsp.JspWriter out;',
  'javax.servlet.http.HttpSession session;',
  'javax.servlet.ServletContext application;',
  'javax.servlet.jsp.PageContext pageContext;',
  'javax.servlet.ServletConfig config;',
  'java.lang.Object page;',
  'java.lang.Throwable exception;',
].join('\n    ');

/**
 * Build a virtual Java compilation unit wrapping scriptlet content
 * so JDT LS can offer completions for implicits + user code.
 */
export function buildVirtualJavaFile(blockContent: string, kind: JspVirtualKind = 'scriptlet'): string {
  if (kind === 'declaration') {
    return [
      'class _JspVirtual {',
      `    ${IMPLICIT_FIELDS}`,
      blockContent,
      '}',
    ].join('\n');
  }
  // scriptlet + expression: put code inside a method body
  const body = kind === 'expression'
    ? `Object __expr = ${blockContent.trim().replace(/;?\s*$/, '')};`
    : blockContent;
  return [
    'class _JspVirtual {',
    `    ${IMPLICIT_FIELDS}`,
    '    void _m() throws Exception {',
    body,
    '    }',
    '}',
  ].join('\n');
}

export function virtualWrapperLineCount(kind: JspVirtualKind): number {
  return kind === 'declaration' ? JSP_VIRTUAL_CLASS_WRAPPER_LINES : JSP_VIRTUAL_METHOD_WRAPPER_LINES;
}

/**
 * Map a 0-based offset inside the JSP block content to a 0-based
 * line/character inside the virtual Java file.
 */
export function mapOffsetToVirtualPosition(
  blockContent: string,
  offsetInBlock: number,
  kind: JspVirtualKind = 'scriptlet',
): { line: number; character: number } {
  const wrapperLines = virtualWrapperLineCount(kind);
  const safe = Math.max(0, Math.min(offsetInBlock, blockContent.length));
  const before = blockContent.slice(0, safe);
  const parts = before.split('\n');
  const lineInBlock = parts.length - 1;
  const character = parts[parts.length - 1]?.length ?? 0;
  if (kind === 'expression') {
    // Expression is rewritten as `Object __expr = <content>;` on one wrapper line.
    const prefix = 'Object __expr = ';
    return { line: wrapperLines, character: prefix.length + character };
  }
  return { line: wrapperLines + lineInBlock, character };
}
