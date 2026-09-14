/**
 * JSP Page Model — whole-page semantic analysis, static include DAG,
 * and unified virtual Java compilation unit generation (F16 / T40 ~ T43).
 */

import { JspJavaParser, type JavaBlock } from './jsp-java-nav';
import { JspSourceMap, type SourceSpan } from './jsp-sourcemap';

export interface JspIncludeDirective {
  file: string;
  startOffset: number;
  endOffset: number;
}

export interface JspParsedPage {
  uri: string;
  content: string;
  imports: string[];
  includes: JspIncludeDirective[];
  declarations: JavaBlock[];
  bodyBlocks: JavaBlock[]; // scriptlet and expression in source order
}

export type JspIncludeResolver = (
  includePath: string,
  parentUri: string,
) => Promise<string | undefined> | string | undefined;

export interface PageVirtualJavaResult {
  virtualJava: string;
  sourceMap: JspSourceMap;
  virtualUri: string;
  primaryUri: string;
}

export class JspPageModelBuilder {
  private readonly parser = new JspJavaParser();

  /**
   * Parse a single JSP document into its constituent directives, declarations, and scriptlets.
   */
  parsePage(uri: string, content: string): JspParsedPage {
    const imports: string[] = [];
    const includes: JspIncludeDirective[] = [];
    const declarations: JavaBlock[] = [];
    const bodyBlocks: JavaBlock[] = [];

    // 1. Parse import directives: <%@ page ... import="pkg.A, pkg.B" %>
    const importRegex = /<%@\s+page\s+[^%]*\bimport\s*=\s*["']([^"']*)["'][^%]*%>/gi;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const classList = match[1].split(',');
      for (const item of classList) {
        const trimmed = item.trim();
        if (trimmed && !imports.includes(trimmed)) {
          imports.push(trimmed);
        }
      }
    }

    // 2. Parse include directives: <%@ include file="relative/path.jsp" %>
    const includeRegex = /<%@\s+include\s+file\s*=\s*["']([^"']+)["'][^%]*%>/gi;
    while ((match = includeRegex.exec(content)) !== null) {
      includes.push({
        file: match[1].trim(),
        startOffset: match.index,
        endOffset: match.index + match[0].length,
      });
    }

    // 3. Parse Java blocks (<%! %>, <% %>, <%= %>)
    const blocks = this.parser.findJavaBlocks(content);
    for (const b of blocks) {
      if (b.kind === 'declaration') {
        declarations.push(b);
      } else if (b.kind === 'scriptlet' || b.kind === 'expression') {
        bodyBlocks.push(b);
      }
    }

    return {
      uri,
      content,
      imports,
      includes,
      declarations,
      bodyBlocks,
    };
  }

  /**
   * Resolve static includes recursively with cycle detection (DAG) (T41).
   */
  async resolveIncludeTree(
    rootUri: string,
    rootContent: string,
    resolver?: JspIncludeResolver,
  ): Promise<JspParsedPage[]> {
    const callStack = new Set<string>();
    const pages: JspParsedPage[] = [];

    const traverse = async (uri: string, content: string) => {
      if (callStack.has(uri)) {
        // Cycle detected: safely stop traversing to prevent infinite recursion (T41)
        return;
      }
      callStack.add(uri);
      try {
        const parsed = this.parsePage(uri, content);
        pages.push(parsed);

        if (!resolver || parsed.includes.length === 0) {
          return;
        }

        for (const inc of parsed.includes) {
          try {
            const incContent = await resolver(inc.file, uri);
            if (typeof incContent === 'string') {
              const childUri = this.resolveRelativeUri(uri, inc.file);
              await traverse(childUri, incContent);
            }
          } catch {
            // Ignore unresolvable includes in language tooling
          }
        }
      } finally {
        callStack.delete(uri);
      }
    };

    await traverse(rootUri, rootContent);
    return pages;
  }

  private resolveRelativeUri(parentUri: string, relativePath: string): string {
    const cleanPath = relativePath.replace(/\\/g, '/');
    try {
      return new URL(cleanPath, parentUri).toString();
    } catch {
      if (cleanPath.startsWith('/')) {
        const idx = parentUri.lastIndexOf('//');
        const rootPrefix = idx >= 0 ? parentUri.slice(0, parentUri.indexOf('/', idx + 2)) : '';
        return `${rootPrefix}${cleanPath}`;
      }
      const lastSlash = parentUri.lastIndexOf('/');
      if (lastSlash >= 0) {
        return `${parentUri.slice(0, lastSlash + 1)}${cleanPath}`;
      }
      return `${parentUri}/${cleanPath}`;
    }
  }

  /**
   * Build unified whole-page virtual Java compilation unit and SourceMap.
   *
   * Solves:
   * - F16 / T40: Inter-block variable sharing inside `_jspService`
   * - T41: Page declarations and static include methods visible across the page
   * - T42: SourceMap dual-directional mapping
   */
  async buildPageVirtualJava(
    rootUri: string,
    rootContent: string,
    resolver?: JspIncludeResolver,
  ): Promise<PageVirtualJavaResult> {
    const pages = await this.resolveIncludeTree(rootUri, rootContent, resolver);
    const sourceMap = new JspSourceMap();

    const lines: string[] = [];
    let currentLine = 0;
    let currentOffset = 0;

    const emitLine = (text: string) => {
      lines.push(text);
      currentLine++;
      currentOffset += text.length + 1; // +1 for newline
    };

    // Header: Package and standard imports
    emitLine('package org.apache.jsp;');
    emitLine('');
    emitLine('import javax.servlet.*;');
    emitLine('import javax.servlet.http.*;');
    emitLine('import javax.servlet.jsp.*;');

    // Page-level user imports (from main and included files)
    const allImports = new Set<string>();
    for (const page of pages) {
      for (const imp of page.imports) {
        allImports.add(imp);
      }
    }
    for (const imp of allImports) {
      emitLine(`import ${imp};`);
    }

    emitLine('');
    emitLine('public final class _JspPage {');

    // Class-level declarations (<%! ... %>) from all included pages
    for (const page of pages) {
      for (const decl of page.declarations) {
        const rawContent = page.content.slice(decl.start, decl.end);
        const sourceStart = this.parser.offsetToPosition(page.content, decl.start);
        const sourceEnd = this.parser.offsetToPosition(page.content, decl.end);

        const vStartLine = currentLine;
        const vStartCol = 4; // indentation
        const vStartOffset = currentOffset + vStartCol;

        // Emit declaration block
        const declLines = rawContent.split('\n');
        for (let i = 0; i < declLines.length; i++) {
          emitLine(`    ${declLines[i]}`);
        }

        const vEndLine = currentLine - 1;
        const vEndCol = declLines[declLines.length - 1].length + 4;
        const vEndOffset = currentOffset - 1;

        sourceMap.addSpan({
          sourceUri: page.uri,
          sourceStartLine: sourceStart.line,
          sourceStartCol: sourceStart.character,
          sourceStartOffset: decl.start,
          sourceEndLine: sourceEnd.line,
          sourceEndCol: sourceEnd.character,
          sourceEndOffset: decl.end,
          virtualStartLine: vStartLine,
          virtualStartCol: vStartCol,
          virtualStartOffset: vStartOffset,
          virtualEndLine: vEndLine,
          virtualEndCol: vEndCol,
          virtualEndOffset: vEndOffset,
          kind: 'declaration',
        });
      }
    }

    // Method body: _jspService containing all implicit variables and sequential scriptlets/expressions
    emitLine('');
    emitLine('    public void _jspService(');
    emitLine('        final javax.servlet.http.HttpServletRequest request,');
    emitLine('        final javax.servlet.http.HttpServletResponse response');
    emitLine('    ) throws java.lang.Throwable {');
    emitLine('        final javax.servlet.jsp.PageContext pageContext = null;');
    emitLine('        javax.servlet.http.HttpSession session = null;');
    emitLine('        final javax.servlet.ServletContext application = null;');
    emitLine('        final javax.servlet.ServletConfig config = null;');
    emitLine('        javax.servlet.jsp.JspWriter out = null;');
    emitLine('        final java.lang.Object page = this;');
    emitLine('        final java.lang.Throwable exception = null;');
    emitLine('');

    let exprCounter = 0;

    // Sequential scriptlets and expressions from all included pages in order
    for (const page of pages) {
      for (const block of page.bodyBlocks) {
        const rawContent = page.content.slice(block.start, block.end);
        const sourceStart = this.parser.offsetToPosition(page.content, block.start);
        const sourceEnd = this.parser.offsetToPosition(page.content, block.end);

        const vStartLine = currentLine;
        const vStartCol = 8; // method body indentation
        const vStartOffset = currentOffset + vStartCol;

        if (block.kind === 'expression') {
          exprCounter++;
          const prefix = `Object __expr_${exprCounter} = `;
          // Clean trailing semicolon/whitespace for expression wrapping
          const cleaned = rawContent.replace(/;?\s*$/, '');
          const exprLines = cleaned.split('\n');

          emitLine(`        ${prefix}${exprLines[0]}`);
          for (let i = 1; i < exprLines.length; i++) {
            emitLine(`        ${exprLines[i]}`);
          }
          // Terminate expression statement
          lines[lines.length - 1] += ';';

          const vEndLine = currentLine - 1;
          const lastLineLen = exprLines[exprLines.length - 1].length;
          const vEndCol = 8 + (exprLines.length === 1 ? prefix.length : 0) + lastLineLen;

          sourceMap.addSpan({
            sourceUri: page.uri,
            sourceStartLine: sourceStart.line,
            sourceStartCol: sourceStart.character,
            sourceStartOffset: block.start,
            sourceEndLine: sourceEnd.line,
            sourceEndCol: sourceEnd.character,
            sourceEndOffset: block.end,
            virtualStartLine: vStartLine,
            virtualStartCol: vStartCol,
            virtualStartOffset: vStartOffset,
            virtualEndLine: vEndLine,
            virtualEndCol: vEndCol,
            virtualEndOffset: currentOffset,
            kind: 'expression',
            prefixLength: prefix.length,
          });
        } else {
          // Scriptlet (<% ... %>)
          const scriptletLines = rawContent.split('\n');
          for (let i = 0; i < scriptletLines.length; i++) {
            emitLine(`        ${scriptletLines[i]}`);
          }

          const vEndLine = currentLine - 1;
          const vEndCol = 8 + scriptletLines[scriptletLines.length - 1].length;

          sourceMap.addSpan({
            sourceUri: page.uri,
            sourceStartLine: sourceStart.line,
            sourceStartCol: sourceStart.character,
            sourceStartOffset: block.start,
            sourceEndLine: sourceEnd.line,
            sourceEndCol: sourceEnd.character,
            sourceEndOffset: block.end,
            virtualStartLine: vStartLine,
            virtualStartCol: vStartCol,
            virtualStartOffset: vStartOffset,
            virtualEndLine: vEndLine,
            virtualEndCol: vEndCol,
            virtualEndOffset: currentOffset,
            kind: 'scriptlet',
          });
        }
      }
    }

    emitLine('    }');
    emitLine('}');

    const virtualJava = lines.join('\n');
    const virtualUri = `jsp-scriptlet://${rootUri}#page`;

    return {
      virtualJava,
      sourceMap,
      virtualUri,
      primaryUri: rootUri,
    };
  }
}

export interface JspTextEdit {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  newText: string;
}

/**
 * Convert completion additionalTextEdits targeting virtual Java into safe JSP page import directives (T43).
 *
 * Drops any non-import edits (preventing corrupting the JSP with synthetic wrapper code).
 * Deduplicates against imports already present in the JSP.
 */
export function convertAdditionalTextEditsToJsp(
  jspContent: string,
  additionalTextEdits?: Array<{ range?: any; newText: string }>,
): JspTextEdit[] {
  if (!additionalTextEdits || additionalTextEdits.length === 0) {
    return [];
  }

  const results: JspTextEdit[] = [];
  // Parse already present imports in the JSP
  const existingImports = new Set<string>();
  const importAttrRegex = /<%@\s+page\s+[^%]*\bimport\s*=\s*["']([^"']*)["'][^%]*%>/gi;
  let match: RegExpExecArray | null;
  while ((match = importAttrRegex.exec(jspContent)) !== null) {
    for (const item of match[1].split(',')) {
      const fqn = item.trim();
      if (fqn) {
        existingImports.add(fqn);
      }
    }
  }

  for (const edit of additionalTextEdits) {
    if (!edit.newText) continue;
    // Extract Java import statement: e.g. "import java.util.ArrayList;\n"
    const javaImportMatch = /(?:^|\n)\s*import\s+([a-zA-Z0-9_$.*]+)\s*;/g;
    let impMatch: RegExpExecArray | null;
    while ((impMatch = javaImportMatch.exec(edit.newText)) !== null) {
      const fqn = impMatch[1].trim();
      if (!fqn || existingImports.has(fqn)) {
        continue;
      }
      existingImports.add(fqn);

      // Create a clean JSP directive edit to insert at the top of the document (Line 1, Col 1)
      results.push({
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        },
        newText: `<%@ page import="${fqn}" %>\n`,
      });
    }
  }

  return results;
}
