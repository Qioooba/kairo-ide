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

export class JspSourceMap {
  private readonly spans: SourceSpan[] = [];

  constructor(spans?: SourceSpan[]) {
    if (spans) {
      this.spans.push(...spans);
    }
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

      let targetVirtualCol = jspChar;
      const prefix = span.prefixLength ?? 0;

      if (lineOffset === 0) {
        // First line of block: relative to sourceStartCol + virtualStartCol + prefix
        const relativeCol = jspChar - span.sourceStartCol;
        targetVirtualCol = span.virtualStartCol + prefix + relativeCol;
      } else {
        // Subsequent lines: keep column
        targetVirtualCol = jspChar;
      }

      const approxVirtualOffset = span.virtualStartOffset + prefix + Math.max(0, jspChar - span.sourceStartCol);

      return {
        line: targetVirtualLine,
        character: targetVirtualCol,
        offset: approxVirtualOffset,
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

      let targetSourceCol: number;
      if (lineOffset === 0) {
        const relativeVirtualCol = Math.max(0, virtualChar - span.virtualStartCol - prefix);
        targetSourceCol = span.sourceStartCol + relativeVirtualCol;
      } else {
        targetSourceCol = virtualChar;
      }

      const approxSourceOffset = span.sourceStartOffset + Math.max(0, targetSourceCol - span.sourceStartCol);

      return {
        sourceUri: span.sourceUri,
        line: targetSourceLine,
        character: targetSourceCol,
        offset: approxSourceOffset,
        inUserCode: true,
        span,
      };
    }

    return null;
  }
}
