/**
 * Invalidates per-URI encoding cache when files change on disk
 * outside the editor (BD-P1-7).
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FileChangesEvent, FileChangeType } from '@theia/filesystem/lib/common/files';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { Disposable } from '@theia/core/lib/common/disposable';
import { KairoEncodingServiceImpl } from './encoding-service';

@injectable()
export class KairoEncodingCacheContribution implements FrontendApplicationContribution, Disposable {
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(KairoEncodingServiceImpl) protected readonly encodingSvc!: KairoEncodingServiceImpl;

  protected fileListener: Disposable | undefined;

  onStart(): void {
    this.fileListener = this.fileService.onDidFilesChange(event => {
      this.handleFilesChanged(event);
    });
  }

  protected handleFilesChanged(event: FileChangesEvent): void {
    for (const change of event.changes) {
      if (change.type === FileChangeType.UPDATED || change.type === FileChangeType.ADDED) {
        this.encodingSvc.invalidateEncodingCache(change.resource);
      }
    }
  }

  dispose(): void {
    this.fileListener?.dispose();
    this.fileListener = undefined;
  }
}
