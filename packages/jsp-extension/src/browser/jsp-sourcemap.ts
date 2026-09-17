/**
 * JSP SourceMap — high-precision dual-directional coordinate mapping
 * between JSP source documents and generated virtual Java compilation units.
 *
 * Implements exact line/column/offset translation with support for:
 * - Multi-byte Unicode (Chinese comments, string literals, emoji)
 * - Multi-line scriptlets, expressions, and declarations
 * - Synthetic wrapper exclusion (F16 / T42)
 */

export interface SourceSpan {
  /** Source file URI (JSP or statically included file) */
  readonly sourceUri: string;
  /** 0-based start in source */
  readonly sourceStartLine: number;
  readonly sourceStartCol: number;
  readonly sourceStartOffset: number;
  /** 0-based end in source */
  readonly sourceEndLine: number;
  readonly sourceEndCol: number;
  readonly sourceEndOffset: number;

  /** 0-based start in generated virtual Java */
  readonly virtualStartLine: number;
  readonly virtualStartCol: number;
  readonly virtualStartOffset: number;
  /** 0-based end in generated virtual Java */
  readonly virtualEndLine: number;
  readonly virtualEndCol: number;
  readonly virtualEndOffset: number;

  /** Kind of code block */
  readonly kind: 'import' | 'declaration' | 'scriptlet' | 'expression' | 'synthetic';
  /** Optional prefix length inside virtual code (e.g. `Object __expr = `) */
  readonly prefixLength?: number;
  readonly sourceContent?: string;
  readonly virtualContent?: string;
}

export interface MappedPosition {
  readonly line: number;
  readonly character: number;
  readonly offset: number;
}

export interface MappedJspPosition extends MappedPosition {
  readonly sourceUri: string;
  readonly inUserCode: boolean;
  readonly span?: SourceSpan;
}

export interface MappedVirtualPosition extends MappedPosition {
  readonly span?: SourceSpan;
}

export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

export class JspSourceMap {
  private readonly spans: SourceSpan[] = [];
  private virtualLineStarts?: number[];
  private sourceLineStartsMap = new Map<string, number[]>();

  constructor(spans?: SourceSpan[]) {
    if (spans) {
      this.spans.push(...spans);
    }
  }

  setVirtualText(virtualJava: string): void {
    this.virtualLineStarts = computeLineStarts(virtualJava);
  }

  setSourceText(uri: string, sourceText: string): void {
    this.sourceLineStartsMap.set(uri, computeLineStarts(sourceText));
  }

  addSpan(span: SourceSpan): void {
    this.spans.push(span);
  }

  getSpans(): readonly SourceSpan[] {
    return this.spans;
  }

  /**
   * Map a JSP source coordinate (0-based line & character) to generated virtual Java coordinate.
   */
  mapJspPositionToVirtual(
    sourceUri: string,
    jspLine: number,
    jspChar: number,
  ): MappedVirtualPosition | null {
    for (const span of this.spans) {
      if (span.sourceUri !== sourceUri) continue;
      if (span.kind === 'synthetic') continue;

      // Check if (jspLine, jspChar) is inside [sourceStart, sourceEnd]
      if (jspLine < span.sourceStartLine || jspLine > span.sourceEndLine) continue;
      if (jspLine === span.sourceStartLine && jspChar < span.sourceStartCol) continue;
      if (jspLine === span.sourceEndLine && jspChar > span.sourceEndCol) continue;

      const lineOffset = jspLine - span.sourceStartLine;
      const targetVirtualLine = span.virtualStartLine + lineOffset;

      let targetVirtualCol: number;
      const prefix = span.prefixLength ?? 0;

      if (lineOffset === 0) {
        // First line of block: relative to sourceStartCol + virtualStartCol + prefix
        const relativeCol = jspChar - span.sourceStartCol;
        targetVirtualCol = span.virtualStartCol + prefix + relativeCol;
      } else {
        // Subsequent lines: indented by virtualStartCol in generated Java class/method
        targetVirtualCol = span.virtualStartCol + jspChar;
      }

      let exactVirtualOffset: number;
      if (this.virtualLineStarts && targetVirtualLine < this.virtualLineStarts.length) {
        exactVirtualOffset = this.virtualLineStarts[targetVirtualLine] + targetVirtualCol;
      } else if (span.virtualContent) {
        const vLines = span.virtualContent.split('\n');
        let offset = span.virtualStartOffset;
        for (let l = 0; l < lineOffset && l < vLines.length; l++) {
          offset += vLines[l].length + 1;
        }
        exactVirtualOffset = offset + targetVirtualCol;
      } else if (lineOffset === 0) {
        exactVirtualOffset = span.virtualStartOffset + prefix + Math.max(0, jspChar - span.sourceStartCol);
      } else {
        const totalLines = Math.max(1, span.sourceEndLine - span.sourceStartLine);
        const lineBase = span.virtualStartOffset + Math.round(((span.virtualEndOffset - span.virtualStartOffset) * lineOffset) / totalLines);
        exactVirtualOffset = Math.min(span.virtualEndOffset, lineBase + targetVirtualCol);
      }

      return {
        line: targetVirtualLine,
        character: targetVirtualCol,
        offset: exactVirtualOffset,
        span,
      };
    }
    return null;
  }

  /**
   * Map a generated virtual Java coordinate (0-based line & character) back to JSP source coordinate.
   */
  mapVirtualPositionToJsp(
    virtualLine: number,
    virtualChar: number,
  ): MappedJspPosition | null {
    for (const span of this.spans) {
      // Check if virtual position falls within span's virtual range
      if (virtualLine < span.virtualStartLine || virtualLine > span.virtualEndLine) continue;
      if (virtualLine === span.virtualStartLine && virtualChar < span.virtualStartCol) continue;
      if (virtualLine === span.virtualEndLine && virtualChar > span.virtualEndCol) continue;

      if (span.kind === 'synthetic') {
        return {
          sourceUri: span.sourceUri,
          line: span.sourceStartLine,
          character: span.sourceStartCol,
          offset: span.sourceStartOffset,
          inUserCode: false,
          span,
        };
      }

      const lineOffset = virtualLine - span.virtualStartLine;
      const targetSourceLine = span.sourceStartLine + lineOffset;
      const prefix = span.prefixLength ?? 0;

      // Check if cursor/diagnostic is in synthetic prefix (e.g. `Object __expr = `)
      if (lineOffset === 0 && virtualChar < span.virtualStartCol + prefix) {
        return {
          sourceUri: span.sourceUri,
          line: span.sourceStartLine,
          character: span.sourceStartCol,
          offset: span.sourceStartOffset,
          inUserCode: false,
          span,
        };
      }

      let targetSourceCol: number;
      if (lineOffset === 0) {
        const relativeVirtualCol = Math.max(0, virtualChar - span.virtualStartCol - prefix);
        targetSourceCol = span.sourceStartCol + relativeVirtualCol;
      } else {
        // Subsequent lines: subtract virtualStartCol indentation
        targetSourceCol = Math.max(0, virtualChar - span.virtualStartCol);
      }

      let exactSourceOffset: number;
      const srcStarts = this.sourceLineStartsMap.get(span.sourceUri);
      if (srcStarts && targetSourceLine < srcStarts.length) {
        exactSourceOffset = srcStarts[targetSourceLine] + targetSourceCol;
      } else if (span.sourceContent) {
        const sLines = span.sourceContent.split('\n');
        let offset = span.sourceStartOffset;
        for (let l = 0; l < lineOffset && l < sLines.length; l++) {
          offset += sLines[l].length + 1;
        }
        exactSourceOffset = offset + targetSourceCol;
      } else if (lineOffset === 0) {
        exactSourceOffset = span.sourceStartOffset + Math.max(0, targetSourceCol - span.sourceStartCol);
      } else {
        const totalLines = Math.max(1, span.virtualEndLine - span.virtualStartLine);
        const lineBase = span.sourceStartOffset + Math.round(((span.sourceEndOffset - span.sourceStartOffset) * lineOffset) / totalLines);
        exactSourceOffset = Math.min(span.sourceEndOffset, lineBase + targetSourceCol);
      }

      return {
        sourceUri: span.sourceUri,
        line: targetSourceLine,
        character: targetSourceCol,
        offset: exactSourceOffset,
        inUserCode: true,
        span,
      };
    }

    return null;
  }
}

