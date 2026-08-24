/**
 * Invalidates per-URI encoding cache when files change on disk
 * outside the editor (BD-P1-7).
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FileChangesEvent } from '@theia/filesystem/lib/common/files';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { Disposable } from '@theia/core/lib/common/disposable';
import { KairoEncodingServiceImpl } from './encoding-service';

/**
 * N-056: FileChangeType is a `const enum` in @theia/filesystem — it has
 * NO runtime object. Referencing `FileChangeType.UPDATED` at runtime
 * reads `.UPDATED` on `undefined` and throws for every file event
 * ("Cannot read properties of undefined (reading 'UPDATED')").
 * Inline the declared numeric values instead
 * (files.d.ts: UPDATED = 0, ADDED = 1, DELETED = 2).
 */
const FILE_CHANGE_UPDATED = 0;
const FILE_CHANGE_ADDED = 1;

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
      if (change.type === FILE_CHANGE_UPDATED || change.type === FILE_CHANGE_ADDED) {
        this.encodingSvc.invalidateEncodingCache(change.resource);
      }
    }
  }

  dispose(): void {
    this.fileListener?.dispose();
    this.fileListener = undefined;
  }
}
