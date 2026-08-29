/**
 * Kairo Extensions Frontend Module — Theia frontend ContainerModule.
 *
 * Binds the Extensions view widget, commands, and menu contributions.
 */

import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  WidgetFactory,
} from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { KairoExtensionsWidget } from './kairo-extensions-widget';
import { KairoExtensionsContribution } from './kairo-extensions-contribution';
import { KairoExtensionService, KAIRO_EXTENSION_SERVICE_PATH } from '../common/kairo-extension-protocol';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';

export const KAIRO_EXTENSIONS_FACTORY_ID = 'kairo-extensions';

export function bindKairoExtensions(bind: interfaces.Bind): void {
  // RPC proxy to the backend extension service
  bind(KairoExtensionService).toDynamicValue(ctx => {
    const connection = ctx.container.get(WebSocketConnectionProvider);
    return connection.createProxy<KairoExtensionService>(KAIRO_EXTENSION_SERVICE_PATH);
  }).inSingletonScope();

  // Extensions widget
  bind(KairoExtensionsWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_EXTENSIONS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoExtensionsWidget),
  })).inSingletonScope();

  // Commands, menus, keybindings
  bind(KairoExtensionsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(KairoExtensionsContribution);
  bind(MenuContribution).toService(KairoExtensionsContribution);
  bind(KeybindingContribution).toService(KairoExtensionsContribution);
  bind(FrontendApplicationContribution).toService(KairoExtensionsContribution);
}

export default new ContainerModule((bind, unbind, isBound, rebind) => {
  bindKairoExtensions(bind);
});