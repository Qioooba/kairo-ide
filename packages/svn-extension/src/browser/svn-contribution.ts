import { injectable, inject } from '@theia/core/shared/inversify';
import type { interfaces } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  WidgetFactory,
  OpenViewArguments,
  WidgetManager,
  ApplicationShell,
} from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { EditorManager } from '@theia/editor/lib/browser';
import { Command, CommandRegistry, CommandContribution } from '@theia/core/lib/common/command';
import { MenuModelRegistry, MenuPath, MenuContribution } from '@theia/core/lib/common/menu';
import { KeybindingRegistry, KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { NavigatorTreeDecorator } from '@theia/navigator/lib/browser/navigator-decorator-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { QuickInputService, QuickPickItem } from '@theia/core/lib/browser/quick-input/quick-input-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { SvnService } from './svn-service';
import { SvnStore } from './svn-store';
import { SvnChangesWidget } from './svn-changes-widget';
import { SvnHistoryWidget } from './svn-history-widget';
import { SvnDiffWidget } from './svn-diff-widget';
import { SvnFileStatusDecorator } from './svn-file-status-decorator';
import { SvnExplorerDecorator } from './svn-explorer-decorator';
import { SvnGutterDecorator } from './svn-gutter-decorator';
import { SvnAnnotateDecorator } from './svn-annotate-decorator';
import { SvnStatusBarContribution } from './svn-status-bar-contribution';
import { SvnPreferenceContribution } from './svn-preferences';

export namespace SvnCommands {
  export const SVN_CATEGORY = 'Subversion';

  export const SHOW_CHANGES: Command = {
    id: 'svn.showChanges',
    label: 'SVN: Show Local Changes',
    category: SVN_CATEGORY,
  };

  export const SHOW_HISTORY: Command = {
    id: 'svn.showHistory',
    label: 'SVN: Show History',
    category: SVN_CATEGORY,
  };

  export const REFRESH: Command = {
    id: 'svn.refresh',
    label: 'SVN: Refresh Status',
    category: SVN_CATEGORY,
  };

  export const UPDATE: Command = {
    id: 'svn.update',
    label: 'SVN: Update Project',
    category: SVN_CATEGORY,
  };

  export const COMMIT: Command = {
    id: 'svn.commit',
    label: 'SVN: Commit...',
    category: SVN_CATEGORY,
  };

  export const ADD: Command = {
    id: 'svn.add',
    label: 'SVN: Add to VCS',
    category: SVN_CATEGORY,
  };

  export const REVERT: Command = {
    id: 'svn.revert',
    label: 'SVN: Revert...',
    category: SVN_CATEGORY,
  };

  export const CLEANUP: Command = {
    id: 'svn.cleanup',
    label: 'SVN: Cleanup',
    category: SVN_CATEGORY,
  };

  export const CHECKOUT: Command = {
    id: 'svn.checkout',
    label: 'SVN: Checkout from...',
    category: SVN_CATEGORY,
  };

  export const ANNOTATE: Command = {
    id: 'svn.annotate',
    label: 'SVN: Toggle Annotate (Blame)',
    category: SVN_CATEGORY,
  };

  export const DIFF_SHOW: Command = {
    id: 'svn.diff.show',
    label: 'SVN: Show Diff',
    category: SVN_CATEGORY,
  };

  export const LOCK: Command = {
    id: 'svn.lock',
    label: 'SVN: Lock...',
    category: SVN_CATEGORY,
  };

  export const UNLOCK: Command = {
    id: 'svn.unlock',
    label: 'SVN: Unlock',
    category: SVN_CATEGORY,
  };

  export const BROWSE_REPO: Command = {
    id: 'svn.browseRepo',
    label: 'SVN: Browse Repository',
    category: SVN_CATEGORY,
  };

  export const SHOW_INFO: Command = {
    id: 'svn.showInfo',
    label: 'SVN: Show Info',
    category: SVN_CATEGORY,
  };

  export const SWITCH: Command = {
    id: 'svn.switch',
    label: 'SVN: Switch...',
    category: SVN_CATEGORY,
  };

  export const RESOLVE: Command = {
    id: 'svn.resolve',
    label: 'SVN: Mark as Resolved',
    category: SVN_CATEGORY,
  };

  export const IGNORE: Command = {
    id: 'svn.ignore',
    label: 'SVN: Add to svn:ignore',
    category: SVN_CATEGORY,
  };
}

export const SVN_CONTEXT_MENU: MenuPath = ['svn_context_menu'];
export const SVN_VIEW_CONTAINER_ID = 'kairo-svn-view-container';
export const SVN_ACTIVE_CONTEXT_KEY = 'svnActive';

@injectable()
export class SvnContribution
  implements FrontendApplicationContribution, CommandContribution, MenuContribution, KeybindingContribution
{
  @inject(SvnService) protected readonly svnService!: SvnService;
  @inject(SvnStore) protected readonly svnStore!: SvnStore;
  @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
  @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
  @inject(ContextKeyService) protected readonly contextKeyService!: ContextKeyService;
  @inject(SvnAnnotateDecorator) protected readonly annotateDecorator!: SvnAnnotateDecorator;
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(QuickInputService) protected readonly quickInputService!: QuickInputService;
  @inject(MessageService) protected readonly messageService!: MessageService;

  protected readonly toDispose = new DisposableCollection();

  dispose(): void {
    this.toDispose.dispose();
  }

  async initializeLayout(): Promise<void> {
    await this.openChangesView({ activate: false });
  }

  onStart(): void {
    this.setupContextKeys();
    this.setupWorkspaceWatching();
    this.setupWcRootWatching();
    this.setupRequestRouting();
  }

  /**
   * Route SvnService's UI request events (requestDiff, requestHistory)
   * to the corresponding widgets. Decouples callers (file explorer,
   * editor context menu, history list) from the widget implementation.
   */
  protected setupRequestRouting(): void {
    this.toDispose.push(
      this.svnService.onDiffRequest(async req => {
        const widget = await this.openDiffView({ activate: true });
        widget.setDiffTarget(req.filePath, req.baseRevision, req.targetRevision);
      }),
    );
    this.toDispose.push(
      this.svnService.onHistoryRequest(async req => {
        const widget = await this.openHistoryView();
        widget.setTargetPath(req.filePath);
      }),
    );
  }

  /**
   * Subscribe to workspace change events so that when the user opens a
   * different project, we automatically detect its SVN working copy and
   * re-activate. This mirrors IntelliJ IDEA's behaviour: opening a project
   * that is under SVN control immediately enables all SVN actions.
   */
  protected setupWorkspaceWatching(): void {
    // Re-detect when the active workspace root is changed
    // (open folder / open file / switch project).
    this.toDispose.push(
      this.workspaceService.onWorkspaceLocationChanged(async () => {
        await this.detectAndActivateWc();
      }),
    );
    // Re-detect on any structural change inside the workspace
    // (e.g. user adds a new folder via "Add Folder to Workspace...").
    this.toDispose.push(
      this.workspaceService.onWorkspaceChanged(async () => {
        await this.detectAndActivateWc();
      }),
    );
    // Run once at startup.
    void this.detectAndActivateWc();
  }

  /**
   * Listen for active working-copy changes. When the WC root switches
   * (e.g. user opened a different SVN project), reset the diff / history
   * widgets so they don't show stale content from the previous project.
   */
  protected setupWcRootWatching(): void {
    this.toDispose.push(
      this.svnService.onDidChangeWcRoot(() => {
        this.resetWcBoundWidgets();
      }),
    );
  }

  protected resetWcBoundWidgets(): void {
    // Drop any active diff target so the next "Show Diff" call uses
    // the new project's files.
    const diffWidget = this.widgetManager.tryGetWidget(SvnDiffWidget.ID) as SvnDiffWidget | undefined;
    if (diffWidget && typeof (diffWidget as any).reset === 'function') {
      (diffWidget as any).reset();
    }
    const historyWidget = this.widgetManager.tryGetWidget(SvnHistoryWidget.ID) as SvnHistoryWidget | undefined;
    if (historyWidget && typeof (historyWidget as any).reset === 'function') {
      (historyWidget as any).reset();
    }
  }

  protected setupContextKeys(): void {
    const svnActiveKey = this.contextKeyService.createKey<boolean>(SVN_ACTIVE_CONTEXT_KEY, false);
    this.svnService.onSvnAvailabilityChange(available => {
      svnActiveKey.set(available && !!this.svnService.getActiveWcRoot());
    });
    this.svnService.onDidChangeStatus(() => {
      svnActiveKey.set(this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot());
    });
  }

  /**
   * Walk all workspace roots, locate a Subversion working copy, and activate it.
   * If none is found, deactivate (clear the active WC root, which stops polling
   * and clears the cached status). This is a no-op if the active WC root has
   * not changed.
   */
  protected async detectAndActivateWc(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots();
    let foundRoot: string | undefined;
    for (const root of roots) {
      if (root.resource) {
        const fsPath = root.resource.path.toString();
        const wcRoot = await this.svnService.findWcRoot(fsPath);
        if (wcRoot) {
          foundRoot = wcRoot;
          break;
        }
      }
    }
    if (foundRoot && foundRoot !== this.svnService.getActiveWcRoot()) {
      this.svnService.setActiveWcRoot(foundRoot);
    } else if (!foundRoot && this.svnService.getActiveWcRoot()) {
      this.svnService.setActiveWcRoot(undefined);
    }
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(SvnCommands.SHOW_CHANGES, {
      execute: () => this.openChangesView(),
      isVisible: () => true,
    });

    registry.registerCommand(SvnCommands.SHOW_HISTORY, {
      execute: () => this.openHistoryView(),
      isVisible: () => true,
    });

    registry.registerCommand(SvnCommands.REFRESH, {
      execute: () => this.svnStore.refresh(),
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.UPDATE, {
      execute: () => this.svnStore.update(),
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.COMMIT, {
      execute: async () => {
        await this.openChangesView();
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.ADD, {
      execute: async (_uris?: any[]) => {
        const state = this.svnStore.getState();
        const files = state.unversionedFiles.map(f => f.path);
        if (files.length > 0) {
          await this.svnStore.addFiles(files);
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.REVERT, {
      execute: async () => {
        const state = this.svnStore.getState();
        const files = Array.from(state.selectedFiles);
        if (files.length > 0 && confirm(`Revert ${files.length} file(s)?`)) {
          await this.svnStore.revertFiles(files);
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.CLEANUP, {
      execute: async () => {
        const wcRoot = this.svnService.getActiveWcRoot();
        if (wcRoot) {
          await this.svnService.cleanup(wcRoot);
          await this.svnStore.refresh();
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.CHECKOUT, {
      execute: async () => {
        const url = await this.quickInputService.input({
          placeHolder: 'Enter SVN repository URL to checkout (e.g., svn://example.com/repo)',
          prompt: 'SVN Repository URL',
        });
        if (!url) return;
        const targetPath = await this.quickInputService.input({
          placeHolder: 'Enter local target path',
          prompt: 'Local Path',
        });
        if (!targetPath) return;
        try {
          await this.svnService.checkout(url, targetPath);
          this.messageService.info(`Checked out ${url} to ${targetPath}`);
        } catch (e) {
          this.messageService.error(`Checkout failed: ${(e as Error).message}`);
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable(),
    });

    registry.registerCommand(SvnCommands.ANNOTATE, {
      execute: async () => {
        const currentEditor = this.editorManager?.currentEditor;
        if (currentEditor) {
          const uri = currentEditor.getResourceUri();
          if (uri) {
            const filePath = this.getRelativePath(uri.toString());
            await this.annotateDecorator.annotateEditor(filePath);
          }
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.LOCK, {
      execute: async () => {
        const state = this.svnStore.getState();
        const files = Array.from(state.selectedFiles);
        if (files.length > 0) {
          await this.svnService.lock(files);
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.UNLOCK, {
      execute: async () => {
        const state = this.svnStore.getState();
        const files = Array.from(state.selectedFiles);
        if (files.length > 0) {
          await this.svnService.unlock(files);
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.DIFF_SHOW, {
      execute: async () => {
        const widget = await this.openDiffView({ activate: true });
        const currentEditor = this.editorManager?.currentEditor;
        if (currentEditor) {
          const uri = currentEditor.getResourceUri();
          if (uri) {
            const filePath = this.getRelativePath(uri.toString());
            widget.setDiffTarget(filePath);
          }
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.BROWSE_REPO, {
      execute: async () => {
        const state = this.svnStore.getState();
        const repoUrl = state.wcInfo?.url || '';
        let url = repoUrl;
        if (!url) {
          url = await this.quickInputService.input({
            placeHolder: 'Enter SVN repository URL to browse',
            prompt: 'SVN Repository URL',
          }) || '';
        }
        if (url) {
          await this.openRepoBrowser(url);
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable(),
    });

    registry.registerCommand(SvnCommands.SHOW_INFO, {
      execute: async () => {
        const state = this.svnStore.getState();
        const info = state.wcInfo;
        const message = info
          ? `URL: ${info.url}\nRevision: ${info.revision}\nLast Changed: ${info.lastChangedRev}\nLast Author: ${info.lastChangedAuthor}\nRoot: ${info.reposRootUrl}\nUUID: ${info.reposUuid}`
          : 'No SVN info available. Run SVN: Refresh Status first.';
        this.showInfoDialog(message);
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.SWITCH, {
      execute: async () => {
        const url = await this.quickInputService.input({
          placeHolder: 'Enter SVN URL to switch to',
          prompt: 'Switch URL',
        });
        if (url) {
          try {
            await this.svnService.switch(url);
            await this.svnStore.refresh();
            this.messageService.info(`Switched to ${url}`);
          } catch (e) {
            this.messageService.error(`Switch failed: ${(e as Error).message}`);
          }
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.RESOLVE, {
      execute: async () => {
        const state = this.svnStore.getState();
        const files = state.conflictedFiles.map(f => f.path);
        for (const f of files) {
          await this.svnService.resolve(f, { accept: 'working' });
        }
        await this.svnStore.refresh();
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });

    registry.registerCommand(SvnCommands.IGNORE, {
      execute: async () => {
        const state = this.svnStore.getState();
        const files = Array.from(state.selectedFiles);
        if (files.length > 0) {
          await this.svnService.ignore([files[0]]);
          await this.svnStore.refresh();
        }
      },
      isVisible: () => true,
      isEnabled: () => this.svnService.isSvnAvailable() && !!this.svnService.getActiveWcRoot(),
    });
  }

  registerMenus(registry: MenuModelRegistry): void {
    const submenuPath = [...SVN_CONTEXT_MENU];

    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.UPDATE.id,
      order: '1',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.COMMIT.id,
      order: '2',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.DIFF_SHOW.id,
      order: '3',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.SHOW_HISTORY.id,
      order: '4',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.ANNOTATE.id,
      order: '5',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.REFRESH.id,
      order: '6',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.ADD.id,
      order: '7',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.REVERT.id,
      order: '8',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.CLEANUP.id,
      order: '9',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.LOCK.id,
      order: '10',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.UNLOCK.id,
      order: '11',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.RESOLVE.id,
      order: '12',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.IGNORE.id,
      order: '13',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.SWITCH.id,
      order: '14',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.SHOW_INFO.id,
      order: '15',
    });
    registry.registerMenuAction(submenuPath, {
      commandId: SvnCommands.BROWSE_REPO.id,
      order: '16',
    });
  }

  registerKeybindings(registry: KeybindingRegistry): void {
    registry.registerKeybinding({
      command: SvnCommands.UPDATE.id,
      keybinding: 'ctrlcmd+t',
      when: 'svnActive',
    });
    registry.registerKeybinding({
      command: SvnCommands.COMMIT.id,
      keybinding: 'ctrlcmd+k',
      when: 'svnActive',
    });
    registry.registerKeybinding({
      command: SvnCommands.SHOW_CHANGES.id,
      keybinding: 'alt+9',
    });
    // IDEA-style keybindings for the current file.
    // Only active when the editor has focus AND a SVN working copy is
    // active, so the browser default Ctrl+D (bookmark) / Ctrl+H
    // (history) is unaffected in other contexts.
    registry.registerKeybinding({
      command: SvnCommands.DIFF_SHOW.id,
      keybinding: 'ctrlcmd+d',
      when: 'svnActive && editorTextFocus',
    });
    registry.registerKeybinding({
      command: SvnCommands.SHOW_HISTORY.id,
      keybinding: 'ctrlcmd+h',
      when: 'svnActive && editorTextFocus',
    });
    // Alternate bindings for explorer / project tree. Exclude Java editor
    // focus so IDEA Ctrl+Alt+H Call Hierarchy (kairo-idea-windows-keymap)
    // wins in .java files (KAIRO-QA-A7-001).
    registry.registerKeybinding({
      command: SvnCommands.SHOW_HISTORY.id,
      keybinding: 'ctrlcmd+alt+h',
      when: 'svnActive && !(editorTextFocus && editorLangId == java)',
    });
  }

  protected async openChangesView(args?: Partial<OpenViewArguments>): Promise<SvnChangesWidget> {
    const widget = await this.widgetManager.getOrCreateWidget(SvnChangesWidget.ID) as SvnChangesWidget;
    try {
      this.shell.addWidget(widget, { area: 'left' });
    } catch {
      // Already attached
    }
    if (args?.activate !== false) {
      this.shell.activateWidget(widget.id);
    }
    widget.update();
    return widget;
  }

  protected async openHistoryView(): Promise<SvnHistoryWidget> {
    const widget = await this.widgetManager.getOrCreateWidget(SvnHistoryWidget.ID) as SvnHistoryWidget;
    try {
      this.shell.addWidget(widget, { area: 'left' });
    } catch {
      // Already attached
    }
    this.shell.activateWidget(widget.id);
    widget.update();
    return widget;
  }

  protected async openDiffView(args?: Partial<OpenViewArguments>): Promise<SvnDiffWidget> {
    const widget = await this.widgetManager.getOrCreateWidget(SvnDiffWidget.ID) as SvnDiffWidget;
    try {
      this.shell.addWidget(widget, { area: 'main' });
    } catch {
      // Already attached
    }
    if (args?.activate !== false) {
      this.shell.activateWidget(widget.id);
    }
    widget.update();
    return widget;
  }

  protected getRelativePath(uri: string): string {
    const wcRoot = this.svnService.getActiveWcRoot();
    if (!wcRoot) return uri;
    const fileUri = uri.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
    const decodedUri = decodeURIComponent(fileUri);
    if (decodedUri.startsWith(wcRoot)) {
      let relative = decodedUri.substring(wcRoot.length);
      if (relative.startsWith('/')) relative = relative.substring(1);
      return relative;
    }
    return decodedUri;
  }

  protected async openRepoBrowser(url: string): Promise<void> {
    try {
      const entries = await this.svnService.listRepository(url);
      interface RepoQuickPickItem extends QuickPickItem {
        entry: typeof entries[0];
      }
      const items: RepoQuickPickItem[] = entries.map(e => ({
        label: e.kind === 'dir' ? `$(folder) ${e.name}/` : `$(file) ${e.name}`,
        description: `${e.lastChangedRevision || '?'} | ${e.lastChangedAuthor || '?'} | ${e.lastChangedDate ? e.lastChangedDate.toLocaleDateString() : '?'}`,
        detail: e.kind === 'dir' ? 'Directory' : `Size: ${e.size || '?'}`,
        entry: e,
      }));
      const selected = await this.quickInputService.showQuickPick<RepoQuickPickItem>(items, {
        placeholder: `Repository: ${url}`,
      });
      if (selected && selected.entry.kind === 'dir') {
        const name = selected.entry.name;
        const newUrl = url.endsWith('/') ? `${url}${name}` : `${url}/${name}`;
        await this.openRepoBrowser(newUrl);
      }
    } catch (e) {
      this.messageService.error(`Failed to browse repository: ${(e as Error).message}`);
    }
  }

  protected showInfoDialog(message: string): void {
    this.messageService.info(message);
  }
}

export function bindSvnExtension(bind: interfaces.Bind): void {
  // Core services
  bind(SvnService).toSelf().inSingletonScope();
  bind(SvnStore).toSelf().inSingletonScope();
  bind(SvnFileStatusDecorator).toSelf().inSingletonScope();
  bind(SvnExplorerDecorator).toSelf().inSingletonScope();
  bind(SvnStatusBarContribution).toSelf().inSingletonScope();
  bind(SvnContribution).toSelf().inSingletonScope();
  bind(SvnGutterDecorator).toSelf().inSingletonScope();
  bind(SvnAnnotateDecorator).toSelf().inSingletonScope();

  // Bind decorators
  bind(TabBarDecorator).toService(SvnFileStatusDecorator);
  bind(NavigatorTreeDecorator).toService(SvnExplorerDecorator);

  // Bind SvnPreferenceContribution explicitly so that the
  // PreferenceProvider can synchronously resolve it during
  // init() (KAIRO-RC-WEB-035: without this, the implicit
  // auto-bind went through async-loaded modules and the
  // PreferenceProvider threw "construct Symbol(PreferenceContribution)
  // in a synchronous way but it has asynchronous dependencies",
  // which prevented the menu bar from rendering).
  bind(SvnPreferenceContribution).toSelf().inSingletonScope();
  bind(PreferenceContribution).toService(SvnPreferenceContribution);

  // Widget factories
  bind(SvnChangesWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SvnChangesWidget.ID,
    createWidget: () => context.container.get(SvnChangesWidget),
  })).inSingletonScope();

  bind(SvnHistoryWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SvnHistoryWidget.ID,
    createWidget: () => context.container.get(SvnHistoryWidget),
  })).inSingletonScope();

  bind(SvnDiffWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SvnDiffWidget.ID,
    createWidget: () => context.container.get(SvnDiffWidget),
  })).inSingletonScope();

  // Frontend contribution
  bind(FrontendApplicationContribution).toService(SvnContribution);
  bind(CommandContribution).toService(SvnContribution);
  bind(MenuContribution).toService(SvnContribution);
  bind(KeybindingContribution).toService(SvnContribution);
  bind(FrontendApplicationContribution).toService(SvnStatusBarContribution);
}
