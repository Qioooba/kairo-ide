/**
 * Composition root for Kairo extensions.
 *
 * Each Kairo extension exports either a `bind(bind)` function
 * (legacy form) or a `ContainerModule` (preferred, Theia 1.73+).
 * We import them all and load them into a single container.
 */

import type { interfaces, Container } from '@theia/core/shared/inversify';

import { bindProjectExtension } from '@kairo/project-extension';
import { KairoRuntime, KairoRuntimeImpl, KairoRuntimeModule } from '@kairo/runtime-extension';
import { bindSearchExtension } from '@kairo/search-extension';
import { bindJspExtension } from '@kairo/jsp-extension';
import { bindTomcatExtension } from '@kairo/tomcat-extension';
import { bindJavaExtension } from '@kairo/java-extension';
import { KairoEncodingServiceImpl, KairoEncodingCommandsContribution, bindEncodingCommands } from '@kairo/encoding-extension';

/**
 * Load all Kairo extensions into the given container.
 * Apps call this once during Theia composition.
 *
 * The frontend module (status bar, views, commands) is NOT
 * loaded here. It is loaded by the Theia browser app via
 * `theiaExtensions[].frontend` (see `./product-frontend.ts`),
 * so the Theia server / Electron host process does not need
 * to drag browser-only Inversify bindings into its own runtime.
 */
export function loadKairoProduct(container: Container): void {
  container.load(KairoRuntimeModule);
  bindKairoProduct(container.bind.bind(container));
}

/**
 * Single-shot binder used by `KairoProduct` (theia-product
 * ContainerModule) and by anyone wiring the Kairo extensions
 * by hand. Binds every Kairo service, including the runtime
 * client that everything else depends on.
 */
export function bindKairoProduct(bind: interfaces.Bind): void {
  bind(KairoRuntime).to(KairoRuntimeImpl).inSingletonScope();
  bindProjectExtension(bind);
  bindSearchExtension(bind);
  bindJspExtension(bind);
  bindTomcatExtension(bind);
  bindJavaExtension(bind);
  bind(KairoEncodingServiceImpl).toSelf().inSingletonScope();
  bindEncodingCommands(bind);
}
