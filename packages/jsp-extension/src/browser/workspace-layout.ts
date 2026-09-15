/**
 * Shared workspace-layout knowledge for legacy Java web projects.
 *
 * Legacy Tomcat projects arrange their sources under many different
 * roots (Maven `src/main/java`, Eclipse `src`, old layouts like
 * `WEB-INF/src` or `WebContent/...`). Every JSP/web.xml provider used
 * to carry its own copy of these constants and helpers, and the
 * copies had drifted apart (completion knew 8 source roots while
 * navigation only probed 5). This module is now the single source of
 * truth for:
 *
 *   - candidate Java source roots / web.xml locations / doc roots
 *   - resolving a fully qualified class name to a file URI
 *   - locating + parsing the workspace web.xml
 *   - small XML/JSP text helpers shared by the providers
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { parseWebXml, type WebXml } from './webxml-parser';

/** Common Java source roots in legacy web projects (most canonical first). */
export const JAVA_SRC_ROOTS = [
  'src/main/java',
  'src',
  'src/java',
  'WEB-INF/src',
  'web/WEB-INF/src',
  'webapp/WEB-INF/src',
  'WebContent/WEB-INF/src',
  'src/main/webapp/WEB-INF/src',
];

/** Common web.xml locations relative to workspace root. */
export const WEB_XML_PATHS = [
  'WEB-INF/web.xml',
  'web/WEB-INF/web.xml',
  'webapp/WEB-INF/web.xml',
  'WebContent/WEB-INF/web.xml',
  'src/main/webapp/WEB-INF/web.xml',
];

/** Matches WEB-INF/web.xml in the URI path. */
export const WEB_XML_RE = /WEB-INF[/\\]web\.xml$/i;

/** Common web document roots; '' means the workspace root itself. */
export const WEB_DOC_ROOTS = ['web', 'WebContent', 'webapp', 'src/main/webapp', ''];

/** Default cap for directory walks (guards against huge workspaces). */
export const DEFAULT_MAX_FILES = 10_000;

/**
 * All workspace roots as URIs.
 */
export async function getAllWorkspaceRootUris(
  workspaceService: WorkspaceService,
): Promise<URI[]> {
  const roots = await workspaceService.roots;
  return roots.map(r => URI.fromFilePath(r.resource.path.toString()));
}

/**
 * The first workspace root as a URI, or undefined when no
 * workspace is open.
 */
export async function getWorkspaceRootUri(
  workspaceService: WorkspaceService,
): Promise<URI | undefined> {
  const roots = await workspaceService.roots;
  if (roots.length === 0) return undefined;
  return URI.fromFilePath(roots[0].resource.path.toString());
}

/**
 * Resolve a fully qualified Java class name to a file URI in the
 * workspace. Probes every known source root and returns the first
 * matching `.java` file found.
 */
export async function resolveWorkspaceJavaClass(
  fileService: FileService,
  workspaceService: WorkspaceService,
  className: string,
  token?: monaco.CancellationToken,
): Promise<monaco.languages.Location[]> {
  const rootUri = await getWorkspaceRootUri(workspaceService);
  if (!rootUri) return [];

  const relativePath = className.replace(/\./g, '/') + '.java';
  for (const srcRoot of JAVA_SRC_ROOTS) {
    if (token?.isCancellationRequested) return [];
    const candidate = rootUri.resolve(srcRoot).resolve(relativePath);
    try {
      await fileService.resolve(candidate, { resolveMetadata: false });
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

/** A web.xml found in the workspace, together with its location. */
export interface LoadedWebXml {
  uri: URI;
  webXml: WebXml;
}

/**
 * Load and parse the first web.xml found in the workspace.
 * Returns undefined when no candidate path exists or it does not parse.
 */
export async function loadWorkspaceWebXml(
  fileService: FileService,
  workspaceService: WorkspaceService,
  token?: monaco.CancellationToken,
): Promise<LoadedWebXml | undefined> {
  const rootUri = await getWorkspaceRootUri(workspaceService);
  if (!rootUri) return undefined;

  for (const webXmlPath of WEB_XML_PATHS) {
    if (token?.isCancellationRequested) return undefined;
    const webXmlUri = rootUri.resolve(webXmlPath);
    try {
      const content = await fileService.read(webXmlUri, { encoding: 'utf-8' });
      const parsed = parseWebXml(content.value);
      if (parsed) return { uri: webXmlUri, webXml: parsed };
    } catch {
      // web.xml not found at this path; try next.
    }
  }
  return undefined;
}

/**
 * Scan all candidate web.xml locations for references to the given
 * servlet class name. Returns one location per matching web.xml.
 */
export async function findWebXmlClassReferences(
  fileService: FileService,
  workspaceService: WorkspaceService,
  className: string,
  token?: monaco.CancellationToken,
): Promise<monaco.languages.Location[]> {
  const rootUri = await getWorkspaceRootUri(workspaceService);
  if (!rootUri) return [];

  const results: monaco.languages.Location[] = [];
  for (const webXmlPath of WEB_XML_PATHS) {
    if (token?.isCancellationRequested) break;
    const webXmlUri = rootUri.resolve(webXmlPath);
    try {
      const content = await fileService.read(webXmlUri, { encoding: 'utf-8' });
      const parsed = parseWebXml(content.value);
      if (!parsed) continue;
      if (parsed.classToServlet[className]) {
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

/**
 * Recursively collect files below `root` whose basename matches
 * `matchFile`. Dot directories, `node_modules`, `dist` and `lib`
 * are skipped unless listed in `extraEnterDirs`.
 */
export async function walkWorkspaceFiles(
  fileService: FileService,
  root: URI,
  matchFile: (base: string) => boolean,
  token?: monaco.CancellationToken,
  maxFiles: number = DEFAULT_MAX_FILES,
): Promise<URI[]> {
  const results: URI[] = [];
  await walkDir(fileService, root, matchFile, results, token, maxFiles);
  return results;
}

async function walkDir(
  fileService: FileService,
  uri: URI,
  matchFile: (base: string) => boolean,
  results: URI[],
  token: monaco.CancellationToken | undefined,
  maxFiles: number,
): Promise<void> {
  if (token?.isCancellationRequested || results.length >= maxFiles) return;
  try {
    const stat = await fileService.resolve(uri, { resolveMetadata: false });
    if (!stat.children) return;
    for (const child of stat.children) {
      if (token?.isCancellationRequested || results.length >= maxFiles) return;
      const basename = child.resource.path.base;
      if (child.isDirectory) {
        if (basename.startsWith('.') || basename === 'node_modules' || basename === 'lib' || basename === 'dist' ||
            basename === 'build' || basename === 'target' || basename === 'classes' || basename === 'work' ||
            basename === 'temp' || basename === 'logs' || basename === '.metadata' || basename === '.settings') {
          continue;
        }
        await walkDir(fileService, child.resource, matchFile, results, token, maxFiles);
      } else if (matchFile(basename)) {
        results.push(child.resource);
      }
    }
  } catch {
    // Skip unreadable directories.
  }
}

/**
 * Check if a string looks like a fully qualified Java class name
 * (e.g. "com.example.MyServlet").
 */
export function isJavaClassName(name: string): boolean {
  return /^[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+$/.test(name);
}

/**
 * Find the 1-based line number of a search string in the content.
 */
export function findLineInContent(content: string, search: string): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(search)) {
      return i + 1;
    }
  }
  return 1;
}

/**
 * Check whether the cursor is inside `<elementName>…</elementName>`
 * using a simple scan of the model text around the position.
 */
export function isInsideXmlElement(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  elementName: string,
): boolean {
  const text = model.getValue();
  const offset = model.getOffsetAt(position);
  const before = text.substring(0, offset);
  const openTag = `<${elementName}>`;
  const closeTag = `</${elementName}>`;
  const openIdx = before.lastIndexOf(openTag);
  if (openIdx === -1) return false;
  const closeIdx = before.lastIndexOf(closeTag);
  // If there's a closing tag between the opening tag and cursor,
  // we're not inside the element.
  if (closeIdx > openIdx) return false;
  // Also verify the closing tag is after the cursor.
  const after = text.substring(offset);
  return after.indexOf(closeTag) !== -1;
}
