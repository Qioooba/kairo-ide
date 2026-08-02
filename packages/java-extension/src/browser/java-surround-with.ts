// SPDX-License-Identifier: Apache-2.0
//
// IDEA-like Surround With (Ctrl+Alt+T) — wrap the current
// selection (or line) with a control-structure / expression template.
// Builds Monaco/IDEA-style snippet strings with tabstops.

export interface SurroundTemplate {
  id: string;
  label: string;
  detail: string;
  /**
   * Build a snippet replacement.
   * Selection is already snippet-escaped.
   * Use ${1:name} tabstops; $0 final caret.
   */
  build: (selection: string, indent: string) => string;
  /** Prefer snippet insertion (default true). */
  asSnippet?: boolean;
}

function escapeSnippet(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
}

function indentBlock(selection: string, indent: string, extra = '\t'): string {
  const body = selection.replace(/\s+$/, '');
  if (!body) {
    return indent + extra + '$0';
  }
  return body
    .split('\n')
    .map(line => (line.trim().length === 0 ? '' : indent + extra + line.replace(/^\s*/, '')))
    .join('\n');
}

export const SURROUND_TEMPLATES: SurroundTemplate[] = [
  {
    id: 'if',
    label: 'if',
    detail: 'Surround with if',
    build: (sel, indent) => `${indent}if (\${1:condition}) {\n${indentBlock(sel, indent)}\n${indent}}`,
  },
  {
    id: 'ifelse',
    label: 'if / else',
    detail: 'Surround with if-else',
    build: (sel, indent) =>
      `${indent}if (\${1:condition}) {\n${indentBlock(sel, indent)}\n${indent}} else {\n${indent}\t\${2}\n${indent}}`,
  },
  {
    id: 'ifnot',
    label: 'if (!…)',
    detail: 'Surround with negated if',
    build: (sel, indent) => `${indent}if (!\${1:condition}) {\n${indentBlock(sel, indent)}\n${indent}}`,
  },
  {
    id: 'while',
    label: 'while',
    detail: 'Surround with while',
    build: (sel, indent) => `${indent}while (\${1:condition}) {\n${indentBlock(sel, indent)}\n${indent}}`,
  },
  {
    id: 'dowhile',
    label: 'do / while',
    detail: 'Surround with do-while',
    build: (sel, indent) =>
      `${indent}do {\n${indentBlock(sel, indent)}\n${indent}} while (\${1:condition});`,
  },
  {
    id: 'for',
    label: 'for',
    detail: 'Surround with for',
    build: (sel, indent) =>
      `${indent}for (int \${1:i} = 0; \${1:i} < \${2:max}; \${1:i}++) {\n${indentBlock(sel, indent)}\n${indent}}`,
  },
  {
    id: 'foreach',
    label: 'for-each',
    detail: 'Surround with enhanced for',
    build: (sel, indent) =>
      `${indent}for (\${1:Type} \${2:item} : \${3:collection}) {\n${indentBlock(sel, indent)}\n${indent}}`,
  },
  {
    id: 'try',
    label: 'try / catch',
    detail: 'Surround with try-catch',
    build: (sel, indent) =>
      `${indent}try {\n${indentBlock(sel, indent)}\n${indent}} catch (\${1:Exception} \${2:e}) {\n${indent}\t\${2:e}.printStackTrace();\n${indent}}`,
  },
  {
    id: 'trycf',
    label: 'try / catch / finally',
    detail: 'Surround with try-catch-finally',
    build: (sel, indent) =>
      `${indent}try {\n${indentBlock(sel, indent)}\n${indent}} catch (\${1:Exception} \${2:e}) {\n${indent}\t\${2:e}.printStackTrace();\n${indent}} finally {\n${indent}\t\${3}\n${indent}}`,
  },
  {
    id: 'tryf',
    label: 'try / finally',
    detail: 'Surround with try-finally',
    build: (sel, indent) =>
      `${indent}try {\n${indentBlock(sel, indent)}\n${indent}} finally {\n${indent}\t\${1}\n${indent}}`,
  },
  {
    id: 'trywr',
    label: 'try-with-resources',
    detail: 'Surround with try-with-resources',
    build: (sel, indent) =>
      `${indent}try (\${1:AutoCloseable} \${2:resource} = \${3:expr}) {\n${indentBlock(sel, indent)}\n${indent}} catch (\${4:Exception} \${5:e}) {\n${indent}\t\${5:e}.printStackTrace();\n${indent}}`,
  },
  {
    id: 'synchronized',
    label: 'synchronized',
    detail: 'Surround with synchronized',
    build: (sel, indent) =>
      `${indent}synchronized (\${1:lock}) {\n${indentBlock(sel, indent)}\n${indent}}`,
  },
  {
    id: 'block',
    label: '{ }',
    detail: 'Surround with code block',
    build: (sel, indent) => `${indent}{\n${indentBlock(sel, indent)}\n${indent}}`,
  },
  {
    id: 'parens',
    label: '( )',
    detail: 'Surround with parentheses',
    build: (sel, indent) => {
      const inner = sel.trim();
      return inner ? `${indent}(${inner})` : `${indent}(\${1:expr})`;
    },
  },
  {
    id: 'not',
    label: '!( )',
    detail: 'Surround with negation',
    build: (sel, indent) => {
      const inner = sel.trim();
      return inner ? `${indent}!(${inner})` : `${indent}!(\${1:expr})`;
    },
  },
  {
    id: 'notnull',
    label: 'Objects.requireNonNull',
    detail: 'Surround with requireNonNull',
    build: (sel, indent) => {
      const inner = sel.trim();
      return inner
        ? `${indent}Objects.requireNonNull(${inner})`
        : `${indent}Objects.requireNonNull(\${1:expr})`;
    },
  },
  {
    id: 'optional',
    label: 'Optional.ofNullable',
    detail: 'Surround with Optional.ofNullable',
    build: (sel, indent) => {
      const inner = sel.trim();
      return inner
        ? `${indent}Optional.ofNullable(${inner})`
        : `${indent}Optional.ofNullable(\${1:expr})`;
    },
  },
  {
    id: 'runnable',
    label: 'Runnable',
    detail: 'Surround with Runnable',
    build: (sel, indent) =>
      `${indent}new Runnable() {\n${indent}\t@Override\n${indent}\tpublic void run() {\n${indentBlock(sel, indent, '\t\t')}\n${indent}\t}\n${indent}}`,
  },
  {
    id: 'callable',
    label: 'Callable',
    detail: 'Surround with Callable',
    build: (sel, indent) =>
      `${indent}new java.util.concurrent.Callable<\${1:Object}>() {\n${indent}\t@Override\n${indent}\tpublic \${1:Object} call() throws Exception {\n${indentBlock(sel, indent, '\t\t')}\n${indent}\t\treturn null;\n${indent}\t}\n${indent}}`,
  },
];

export interface SurroundSelection {
  lines: string[];
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface SurroundEdit {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  /** Snippet text (with tabstops). */
  text: string;
  asSnippet: boolean;
}

/** Expand empty selection to the whole current line. */
export function resolveSurroundSelection(sel: SurroundSelection): {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  text: string;
  indent: string;
} {
  const { lines, startLine, startCharacter, endLine, endCharacter } = sel;
  const empty = startLine === endLine && startCharacter === endCharacter;

  if (empty) {
    const line = lines[startLine] ?? '';
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return {
      startLine,
      startCharacter: 0,
      endLine,
      endCharacter: line.length,
      text: line.replace(/\s+$/, ''),
      indent,
    };
  }

  const parts: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i] ?? '';
    if (i === startLine && i === endLine) {
      parts.push(line.slice(startCharacter, endCharacter));
    } else if (i === startLine) {
      parts.push(line.slice(startCharacter));
    } else if (i === endLine) {
      parts.push(line.slice(0, endCharacter));
    } else {
      parts.push(line);
    }
  }
  const text = parts.join('\n');
  const firstLine = lines[startLine] ?? '';
  const indent = firstLine.match(/^\s*/)?.[0] ?? '';
  return {
    startLine,
    startCharacter,
    endLine,
    endCharacter,
    text,
    indent: startCharacter === 0 ? indent : (lines[startLine]?.match(/^\s*/)?.[0] ?? ''),
  };
}

export function computeSurroundEdit(
  sel: SurroundSelection,
  template: SurroundTemplate,
): SurroundEdit {
  const resolved = resolveSurroundSelection(sel);
  let startCharacter = resolved.startCharacter;
  let endCharacter = resolved.endCharacter;
  let text = resolved.text;
  let indent = resolved.indent;

  const wholeLines =
    (sel.startLine !== sel.endLine || sel.startCharacter !== sel.endCharacter) &&
    sel.startCharacter === 0;

  if (wholeLines || (sel.startLine === sel.endLine && sel.startCharacter === sel.endCharacter)) {
    startCharacter = 0;
    endCharacter = sel.lines[resolved.endLine]?.length ?? endCharacter;
    const slice = sel.lines
      .slice(resolved.startLine, resolved.endLine + 1)
      .map((l, idx, arr) => (idx === arr.length - 1 ? l.replace(/\s+$/, '') : l))
      .join('\n');
    text = slice;
    indent = (sel.lines[resolved.startLine] ?? '').match(/^\s*/)?.[0] ?? '';
  }

  const escaped = escapeSnippet(text);
  const built = template.build(escaped, indent);
  return {
    startLine: resolved.startLine,
    startCharacter,
    endLine: resolved.endLine,
    endCharacter,
    text: built,
    asSnippet: template.asSnippet !== false,
  };
}

export function findSurroundTemplate(idOrLabel: string): SurroundTemplate | undefined {
  const key = idOrLabel.toLowerCase();
  return SURROUND_TEMPLATES.find(t => t.id === key || t.label.toLowerCase() === key);
}
