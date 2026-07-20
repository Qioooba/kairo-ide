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
import { WindowTitleContribution } from '@theia/core/lib/browser/window/window-title-service';
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
import { ImportWizardWidget, ProjectSelectorWidget } from '@kairo/project-extension';
import { KairoLargeFileContribution } from './kairo-large-file-contribution';
import { KairoLargeFilePreferenceContribution } from './kairo-large-file-preferences';

export const KAIRO_SERVERS_FACTORY_ID = 'kairo-server-view';
export const KAIRO_BUILDS_FACTORY_ID = 'kairo-build-view';
export const KAIRO_DEPLOYMENTS_FACTORY_ID = 'kairo-deployments';
export const KAIRO_LOGS_FACTORY_ID = 'kairo-log-viewer';
export const KAIRO_IMPORT_WIZARD_FACTORY_ID = 'kairo-import-wizard';
export const KAIRO_PROJECT_SELECTOR_FACTORY_ID = 'kairo-project-selector';

class KairoWindowTitleContribution implements WindowTitleContribution {
  enhanceTitle(_title: string): string {
    return 'Kairo IDE';
  }
}

export function bindKairoFrontend(bind: interfaces.Bind, _unbind?: interfaces.Unbind, _isBound?: interfaces.IsBound, _rebind?: interfaces.Rebind): void {
  // NOTE: Runtime service bindings (RuntimeConnectionService,
  // KairoRuntime, KairoErrorListener, WorkspaceContextService)
  // are handled by bindKairoProduct() in product-bindings.ts.
  // Do NOT duplicate them here — doing so causes "Could not
  // unbind serviceIdentifier" and "synchronous construction
  // with async dependencies" errors in the Theia DI container.

  // ── Kairo contributions ──────────────────────────────────────
  bind(KairoStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoStatusBarContribution);
  bind(KairoWindowTitleContribution).toSelf().inSingletonScope();
  bind(WindowTitleContribution).toService(KairoWindowTitleContribution);
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
  // Theia's standard modules already register these, but a missing
  // module in a stripped build causes the menu bar to throw
  // "No command X exists" at click time. This contribution guarantees
  // the commands are always present (either the real handler or a
  // friendly fallback message). See the file header for the long
  // version of this rationale.
  bind(KairoFileCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(KairoFileCommandsContribution);
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
}

export default new ContainerModule((bind, unbind, isBound, rebind) => {
  bindKairoFrontend(bind, unbind, isBound, rebind);
});
