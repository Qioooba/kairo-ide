import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { FindSymbolWidget } from './find-symbol-widget';

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

  registerKeybindings(keybindings: KeybindingRegistry): void {
    super.registerKeybindings(keybindings);
    keybindings.registerKeybinding({
      command: 'kairo.find.symbol',
      keybinding: 'ctrlcmd+alt+shift+n',
    });
  }
}