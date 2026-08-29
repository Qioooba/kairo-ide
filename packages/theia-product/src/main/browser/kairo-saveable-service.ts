/**
 * KairoSaveableService — surfaces save failures to the user.
 *
 * Stock Theia's SAVE command handler lets a rejected save
 * propagate to the command registry, which only logs to the
 * console: the user presses Cmd+S, nothing happens, and the
 * dirty dot silently stays. For Kairo this is the common path
 * for ENCODING refusals (e.g. an emoji typed into a GBK file
 * is rejected by the validating EncodingService) — a silent
 * refusal is indistinguishable from a successful save at a
 * glance (flow-03 live evidence: bytes correctly unchanged,
 * zero user-visible feedback).
 *
 * This subclass shows an error notification with the failure
 * reason, then rethrows so the model keeps its dirty state.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core/lib/common';
import { FilesystemSaveableService } from '@theia/filesystem/lib/browser/filesystem-saveable-service';
import { Widget } from '@theia/core/lib/browser/widgets/widget';
import { SaveOptions } from '@theia/core/lib/browser/saveable';
import URI from '@theia/core/lib/common/uri';

/**
 * Extends FilesystemSaveableService (not the abstract base) so the
 * stock Save As implementation (canSaveAs + saveAs via file dialog)
 * is preserved — rebinding with the base class disabled Save As
 * product-wide (TC-MENU-005).
 */
@injectable()
export class KairoSaveableService extends FilesystemSaveableService {
  /** Pre-save callbacks invoked before each save operation. */
  static readonly onBeforeSave: Array<(widget: Widget, options?: SaveOptions) => void> = [];

  @inject(MessageService) protected readonly messages!: MessageService;

  override async save(widget: Widget, options?: SaveOptions): Promise<URI | undefined> {
    // P2-GIT-03: fire pre-save hooks before writing to disk
    for (const cb of KairoSaveableService.onBeforeSave) {
      try { cb(widget, options); } catch { /* prevent hook failures from breaking save */ }
    }

    try {
      return await super.save(widget, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.messages.error(`Save failed: ${message}`);
      throw err;
    }
  }
}
