/**
 * Java Index Progress UI — surfaces the JDT LS $/progress indexing
 * state in the status bar (TC-JAVA-001) and registers the
 * pause/resume + force-rebuild commands.
 *
 * Without this contribution JavaIndexProgressService is bound but
 * never rendered: the user gets zero feedback during workspace
 * indexing and has no way to pause or force a rebuild from the UI.
 */

import { injectable, inject, optional } from '@theia/core/shared/inversify';
import {
  FrontendApplication,
  FrontendApplicationContribution,
  StatusBar,
  StatusBarAlignment,
} from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable } from '@theia/core/lib/common/disposable';
import { KairoI18nService } from '@kairo/i18n';
import { JavaIndexProgressService } from './java-index-progress';

export namespace JavaIndexProgressCommands {
  export const PAUSE: Command = {
    id: 'kairo.java.index.pause',
    label: 'Java: Pause/Resume Indexing',
    category: 'Java',
  };

  export const REBUILD: Command = {
    id: 'kairo.java.index.rebuild',
    label: 'Java: Rebuild Index',
    category: 'Java',
  };
}

const INDEX_ENTRY_ID = 'kairo.java.index';

@injectable()
export class JavaIndexProgressUiContribution implements FrontendApplicationContribution, CommandContribution {
  @inject(JavaIndexProgressService)
  protected readonly progress!: JavaIndexProgressService;

  @inject(StatusBar)
  protected readonly statusBar!: StatusBar;

  @inject(KairoI18nService)
  @optional()
  protected readonly i18n?: KairoI18nService;

  protected sub: Disposable | undefined;

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(JavaIndexProgressCommands.PAUSE, {
      execute: () => this.progress.togglePause(),
    });
    registry.registerCommand(JavaIndexProgressCommands.REBUILD, {
      execute: () => {
        void this.progress.clearCache();
      },
    });
  }

  onStart(_app: FrontendApplication): void {
    this.sub = this.progress.onProgress(p => this.render(p));
  }

  onStop(): void {
    this.sub?.dispose();
    this.sub = undefined;
  }

  protected render(p: {
    active: boolean;
    title: string;
    percentage?: number;
    message?: string;
    paused?: boolean;
  }): void {
    if (!p.active) {
      try {
        this.statusBar.removeElement(INDEX_ENTRY_ID);
      } catch {
        // not present yet
      }
      return;
    }
    const pct = typeof p.percentage === 'number' ? ` ${Math.round(p.percentage)}%` : '';
    const msg = !pct && p.message ? ` — ${p.message}` : '';
    const icon = p.paused ? '$(debug-pause)' : '$(sync~spin)';
    const label = this.i18n ? this.i18n.t('statusBar.javaIndexing') : 'Indexing';
    this.statusBar.setElement(INDEX_ENTRY_ID, {
      text: `${icon} ${label}: ${p.title}${pct}${msg}`.trim().slice(0, 120),
      tooltip: this.i18n
        ? this.i18n.t('statusBar.javaIndexingTooltip')
        : 'JDT LS is indexing the workspace. Click to pause/resume; run "Java: Rebuild Index" to force a full rebuild.',
      alignment: StatusBarAlignment.LEFT,
      priority: 99,
      command: JavaIndexProgressCommands.PAUSE.id,
    });
  }
}
