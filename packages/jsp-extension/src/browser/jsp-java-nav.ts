/**
 * JSP Java parser — extracts Java type references from JSP files.
 *
 * Pure functions; no I/O, no DI needed. Used by both
 * jsp-navigation.ts (Ctrl+Click → Java) and by the JSP
 * completion provider.
 *
 * Parses:
 *  - <%@ page import="..." %> directives → simple→FQN map
 *  - <% ... %>, <%= ... %>, <%! ... %> blocks → Java code regions
 *  - Word-under-cursor extraction
 */

/** Boundaries of a Java code block inside a JSP file. */
export interface JavaBlock {
  /** 0-based offset of the opening tag end (e.g. right after "<%"). */
  start: number;
  /** 0-based offset of the closing tag start (e.g. right before "%>"). */
  end: number;
  /** One of 'scriptlet', 'expression', 'declaration', 'directive'. */
  kind: 'scriptlet' | 'expression' | 'declaration' | 'directive';
}

/**
 * Lightweight JSP parser that extracts Java type references.
 * Pure functions — no I/O, no DI needed.
 */
export class JspJavaParser {
  /**
   * Parse `<%@ page import="..." %>` directives and return a map
   * from simple class name to fully-qualified name.
   */
  parseImports(content: string): Map<string, string> {
    const imports = new Map<string, string>();
    // Match <%@ page import="a.b.C, x.y.Z" %>
    const re = /<%@\s+page\s+[^%]*\bimport\s*=\s*"([^"]*)"[^%]*%>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      for (const cls of m[1].split(',')) {
        const fqn = cls.trim();
        if (!fqn) continue;
        const simple = fqn.split('.').pop()!;
        if (simple && !imports.has(simple)) {
          imports.set(simple, fqn);
        }
      }
    }
    return imports;
  }

  /**
   * Find all Java code blocks in the JSP content.
   * Returns blocks sorted by start offset.
   */
  findJavaBlocks(content: string): JavaBlock[] {
    const blocks: JavaBlock[] = [];

    // Match each block type: <%! ... %>, <%= ... %>, <%@ ... %>, <% ... %>
    const re = /<%\s*([!=@]?)\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const tagEnd = m.index + m[0].length;
      const marker = m[1] || '';

      // Find the closing %>
      const closeIdx = content.indexOf('%>', tagEnd);
      if (closeIdx === -1) continue;

      let kind: JavaBlock['kind'];
      if (marker === '!') kind = 'declaration';
      else if (marker === '=') kind = 'expression';
      else if (marker === '@') kind = 'directive';
      else kind = 'scriptlet';

      blocks.push({ start: tagEnd, end: closeIdx, kind });
    }

    blocks.sort((a, b) => a.start - b.start);
    return blocks;
  }

  /**
   * Find the Java block that contains the given offset, or null
   * if the offset is not inside any Java block.
   */
  findBlockAt(blocks: JavaBlock[], offset: number): JavaBlock | null {
    for (const b of blocks) {
      if (offset >= b.start && offset < b.end) return b;
    }
    return null;
  }

  /**
   * Extract the Java-style identifier word at the given offset.
   * Returns null if the offset is not on a word character.
   */
  getWordAt(content: string, offset: number): { word: string; start: number; end: number } | null {
    if (offset < 0 || offset >= content.length) return null;
    if (!isJavaIdentChar(content.charCodeAt(offset))) return null;

    let start = offset;
    while (start > 0 && isJavaIdentChar(content.charCodeAt(start - 1))) {
      start--;
    }
    let end = offset;
    while (end < content.length && isJavaIdentChar(content.charCodeAt(end))) {
      end++;
    }
    const word = content.slice(start, end);
    if (!word) return null;
    return { word, start, end };
  }

  /**
   * Convert a 0-based line/column position to a 0-based offset
   * in the content string.
   */
  positionToOffset(content: string, line: number, column: number): number {
    const lines = content.split('\n');
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      offset += lines[i].length + 1; // +1 for \n
    }
    return offset + column;
  }
}

function isJavaIdentChar(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x5f || // _
    code === 0x24    // $
  );
}