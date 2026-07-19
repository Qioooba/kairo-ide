/**
 * Kairo UI Kit — Frontend Application Contribution
 *
 * Provides auto-opens the Explorer view on workspace load.
 *
 * Theme registration is handled by KairoThemeContribution.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CommandService } from '@theia/core/lib/common/command';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { Disposable } from '@theia/core/lib/common/disposable';

// ============================================================================
// KairoUiContribution — auto-opens Explorer on workspace load
// ============================================================================

@injectable()
export class KairoUiContribution implements FrontendApplicationContribution {
  private onWorkspaceChangedDisposable: Disposable | undefined;
  private explorerTimer: ReturnType<typeof setTimeout> | undefined;
  private workspaceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    @inject(CommandService) protected readonly commandService: CommandService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
  ) {}

  onStart(): void {
    this.maybeOpenExplorerOnTrust();
  }

  onStop(): void {
    this.onWorkspaceChangedDisposable?.dispose();
    if (this.explorerTimer !== undefined) {
      clearTimeout(this.explorerTimer);
      this.explorerTimer = undefined;
    }
    if (this.workspaceTimer !== undefined) {
      clearTimeout(this.workspaceTimer);
      this.workspaceTimer = undefined;
    }
  }

  /**
   * Open the Explorer view once a workspace is ready. We deliberately
   * do not touch layout, sashes, or any other DOM — just dispatching
   * a single command keeps the user's saved layout intact if they
   * later close the panel themselves.
   */
  private maybeOpenExplorerOnTrust(): void {
    const tryOpen = () => {
      const ws = this.workspaceService.workspace;
      if (!ws) return;
      const trusted = (ws as unknown as { isTrusted?: boolean }).isTrusted;
      if (trusted === false) return;
      this.commandService.executeCommand('workbench.view.explorer').catch(() => undefined);
    };
    this.explorerTimer = setTimeout(tryOpen, 1500);
    this.onWorkspaceChangedDisposable = this.workspaceService.onWorkspaceChanged?.(() => {
      this.workspaceTimer = setTimeout(tryOpen, 800);
    });
  }
}

export default KairoUiContribution;