/**
 * Deterministic, resumable JSP Region Scanner for Kairo IDE.
 *
 * Implements authoritative JSP 2.0 / 2.1 / Tomcat 6 delimiter scanning.
 * Pure logic — no DOM or Theia UI dependencies.
 *
 * Shared by syntax highlighting, Java block extraction, navigation,
 * virtual document compilation, and source map generation.
 */

import type { JspDialect } from './language-coverage';

export type JspRegionKind =
  | 'jsp-comment'
  | 'html-comment'
  | 'jsp-directive'
  | 'jsp-declaration'
  | 'jsp-expression'
  | 'jsp-scriptlet'
  | 'el-expression'
  | 'embedded-script'
  | 'embedded-style'
  | 'tag'
  | 'text';

export interface JspRegion {
  kind: JspRegionKind;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  embeddedLanguage?: 'java' | 'javascript' | 'css' | 'el';
  isClosed: boolean;
  /** Inner content range excluding opening and closing delimiters */
  innerStartOffset: number;
  innerEndOffset: number;
  /** Directive name or tag name if applicable */
  tagName?: string;
  /** Attributes for tag/directive */
  attributes?: Record<string, string>;
}

export interface JavaBlockCompat {
  start: number;
  end: number;
  kind: 'scriptlet' | 'expression' | 'declaration' | 'directive';
}

export class JspRegionScanner {
  /**
   * Scan complete JSP document into a flat array of non-overlapping regions.
   * Offsets use UTF-16 code units (Monaco column/offset standard).
   */
  scanRegions(content: string, dialect: JspDialect = 'jsp'): JspRegion[] {
    const regions: JspRegion[] = [];
    const len = content.length;
    let offset = 0;

    const isXml = dialect === 'jspx' || dialect === 'tagx';

    // Precalculate line start offsets for fast offset -> position translation
    const lineOffsets = this.computeLineOffsets(content);

    const getPos = (off: number) => {
      let low = 0;
      let high = lineOffsets.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (lineOffsets[mid] <= off) {
          if (mid === lineOffsets.length - 1 || lineOffsets[mid + 1] > off) {
            return { line: mid, col: off - lineOffsets[mid] };
          }
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return { line: 0, col: off };
    };

    while (offset < len) {
      // 1. Check for JSP Delimiters <% ...
      if (!isXml && content.startsWith('<%', offset)) {
        // 1.1 JSP Comment <%-- ... --%>
        if (content.startsWith('<%--', offset)) {
          const closeIdx = content.indexOf('--%>', offset + 4);
          const endOffset = closeIdx !== -1 ? closeIdx + 4 : len;
          const isClosed = closeIdx !== -1;
          const startPos = getPos(offset);
          const endPos = getPos(endOffset);
          regions.push({
            kind: 'jsp-comment',
            startOffset: offset,
            endOffset,
            startLine: startPos.line,
            startCol: startPos.col,
            endLine: endPos.line,
            endCol: endPos.col,
            isClosed,
            innerStartOffset: offset + 4,
            innerEndOffset: isClosed ? closeIdx : len,
          });
          offset = endOffset;
          continue;
        }

        // 1.2 JSP Directive, Declaration, Expression, or Scriptlet
        let kind: JspRegionKind = 'jsp-scriptlet';
        let innerStart = offset + 2;
        let embeddedLang: JspRegion['embeddedLanguage'] = 'java';

        const marker = content[offset + 2];
        if (marker === '@') {
          kind = 'jsp-directive';
          innerStart = offset + 3;
          embeddedLang = undefined;
        } else if (marker === '!') {
          kind = 'jsp-declaration';
          innerStart = offset + 3;
        } else if (marker === '=') {
          kind = 'jsp-expression';
          innerStart = offset + 3;
        }

        // Search for closing delimiter '%>' respecting '%\>' escape
        const closeIdx = this.findScriptletClose(content, innerStart);
        const isClosed = closeIdx !== -1;
        const endOffset = isClosed ? closeIdx + 2 : len;
        const startPos = getPos(offset);
        const endPos = getPos(endOffset);

        regions.push({
          kind,
          startOffset: offset,
          endOffset,
          startLine: startPos.line,
          startCol: startPos.col,
          endLine: endPos.line,
          endCol: endPos.col,
          embeddedLanguage: embeddedLang,
          isClosed,
          innerStartOffset: innerStart,
          innerEndOffset: isClosed ? closeIdx : len,
        });

        offset = endOffset;
        continue;
      }

      // 2. Check for HTML Comment <!-- ... -->
      if (content.startsWith('<!--', offset)) {
        const closeIdx = content.indexOf('-->', offset + 4);
        const isClosed = closeIdx !== -1;
        const endOffset = isClosed ? closeIdx + 3 : len;
        const startPos = getPos(offset);
        const endPos = getPos(endOffset);

        regions.push({
          kind: 'html-comment',
          startOffset: offset,
          endOffset,
          startLine: startPos.line,
          startCol: startPos.col,
          endLine: endPos.line,
          endCol: endPos.col,
          isClosed,
          innerStartOffset: offset + 4,
          innerEndOffset: isClosed ? closeIdx : len,
        });

        offset = endOffset;
        continue;
      }

      // 3. Check for EL Expressions ${...} or #{...}
      if (content.startsWith('${', offset) || content.startsWith('#{', offset)) {
        const closeIdx = this.findElClose(content, offset + 2);
        const isClosed = closeIdx !== -1;
        const endOffset = isClosed ? closeIdx + 1 : len;
        const startPos = getPos(offset);
        const endPos = getPos(endOffset);

        regions.push({
          kind: 'el-expression',
          startOffset: offset,
          endOffset,
          startLine: startPos.line,
          startCol: startPos.col,
          endLine: endPos.line,
          endCol: endPos.col,
          embeddedLanguage: 'el',
          isClosed,
          innerStartOffset: offset + 2,
          innerEndOffset: isClosed ? closeIdx : len,
        });

        offset = endOffset;
        continue;
      }

      // 4. Check for <script> and <style> tags
      const scriptMatch = /^<script\b[^>]*>/i.exec(content.slice(offset));
      if (scriptMatch) {
        const tagLen = scriptMatch[0].length;
        const startPos = getPos(offset);
        const innerStart = offset + tagLen;
        const closeMatch = /<\/script\s*>/i.exec(content.slice(innerStart));
        const isClosed = closeMatch !== null;
        const innerEnd = isClosed ? innerStart + closeMatch.index : len;
        const endOffset = isClosed ? innerEnd + closeMatch[0].length : len;
        const endPos = getPos(endOffset);

        regions.push({
          kind: 'embedded-script',
          startOffset: offset,
          endOffset,
          startLine: startPos.line,
          startCol: startPos.col,
          endLine: endPos.line,
          endCol: endPos.col,
          embeddedLanguage: 'javascript',
          isClosed,
          innerStartOffset: innerStart,
          innerEndOffset: innerEnd,
          tagName: 'script',
        });

        offset = endOffset;
        continue;
      }

      const styleMatch = /^<style\b[^>]*>/i.exec(content.slice(offset));
      if (styleMatch) {
        const tagLen = styleMatch[0].length;
        const startPos = getPos(offset);
        const innerStart = offset + tagLen;
        const closeMatch = /<\/style\s*>/i.exec(content.slice(innerStart));
        const isClosed = closeMatch !== null;
        const innerEnd = isClosed ? innerStart + closeMatch.index : len;
        const endOffset = isClosed ? innerEnd + closeMatch[0].length : len;
        const endPos = getPos(endOffset);

        regions.push({
          kind: 'embedded-style',
          startOffset: offset,
          endOffset,
          startLine: startPos.line,
          startCol: startPos.col,
          endLine: endPos.line,
          endCol: endPos.col,
          embeddedLanguage: 'css',
          isClosed,
          innerStartOffset: innerStart,
          innerEndOffset: innerEnd,
          tagName: 'style',
        });

        offset = endOffset;
        continue;
      }

      // 5. Check for General Tags (<tag ... > or </tag>) with embedded expressions
      if (content[offset] === '<' && offset + 1 < len && /[a-zA-Z_!/?]/.test(content[offset + 1])) {
        offset = this.scanTagWithEmbedded(content, offset, getPos, regions);
        continue;
      }

      // 6. Template text up to the next delimiter start (<, ${, #{)
      const nextDelimiter = this.findNextDelimiter(content, offset + 1);
      const textEnd = nextDelimiter !== -1 ? nextDelimiter : len;
      const startPos = getPos(offset);
      const endPos = getPos(textEnd);

      regions.push({
        kind: 'text',
        startOffset: offset,
        endOffset: textEnd,
        startLine: startPos.line,
        startCol: startPos.col,
        endLine: endPos.line,
        endCol: endPos.col,
        isClosed: true,
        innerStartOffset: offset,
        innerEndOffset: textEnd,
      });

      offset = textEnd;
    }

    return regions;
  }

  /**
   * Find scriptlet closing `%>` respecting `%\>` escape sequence.
   * Per Tomcat Jasper Parser specification:
   * `%\>` is an escaped literal `%>` inside Java code and does NOT terminate the scriptlet.
   * Any unescaped `%>` terminates the scriptlet.
   */
  findScriptletClose(content: string, from: number): number {
    let inSingle = false;
    let inDouble = false;
    let inLineComment = false;
    let inBlockComment = false;

    let idx = from;
    const len = content.length;
    while (idx < len - 1) {
      const c = content[idx];
      const n = content[idx + 1];

      if (inLineComment) {
        if (c === '\n') {
          inLineComment = false;
        }
        idx++;
        continue;
      }
      if (inBlockComment) {
        if (c === '*' && n === '/') {
          inBlockComment = false;
          idx += 2;
          continue;
        }
        idx++;
        continue;
      }
      if (inSingle) {
        if (c === '\\') {
          idx += 2;
          continue;
        }
        if (c === "'") {
          inSingle = false;
        } else if (c === '\n') {
          inSingle = false;
        }
        idx++;
        continue;
      }
      if (inDouble) {
        if (c === '\\') {
          idx += 2;
          continue;
        }
        if (c === '"') {
          inDouble = false;
        } else if (c === '\n') {
          inDouble = false;
        }
        idx++;
        continue;
      }

      if (c === '/' && n === '/') {
        inLineComment = true;
        idx += 2;
        continue;
      }
      if (c === '/' && n === '*') {
        inBlockComment = true;
        idx += 2;
        continue;
      }
      if (c === "'") {
        inSingle = true;
        idx++;
        continue;
      }
      if (c === '"') {
        inDouble = true;
        idx++;
        continue;
      }

      // Check JSP spec escape: %\>
      if (c === '%' && n === '\\' && idx + 2 < len && content[idx + 2] === '>') {
        idx += 3;
        continue;
      }

      if (c === '%' && n === '>') {
        return idx;
      }
      idx++;
    }
    return -1;
  }

  /**
   * Find closing `}` for EL expressions, handling nested quotes and brackets.
   */
  findElClose(content: string, from: number): number {
    let depth = 1;
    let inDouble = false;
    let inSingle = false;

    for (let i = from; i < content.length; i++) {
      const c = content[i];
      if (inDouble) {
        if (c === '\\') {
          i++;
        } else if (c === '"') {
          inDouble = false;
        }
        continue;
      }
      if (inSingle) {
        if (c === '\\') {
          i++;
        } else if (c === "'") {
          inSingle = false;
        }
        continue;
      }
      if (c === '"') {
        inDouble = true;
        continue;
      }
      if (c === "'") {
        inSingle = true;
        continue;
      }
      if (c === '{') {
        depth++;
        continue;
      }
      if (c === '}') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
      // Stop on newline if unclosed EL shouldn't cross lines in invalid source
      if (c === '\n' && depth > 5) {
        return -1;
      }
    }
    return -1;
  }

  /**
   * Scan an XML/HTML tag, splitting out embedded <%= ... %> or ${ ... } / #{ ... }
   * into their own high-fidelity regions.
   */
  scanTagWithEmbedded(
    content: string,
    offset: number,
    getPos: (off: number) => { line: number; col: number },
    regions: JspRegion[],
  ): number {
    const len = content.length;
    let i = offset + 1;
    let inDouble = false;
    let inSingle = false;
    let tagChunkStart = offset;

    while (i < len) {
      const c = content[i];
      const n = i + 1 < len ? content[i + 1] : '';

      // Embedded JSP: <%= ... %>, <% ... %>
      if (c === '<' && n === '%') {
        if (i > tagChunkStart) {
          const startPos = getPos(tagChunkStart);
          const endPos = getPos(i);
          regions.push({
            kind: 'tag',
            startOffset: tagChunkStart,
            endOffset: i,
            startLine: startPos.line,
            startCol: startPos.col,
            endLine: endPos.line,
            endCol: endPos.col,
            isClosed: true,
            innerStartOffset: tagChunkStart === offset ? offset + 1 : tagChunkStart,
            innerEndOffset: i,
          });
        }

        let kind: JspRegionKind = 'jsp-scriptlet';
        let innerStart = i + 2;
        if (content[i + 2] === '=') {
          kind = 'jsp-expression';
          innerStart = i + 3;
        } else if (content[i + 2] === '!') {
          kind = 'jsp-declaration';
          innerStart = i + 3;
        }

        const closeIdx = this.findScriptletClose(content, innerStart);
        const isClosed = closeIdx !== -1;
        const endOffset = isClosed ? closeIdx + 2 : len;
        const startPos = getPos(i);
        const endPos = getPos(endOffset);

        regions.push({
          kind,
          startOffset: i,
          endOffset,
          startLine: startPos.line,
          startCol: startPos.col,
          endLine: endPos.line,
          endCol: endPos.col,
          embeddedLanguage: 'java',
          isClosed,
          innerStartOffset: innerStart,
          innerEndOffset: isClosed ? closeIdx : len,
        });

        i = endOffset;
        tagChunkStart = endOffset;
        continue;
      }

      // Embedded EL: ${...}, #{...}
      if ((c === '$' || c === '#') && n === '{') {
        if (i > tagChunkStart) {
          const startPos = getPos(tagChunkStart);
          const endPos = getPos(i);
          regions.push({
            kind: 'tag',
            startOffset: tagChunkStart,
            endOffset: i,
            startLine: startPos.line,
            startCol: startPos.col,
            endLine: endPos.line,
            endCol: endPos.col,
            isClosed: true,
            innerStartOffset: tagChunkStart === offset ? offset + 1 : tagChunkStart,
            innerEndOffset: i,
          });
        }

        const closeIdx = this.findElClose(content, i + 2);
        const isClosed = closeIdx !== -1;
        const endOffset = isClosed ? closeIdx + 1 : len;
        const startPos = getPos(i);
        const endPos = getPos(endOffset);

        regions.push({
          kind: 'el-expression',
          startOffset: i,
          endOffset,
          startLine: startPos.line,
          startCol: startPos.col,
          endLine: endPos.line,
          endCol: endPos.col,
          embeddedLanguage: 'el',
          isClosed,
          innerStartOffset: i + 2,
          innerEndOffset: isClosed ? closeIdx : len,
        });

        i = endOffset;
        tagChunkStart = endOffset;
        continue;
      }

      if (inDouble) {
        if (c === '"') inDouble = false;
        i++;
        continue;
      }
      if (inSingle) {
        if (c === "'") inSingle = false;
        i++;
        continue;
      }

      if (c === '"') {
        inDouble = true;
        i++;
        continue;
      }
      if (c === "'") {
        inSingle = true;
        i++;
        continue;
      }

      if (c === '>') {
        const endOffset = i + 1;
        if (endOffset > tagChunkStart) {
          const startPos = getPos(tagChunkStart);
          const endPos = getPos(endOffset);
          regions.push({
            kind: 'tag',
            startOffset: tagChunkStart,
            endOffset,
            startLine: startPos.line,
            startCol: startPos.col,
            endLine: endPos.line,
            endCol: endPos.col,
            isClosed: true,
            innerStartOffset: tagChunkStart === offset ? offset + 1 : tagChunkStart,
            innerEndOffset: i,
          });
        }
        return endOffset;
      }

      i++;
    }

    if (len > tagChunkStart) {
      const startPos = getPos(tagChunkStart);
      const endPos = getPos(len);
      regions.push({
        kind: 'tag',
        startOffset: tagChunkStart,
        endOffset: len,
        startLine: startPos.line,
        startCol: startPos.col,
        endLine: endPos.line,
        endCol: endPos.col,
        isClosed: false,
        innerStartOffset: tagChunkStart === offset ? offset + 1 : tagChunkStart,
        innerEndOffset: len,
      });
    }
    return len;
  }

  /**
   * Find closing `>` of an XML/HTML tag, skipping quoted attribute strings
   * and embedded `<% ... %>` or `${ ... }`.
   */
  findTagClose(content: string, from: number): number {
    let inDouble = false;
    let inSingle = false;
    let i = from;

    while (i < content.length) {
      const c = content[i];
      if (inDouble) {
        if (c === '"') inDouble = false;
        i++;
        continue;
      }
      if (inSingle) {
        if (c === "'") inSingle = false;
        i++;
        continue;
      }
      if (c === '"') {
        inDouble = true;
        i++;
        continue;
      }
      if (c === "'") {
        inSingle = true;
        i++;
        continue;
      }
      // Skip embedded JSP scriptlet inside tag attribute
      if (c === '<' && i + 1 < content.length && content[i + 1] === '%') {
        const closeJsp = this.findScriptletClose(content, i + 2);
        if (closeJsp !== -1) {
          i = closeJsp + 2;
          continue;
        }
      }
      // Skip embedded EL inside tag attribute
      if ((c === '$' || c === '#') && i + 1 < content.length && content[i + 1] === '{') {
        const closeEl = this.findElClose(content, i + 2);
        if (closeEl !== -1) {
          i = closeEl + 1;
          continue;
        }
      }
      if (c === '>') {
        return i;
      }
      i++;
    }
    return -1;
  }

  findNextDelimiter(content: string, from: number): number {
    for (let i = from; i < content.length; i++) {
      const c = content[i];
      if (c === '<') return i;
      if (c === '$' && i + 1 < content.length && content[i + 1] === '{') return i;
      if (c === '#' && i + 1 < content.length && content[i + 1] === '{') return i;
    }
    return -1;
  }

  computeLineOffsets(content: string): number[] {
    const offsets = [0];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  /**
   * Find Java blocks compatible with JspJavaParser API.
   */
  extractJavaBlocks(content: string, dialect: JspDialect = 'jsp'): JavaBlockCompat[] {
    const regions = this.scanRegions(content, dialect);
    const blocks: JavaBlockCompat[] = [];

    for (const r of regions) {
      if (r.kind === 'jsp-scriptlet') {
        blocks.push({ start: r.innerStartOffset, end: r.innerEndOffset, kind: 'scriptlet' });
      } else if (r.kind === 'jsp-expression') {
        blocks.push({ start: r.innerStartOffset, end: r.innerEndOffset, kind: 'expression' });
      } else if (r.kind === 'jsp-declaration') {
        blocks.push({ start: r.innerStartOffset, end: r.innerEndOffset, kind: 'declaration' });
      } else if (r.kind === 'jsp-directive') {
        blocks.push({ start: r.innerStartOffset, end: r.innerEndOffset, kind: 'directive' });
      }
    }

    return blocks;
  }
}

export const defaultJspRegionScanner = new JspRegionScanner();
