/**
 * Composition root for Kairo extensions.
 *
 * Each Kairo extension exports either a `bind(bind)` function
 * (legacy form) or a `ContainerModule` (preferred, Theia 1.73+).
 * We import them all and load them into a single container.
 */

import type { interfaces, Container } from '@theia/core/shared/inversify';
import { ContainerModule } from '@theia/core/shared/inversify';

import { bindProjectExtension, ActiveProjectService } from '@kairo/project-extension';
import {
  KairoRuntimeModule,
  RuntimeConnectionService,
  KairoRuntime,
  KairoErrorListener,
  KairoErrorListenerImpl,
  WorkspaceContextService,
  RUNTIME_BASE_URL,
} from '@kairo/runtime-extension';
import { bindSearchExtension } from '@kairo/search-extension';
import { bindJspExtension } from '@kairo/jsp-extension';
import { bindTomcatExtension } from '@kairo/tomcat-extension';
import { bindJavaExtension, bindJavaLanguageClientContribution } from '@kairo/java-extension';
import { KairoEncodingServiceImpl, bindEncodingCommands } from '@kairo/encoding-extension';
import { bindBuildExtension } from '@kairo/build-extension';
import { KairoThemeContribution } from '@kairo/ui-kit';

/**
 * Bind an identifier to self in singleton scope, using rebind
 * if the identifier is already bound, otherwise bind.
 */
export function bindOrRebindSelf(
  bind: interfaces.Bind,
  isBound: interfaces.IsBound,
  rebind: interfaces.Rebind,
  ident: any,
): void {
  if (isBound(ident)) {
    rebind(ident).toSelf().inSingletonScope();
  } else {
    bind(ident).toSelf().inSingletonScope();
  }
}

/**
 * Single-shot binder used by `KairoProduct` (theia-product
 * ContainerModule) and by anyone wiring the Kairo extensions
 * by hand. Binds every Kairo service, including the runtime
 * client that everything else depends on.
 *
 * Uses isBound/rebind so that `loadKairoProduct` (which loads
 * KairoRuntimeModule before KairoProduct) can safely coexist
 * with direct use of the KairoProduct ContainerModule.
 */
export function bindKairoProduct(
  bind: interfaces.Bind,
  isBound?: interfaces.IsBound,
  rebind?: interfaces.Rebind,
): void {
  // Runtime client — every other Kairo extension depends on
  // RuntimeConnectionService (the single HTTP client to the Go
  // Runtime Agent). These bindings mirror KairoRuntimeModule.
  if (isBound && rebind) {
    bindOrRebindSelf(bind, isBound, rebind, RuntimeConnectionService);
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

  // Workspace context service
  if (isBound && rebind) {
    bindOrRebindSelf(bind, isBound, rebind, WorkspaceContextService);
  } else {
    bind(WorkspaceContextService).toSelf().inSingletonScope();
  }

  bindProjectExtension(bind);
  // Active project service
  if (isBound && rebind) {
    bindOrRebindSelf(bind, isBound, rebind, ActiveProjectService);
  } else {
    bind(ActiveProjectService).toSelf().inSingletonScope();
  }
  bindSearchExtension(bind);
  bindJspExtension(bind);
  bindTomcatExtension(bind);
  bindBuildExtension(bind);
  bindJavaExtension(bind);
  bindJavaLanguageClientContribution(bind);
  bind(KairoEncodingServiceImpl).toSelf().inSingletonScope();
  bindEncodingCommands(bind);

  // Theme contribution
  if (isBound && rebind) {
    bindOrRebindSelf(bind, isBound, rebind, KairoThemeContribution);
  } else {
    bind(KairoThemeContribution).toSelf().inSingletonScope();
  }
}

/**
 * KairoProduct — the Theia ContainerModule that composes all
 * Kairo extensions. Defined here (next to the binder) to avoid
 * a circular import with product.ts.
 *
 * When loaded, it binds every Kairo service and configures the
 * RuntimeConnectionService on first activation so that the
 * runtime client is ready to use without a separate bootstrap
 * call (previously done by configureKairoRuntime).
 */
export const KairoProduct = new ContainerModule((bind, _unbind, isBound, rebind, onActivation) => {
  bindKairoProduct(bind, isBound, rebind);

  // Configure the runtime client on first activation, matching
  // the behaviour that configureKairoRuntime() previously provided.
  // The base URL is read from the global KAIRO_RUNTIME_BASE_URL if
  // set by the host HTML page, otherwise the empty-string default.
  onActivation((svc: RuntimeConnectionService) => {
    const baseUrl: string =
      (typeof window !== 'undefined' && (window as any).KAIRO_RUNTIME_BASE_URL) ||
      RUNTIME_BASE_URL;
    svc.configure({ baseUrl });
    return svc;
  });
});

// Default export re-exports the named ContainerModule so that
// Theia's `load(container, jsModule)` (which reads `jsModule.default`)
// uses the same single KairoProduct composition root.
export default KairoProduct;

/**
 * Load all Kairo extensions into the given container.
 * Apps call this once during Theia composition.
 */
export function loadKairoProduct(container: Container): void {
  container.load(KairoRuntimeModule);
  container.load(KairoProduct);
}
