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
import { QuickInputService, ApplicationShell, FrontendApplicationContribution, QuickPickItem } from '@theia/core/lib/browser';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { KairoProjectEncodingContribution } from './project-encoding-contribution';
import { KairoEncodingCacheContribution } from './encoding-cache-contribution';
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MessageService,
} from '@theia/core/lib/common';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import { reloadEditorWithEncoding } from './reopen-strategy';
import URI from '@theia/core/lib/common/uri';
import {
  KairoEncodingServiceImpl,
  KAIRO_ENCODING_OPTIONS,
  toTheiaEncodingId,
  toGoEncodingId,
  sameEncodingId,
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
  export const CONVERT_ENCODING: Command = {
    id: 'kairo.encoding.convert',
    label: 'Convert Encoding…',
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
  @inject(WorkspaceContextService) protected workspaceContext!: WorkspaceContextService;
  @inject(KairoI18nService) protected i18n!: KairoI18nService;

  /** Captured so labels can be refreshed after async i18n load / language switch. */
  protected commandRegistry: CommandRegistry | undefined;

  protected readonly commandI18nKeys: Record<string, KairoI18nKey> = {
    [KairoEncodingCommands.REOPEN_WITH_ENCODING.id]: 'encoding.reopenWithEncoding',
    [KairoEncodingCommands.SAVE_WITH_ENCODING.id]: 'encoding.saveWithEncoding',
    [KairoEncodingCommands.SHOW_ENCODING.id]: 'encoding.showFileEncoding',
    [KairoEncodingCommands.CONVERT_ENCODING.id]: 'encoding.convertEncoding',
  };

  protected withLabel(cmd: Command): Command {
    const key = this.commandI18nKeys[cmd.id];
    const label = key ? this.i18n.t(key) : cmd.label;
    const category = cmd.category === 'Kairo' ? this.i18n.t('menu.category.kairo') : cmd.category;
    return key || category !== cmd.category ? { ...cmd, label, category } : cmd;
  }

  protected refreshCommandLabels(): void {
    if (!this.commandRegistry) {
      return;
    }
    const category = this.i18n.t('menu.category.kairo');
    for (const [id, key] of Object.entries(this.commandI18nKeys)) {
      const cmd = this.commandRegistry.getCommand(id);
      if (cmd) {
        cmd.label = this.i18n.t(key);
        if (cmd.category === 'Kairo' || cmd.category === category) {
          cmd.category = category;
        }
      }
    }
  }

  registerCommands(registry: CommandRegistry): void {
    this.commandRegistry = registry;
    this.refreshCommandLabels();
    this.i18n.onDidChangeLanguage(() => this.refreshCommandLabels());

    registry.registerCommand(this.withLabel(KairoEncodingCommands.SHOW_ENCODING), {
      execute: async (uri?: URI | string) => {
        const target = this.normalizeUri(uri) ?? this.currentEditorUri();
        if (!target) {
          this.messages.warn(this.i18n.t('encoding.noFileOpen'));
          return;
        }
        const enc = this.service.getEncodingFor(target);
        this.messages.info(this.i18n.t('encoding.showEncoding', {
          path: target.toString(),
          encoding: enc,
        }));
      },
    });

    registry.registerCommand(this.withLabel(KairoEncodingCommands.REOPEN_WITH_ENCODING), {
      execute: async (uri?: URI | string) => {
        const target = this.normalizeUri(uri) ?? this.currentEditorUri();
        if (!target) {
          this.messages.warn(this.i18n.t('encoding.openFileFirst'));
          return;
        }
        const current = this.service.getEncodingFor(target);
        const picked = await this.pickEncoding(current);
        if (!picked) return;
        // Compare in Kairo domain — getEncodingFor used to return
        // Theia ids while picks are Kairo labels (BD-P1-8).
        if (sameEncodingId(picked, current)) {
          this.messages.info(this.i18n.t('encoding.alreadyUsing', { encoding: current }));
          return;
        }
        // Register the override BEFORE reloading so both the
        // re-decode and any later save pick it up. The override is
        // per-URI and survives editor close/reopen.
        this.service.setEncodingFor(target, picked);
        // Reload strategy lives in reopen-strategy.ts (DOM-free,
        // unit-tested): prefer setEncoding(Decode) on the live
        // editor, fall back to close/reopen. The old unconditional
        // close/reopen silently reused the still-cached Monaco
        // model, so the file was never re-decoded (KAIRO-RC-WEB-206
        // follow-up).
        const widget = await this.editorManager.getByUri(target);
        if (widget) {
          const outcome = await reloadEditorWithEncoding(
            widget, target, toTheiaEncodingId(picked), this.editorManager, this.messages,
            this.i18n.t('encoding.dirtyRefuse'),
          );
          if (outcome === 'refused-dirty') {
            // Roll back the override so a later Ctrl+S does not
            // silently rewrite the file in the new encoding.
            this.service.setEncodingFor(target, current);
            return;
          }
        }
        this.service.invalidateEncodingCache(target);
        this.messages.info(this.i18n.t('encoding.reopenedAs', {
          name: target.displayName,
          encoding: picked,
        }));
      },
    });

    registry.registerCommand(this.withLabel(KairoEncodingCommands.SAVE_WITH_ENCODING), {
      execute: async (uri?: URI | string) => {
        const target = this.normalizeUri(uri) ?? this.currentEditorUri();
        if (!target) {
          this.messages.warn(this.i18n.t('encoding.openFileFirst'));
          return;
        }
        const widget = await this.editorManager.getByUri(target);
        if (!widget) {
          this.messages.warn(this.i18n.t('encoding.noOpenEditor', { name: target.displayName }));
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
            this.i18n.t('encoding.cannotEncode', { encoding: picked }) +
              (validation.error ? ` ${validation.error}` : ''),
          );
          return;
        }
        try {
          // KAIRO-RC-WEB-235: the EncodingRegistry override ALWAYS
          // wins over the write() options.encoding, so the override
          // must be updated BEFORE writing — otherwise the bytes are
          // encoded with the OLD encoding while the UI claims the new
          // one (the one-way "Saved as utf-8" that stayed GBK).
          this.service.setEncodingFor(target, picked);
          await this.service.writeWithEncoding(target, text, picked);
          this.service.invalidateEncodingCache(target);
          // Mark the document as not dirty without re-saving
          // (we just wrote the bytes ourselves).
          (document as { setDirty?: (dirty: boolean) => void }).setDirty?.(false);
          this.messages.info(this.i18n.t('encoding.savedAs', {
            name: target.displayName,
            encoding: picked,
          }));
        } catch (err) {
          this.messages.error(this.i18n.t('encoding.saveFailed', {
            encoding: picked,
            msg: (err as Error).message,
          }));
        }
      },
    });

    registry.registerCommand(this.withLabel(KairoEncodingCommands.CONVERT_ENCODING), {
      execute: async (uri?: URI | string) => {
        const target = this.normalizeUri(uri) ?? this.currentEditorUri();
        if (!target) {
          this.messages.warn(this.i18n.t('encoding.openFileFirst'));
          return;
        }
        const widget = await this.editorManager.getByUri(target);
        if (!widget) {
          this.messages.warn(this.i18n.t('encoding.noOpenEditor', { name: target.displayName }));
          return;
        }
        const document = widget.editor.document;
        const current = this.service.getEncodingFor(target);
        const picked = await this.pickEncoding(current);
        if (!picked) return;
        if (sameEncodingId(picked, current)) {
          this.messages.info(this.i18n.t('encoding.alreadyUsingConvert', { encoding: current }));
          return;
        }
        // Show confirmation dialog with details
        const dialog = new ConfirmDialog({
          title: this.i18n.t('encoding.convertTitle'),
          msg: this.i18n.t('encoding.convertMsg', {
            name: target.displayName,
            from: current,
            to: picked,
          }),
          ok: this.i18n.t('encoding.convertOk'),
          cancel: this.i18n.t('encoding.convertCancel'),
        });
        const confirmed = await dialog.open();
        if (!confirmed) return;
        const text = document.getText();
        // Validate the text can be represented in the target encoding
        const validation = await this.service.validateEncoding(text, picked);
        if (!validation.valid) {
          this.messages.error(
            this.i18n.t('encoding.convertRefused', {
              msg: this.i18n.t('encoding.cannotEncode', { encoding: picked }) +
                (validation.error ? ` ${validation.error}` : ''),
            }),
          );
          return;
        }
        const wsId = this.workspaceContext.context?.workspaceId;
        if (!wsId) {
          this.messages.error(this.i18n.t('encoding.noWorkspace'));
          return;
        }
        try {
          // BD-P1-6: real workspaceId, OS fs path (not `/g:/…` URI path),
          // and Go-canonical from/to ids (not Theia utf8 / utf8bom).
          await this.service.recode({
            workspaceId: wsId,
            file: FileUri.fsPath(target),
            from: toGoEncodingId(current),
            to: toGoEncodingId(picked),
          });
          // Update the encoding metadata
          this.service.setEncodingFor(target, picked);
          this.service.invalidateEncodingCache(target);
          // Reload the editor to show the recoded content
          const reloaded = await this.editorManager.getByUri(target);
          if (reloaded) {
            await reloadEditorWithEncoding(
              reloaded, target, toTheiaEncodingId(picked),
              this.editorManager, this.messages,
              this.i18n.t('encoding.dirtyRefuse'),
            );
          }
          this.messages.info(this.i18n.t('encoding.converted', {
            name: target.displayName,
            from: current,
            to: picked,
          }));
        } catch (err) {
          this.messages.error(this.i18n.t('encoding.convertFailed', {
            from: current,
            to: picked,
            msg: (err as Error).message,
          }));
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
      description: sameEncodingId(e, current) ? this.i18n.t('encoding.currentLabel') : undefined,
    }));
    const sel = await this.quickPick.showQuickPick(picks, {
      placeholder: this.i18n.t('encoding.pickPlaceholder', { encoding: current }),
    });
    if (!sel) return undefined;
    return typeof sel === 'string' ? sel : (sel as QuickPickItem).label;
  }
}

export function bindEncodingCommands(bind: interfaces.Bind): void {
  bind(KairoEncodingCommandsContribution).toSelf().inSingletonScope();
  // Project default encoding -> folder-level override (WEB-206).
  bind(KairoProjectEncodingContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoProjectEncodingContribution);
  bind(KairoEncodingCacheContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoEncodingCacheContribution);
}
