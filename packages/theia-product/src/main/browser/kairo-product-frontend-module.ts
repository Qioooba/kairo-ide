/**
 * Kairo product — frontend Theia module.
 *
 * This is the single InversifyJS module that the browser app
 * loads via the `theiaExtensions[].frontend` field. It binds:
 *
 *   * `KairoViewsContribution`     — commands, view containers, event wiring
 *   * `KairoStatusBarContribution` — status bar entries
 *   * Every Kairo service the contributions / widgets need
 *
 * Widgets are not bound globally; they are constructed lazily
 * by the `WidgetManager` when the user opens a view.
 *
 * Binding the per-extension services here is required:
 * KairoStatusBarContribution and KairoViewsContribution inject
 * KairoProjectService / KairoServerService / ServerStore /
 * BuildStore / KairoEncodingServiceImpl / KairoJavaService.
 * Without these bindings in the frontend container inversify
 * throws "No matching bindings found" and the React shell
 * crashes to a blank page (N-023 / N-026 in MILESTONES.md).
 */

import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  WidgetFactory,
} from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common';
import {
  KairoDeploymentsWidget,
  KairoViewsContribution,
} from './kairo-views-contribution';
import { KairoStatusBarContribution } from './kairo-status-bar-contribution';
import {
  KairoEncodingServiceImpl,
  KairoEncodingCommandsContribution,
  bindEncodingCommands,
} from '@kairo/encoding-extension';
import { BuildViewWidget, bindBuildExtension } from '@kairo/build-extension';
import {
  ServerViewWidget,
  LogViewerWidget,
  bindTomcatExtension,
} from '@kairo/tomcat-extension';
import { KairoProjectService, ActiveProjectService, bindProjectExtension } from '@kairo/project-extension';
import { KairoJavaService, bindJavaExtension, bindJavaLanguageClientContribution } from '@kairo/java-extension';
import { bindSearchExtension } from '@kairo/search-extension';
import { bindJspExtension } from '@kairo/jsp-extension';
import {
  RuntimeConnectionService,
  KairoRuntime,
  KairoErrorListener,
  KairoErrorListenerImpl,
  WorkspaceContextService,
} from '@kairo/runtime-extension';

export const KAIRO_SERVERS_FACTORY_ID = 'kairo-server-view';
export const KAIRO_BUILDS_FACTORY_ID = 'kairo-build-view';
export const KAIRO_DEPLOYMENTS_FACTORY_ID = 'kairo-deployments';
export const KAIRO_LOGS_FACTORY_ID = 'kairo-log-viewer';

export function bindKairoFrontend(bind: interfaces.Bind, unbind?: interfaces.Unbind, isBound?: interfaces.IsBound, rebind?: interfaces.Rebind): void {
  // ── Kairo runtime client + workspace context ────────────────
  // Mirrors KairoRuntimeModule in
  // packages/runtime-extension/src/browser/index.ts. We have
  // to inline the bindings here because Theia loads this
  // module via `theiaExtensions[].frontend` and does not
  // give us a `container.load(...)` hook to compose the
  // existing KairoRuntimeModule ContainerModule.
  // Bindings: RuntimeConnectionService, KairoRuntime,
  // KairoErrorListener, WorkspaceContextService. Every
  // per-extension service below injects at least one of
  // these, so they must be in the frontend container
  // (N-023 / N-026 in MILESTONES.md).
  if (isBound && rebind && isBound(RuntimeConnectionService)) {
    rebind(RuntimeConnectionService).toSelf().inSingletonScope();
  } else {
    bind(RuntimeConnectionService).toSelf().inSingletonScope();
  }
  if (isBound && rebind && isBound(KairoRuntime)) {
    rebind(KairoRuntime).toService(RuntimeConnectionService);
  } else {
    bind(KairoRuntime).toService(RuntimeConnectionService);
  }
  if (isBound && rebind && isBound(KairoErrorListener)) {
    rebind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
  } else {
    bind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
  }
  if (isBound && rebind && isBound(WorkspaceContextService)) {
    rebind(WorkspaceContextService).toSelf().inSingletonScope();
  } else {
    bind(WorkspaceContextService).toSelf().inSingletonScope();
  }

  // ── Kairo per-extension services ─────────────────────────────
  // These must be in the frontend container because the
  // contributions below inject them.
  bindProjectExtension(bind);                  // KairoProjectService
  bindTomcatExtension(bind);                   // KairoServerService, ServerStore, ServerViewWidget
  bindBuildExtension(bind);                    // BuildStore, BuildViewWidget
  bindJavaExtension(bind);                     // KairoJavaService
  bindJavaLanguageClientContribution(bind);    // Java language client (frontend side)
  bindSearchExtension(bind);                   // KairoSearchService
  bindJspExtension(bind);                      // KairoJspService
  bind(KairoEncodingServiceImpl).toSelf().inSingletonScope();
  bindEncodingCommands(bind);                  // KairoEncodingCommandsContribution
  // Active project service lives in project-extension.
  bind(ActiveProjectService).toSelf().inSingletonScope();

  // ── Kairo contributions ──────────────────────────────────────
  bind(KairoStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoStatusBarContribution);
  bind(KairoViewsContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoViewsContribution);
  // The Kairo views contribution also registers commands
  // (Build / Build & Deploy / Start / Stop / etc.). Bind
  // it as a CommandContribution so Theia's command registry
  // picks up the methods.
  bind(CommandContribution).toService(KairoViewsContribution);
  bind(CommandContribution).toService(KairoEncodingCommandsContribution);

  bind(KairoDeploymentsWidget).toSelf();

  // Register widget factories so the WidgetManager can lazily
  // construct each view the first time the user opens it.
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_SERVERS_FACTORY_ID,
    createWidget: () => ctx.container.get(ServerViewWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_BUILDS_FACTORY_ID,
    createWidget: () => ctx.container.get(BuildViewWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEPLOYMENTS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDeploymentsWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_LOGS_FACTORY_ID,
    createWidget: () => ctx.container.get(LogViewerWidget),
  })).inSingletonScope();
}

export default new ContainerModule((bind, unbind, isBound, rebind) => {
  bindKairoFrontend(bind, unbind, isBound, rebind);
});

