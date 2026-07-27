import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { SearchCenterWidget } from './search-center-widget';

@injectable()
export class SearchCenterContribution extends AbstractViewContribution<SearchCenterWidget> {
  protected readonly keydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const isSearchShortcut = (isOSX ? event.metaKey : event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f';
    const isReplaceShortcut = (isOSX ? event.metaKey : event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'r';
    if (isSearchShortcut || isReplaceShortcut) {
      if (target?.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void this.openView({ activate: true });
    }
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
  }

  registerCommands(commands: import('@theia/core/lib/common/command').CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand({
      id: 'kairo.search.replace',
      label: 'Replace in Path',
    }, {
      execute: async () => {
        return this.openView({ activate: true });
      },
    });
  }
}
