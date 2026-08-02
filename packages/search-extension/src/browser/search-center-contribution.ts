import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { SearchCenterWidget } from './search-center-widget';

/**
 * Theia SIW (search-in-workspace) owns ctrlcmd+shift+f by default.
 * We unregister those bindings and route IDEA Find/Replace in Path
 * shortcuts to the Kairo Search Center popup instead.
 */
const THEIA_SEARCH_KEYS = [
  'ctrlcmd+shift+f',
  'ctrl+shift+f',
  'cmd+shift+f',
  'ctrlcmd+shift+r',
  'ctrl+shift+r',
  'cmd+shift+r',
] as const;

@injectable()
export class SearchCenterContribution extends AbstractViewContribution<SearchCenterWidget> {
  protected pendingMode: 'search' | 'replace' = 'search';

  protected readonly keydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const isSearchShortcut = (isOSX ? event.metaKey : event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f';
    const isReplaceShortcut = (isOSX ? event.metaKey : event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'r';
    if (!isSearchShortcut && !isReplaceShortcut) {
      return;
    }
    // Allow typing inside the Search Center itself; still intercept Monaco
    // editor focus so Theia SIW cannot steal Ctrl+Shift+F.
    if (target?.closest('[data-testid="search-center-modal"]')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.pendingMode = isReplaceShortcut ? 'replace' : 'search';
    void this.openView({ activate: true }).then(widget => {
      widget?.setMode?.(this.pendingMode);
      widget?.captureEditorSelection?.();
    });
  };

  constructor() {
    super({
      widgetId: SearchCenterWidget.ID,
      widgetName: 'Find in Path',
      defaultWidgetOptions: { area: 'main' },
      toggleCommandId: 'kairo.search.center.toggle',
    });
  }

  onStart(_app: FrontendApplication): void {
    window.addEventListener('keydown', this.keydown, true);
  }

  onStop(): void {
    window.removeEventListener('keydown', this.keydown, true);
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    super.registerKeybindings(keybindings);
    for (const key of THEIA_SEARCH_KEYS) {
      try {
        keybindings.unregisterKeybinding(key);
      } catch {
        // Binding may not exist on this platform / Theia version.
      }
    }
    try {
      keybindings.unregisterKeybinding({ id: 'search-in-workspace.open' } as any);
    } catch {
      // ignore
    }
    try {
      keybindings.unregisterKeybinding({ id: 'search-in-workspace.replace' } as any);
    } catch {
      // ignore
    }

    keybindings.registerKeybinding({
      command: 'kairo.search.center.toggle',
      keybinding: isOSX ? 'cmd+shift+f' : 'ctrl+shift+f',
    });
    keybindings.registerKeybinding({
      command: 'kairo.search.replace',
      keybinding: isOSX ? 'cmd+shift+r' : 'ctrl+shift+r',
    });
  }

  registerCommands(commands: import('@theia/core/lib/common/command').CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand({
      id: 'kairo.search.replace',
      label: 'Replace in Path',
    }, {
      execute: async () => {
        this.pendingMode = 'replace';
        const widget = await this.openView({ activate: true });
        widget?.setMode?.('replace');
        widget?.captureEditorSelection?.();
        return widget;
      },
    });
  }
}
