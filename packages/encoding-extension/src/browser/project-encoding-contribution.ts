/**
 * Applies the active project's default encoding as a
 * folder-level override (KAIRO-RC-WEB-206).
 *
 * The import wizard stores an encoding per project (e.g. GBK
 * for legacy Chinese apps), but nothing applied it: files
 * opened with the workspace default (UTF-8) and GBK bytes
 * rendered as mojibake. When the active project changes, we
 * register an EncodingRegistry override whose parent is the
 * project root, so every file under it opens with the project
 * encoding unless the user set a more specific per-file
 * override via "Reopen with Encoding".
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ActiveProjectService, ProjectInfo } from '@kairo/project-extension';
import { KairoEncodingServiceImpl } from './encoding-service';

/**
 * Normalize a project root to a file-scheme Theia URI. The agent
 * reports roots as bare paths ('/srv/app' or 'D:\\legacy\\app');
 * `new URI(barePath)` produces a SCHEME-LESS uri whose override
 * never matches the file:// resources the FileService reads, so
 * the project encoding silently did nothing (KAIRO-RC-WEB-206).
 */
export function toProjectRootUri(root: string): URI {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(root)) {
    return new URI(root);
  }
  return FileUri.create(root);
}

@injectable()
export class KairoProjectEncodingContribution implements FrontendApplicationContribution {
  @inject(ActiveProjectService) protected readonly activeProject!: ActiveProjectService;
  @inject(KairoEncodingServiceImpl) protected readonly encodingSvc!: KairoEncodingServiceImpl;

  onStart(): void {
    this.activeProject.onDidChangeProject(p => this.apply(p));
    this.apply(this.activeProject.project);
  }

  protected apply(p: ProjectInfo | undefined): void {
    if (!p?.root) return;
    const rootUri = toProjectRootUri(p.root);
    if (p.encoding) {
      try {
        this.encodingSvc.applyProjectEncoding(rootUri, p.encoding);
      } catch (err) {
        console.warn('[kairo] failed to apply project encoding', err);
      }
    }
    if (p.directoryEncodingOverrides && Object.keys(p.directoryEncodingOverrides).length > 0) {
      try {
        this.encodingSvc.applyDirectoryEncodingOverrides(rootUri, p.directoryEncodingOverrides);
      } catch (err) {
        console.warn('[kairo] failed to apply directory encoding overrides', err);
      }
    }
  }
}
