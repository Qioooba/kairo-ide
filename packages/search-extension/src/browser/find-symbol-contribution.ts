import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import { FindSymbolWidget } from './find-symbol-widget';
import { openBodyOverlay } from './open-body-overlay';

@injectable()
export class FindSymbolContribution extends AbstractViewContribution<FindSymbolWidget> {
  constructor() {
    super({
      widgetId: FindSymbolWidget.ID,
      widgetName: 'Kairo Find Symbol',
      defaultWidgetOptions: { area: 'main' },
      toggleCommandId: 'kairo.find.symbol',
    });
  }

  override async openView(_args?: Partial<{ activate: boolean; reveal: boolean }>): Promise<FindSymbolWidget> {
    return openBodyOverlay(this.widgetManager, FindSymbolWidget.ID) as Promise<FindSymbolWidget>;
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    super.registerKeybindings(keybindings);
    keybindings.registerKeybinding({
      command: 'kairo.find.symbol',
      keybinding: isOSX ? 'cmd+alt+o' : 'ctrl+alt+shift+n',
    });
  }
}
