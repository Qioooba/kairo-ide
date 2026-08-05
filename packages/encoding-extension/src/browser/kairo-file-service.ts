/**
 * KairoFileService — surfaces encoding save refusals to the user.
 *
 * MonacoEditorModel.run() swallows save errors with a bare
 * console.error, so a rejected save never rejects the outer
 * promise: no notification, the dirty dot just stays (flow-03
 * live evidence: emoji-in-GBK save correctly blocked at the byte
 * level, but the user saw NOTHING). The failure does pass
 * through FileService.write / FileService.update on its way to
 * the void, so this subclass reports encoding refusals as error
 * notifications and rethrows.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { Readable } from '@theia/core/lib/common/stream';
import { KairoEncodingServiceImpl } from './encoding-service';
import { FileService, WriteTextFileOptions, UpdateTextFileOptions } from '@theia/filesystem/lib/browser/file-service';
import { FileStatWithMetadata } from '@theia/filesystem/lib/common/files';
import type { TextDocumentContentChangeEvent } from '@theia/core/shared/vscode-languageserver-protocol';

export function isEncodingRefusal(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  return !!e && (e.name === 'UnrepresentableEncodingError' || /not representable/.test(e.message || ''));
}

@injectable()
export class KairoFileService extends FileService {
  @inject(MessageService) protected readonly kairoMessages!: MessageService;
  @inject(KairoEncodingServiceImpl) protected readonly encodingSvc!: KairoEncodingServiceImpl;

  protected reportIfEncodingRefusal(err: unknown): void {
    if (isEncodingRefusal(err)) {
      this.kairoMessages.error((err as Error).message);
    }
  }

  override async write(resource: URI, value: string | Readable<string>, options?: WriteTextFileOptions): Promise<FileStatWithMetadata & { encoding: string }> {
    try {
      const stat = await super.write(resource, value, options);
      this.encodingSvc.invalidateEncodingCache(resource);
      return stat;
    } catch (err) {
      this.reportIfEncodingRefusal(err);
      throw err;
    }
  }

  override async update(resource: URI, changes: TextDocumentContentChangeEvent[], options: UpdateTextFileOptions): Promise<FileStatWithMetadata & { encoding: string }> {
    try {
      const stat = await super.update(resource, changes, options);
      this.encodingSvc.invalidateEncodingCache(resource);
      return stat;
    } catch (err) {
      this.reportIfEncodingRefusal(err);
      throw err;
    }
  }
}
