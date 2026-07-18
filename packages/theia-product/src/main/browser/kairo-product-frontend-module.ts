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
import {
  KairoServersWidget,
  KairoBuildsWidget,
  KairoDeploymentsWidget,
  KairoTomcatLogsWidget,
  KairoViewsContribution,
} from './kairo-views-contribution';
import { KairoStatusBarContribution } from './kairo-status-bar-contribution';

export const KAIRO_SERVERS_FACTORY_ID = 'kairo-servers';
export const KAIRO_BUILDS_FACTORY_ID = 'kairo-builds';
export const KAIRO_DEPLOYMENTS_FACTORY_ID = 'kairo-deployments';
export const KAIRO_LOGS_FACTORY_ID = 'kairo-logs';

export function bindKairoFrontend(bind: interfaces.Bind): void {
  bind(KairoStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoStatusBarContribution);
  bind(KairoViewsContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoViewsContribution);

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

