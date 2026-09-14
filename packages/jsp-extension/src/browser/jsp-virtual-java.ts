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

/** Prefix prepended to expression bodies inside the virtual method. */
export const JSP_EXPRESSION_PREFIX = 'Object __expr = ';

export type JspVirtualKind = 'scriptlet' | 'expression' | 'declaration';

export function virtualUriForBlock(jspUri: string, blockIndex: number): string {
  return `${JSP_VIRTUAL_URI_PREFIX}//${jspUri}#block${blockIndex}`;
}

export function virtualUriForPage(jspUri: string): string {
  return `${JSP_VIRTUAL_URI_PREFIX}//${jspUri}#page`;
}

export function parseVirtualUri(virtualUri: string): { jspUri: string; blockIndex?: number; isPage?: boolean } | null {
  if (!virtualUri.startsWith(JSP_VIRTUAL_URI_PREFIX + '//')) {
    return null;
  }
  const rest = virtualUri.slice(JSP_VIRTUAL_URI_PREFIX.length + 2);
  if (rest.endsWith('#page')) {
    const jspUri = rest.slice(0, -('#page'.length));
    return { jspUri, isPage: true };
  }
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
 *
 * Expression bodies keep their original whitespace/newlines so
 * offset→position mapping stays aligned with the JSP source.
 * Only a trailing semicolon (and trailing whitespace) is stripped
 * before we append our own terminating `;`.
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
    ? `${JSP_EXPRESSION_PREFIX}${blockContent.replace(/;?\s*$/, '')};`
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
    // Expression is rewritten as `Object __expr = <content>;` —
    // prefix only applies on the first content line; later lines
    // keep their original column (multi-line expressions).
    if (lineInBlock === 0) {
      return { line: wrapperLines, character: JSP_EXPRESSION_PREFIX.length + character };
    }
    return { line: wrapperLines + lineInBlock, character };
  }
  return { line: wrapperLines + lineInBlock, character };
}

/**
 * Map a 0-based line/character inside the virtual Java file back to
 * an offset relative to the start of the JSP block content.
 * Returns null when the position falls outside user content
 * (wrapper lines / trailing braces).
 */
export function mapVirtualPositionToBlockOffset(
  blockContent: string,
  virtualLine: number,
  virtualCharacter: number,
  kind: JspVirtualKind = 'scriptlet',
): { lineInBlock: number; characterInBlock: number } | null {
  const wrapperLines = virtualWrapperLineCount(kind);
  const lineInBlock = virtualLine - wrapperLines;
  if (lineInBlock < 0) {
    return null;
  }
  const lines = blockContent.split('\n');
  if (lineInBlock >= lines.length) {
    return null;
  }
  let characterInBlock = virtualCharacter;
  if (kind === 'expression' && lineInBlock === 0) {
    characterInBlock = Math.max(0, virtualCharacter - JSP_EXPRESSION_PREFIX.length);
  }
  return { lineInBlock, characterInBlock };
}
