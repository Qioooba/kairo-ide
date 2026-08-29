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
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { injectable, inject } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import {
  WEB_XML_RE,
  findWebXmlClassReferences,
  isInsideXmlElement,
  isJavaClassName,
  resolveWorkspaceJavaClass,
} from './workspace-layout';

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
          if (!isInsideXmlElement(model, position, 'servlet-class')) return [];
          return resolveWorkspaceJavaClass(this.fileService, this.workspaceService, className, token);
        },
      }),
      // Reference: Java Servlet class → web.xml entries
      monaco.languages.registerReferenceProvider('java', {
        provideReferences: async (model, position, _context, token) => {
          if (token.isCancellationRequested) return [];
          const className = guessJavaClassName(model, position);
          if (!className) return [];
          return findWebXmlClassReferences(this.fileService, this.workspaceService, className, token);
        },
      }),
    );
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this.subs = [];
  }
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
