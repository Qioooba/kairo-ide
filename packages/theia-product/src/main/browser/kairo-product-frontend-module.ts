/**
 * Kairo product — frontend Theia module.
 *
 * This is the single InversifyJS module that the browser app
 * loads via the `theiaExtensions[].frontend` field. It binds:
 *
 *   * `KairoViewsContribution`     — commands, view containers, event wiring
 *   * `KairoStatusBarContribution` — status bar entries
 *   * Widget factories for the four Kairo views
 *
 * Widgets are not bound globally; they are constructed lazily
 * by the `WidgetManager` when the user opens a view.
 *
 * Service-layer bindings (BuildStore, KairoProjectService,
 * KairoServerService, etc.) are handled by `bindKairoProduct`
 * in product-bindings.ts and are NOT duplicated here.
 * The KairoProductFrontend ContainerModule in product-frontend.ts
 * calls both bindKairoFrontend (this module) and bindKairoProduct
 * so the container is fully populated.
 */

import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  WidgetFactory,
} from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import {
  KairoDeploymentsWidget,
  KairoViewsContribution,
} from './kairo-views-contribution';
import { KairoStatusBarContribution } from './kairo-status-bar-contribution';
import { KairoFileCommandsContribution } from './kairo-file-commands';
import { KairoEncodingCommandsContribution } from '@kairo/encoding-extension';
import { BuildViewWidget } from '@kairo/build-extension';
import { ServerViewWidget, LogViewerWidget } from '@kairo/tomcat-extension';
import {
  RuntimeConnectionService,
  KairoRuntime,
  KairoErrorListener,
  KairoErrorListenerImpl,
  WorkspaceContextService,
} from '@kairo/runtime-extension';
import { ImportWizardWidget, ProjectSelectorWidget } from '@kairo/project-extension';
import { KairoWelcomeWidget, KAIRO_WELCOME_FACTORY_ID } from './kairo-welcome-widget';
import { KairoLargeFileContribution } from './kairo-large-file-contribution';
import { KairoLargeFilePreferenceContribution } from './kairo-large-file-preferences';
import {
  KAIRO_SERVERS_FACTORY_ID,
  KAIRO_BUILDS_FACTORY_ID,
  KAIRO_DEPLOYMENTS_FACTORY_ID,
  KAIRO_LOGS_FACTORY_ID,
  KAIRO_IMPORT_WIZARD_FACTORY_ID,
  KAIRO_PROJECT_SELECTOR_FACTORY_ID,
} from './kairo-factory-ids';

// Re-export so existing consumers can keep importing the IDs from
// this module; the definitions live in kairo-factory-ids.ts.
export {
  KAIRO_SERVERS_FACTORY_ID,
  KAIRO_BUILDS_FACTORY_ID,
  KAIRO_DEPLOYMENTS_FACTORY_ID,
  KAIRO_LOGS_FACTORY_ID,
  KAIRO_IMPORT_WIZARD_FACTORY_ID,
  KAIRO_PROJECT_SELECTOR_FACTORY_ID,
} from './kairo-factory-ids';

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
  bind(MenuContribution).toService(KairoViewsContribution);
  bind(CommandContribution).toService(KairoEncodingCommandsContribution);

  // KairoFileCommandsContribution is a defensive re-registration
  // of the standard Theia file.* / workspace:* / core.* commands.
  // Theia's standard modules already register these, but a
  // missing module in a stripped build causes the menu bar to
  // throw "No command X exists" at click time. This contribution
  // guarantees the commands are always present (either the real
  // handler or a friendly fallback message). See
  // kairo-file-commands.ts for the long version of this rationale.
  bind(KairoFileCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(KairoFileCommandsContribution);

  // KairoLargeFileContribution: adaptive large-file performance
  // mode (see kairo-large-file-contribution.ts).
  bind(KairoLargeFileContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoLargeFileContribution);
  bind(CommandContribution).toService(KairoLargeFileContribution);
  bind(PreferenceContribution).toConstantValue(KairoLargeFilePreferenceContribution);

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

  // Import Wizard and Project Selector are the primary entry
  // points for the Kairo project workflow. They must be reachable
  // from the composition root (command palette / File menu).
  bind(ImportWizardWidget).toSelf();
  bind(ProjectSelectorWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_IMPORT_WIZARD_FACTORY_ID,
    createWidget: () => ctx.container.get(ImportWizardWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_PROJECT_SELECTOR_FACTORY_ID,
    createWidget: () => ctx.container.get(ProjectSelectorWidget),
  })).inSingletonScope();

  // Welcome tab — the first-run entry point (KAIRO-RC-WEB-018).
  bind(KairoWelcomeWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_WELCOME_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoWelcomeWidget),
  })).inSingletonScope();
}

export default new ContainerModule((bind, unbind, isBound, rebind) => {
  bindKairoFrontend(bind, unbind, isBound, rebind);
});
