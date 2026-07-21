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
import { ActiveProjectService, ProjectInfo } from '@kairo/project-extension';
import { KairoEncodingServiceImpl } from './encoding-service';

@injectable()
export class KairoProjectEncodingContribution implements FrontendApplicationContribution {
  @inject(ActiveProjectService) protected readonly activeProject!: ActiveProjectService;
  @inject(KairoEncodingServiceImpl) protected readonly encodingSvc!: KairoEncodingServiceImpl;

  onStart(): void {
    this.activeProject.onDidChangeProject(p => this.apply(p));
    this.apply(this.activeProject.project);
  }

  protected apply(p: ProjectInfo | undefined): void {
    if (p?.encoding && p.root) {
      try {
        this.encodingSvc.applyProjectEncoding(new URI(p.root), p.encoding);
      } catch (err) {
        console.warn('[kairo] failed to apply project encoding', err);
      }
    }
  }
}
