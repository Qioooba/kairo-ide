import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import { FindFileWidget } from './find-file-widget';
import { openBodyOverlay } from './open-body-overlay';

@injectable()
export class FindFileContribution extends AbstractViewContribution<FindFileWidget> {
  constructor() {
    super({
      widgetId: FindFileWidget.ID,
      widgetName: 'Kairo Find File',
      defaultWidgetOptions: { area: 'main' },
      toggleCommandId: 'kairo.find.file',
    });
  }

  override async openView(_args?: Partial<{ activate: boolean; reveal: boolean }>): Promise<FindFileWidget> {
    return openBodyOverlay(this.widgetManager, FindFileWidget.ID) as Promise<FindFileWidget>;
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    super.registerKeybindings(keybindings);
    keybindings.registerKeybinding({
      command: 'kairo.find.file',
      keybinding: isOSX ? 'cmd+shift+o' : 'ctrl+shift+n',
    });
  }
}
