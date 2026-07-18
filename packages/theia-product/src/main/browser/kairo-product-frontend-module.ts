/**
 * Kairo product — frontend Theia module.
 *
 * This is the single InversifyJS module that the browser app
 * loads via the `theiaExtensions[].frontend` field. It binds:
 *
 *   * `KairoViewsContribution`     — commands, view containers, event wiring
 *   * `KairoStatusBarContribution` — status bar entries
 *
 * Widgets are not bound globally; they are constructed lazily
 * by the `WidgetManager` when the user opens a view.
 */

import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  WidgetFactory,
  WidgetManager,
} from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common';
import {
  KairoServersWidget,
  KairoBuildsWidget,
  KairoDeploymentsWidget,
  KairoTomcatLogsWidget,
  KairoViewsContribution,
} from './kairo-views-contribution';
import { KairoStatusBarContribution } from './kairo-status-bar-contribution';
import { KairoEncodingCommandsContribution } from '@kairo/encoding-extension';

export const KAIRO_SERVERS_FACTORY_ID = 'kairo-servers';
export const KAIRO_BUILDS_FACTORY_ID = 'kairo-builds';
export const KAIRO_DEPLOYMENTS_FACTORY_ID = 'kairo-deployments';
export const KAIRO_LOGS_FACTORY_ID = 'kairo-logs';

export function bindKairoFrontend(bind: interfaces.Bind): void {
  bind(KairoStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoStatusBarContribution);
  bind(KairoViewsContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoViewsContribution);
  // The Kairo views contribution also registers commands
  // (Build / Build & Deploy / Start / Stop / etc.). Bind
  // it as a CommandContribution so Theia's command registry
  // picks up the methods. (Previously the
  // registerCommands(registry) method existed but no one
  // called it — v0.3-encoding fixes this so the palette
  // entries actually appear.)
  bind(CommandContribution).toService(KairoViewsContribution);

  bind(KairoEncodingCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(KairoEncodingCommandsContribution);

  bind(KairoServersWidget).toSelf();
  bind(KairoBuildsWidget).toSelf();
  bind(KairoDeploymentsWidget).toSelf();
  bind(KairoTomcatLogsWidget).toSelf();

  // Register widget factories so the WidgetManager can lazily
  // construct each view the first time the user opens it.
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_SERVERS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoServersWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_BUILDS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoBuildsWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEPLOYMENTS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDeploymentsWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_LOGS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoTomcatLogsWidget),
  })).inSingletonScope();
  bind(WidgetManager).toSelf().inSingletonScope();
}

export default new ContainerModule(bind => bindKairoFrontend(bind));

