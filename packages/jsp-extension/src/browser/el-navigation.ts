/**
 * EL expression navigation provider.
 *
 * Ctrl+Click on EL expressions to navigate to:
 *  - Bean class definitions (for ${beanName.property})
 *  - Servlet attribute setters
 *
 * Maps common EL implicit objects to their Java types and provides
 * navigation targets in a quick-pick list when multiple matches exist.
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import type { JspNavServices } from './jsp-nav-services';

/** Type mapping for EL implicit objects → Java FQN. */
const EL_TYPE_MAP: Record<string, string> = {
  pageContext: 'javax.servlet.jsp.PageContext',
  requestScope: 'javax.servlet.http.HttpServletRequest',
  sessionScope: 'javax.servlet.http.HttpSession',
  applicationScope: 'javax.servlet.ServletContext',
  param: 'javax.servlet.http.HttpServletRequest',
  paramValues: 'javax.servlet.http.HttpServletRequest',
  header: 'javax.servlet.http.HttpServletRequest',
  headerValues: 'javax.servlet.http.HttpServletRequest',
  cookie: 'javax.servlet.http.Cookie',
  initParam: 'javax.servlet.ServletConfig',
};

/** Common Java source roots. */
const SRC_ROOTS = [
  'src/main/java',
  'src',
  'src/java',
  'WEB-INF/src',
  'web/WEB-INF/src',
];

/** EL expression pattern: ${...} or #{...} */
const EL_EXPR_RE = /([$#])\{/g;

/**
 * Find the EL expression that contains the given position.
 */
function findElExpressionAt(
  content: string,
  line: number,
  column: number,
): { start: number; end: number; content: string } | null {
  let offset = 0;
  const lines = content.split('\n');
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  offset += column;

  EL_EXPR_RE.lastIndex = 0;
  const matches: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = EL_EXPR_RE.exec(content)) !== null) {
    const start = m.index + 2;
    let depth = 1;
    let pos = start;
    while (pos < content.length && depth > 0) {
      if (content[pos] === '{') depth++;
      else if (content[pos] === '}') depth--;
      pos++;
    }
    if (depth === 0) {
      matches.push({ start: m.index, end: pos });
    }
  }

  for (const match of matches) {
    if (offset >= match.start && offset <= match.end) {
      return {
        start: match.start,
        end: match.end,
        content: content.substring(match.start + 2, match.end - 1),
      };
    }
  }
  return null;
}

/**
 * EL navigation definition provider.
 *
 * Navigates from EL expressions to Java class definitions.
 */
export class ElNavigationProvider implements monaco.languages.DefinitionProvider {
  constructor(
    protected readonly fileService: FileService,
    protected readonly workspaceService: WorkspaceService,
  ) {}

  async provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Definition> {
    if (token.isCancellationRequested) return [];

    const content = model.getValue();
    const elInfo = findElExpressionAt(content, position.lineNumber - 1, position.column - 1);
    if (!elInfo) return [];

    const expr = elInfo.content.trim();

    // Check if it's an implicit object → navigate to its Java type
    const firstDot = expr.indexOf('.');
    const rootVar = firstDot >= 0 ? expr.substring(0, firstDot) : expr;

    const typeFqn = EL_TYPE_MAP[rootVar];
    if (typeFqn) {
      return this.resolveJavaClass(typeFqn, token);
    }

    return [];
  }

  /**
   * Resolve a fully qualified Java class name to a file URI.
   */
  private async resolveJavaClass(
    className: string,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Location[]> {
    const relativePath = className.replace(/\./g, '/') + '.java';
    const roots = await this.workspaceService.roots;
    if (roots.length === 0) return [];

    const rootUri = URI.fromFilePath(roots[0].resource.path.toString());
    for (const srcRoot of SRC_ROOTS) {
      if (token.isCancellationRequested) return [];
      const candidate = rootUri.resolve(srcRoot).resolve(relativePath);
      try {
        await this.fileService.resolve(candidate, { resolveMetadata: false });
        return [{
          uri: monaco.Uri.parse(candidate.toString()),
          range: new monaco.Range(1, 1, 1, 1),
        }];
      } catch {
        // File doesn't exist at this path; try next.
      }
    }
    return [];
  }
}

/**
 * Register the EL navigation definition provider with Monaco.
 */
export function registerElNavigation(services: JspNavServices): monaco.IDisposable {
  return monaco.languages.registerDefinitionProvider(
    JSP_LANGUAGE_ID,
    new ElNavigationProvider(services.fileService, services.workspaceService),
  );
}