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

export namespace KairoDiagnosticCommands {
  export const GENERATE_DIAGNOSTIC = {
    id: 'kairo.generateDiagnosticBundle',
    label: 'Kairo: 生成诊断包',
    category: 'Kairo',
  };
}

@injectable()
export class KairoDiagnosticCommandContribution implements CommandContribution {
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(ProgressService) protected readonly progressService!: ProgressService;
  @inject(FileDialogService) protected readonly fileDialog!: FileDialogService;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(KairoDiagnosticCommands.GENERATE_DIAGNOSTIC, {
      execute: () => this.generateDiagnosticBundle(),
    });
  }

  /**
   * Generate a diagnostic bundle and prompt the user to save it.
   */
  protected async generateDiagnosticBundle(): Promise<void> {
    const progress = await this.progressService.showProgress({
      text: '正在生成诊断包...',
      options: {
        cancelable: true,
        location: 'notification',
      },
    });

    try {
      progress.report({ message: '正在收集诊断信息...' });

      // Request the runtime agent to generate the bundle
      const result = await this.runtime.request(
        'POST /api/v1/diagnostics/bundle' as any,
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
        throw new Error(result?.error || '诊断包生成失败');
      }

      progress.report({ message: '正在准备保存...' });

      // Show save dialog
      const bundlePath = result.bundlePath;
      const _fileName = bundlePath?.split('/').pop() || 'kairo-diag.zip';

      const saveUri = await this.fileDialog.showSaveDialog({
        title: '保存诊断包',
        filters: {
          'ZIP 文件': ['zip'],
        },
      });

      if (!saveUri) {
        // User cancelled
        this.messages.info('诊断包生成已取消。');
        return;
      }

      progress.report({ message: '正在保存...' });

      // Download the bundle from the agent
      await this.runtime.request(
        'POST /api/v1/diagnostics/download' as any,
        { bundlePath, savePath: saveUri.path.toString() },
        { noRetry: true },
      );

      // Show summary
      const summary = result.summary;
      const summaryParts: string[] = [];
      if (summary) {
        if (summary.processes > 0) summaryParts.push(`${summary.processes} 个进程`);
        if (summary.ports > 0) summaryParts.push(`${summary.ports} 个端口`);
        if (summary.errors > 0) summaryParts.push(`${summary.errors} 个错误`);
        if (summary.logs > 0) summaryParts.push(`${summary.logs} 行日志`);
        if (summary.sizeBytes > 0) {
          const sizeMB = (summary.sizeBytes / (1024 * 1024)).toFixed(1);
          summaryParts.push(`大小: ${sizeMB} MB`);
        }
      }

      this.messages.info(
        `诊断包已保存到 ${saveUri.path.toString()}\n\n` +
        (summaryParts.length > 0
          ? `收集内容: ${summaryParts.join(', ')}`
          : '诊断包已成功生成。'),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.messages.error(`诊断包生成失败: ${msg}`);
    } finally {
      progress.cancel();
    }
  }
}