/**
 * Kairo encoding commands — the menu entries that surface
 * the encoding service to the user.
 *
 * Three commands are exposed:
 *   - "Kairo: Reopen with Encoding…" — picks an encoding,
 *     registers the override, and reloads the file by
 *     closing and re-opening it through EditorManager.
 *   - "Kairo: Save with Encoding…" — picks an encoding, runs
 *     a sanity check (canEncode), then writes the current
 *     model through the service. Marks the model as not
 *     dirty afterwards.
 *   - "Kairo: Show File Encoding" — reads the cached /
 *     override value and surfaces it via a notification.
 *
 * All three are wired into the Theia command palette via
 * bindEncodingCommands(); the theia-product loads the
 * contribution on startup.
 */

import { injectable, inject, interfaces } from '@theia/core/shared/inversify';
import { QuickInputService, ApplicationShell } from '@theia/core/lib/browser';
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MessageService,
} from '@theia/core/lib/common';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import URI from '@theia/core/lib/common/uri';
import {
  KairoEncodingServiceImpl,
  KAIRO_ENCODING_OPTIONS,
} from './encoding-service';

export namespace KairoEncodingCommands {
  export const REOPEN_WITH_ENCODING: Command = {
    id: 'kairo.encoding.reopen',
    label: 'Reopen with Encoding…',
    category: 'Kairo',
  };
  export const SAVE_WITH_ENCODING: Command = {
    id: 'kairo.encoding.save',
    label: 'Save with Encoding…',
    category: 'Kairo',
  };
  export const SHOW_ENCODING: Command = {
    id: 'kairo.encoding.show',
    label: 'Show File Encoding',
    category: 'Kairo',
  };
}

@injectable()
export class KairoEncodingCommandsContribution implements CommandContribution {
  @inject(KairoEncodingServiceImpl) protected service!: KairoEncodingServiceImpl;
  @inject(EditorManager) protected editorManager!: EditorManager;
  @inject(QuickInputService) protected quickPick!: QuickInputService;
  @inject(MessageService) protected messages!: MessageService;
  @inject(ApplicationShell) protected shell!: ApplicationShell;

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(KairoEncodingCommands.SHOW_ENCODING, {
      execute: async (uri?: URI | string) => {
        const target = this.normalizeUri(uri) ?? this.currentEditorUri();
        if (!target) {
          this.messages.warn('No file is open.');
          return;
        }
        const enc = this.service.getEncodingFor(target);
        this.messages.info(`${target.toString()}: ${enc}`);
      },
    });

    registry.registerCommand(KairoEncodingCommands.REOPEN_WITH_ENCODING, {
      execute: async (uri?: URI | string) => {
        const target = this.normalizeUri(uri) ?? this.currentEditorUri();
        if (!target) {
          this.messages.warn('Open a file first.');
          return;
        }
        const current = this.service.getEncodingFor(target);
        const picked = await this.pickEncoding(current);
        if (!picked) return;
        if (picked === current) {
          this.messages.info(`Already using ${current}, nothing to do.`);
          return;
        }
        // Register the override BEFORE reading so the
        // subsequent read picks it up. The override is per-URI
        // and survives editor close/reopen.
        this.service.setEncodingFor(target, picked);
        // Close the open editor and re-open so the model
        // reloads from disk with the new encoding override.
        const widget = await this.editorManager.getByUri(target);
        if (widget) widget.close();
        await this.editorManager.open(target);
        this.messages.info(`Reopened ${target.displayName} as ${picked}.`);
      },
    });

    registry.registerCommand(KairoEncodingCommands.SAVE_WITH_ENCODING, {
      execute: async (uri?: URI | string) => {
        const target = this.normalizeUri(uri) ?? this.currentEditorUri();
        if (!target) {
          this.messages.warn('Open a file first.');
          return;
        }
        const widget = await this.editorManager.getByUri(target);
        if (!widget) {
          this.messages.warn(`No open editor for ${target.displayName}.`);
          return;
        }
        const document = widget.editor.document;
        const text = document.getText();
        const current = this.service.getEncodingFor(target);
        const picked = await this.pickEncoding(current);
        if (!picked) return;
        // Validate via Go agent instead of buggy TextEncoder (V-025)
        const validation = await this.service.validateEncoding(text, picked);
        if (!validation.valid) {
          this.messages.error(
            `Cannot save as ${picked}: the document contains characters ` +
              `${picked} cannot represent. ${validation.error || ''} ` +
              `Save refused; choose an encoding that can represent the ` +
              `buffer (utf-8 is always safe).`,
          );
          return;
        }
        try {
          await this.service.writeWithEncoding(target, text, picked);
          this.service.setEncodingFor(target, picked);
          // Mark the document as not dirty without re-saving
          // (we just wrote the bytes ourselves).
          (document as any).setDirty?.(false);
          this.messages.info(`Saved ${target.displayName} as ${picked}.`);
        } catch (err) {
          this.messages.error(`Save with ${picked} failed: ${(err as Error).message}`);
        }
      },
    });
  }

  protected normalizeUri(uri: URI | string | undefined): URI | undefined {
    if (!uri) return undefined;
    if (typeof uri === 'string') return new URI(uri);
    return uri;
  }

  protected currentEditorUri(): URI | undefined {
    const w = this.editorManager.currentEditor;
    if (!w) return undefined;
    const u: unknown = w.editor?.document?.uri;
    if (!u) return undefined;
    if (typeof u === 'string') return new URI(u);
    return u as URI;
  }

  protected async pickEncoding(current: string): Promise<string | undefined> {
    const picks = KAIRO_ENCODING_OPTIONS.map(e => ({
      label: e,
      description: e === current ? 'current' : undefined,
    }));
    const sel = await this.quickPick.showQuickPick(picks, {
      placeholder: `Pick an encoding (current: ${current})`,
    });
    if (!sel) return undefined;
    return typeof sel === 'string' ? sel : (sel as any).label;
  }
}

export function bindEncodingCommands(bind: interfaces.Bind): void {
  bind(KairoEncodingCommandsContribution).toSelf().inSingletonScope();
}
