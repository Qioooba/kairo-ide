/**
 * "Kairo: Generate Diagnostic Bundle" command — P3-OBS-01
 *
 * Shows a progress dialog during collection, opens a save dialog
 * for the zip file, and shows a summary of what was collected.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  CommandContribution,
  CommandRegistry,
  MessageService,
  ProgressService,
} from '@theia/core/lib/common';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
import type { Endpoint } from '@kairo/protocol';

export namespace KairoDiagnosticCommands {
  export const GENERATE_DIAGNOSTIC = {
    id: 'kairo.generateDiagnosticBundle',
    label: 'Kairo: Generate Diagnostic Bundle',
    category: 'Kairo',
  };
}

@injectable()
export class KairoDiagnosticCommandContribution implements CommandContribution {
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(ProgressService) protected readonly progressService!: ProgressService;
  @inject(FileDialogService) protected readonly fileDialog!: FileDialogService;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected commandRegistry: CommandRegistry | undefined;

  registerCommands(registry: CommandRegistry): void {
    this.commandRegistry = registry;
    this.refreshCommandLabels();
    this.i18n.onDidChangeLanguage(() => this.refreshCommandLabels());

    registry.registerCommand({
      ...KairoDiagnosticCommands.GENERATE_DIAGNOSTIC,
      label: this.i18n.t('command.generateDiagnosticBundle'),
      category: this.i18n.t('menu.category.kairo'),
    }, {
      execute: () => this.generateDiagnosticBundle(),
    });
  }

  protected refreshCommandLabels(): void {
    const cmd = this.commandRegistry?.getCommand(KairoDiagnosticCommands.GENERATE_DIAGNOSTIC.id);
    if (cmd) {
      cmd.label = this.i18n.t('command.generateDiagnosticBundle');
      cmd.category = this.i18n.t('menu.category.kairo');
    }
  }

  /**
   * Generate a diagnostic bundle and prompt the user to save it.
   */
  protected async generateDiagnosticBundle(): Promise<void> {
    const progress = await this.progressService.showProgress({
      text: this.i18n.t('diagnostic.generating'),
      options: {
        cancelable: true,
        location: 'notification',
      },
    });

    try {
      progress.report({ message: this.i18n.t('diagnostic.collecting') });

      const result = await this.runtime.request(
        'POST /api/v1/diagnostics/bundle' as Endpoint,
        undefined,
        { noRetry: true },
      ) as unknown as {
        success: boolean;
        bundlePath?: string;
        summary?: {
          processes: number;
          ports: number;
          errors: number;
          logs: number;
          sizeBytes: number;
        };
        error?: string;
      } | undefined;

      if (!result?.success) {
        throw new Error(result?.error || this.i18n.t('diagnostic.failed'));
      }

      progress.report({ message: this.i18n.t('diagnostic.prepareSave') });

      const bundlePath = result.bundlePath;
      const _fileName = bundlePath?.split('/').pop() || 'kairo-diag.zip';

      const saveUri = await this.fileDialog.showSaveDialog({
        title: this.i18n.t('diagnostic.saveTitle'),
        filters: {
          [this.i18n.t('diagnostic.zipFilter')]: ['zip'],
        },
      });

      if (!saveUri) {
        this.messages.info(this.i18n.t('diagnostic.cancelled'));
        return;
      }

      progress.report({ message: this.i18n.t('diagnostic.saving') });

      await this.runtime.request(
        'POST /api/v1/diagnostics/download' as Endpoint,
        { bundlePath, savePath: saveUri.path.toString() },
        { noRetry: true },
      );

      const summary = result.summary;
      const summaryParts: string[] = [];
      if (summary) {
        if (summary.processes > 0) {
          summaryParts.push(this.i18n.t('diagnostic.summaryProcesses', { count: summary.processes }));
        }
        if (summary.ports > 0) {
          summaryParts.push(this.i18n.t('diagnostic.summaryPorts', { count: summary.ports }));
        }
        if (summary.errors > 0) {
          summaryParts.push(this.i18n.t('diagnostic.summaryErrors', { count: summary.errors }));
        }
        if (summary.logs > 0) {
          summaryParts.push(this.i18n.t('diagnostic.summaryLogs', { count: summary.logs }));
        }
        if (summary.sizeBytes > 0) {
          const sizeMB = (summary.sizeBytes / (1024 * 1024)).toFixed(1);
          summaryParts.push(this.i18n.t('diagnostic.summarySize', { size: sizeMB }));
        }
      }

      this.messages.info(
        this.i18n.t('diagnostic.saved', { path: saveUri.path.toString() }) + '\n\n' +
        (summaryParts.length > 0
          ? this.i18n.t('diagnostic.collected', { summary: summaryParts.join(', ') })
          : this.i18n.t('diagnostic.success')),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.messages.error(this.i18n.t('diagnostic.errorFailed', { msg }));
    } finally {
      progress.cancel();
    }
  }
}
