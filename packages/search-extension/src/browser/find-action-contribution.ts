import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import { FindActionWidget } from './find-action-widget';

@injectable()
export class FindActionContribution extends AbstractViewContribution<FindActionWidget> {
  constructor() {
    super({
      widgetId: FindActionWidget.ID,
      widgetName: 'Kairo Find Action',
      defaultWidgetOptions: { area: 'main' },
      toggleCommandId: 'kairo.find.action',
    });
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    super.registerKeybindings(keybindings);
    keybindings.registerKeybinding({
      command: 'kairo.find.action',
      keybinding: isOSX ? 'cmd+shift+a' : 'ctrl+shift+a',
    });
  }
}