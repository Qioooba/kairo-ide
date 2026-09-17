/**
 * Incremental Tokenizer Engine for Kairo IDE.
 *
 * Implements checkpoint-based scanning (every 256 lines), state equivalence checks,
 * safe suffix reuse, and time-sliced yielding.
 * Pure logic — runnable in Web Worker or Node thread.
 */

import { LexerState } from '../common/lexer-state';
import { ModelTokenCache } from '../common/token-cache';
import { JspRegionScanner } from '../common/jsp-region-scanner';

export interface TokenizeSliceResult {
  startLine: number;
  endLine: number;
  lineTokens: Uint32Array[];
  endState?: LexerState;
  isCompleted: boolean;
  hasMore: boolean;
}

export class IncrementalTokenizer {
  readonly modelInstanceId: string;
  readonly languageId: string;
  readonly dialect: string;

  private fullText: string = '';
  private lines: string[] = [];
  private lineStarts: number[] = [0];
  private version: number = 0;
  private cache: ModelTokenCache;
  private jspScanner = new JspRegionScanner();

  constructor(modelInstanceId: string, languageId: string, dialect: string = languageId) {
    this.modelInstanceId = modelInstanceId;
    this.languageId = languageId;
    this.dialect = dialect;
    this.cache = new ModelTokenCache(modelInstanceId);
  }

  getLineCount(): number {
    return this.lines.length;
  }

  getText(): string {
    return this.fullText;
  }

  private rebuildFromFullText(text: string): void {
    this.fullText = text;
    const lineStarts = [0];
    const lines: string[] = [];
    let lineStart = 0;
    const len = text.length;
    let i = 0;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 13 /* \r */) {
        if (i + 1 < len && text.charCodeAt(i + 1) === 10 /* \n */) {
          lines.push(text.slice(lineStart, i));
          i += 2;
        } else {
          lines.push(text.slice(lineStart, i));
          i += 1;
        }
        lineStart = i;
        lineStarts.push(lineStart);
      } else if (c === 10 /* \n */) {
        lines.push(text.slice(lineStart, i));
        i += 1;
        lineStart = i;
        lineStarts.push(lineStart);
      } else {
        i++;
      }
    }
    lines.push(text.slice(lineStart));
    this.lines = lines;
    this.lineStarts = lineStarts;
  }

  getLineFromOffset(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.lineStarts[mid] <= offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.max(1, high + 1);
  }

  setFullText(text: string, version: number): void {
    this.rebuildFromFullText(text);
    this.version = version;
    this.cache.clear();
    this.cache.setVersion(version);
  }

  applyEdits(
    changes: Array<{ rangeOffset: number; rangeLength: number; text: string }>,
    version: number,
    fullTextFallback?: string,
  ): number {
    if (fullTextFallback !== undefined) {
      this.setFullText(fullTextFallback, version);
      return 1;
    }

    if (!changes || changes.length === 0) {
      this.version = version;
      this.cache.setVersion(version);
      return 1;
    }

    // Sort changes by rangeOffset descending (Monaco convention for edits within a single event)
    const sortedChanges = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset);

    // Find earliest affected line before applying edits
    let minOffset = Infinity;
    for (const change of sortedChanges) {
      if (change.rangeOffset < minOffset) {
        minOffset = change.rangeOffset;
      }
    }

    const earliestDirtyLine = Math.min(this.lines.length || 1, this.getLineFromOffset(minOffset));

    // Apply edits to text mirror in descending offset order
    let current = this.fullText;
    for (const c of sortedChanges) {
      if (c.rangeOffset < 0 || c.rangeOffset > current.length) {
        continue;
      }
      const before = current.slice(0, c.rangeOffset);
      const after = current.slice(c.rangeOffset + c.rangeLength);
      current = before + c.text + after;
    }

    this.rebuildFromFullText(current);
    this.version = version;
    this.cache.setVersion(version);
    this.cache.invalidateFrom(earliestDirtyLine);

    return earliestDirtyLine;
  }

  /**
   * Tokenize a slice of lines starting from `fromLine` (1-indexed) up to `maxLines` or time budget.
   */
  tokenizeSlice(
    fromLine: number,
    targetEndLine: number,
    timeBudgetMs: number = 12,
  ): TokenizeSliceResult {
    const totalLines = this.lines.length;
    if (totalLines === 0) {
      return {
        startLine: 1,
        endLine: 1,
        lineTokens: [new Uint32Array(0)],
        isCompleted: true,
        hasMore: false,
      };
    }

    const startLine = Math.max(1, Math.min(fromLine, totalLines));
    const endTarget = Math.min(targetEndLine, totalLines);

    // Resolve initial state from closest checkpoint strictly before startLine
    const cp = this.cache.getClosestCheckpoint(startLine);
    let currentState = cp ? cp.state.clone() : new LexerState('root', undefined, [], this.dialect);
    let currentLine = cp ? cp.lineNumber + 1 : 1;

    // Fast-forward to startLine if checkpoint was earlier
    while (currentLine < startLine) {
      currentState = this.tokenizeLineStub(this.lines[currentLine - 1], currentState);
      currentLine++;
    }

    const startTime = Date.now();
    const lineTokens: Uint32Array[] = [];

    let line = startLine;
    while (line <= endTarget) {
      const lineText = this.lines[line - 1] ?? '';
      const { tokens, nextState } = this.tokenizeSingleLine(lineText, currentState);
      lineTokens.push(tokens);
      this.cache.setLineTokens(line, tokens);

      currentState = nextState;

      // Save checkpoint every 256 lines
      if (line % this.cache.CHECKPOINT_INTERVAL === 0) {
        this.cache.addCheckpoint(line, currentState, this.cache.getVersion());
      }

      line++;

      // Check time budget
      if (line <= endTarget && Date.now() - startTime >= timeBudgetMs) {
        break;
      }
    }

    const finishedLine = line - 1;
    const isCompleted = finishedLine >= totalLines;
    if (isCompleted) {
      this.cache.setCompletedLineCount(totalLines);
    } else if (finishedLine > this.cache.getCompletedLineCount()) {
      this.cache.setCompletedLineCount(finishedLine);
    }

    return {
      startLine,
      endLine: finishedLine,
      lineTokens,
      endState: currentState,
      isCompleted,
      hasMore: finishedLine < totalLines,
    };
  }

  /**
   * Fast state transition stub for lines before viewport.
   */
  private tokenizeLineStub(lineText: string, state: LexerState): LexerState {
    return this.tokenizeSingleLine(lineText, state).nextState;
  }

  /**
   * Tokenize a single line and generate packed Monaco-compatible binary tokens:
   * [endOffset, metadata, endOffset, metadata, ...]
   *
   * Handles:
   *  - JSP scriptlets, directives, comments, EL
   *  - Java keywords, types, methods, comments, strings (with newline recovery)
   *  - Long lines up to millions of characters safely.
   */
  tokenizeSingleLine(lineText: string, state: LexerState): { tokens: Uint32Array; nextState: LexerState } {
    const tokensBuilder: number[] = [];
    let nextState = state.clone();

    if (this.languageId === 'java') {
      return this.tokenizeJavaLine(lineText, state);
    }

    if (lineText.length === 0) {
      return { tokens: new Uint32Array(0), nextState };
    }

    let i = 0;
    const len = lineText.length;

    // Handle multiline comment/scriptlet continuation
    if (nextState.mode === 'jsp-comment') {
      const close = lineText.indexOf('--%>');
      if (close !== -1) {
        tokensBuilder.push(close + 4, 1 /* comment */);
        nextState = new LexerState('root', undefined, [], this.dialect);
        i = close + 4;
      } else {
        tokensBuilder.push(len, 1 /* comment */);
        return { tokens: new Uint32Array(tokensBuilder), nextState };
      }
    } else if (nextState.mode === 'html-comment') {
      const close = lineText.indexOf('-->');
      if (close !== -1) {
        tokensBuilder.push(close + 3, 1 /* comment */);
        nextState = new LexerState('root', undefined, [], this.dialect);
        i = close + 3;
      } else {
        tokensBuilder.push(len, 1 /* comment */);
        return { tokens: new Uint32Array(tokensBuilder), nextState };
      }
    } else if (nextState.mode === 'java-block-comment') {
      const close = lineText.indexOf('*/');
      if (close !== -1) {
        tokensBuilder.push(close + 2, 1 /* comment */);
        nextState = new LexerState(nextState.embeddedLanguage ? 'scriptlet' : 'root', nextState.embeddedLanguage, [], this.dialect);
        i = close + 2;
      } else {
        tokensBuilder.push(len, 1 /* comment */);
        return { tokens: new Uint32Array(tokensBuilder), nextState };
      }
    } else if (nextState.mode === 'directive') {
      const close = lineText.indexOf('%>');
      if (close !== -1) {
        if (close > 0) {
          tokensBuilder.push(close, 3 /* directive */);
        }
        tokensBuilder.push(close + 2, 2 /* delimiter */);
        nextState = new LexerState('root', undefined, [], this.dialect);
        i = close + 2;
      } else {
        tokensBuilder.push(len, 3 /* directive */);
        return { tokens: new Uint32Array(tokensBuilder), nextState };
      }
    } else if (nextState.mode === 'html-tag') {
      const { nextIdx, closed } = this.tokenizeHtmlTagContent(lineText, 0, tokensBuilder);
      if (closed) {
        nextState = new LexerState('root', undefined, [], this.dialect);
        i = nextIdx;
      } else {
        return { tokens: new Uint32Array(tokensBuilder), nextState };
      }
    } else if (nextState.mode === 'scriptlet' || nextState.mode === 'java') {
      // In Java block: check for '%>' scriptlet end
      const closeScriptlet = this.jspScanner.findScriptletClose(lineText, i);
      if (closeScriptlet !== -1) {
        // Tokenize Java content before '%>'
        this.tokenizeJavaSnippet(lineText.slice(i, closeScriptlet), i, tokensBuilder);
        // Scriptlet closing delimiter '%>'
        tokensBuilder.push(closeScriptlet + 2, 2 /* delimiter */);
        nextState = new LexerState('root', undefined, [], this.dialect);
        i = closeScriptlet + 2;
      } else {
        // Whole remaining line is inside Java
        const endMode = this.tokenizeJavaSnippet(lineText.slice(i), i, tokensBuilder);
        nextState = endMode === 'java-block-comment'
          ? new LexerState('java-block-comment', 'java', [], this.dialect)
          : nextState;
        return { tokens: new Uint32Array(tokensBuilder), nextState };
      }
    }

    // Main line scanning loop
    while (i < len) {
      // 1. JSP Comment <%--
      if (lineText.startsWith('<%--', i)) {
        const close = lineText.indexOf('--%>', i + 4);
        if (close !== -1) {
          tokensBuilder.push(close + 4, 1 /* comment */);
          i = close + 4;
        } else {
          tokensBuilder.push(len, 1 /* comment */);
          nextState = new LexerState('jsp-comment', undefined, [], this.dialect);
          break;
        }
        continue;
      }

      // 2. HTML Comment <!--
      if (lineText.startsWith('<!--', i)) {
        const close = lineText.indexOf('-->', i + 4);
        if (close !== -1) {
          tokensBuilder.push(close + 3, 1 /* comment */);
          i = close + 3;
        } else {
          tokensBuilder.push(len, 1 /* comment */);
          nextState = new LexerState('html-comment', undefined, [], this.dialect);
          break;
        }
        continue;
      }

      // 3. Scriptlet <% or Expression <%= or Declaration <%! or Directive <%@
      if (lineText.startsWith('<%', i)) {
        let tagEnd = i + 2;
        const marker = lineText[i + 2];
        if (marker === '@' || marker === '=' || marker === '!') {
          tagEnd++;
        }
        tokensBuilder.push(tagEnd, 2 /* delimiter */);

        const close = this.jspScanner.findScriptletClose(lineText, tagEnd);
        if (close !== -1) {
          // Inner Java code
          if (marker !== '@') {
            this.tokenizeJavaSnippet(lineText.slice(tagEnd, close), tagEnd, tokensBuilder);
          } else {
            // Directive text
            tokensBuilder.push(close, 3 /* directive */);
          }
          tokensBuilder.push(close + 2, 2 /* delimiter */);
          i = close + 2;
        } else {
          if (marker !== '@') {
            const snipMode = this.tokenizeJavaSnippet(lineText.slice(tagEnd), tagEnd, tokensBuilder);
            nextState = snipMode === 'java-block-comment'
              ? new LexerState('java-block-comment', 'java', [], this.dialect)
              : new LexerState('scriptlet', 'java', [], this.dialect);
          } else {
            tokensBuilder.push(len, 3 /* directive */);
            nextState = new LexerState('directive', undefined, [], this.dialect);
          }
          break;
        }
        continue;
      }

      // 4. EL Expression ${...} or #{...}
      if (lineText.startsWith('${', i) || lineText.startsWith('#{', i)) {
        tokensBuilder.push(i + 2, 4 /* el.delimiter */);
        const close = this.jspScanner.findElClose(lineText, i + 2);
        if (close !== -1) {
          tokensBuilder.push(close, 5 /* el.body */);
          tokensBuilder.push(close + 1, 4 /* el.delimiter */);
          i = close + 1;
        } else {
          tokensBuilder.push(len, 5 /* el.body */);
          break;
        }
        continue;
      }

      // 5. HTML Tags <tag ... >
      if (lineText[i] === '<') {
        const nextChar = lineText[i + 1] ?? '';
        if (/[a-zA-Z_!/?]/.test(nextChar)) {
          const { nextIdx, closed } = this.tokenizeHtmlTagContent(lineText, i, tokensBuilder);
          if (closed) {
            i = nextIdx;
            continue;
          } else {
            nextState = new LexerState('html-tag', undefined, [], this.dialect);
            break;
          }
        }
      }

      // Advance to next interesting delimiter
      let nextDelim = len;
      for (let j = i + 1; j < len; j++) {
        const c = lineText[j];
        if (c === '<' || (c === '$' && lineText[j + 1] === '{') || (c === '#' && lineText[j + 1] === '{')) {
          nextDelim = j;
          break;
        }
      }
      tokensBuilder.push(nextDelim, 0 /* text */);
      i = nextDelim;
    }

    return {
      tokens: new Uint32Array(tokensBuilder),
      nextState,
    };
  }

  /**
   * Tokenize HTML/XML tag body including attribute EL expressions.
   */
  private tokenizeHtmlTagContent(
    lineText: string,
    fromIdx: number,
    tokensBuilder: number[],
  ): { nextIdx: number; closed: boolean } {
    let idx = fromIdx;
    const len = lineText.length;
    let tagStart = idx;
    let inQuote: '"' | "'" | undefined = undefined;

    while (idx < len) {
      const c = lineText[idx];

      if (inQuote) {
        if (c === inQuote) {
          inQuote = undefined;
          idx++;
          continue;
        }
        // EL inside quoted attribute: "${...}" or '#{...}'
        if ((c === '$' || c === '#') && idx + 1 < len && lineText[idx + 1] === '{') {
          if (idx > tagStart) {
            tokensBuilder.push(idx, 6 /* tag */);
          }
          tokensBuilder.push(idx + 2, 4 /* el.delimiter */);
          const closeEl = this.jspScanner.findElClose(lineText, idx + 2);
          if (closeEl !== -1) {
            tokensBuilder.push(closeEl, 5 /* el.body */);
            tokensBuilder.push(closeEl + 1, 4 /* el.delimiter */);
            idx = closeEl + 1;
            tagStart = idx;
          } else {
            tokensBuilder.push(len, 5 /* el.body */);
            return { nextIdx: len, closed: false };
          }
          continue;
        }
        idx++;
        continue;
      }

      // Not in quote
      if (c === '"' || c === "'") {
        inQuote = c;
        idx++;
        continue;
      }

      // EL unquoted attribute: <tag attr=${...}>
      if ((c === '$' || c === '#') && idx + 1 < len && lineText[idx + 1] === '{') {
        if (idx > tagStart) {
          tokensBuilder.push(idx, 6 /* tag */);
        }
        tokensBuilder.push(idx + 2, 4 /* el.delimiter */);
        const closeEl = this.jspScanner.findElClose(lineText, idx + 2);
        if (closeEl !== -1) {
          tokensBuilder.push(closeEl, 5 /* el.body */);
          tokensBuilder.push(closeEl + 1, 4 /* el.delimiter */);
          idx = closeEl + 1;
          tagStart = idx;
        } else {
          tokensBuilder.push(len, 5 /* el.body */);
          return { nextIdx: len, closed: false };
        }
        continue;
      }

      // End of tag `>`
      if (c === '>') {
        tokensBuilder.push(idx + 1, 6 /* tag */);
        return { nextIdx: idx + 1, closed: true };
      }

      idx++;
    }

    if (idx > tagStart) {
      tokensBuilder.push(len, 6 /* tag */);
    }
    return { nextIdx: len, closed: false };
  }

  private tokenizeJavaLine(lineText: string, state: LexerState): { tokens: Uint32Array; nextState: LexerState } {
    const tokensBuilder: number[] = [];
    const len = lineText.length;
    let nextState = state.clone();

    if (len === 0) {
      return { tokens: new Uint32Array(0), nextState };
    }

    let i = 0;
    if (nextState.mode === 'comment' || nextState.mode === 'java-block-comment') {
      const close = lineText.indexOf('*/');
      if (close !== -1) {
        tokensBuilder.push(close + 2, 1 /* comment */);
        nextState = new LexerState('root', undefined, [], 'java');
        i = close + 2;
      } else {
        tokensBuilder.push(len, 1 /* comment */);
        return { tokens: new Uint32Array(tokensBuilder), nextState };
      }
    }

    const endMode = this.tokenizeJavaSnippet(lineText.slice(i), i, tokensBuilder);
    nextState = endMode === 'java-block-comment'
      ? new LexerState('java-block-comment', undefined, [], 'java')
      : new LexerState('root', undefined, [], 'java');

    return {
      tokens: new Uint32Array(tokensBuilder),
      nextState,
    };
  }

  /**
   * Tokenize snippet of Java code.
   */
  private tokenizeJavaSnippet(code: string, baseOffset: number, tokensBuilder: number[]): 'root' | 'java-block-comment' {
    if (!code) return 'root';
    let idx = 0;
    const len = code.length;

    while (idx < len) {
      const c = code[idx];

      // Whitespace
      if (/\s/.test(c)) {
        idx++;
        continue;
      }

      // Line comment //
      if (c === '/' && code[idx + 1] === '/') {
        tokensBuilder.push(baseOffset + len, 1 /* comment */);
        break;
      }

      // Block comment /*
      if (c === '/' && code[idx + 1] === '*') {
        const close = code.indexOf('*/', idx + 2);
        if (close !== -1) {
          tokensBuilder.push(baseOffset + close + 2, 1 /* comment */);
          idx = close + 2;
        } else {
          tokensBuilder.push(baseOffset + len, 1 /* comment */);
          return 'java-block-comment';
        }
        continue;
      }

      // String literal "..."
      if (c === '"') {
        let strEnd = idx + 1;
        let closed = false;
        while (strEnd < len) {
          if (code[strEnd] === '\\') {
            strEnd += 2;
            continue;
          }
          if (code[strEnd] === '"') {
            strEnd++;
            closed = true;
            break;
          }
          strEnd++;
        }
        tokensBuilder.push(baseOffset + strEnd, closed ? 7 /* string */ : 8 /* string.invalid */);
        idx = strEnd;
        continue;
      }

      // Word: keyword, type, identifier
      if (/[a-zA-Z_$]/.test(c)) {
        let endWord = idx + 1;
        while (endWord < len && /[\w$]/.test(code[endWord])) {
          endWord++;
        }
        const word = code.slice(idx, endWord);
        const isKw = /^(abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|true|false|null)$/.test(word);
        tokensBuilder.push(baseOffset + endWord, isKw ? 9 /* keyword */ : 10 /* identifier */);
        idx = endWord;
        continue;
      }

      // Punctuation / operator
      idx++;
      tokensBuilder.push(baseOffset + idx, 11 /* operator */);
    }

    return 'root';
  }

  getCache(): ModelTokenCache {
    return this.cache;
  }
}
