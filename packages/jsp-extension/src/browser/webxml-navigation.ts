/**
 * Bidirectional Servlet mapping navigation.
 *
 * - Ctrl+Click on a servlet-class in web.xml navigates to the
 *   corresponding Java Servlet class file.
 * - Find References on a Java Servlet class navigates back to
 *   the web.xml configuration entries.
 *
 * Registered as a FrontendApplicationContribution so providers
 * are active as soon as the workbench opens.
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { injectable, inject } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { parseWebXml } from './webxml-parser';

/** Common Java source roots in legacy web projects. */
const SRC_ROOTS = [
  'src/main/java',
  'src',
  'src/java',
  'WEB-INF/src',
  'web/WEB-INF/src',
];

/** Common web.xml locations relative to workspace root. */
const WEB_XML_PATHS = [
  'WEB-INF/web.xml',
  'web/WEB-INF/web.xml',
  'webapp/WEB-INF/web.xml',
  'WebContent/WEB-INF/web.xml',
  'src/main/webapp/WEB-INF/web.xml',
];

/** Matches WEB-INF/web.xml in the URI path. */
const WEB_XML_RE = /WEB-INF[/\\]web\.xml$/i;

@injectable()
export class WebXmlNavigationContribution implements FrontendApplicationContribution, Disposable {
  @inject(FileService)
  protected readonly fileService!: FileService;

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService;

  protected subs: Disposable[] = [];

  onStart(): void {
    this.subs.push(
      // Definition: web.xml servlet-class → Java Servlet class
      monaco.languages.registerDefinitionProvider('xml', {
        provideDefinition: async (model, position, token) => {
          if (token.isCancellationRequested) return [];
          if (!WEB_XML_RE.test(model.uri.path)) return [];
          const word = model.getWordAtPosition(position);
          if (!word) return [];
          const className = word.word.trim();
          if (!isJavaClassName(className)) return [];
          // Verify we're inside a <servlet-class> element
          if (!isInsideServletClass(model, position)) return [];
          return this.resolveJavaClass(className, token);
        },
      }),
      // Reference: Java Servlet class → web.xml entries
      monaco.languages.registerReferenceProvider('java', {
        provideReferences: async (model, position, _context, token) => {
          if (token.isCancellationRequested) return [];
          const className = guessJavaClassName(model, position);
          if (!className) return [];
          return this.findWebXmlReferences(className, token);
        },
      }),
    );
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this.subs = [];
  }

  /**
   * Resolve a fully qualified Java class name to a file URI in the
   * workspace. Returns the first matching source file found.
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

  /**
   * Scan workspace web.xml files for references to the given
   * servlet class name.
   */
  private async findWebXmlReferences(
    className: string,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Location[]> {
    const roots = await this.workspaceService.roots;
    if (roots.length === 0) return [];

    const rootUri = URI.fromFilePath(roots[0].resource.path.toString());
    const results: monaco.languages.Location[] = [];

    for (const webXmlPath of WEB_XML_PATHS) {
      if (token.isCancellationRequested) return [];
      const webXmlUri = rootUri.resolve(webXmlPath);
      try {
        const content = await this.fileService.read(webXmlUri, { encoding: 'utf-8' });
        const parsed = parseWebXml(content.value);
        if (!parsed) continue;
        if (parsed.classToServlet[className]) {
          // Find the line number of the servlet-class element
          const line = findLineInContent(content.value, className);
          results.push({
            uri: monaco.Uri.parse(webXmlUri.toString()),
            range: new monaco.Range(line, 1, line, 1),
          });
        }
      } catch {
        // web.xml not found at this path; try next.
      }
    }
    return results;
  }
}

/**
 * Check whether the cursor is inside a <servlet-class> element.
 * Uses a simple scan of the model text around the position.
 */
function isInsideServletClass(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): boolean {
  const text = model.getValue();
  const offset = model.getOffsetAt(position);
  // Scan backwards for the opening tag
  const before = text.substring(0, offset);
  const openIdx = before.lastIndexOf('<servlet-class>');
  if (openIdx === -1) return false;
  const closeIdx = before.lastIndexOf('</servlet-class>');
  // If there's a closing tag between the opening tag and cursor,
  // we're not inside a servlet-class element.
  if (closeIdx > openIdx) return false;
  // Also verify the closing tag is after the cursor
  const after = text.substring(offset);
  const endCloseIdx = after.indexOf('</servlet-class>');
  return endCloseIdx !== -1;
}

/**
 * Check if a string looks like a fully qualified Java class name
 * (e.g. "com.example.MyServlet").
 */
function isJavaClassName(name: string): boolean {
  return /^[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+$/.test(name);
}

/**
 * Guess the fully qualified class name from a Java source file.
 * Scans backwards from the cursor for a package declaration and
 * forwards for the class declaration.
 */
function guessJavaClassName(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): string | undefined {
  const text = model.getValue();
  const word = model.getWordAtPosition(position);
  const className = word?.word?.trim();
  if (!className || !/^[A-Z][\w]*$/.test(className)) return undefined;

  // Find package declaration
  const pkgMatch = text.match(/^\s*package\s+([\w.]+)\s*;/m);
  const pkg = pkgMatch ? pkgMatch[1] : '';

  return pkg ? `${pkg}.${className}` : className;
}

/**
 * Find the 1-based line number of a search string in the content.
 */
function findLineInContent(content: string, search: string): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(search)) {
      return i + 1;
    }
  }
  return 1;
}