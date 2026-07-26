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
  RuntimeConnectionService,
  KairoRuntime,
  KairoErrorListener,
  KairoErrorListenerImpl,
  WorkspaceContextService,
} from '@kairo/runtime-extension';
import { bindSearchExtension } from '@kairo/search-extension';
import { bindJspExtension } from '@kairo/jsp-extension';
import { bindTomcatExtension } from '@kairo/tomcat-extension';
import {
  bindJavaExtension,
  bindJavaLanguageClientContribution,
} from '@kairo/java-extension';
import { KairoEncodingServiceImpl, bindEncodingCommands } from '@kairo/encoding-extension';
import { bindBuildExtension } from '@kairo/build-extension';
import { bindTestExtension } from '@kairo/test-extension';

/**
 * Single-shot binder used by `KairoProduct` (theia-product
 * ContainerModule) and by anyone wiring the Kairo extensions
 * by hand. Binds every Kairo service, including the runtime
 * client that everything else depends on.
 *
 * The four runtime-client bindings are guarded by `isBound` so
 * this binder is idempotent when composed after
 * `bindKairoFrontend` (which binds the same services) inside
 * `KairoProductFrontend` — a duplicate `bind()` for one
 * identifier makes `container.get()` throw "Ambiguous match"
 * and kills frontend startup (KAIRO-RC-WEB-001). Standalone
 * use (KairoProduct module / loadKairoProduct) passes a fresh
 * container where `isBound` is false, so the bindings are
 * still installed.
 */
export function bindKairoProduct(
  bind: interfaces.Bind,
  isBound?: interfaces.IsBound,
  _rebind?: interfaces.Rebind,
): void {
  // Runtime client — every other Kairo extension depends on
  // RuntimeConnectionService (the single HTTP client to the Go
  // Runtime Agent). These bindings mirror KairoRuntimeModule and
  // the ones in bindKairoFrontend; skip any that already exist.
  if (!isBound || !isBound(RuntimeConnectionService)) {
    bind(RuntimeConnectionService).toSelf().inSingletonScope();
  }
  if (!isBound || !isBound(KairoRuntime)) {
    bind(KairoRuntime).toService(RuntimeConnectionService);
  }
  if (!isBound || !isBound(KairoErrorListener)) {
    bind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
  }

  // Workspace context service
  if (!isBound || !isBound(WorkspaceContextService)) {
    bind(WorkspaceContextService).toSelf().inSingletonScope();
  }

  bindProjectExtension(bind);
  bind(ActiveProjectService).toSelf().inSingletonScope();
  bindSearchExtension(bind);
  bindJspExtension(bind);
  bindTomcatExtension(bind);
  bindBuildExtension(bind);
  bindTestExtension(bind);
  bindJavaExtension(bind);
  bindJavaLanguageClientContribution(bind);
  bind(KairoEncodingServiceImpl).toSelf().inSingletonScope();
  bindEncodingCommands(bind);

  // Theme contribution is registered by @kairo/ui-kit (the only
  // owner of KairoThemeContribution). Re-binding here would throw
  // "Attempted to construct KairoThemeContribution twice" because
  // the service is already bound to a singleton in the UI kit
  // module that loaded before us. See N-034.
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
export const KairoProduct = new ContainerModule((bind, _unbind, isBound, rebind, _onActivation) => {
  bindKairoProduct(bind, isBound, rebind);
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
  // KairoProduct already binds all runtime services via
  // bindKairoProduct, so we no longer need to pre-load
  // KairoRuntimeModule (which would cause duplicate bindings).
  container.load(KairoProduct);
}
