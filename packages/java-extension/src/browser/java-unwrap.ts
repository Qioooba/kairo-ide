// SPDX-License-Identifier: Apache-2.0
//
// IDEA-like Unwrap (Ctrl+Shift+Delete) — remove the nearest
// control-structure / brace / paren wrapper and keep the body.

export interface UnwrapInput {
  lines: string[];
  /** 0-based caret line. */
  line: number;
  /** 0-based caret character. */
  character: number;
}

export interface UnwrapEdit {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  text: string;
  cursorLine: number;
  cursorCharacter: number;
}

interface BlockMatch {
  kind: string;
  headerLine: number;
  openBraceLine: number;
  openBraceCol: number;
  closeBraceLine: number;
  closeBraceCol: number;
  /** Body lines inclusive (content inside braces), 0-based. */
  bodyStartLine: number;
  bodyEndLine: number;
  indent: string;
}

function findMatchingBrace(
  lines: string[],
  openLine: number,
  openCol: number,
): { line: number; col: number } | undefined {
  let depth = 0;
  let started = false;
  for (let li = openLine; li < lines.length; li++) {
    const line = lines[li];
    const start = li === openLine ? openCol : 0;
    for (let ci = start; ci < line.length; ci++) {
      const ch = line[ci];
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
        if (started && depth === 0) {
          return { line: li, col: ci };
        }
      }
    }
  }
  return undefined;
}

function findMatchingParen(
  lines: string[],
  openLine: number,
  openCol: number,
): { line: number; col: number } | undefined {
  let depth = 0;
  let started = false;
  for (let li = openLine; li < lines.length; li++) {
    const line = lines[li];
    const start = li === openLine ? openCol : 0;
    for (let ci = start; ci < line.length; ci++) {
      const ch = line[ci];
      if (ch === '(') {
        depth++;
        started = true;
      } else if (ch === ')') {
        depth--;
        if (started && depth === 0) {
          return { line: li, col: ci };
        }
      }
    }
  }
  return undefined;
}

const CONTROL_LINE =
  /^(\s*)(?:(?:public|private|protected|static|final|synchronized)\s+)*(?:if|else\s+if|else|for|while|do|try|catch|finally|switch|synchronized)\b/;

/**
 * Find the innermost unwrap target around the caret.
 */
export function findUnwrapTarget(input: UnwrapInput): BlockMatch | undefined {
  const { lines, line, character } = input;
  if (line < 0 || line >= lines.length) {
    return undefined;
  }

  // 1) Parentheses on current line around caret: (expr)
  const cur = lines[line];
  let openParen = -1;
  for (let i = Math.min(character, cur.length) - 1; i >= 0; i--) {
    if (cur[i] === '(') {
      openParen = i;
      break;
    }
    if (cur[i] === ')') break;
  }
  if (openParen >= 0) {
    const close = findMatchingParen(lines, line, openParen);
    if (close && close.line === line && character <= close.col) {
      const inner = cur.slice(openParen + 1, close.col);
      return {
        kind: 'parens',
        headerLine: line,
        openBraceLine: line,
        openBraceCol: openParen,
        closeBraceLine: close.line,
        closeBraceCol: close.col,
        bodyStartLine: line,
        bodyEndLine: line,
        indent: cur.match(/^\s*/)?.[0] ?? '',
      };
    }
  }

  // 2) Walk upward for control structure with { }
  for (let li = line; li >= Math.max(0, line - 40); li--) {
    const text = lines[li];
    const m = text.match(CONTROL_LINE);
    const braceIdx = text.indexOf('{');
    if (!m && braceIdx < 0) {
      continue;
    }
    const openLine = braceIdx >= 0 ? li : li;
    let openCol = braceIdx;
    if (openCol < 0) {
      // brace may be on next lines
      for (let k = li; k <= Math.min(lines.length - 1, li + 3); k++) {
        const idx = lines[k].indexOf('{');
        if (idx >= 0) {
          openCol = idx;
          // rewrite open line
          const close = findMatchingBrace(lines, k, idx);
          if (!close) continue;
          if (line < k || line > close.line) continue;
          if (line === k && character < idx) continue;
          if (line === close.line && character > close.col) continue;
          const indent = (m?.[1] ?? text.match(/^\s*/)?.[0] ?? '');
          return {
            kind: m ? 'control' : 'block',
            headerLine: li,
            openBraceLine: k,
            openBraceCol: idx,
            closeBraceLine: close.line,
            closeBraceCol: close.col,
            bodyStartLine: k,
            bodyEndLine: close.line,
            indent,
          };
        }
      }
      continue;
    }
    const close = findMatchingBrace(lines, openLine, openCol);
    if (!close) continue;
    if (line < openLine || line > close.line) continue;
    if (line === openLine && character < openCol) continue;
    if (line === close.line && character > close.col) continue;
    return {
      kind: m ? 'control' : 'block',
      headerLine: li,
      openBraceLine: openLine,
      openBraceCol: openCol,
      closeBraceLine: close.line,
      closeBraceCol: close.col,
      bodyStartLine: openLine,
      bodyEndLine: close.line,
      indent: m?.[1] ?? text.match(/^\s*/)?.[0] ?? '',
    };
  }
  return undefined;
}

/**
 * Compute unwrap edit: replace wrapper range with dedented body.
 */
export function computeUnwrapEdit(input: UnwrapInput): UnwrapEdit | null {
  const target = findUnwrapTarget(input);
  if (!target) {
    return null;
  }
  const { lines } = input;

  if (target.kind === 'parens') {
    const line = lines[target.headerLine];
    const inner = line.slice(target.openBraceCol + 1, target.closeBraceCol);
    const newLine = line.slice(0, target.openBraceCol) + inner + line.slice(target.closeBraceCol + 1);
    return {
      startLine: target.headerLine,
      startCharacter: 0,
      endLine: target.headerLine,
      endCharacter: line.length,
      text: newLine,
      cursorLine: target.headerLine,
      cursorCharacter: target.openBraceCol + Math.min(inner.length, Math.max(0, input.character - target.openBraceCol - 1)),
    };
  }

  // Extract body between braces
  const bodyLines: string[] = [];
  for (let li = target.openBraceLine; li <= target.closeBraceLine; li++) {
    let line = lines[li];
    if (li === target.openBraceLine && li === target.closeBraceLine) {
      line = line.slice(target.openBraceCol + 1, target.closeBraceCol);
      if (line.trim()) bodyLines.push(line.replace(/^\s*/, target.indent));
      continue;
    }
    if (li === target.openBraceLine) {
      const after = line.slice(target.openBraceCol + 1);
      if (after.trim()) bodyLines.push(after.replace(/^\s*/, target.indent + '\t').replace(/^\t/, target.indent));
      // normalize: strip one indent level from body
      continue;
    }
    if (li === target.closeBraceLine) {
      const before = line.slice(0, target.closeBraceCol);
      if (before.trim()) bodyLines.push(dedentOne(before, target.indent));
      continue;
    }
    bodyLines.push(dedentOne(line, target.indent));
  }

  // Clean empty leading/trailing
  while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
  while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();

  const text = bodyLines.length ? bodyLines.join('\n') : target.indent;

  // IDEA Unwrap: for try, also drop trailing catch / finally clauses.
  let endLine = target.closeBraceLine;
  let endCharacter = lines[target.closeBraceLine]?.length ?? 0;
  const header = lines[target.headerLine] ?? '';
  if (/\btry\b/.test(header)) {
    const extended = extendPastCatchFinally(lines, target.closeBraceLine);
    endLine = extended.endLine;
    endCharacter = extended.endCharacter;
  }

  return {
    startLine: target.headerLine,
    startCharacter: 0,
    endLine,
    endCharacter,
    text,
    cursorLine: target.headerLine,
    cursorCharacter: target.indent.length,
  };
}

/** Expand end past contiguous catch/finally blocks after a try. */
function extendPastCatchFinally(
  lines: string[],
  closeBraceLine: number,
): { endLine: number; endCharacter: number } {
  let endLine = closeBraceLine;
  let endCharacter = lines[closeBraceLine]?.length ?? 0;
  let scanLine = closeBraceLine;

  while (scanLine < lines.length) {
    const line = lines[scanLine];
    const fromCol = scanLine === closeBraceLine
      ? Math.max(0, line.indexOf('}') + 1)
      : 0;
    const slice = line.slice(fromCol);
    const hasClause = /\b(?:catch|finally)\b/.test(slice);
    if (!hasClause) {
      if (!line.trim() && scanLine > closeBraceLine) {
        scanLine++;
        continue;
      }
      if (scanLine === closeBraceLine) {
        scanLine++;
        continue;
      }
      break;
    }

    let openLine = scanLine;
    let openCol = -1;
    for (let k = scanLine; k <= Math.min(lines.length - 1, scanLine + 3); k++) {
      const start = k === scanLine ? fromCol : 0;
      const idx = lines[k].indexOf('{', start);
      if (idx >= 0) {
        openLine = k;
        openCol = idx;
        break;
      }
    }
    if (openCol < 0) {
      break;
    }
    const close = findMatchingBrace(lines, openLine, openCol);
    if (!close) {
      break;
    }
    endLine = close.line;
    endCharacter = lines[close.line]?.length ?? close.col + 1;
    // Next clause may start on the same line after `}`
    const trailing = lines[close.line].slice(close.col + 1);
    if (/\b(?:catch|finally)\b/.test(trailing)) {
      scanLine = close.line;
      closeBraceLine = close.line;
      continue;
    }
    scanLine = close.line + 1;
    closeBraceLine = close.line;
  }

  return { endLine, endCharacter };
}

function dedentOne(line: string, baseIndent: string): string {
  if (!line.trim()) return '';
  // Remove one tab or 2-4 spaces beyond baseIndent
  if (line.startsWith(baseIndent + '\t')) {
    return baseIndent + line.slice(baseIndent.length + 1);
  }
  if (line.startsWith(baseIndent + '    ')) {
    return baseIndent + line.slice(baseIndent.length + 4);
  }
  if (line.startsWith(baseIndent + '  ')) {
    return baseIndent + line.slice(baseIndent.length + 2);
  }
  if (line.startsWith(baseIndent)) {
    return line;
  }
  return line.replace(/^\s+/, baseIndent);
}
