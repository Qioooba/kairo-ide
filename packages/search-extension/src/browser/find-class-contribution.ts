import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import { FindClassWidget } from './find-class-widget';

@injectable()
export class FindClassContribution extends AbstractViewContribution<FindClassWidget> {
  constructor() {
    super({
      widgetId: FindClassWidget.ID,
      widgetName: 'Kairo Find Class',
      defaultWidgetOptions: { area: 'main' },
      toggleCommandId: 'kairo.find.class',
    });
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    super.registerKeybindings(keybindings);
    keybindings.registerKeybinding({
      command: 'kairo.find.class',
      keybinding: isOSX ? 'cmd+o' : 'ctrl+n',
    });
  }
}