// SPDX-License-Identifier: Apache-2.0
//
// IDEA-like Complete Statement (Ctrl+Shift+Enter / Cmd+Shift+Enter).
// Pure, monaco-free heuristics so the logic stays unit-testable.

export interface CompleteStatementInput {
  /** Full document lines (0-based). */
  lines: string[];
  /** 0-based line of the cursor. */
  line: number;
  /** 0-based character offset of the cursor on that line. */
  character: number;
}

export interface CompleteStatementEdit {
  /** 0-based line to replace. */
  line: number;
  /** Replacement text for that line (no trailing newline). */
  text: string;
  /** Optional lines to insert after `line` (each without trailing newline). */
  insertAfter?: string[];
  /** 0-based cursor line after the edit. */
  cursorLine: number;
  /** 0-based cursor character after the edit. */
  cursorCharacter: number;
}

const CONTROL_HEAD =
  /^\s*(?:(?:public|private|protected|static|final|synchronized|native|abstract)\s+)*(?:if|else\s+if|else|for|while|do|try|catch|finally|switch)\b/;

const METHOD_OR_TYPE_HEAD =
  /^\s*(?:(?:public|private|protected|static|final|synchronized|native|abstract|default)\s+)+[\w.<>,\[\]\s]+\s+\w+\s*\([^;]*$/;

const TYPE_DECL_HEAD =
  /^\s*(?:(?:public|private|protected|static|final|abstract|sealed|non-sealed)\s+)*(?:class|interface|enum|record)\s+\w+/;

const NO_SEMICOLON_HEAD =
  /^\s*(?:package|import|module)\b|^\s*@\w+/;

/** Count unmatched openers in a string (ignores simple string/char literals). */
export function unmatchedClosers(text: string): { parens: number; brackets: number; angles: number } {
  let parens = 0;
  let brackets = 0;
  let angles = 0;
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && (inSingle || inDouble)) {
      escape = true;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) {
      continue;
    }
    if (ch === '(') parens++;
    else if (ch === ')') parens = Math.max(0, parens - 1);
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
    else if (ch === '<') angles++;
    else if (ch === '>') angles = Math.max(0, angles - 1);
  }
  return { parens, brackets, angles };
}

function trimRightKeepIndent(line: string): { indent: string; body: string } {
  const indent = line.match(/^\s*/)?.[0] ?? '';
  return { indent, body: line.slice(indent.length).replace(/\s+$/, '') };
}

function looksComplete(body: string): boolean {
  if (!body) return true;
  if (/[;{}]\s*$/.test(body)) return true;
  if (/^\s*\/\//.test(body) || /^\s*\/\*/.test(body)) return true;
  return false;
}

function needsBlockBody(body: string): boolean {
  if (!CONTROL_HEAD.test(body)) {
    return false;
  }
  if (/\{\s*$/.test(body)) {
    return false;
  }
  const { parens } = unmatchedClosers(body);
  // Wait until parentheses are balanced (e.g. `if (x`).
  if (parens > 0) {
    return false;
  }
  return true;
}

/**
 * Compute an IDEA-like Complete Statement edit for the current line.
 * Returns null when the line already looks complete.
 */
export function computeCompleteStatement(input: CompleteStatementInput): CompleteStatementEdit | null {
  const { lines, line, character } = input;
  if (line < 0 || line >= lines.length) {
    return null;
  }
  const original = lines[line];
  const { indent, body: rawBody } = trimRightKeepIndent(original);
  // Prefer completing using text up to EOL (IDEA completes the statement, not only to caret).
  const upToCaret = original.slice(0, Math.min(character, original.length));
  const bodyFromCaret = upToCaret.replace(/^\s+/, '').replace(/\s+$/, '');
  let body = rawBody || bodyFromCaret;
  if (!body) {
    return null;
  }
  if (looksComplete(body) && unmatchedClosers(body).parens === 0 && unmatchedClosers(body).brackets === 0) {
    // Move to next line (IDEA still advances)
    return {
      line,
      text: original.replace(/\s+$/, ''),
      insertAfter: [indent],
      cursorLine: line + 1,
      cursorCharacter: indent.length,
    };
  }

  const closers = unmatchedClosers(body);
  let suffix = '';
  // Don't auto-close outer call parens when completing a lambda arrow into a block.
  const isLambdaArrow = /->\s*$/.test(body);
  if (!isLambdaArrow) {
    suffix += ')'.repeat(closers.parens);
    suffix += ']'.repeat(closers.brackets);
  }
  // Do not auto-close generics `<>` aggressively — often comparison operators.

  let nextBody = body + suffix;

  // `do` → do { } while ();
  if (/^\s*do\b/.test(nextBody) && !/\{\s*$/.test(nextBody) && !/while\s*\(/.test(nextBody)) {
    const lineText = indent + 'do {';
    return {
      line,
      text: lineText,
      insertAfter: [indent + '\t', indent + '} while (condition);'],
      cursorLine: line + 1,
      cursorCharacter: indent.length + 1,
    };
  }

  // class / interface / enum / record → body
  if (TYPE_DECL_HEAD.test(nextBody) && !/\{\s*$/.test(nextBody) && !/;\s*$/.test(nextBody)) {
    const again = unmatchedClosers(nextBody);
    nextBody += ')'.repeat(again.parens); // record components
    const lineText = indent + nextBody.replace(/\s+$/, '') + ' {';
    return {
      line,
      text: lineText,
      insertAfter: [indent + '\t', indent + '}'],
      cursorLine: line + 1,
      cursorCharacter: indent.length + 1,
    };
  }

  // Control structures → open a block
  if (needsBlockBody(nextBody) && !/\{\s*$/.test(nextBody)) {
    const again = unmatchedClosers(nextBody);
    nextBody += ')'.repeat(again.parens);
    nextBody += ']'.repeat(again.brackets);
    const lineText = indent + nextBody.replace(/\s+$/, '') + ' {';
    return {
      line,
      text: lineText,
      insertAfter: [indent + '\t', indent + '}'],
      cursorLine: line + 1,
      cursorCharacter: indent.length + 1,
    };
  }

  // Method / constructor signature without body
  if (METHOD_OR_TYPE_HEAD.test(nextBody) && !/\{\s*$/.test(nextBody) && !/;\s*$/.test(nextBody)) {
    const again = unmatchedClosers(nextBody);
    nextBody += ')'.repeat(again.parens);
    const lineText = indent + nextBody.replace(/\s+$/, '') + ' {';
    return {
      line,
      text: lineText,
      insertAfter: [indent + '\t', indent + '}'],
      cursorLine: line + 1,
      cursorCharacter: indent.length + 1,
    };
  }

  // package / import / annotations — never invent a semicolon mid-annotation
  if (NO_SEMICOLON_HEAD.test(nextBody)) {
    if (/^\s*(?:package|import)\b/.test(nextBody) && !/;\s*$/.test(nextBody)) {
      nextBody = nextBody.replace(/\s+$/, '') + ';';
    }
    const lineText = indent + nextBody;
    return {
      line,
      text: lineText,
      insertAfter: [indent],
      cursorLine: line + 1,
      cursorCharacter: indent.length,
    };
  }

  // Lambda arrow → block body (keep outer call open; user closes later / next Complete Statement)
  if (isLambdaArrow || /->\s*$/.test(nextBody)) {
    const lineText = indent + nextBody.replace(/\s+$/, '') + ' {';
    return {
      line,
      text: lineText,
      insertAfter: [indent + '\t', indent + '}'],
      cursorLine: line + 1,
      cursorCharacter: indent.length + 1,
    };
  }

  // Ordinary statement → semicolon
  if (!/[;{}]\s*$/.test(nextBody)) {
    nextBody = nextBody.replace(/\s+$/, '') + ';';
  }

  const lineText = indent + nextBody;
  return {
    line,
    text: lineText,
    insertAfter: [indent],
    cursorLine: line + 1,
    cursorCharacter: indent.length,
  };
}
