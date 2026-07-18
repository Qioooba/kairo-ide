/**
 * Composition root for Kairo extensions.
 *
 * Each Kairo extension exports either a `bind(bind)` function
 * (legacy form) or a `ContainerModule` (preferred, Theia 1.73+).
 * We import them all and load them into a single container.
 */

import type { interfaces, Container } from '@theia/core/shared/inversify';
import { ContainerModule } from '@theia/core/shared/inversify';

import { bindProjectExtension } from '@kairo/project-extension';
import { KairoRuntimeModule } from '@kairo/runtime-extension';
import { bindSearchExtension } from '@kairo/search-extension';
import { bindJspExtension } from '@kairo/jsp-extension';
import { bindTomcatExtension } from '@kairo/tomcat-extension';
import { bindJavaExtension } from '@kairo/java-extension';
import { KairoEncodingServiceImpl, KairoEncodingCommandsContribution, bindEncodingCommands } from '@kairo/encoding-extension';

/**
 * Single-shot binder used by `KairoProduct` (theia-product
 * ContainerModule) and by anyone wiring the Kairo extensions
 * by hand. Binds every Kairo service, including the runtime
 * client that everything else depends on.
 */
export function bindKairoProduct(bind: interfaces.Bind): void {
  bindProjectExtension(bind);
  bindSearchExtension(bind);
  bindJspExtension(bind);
  bindTomcatExtension(bind);
  bindJavaExtension(bind);
  bind(KairoEncodingServiceImpl).toSelf().inSingletonScope();
  bindEncodingCommands(bind);
}

/**
 * KairoProduct — the Theia ContainerModule that composes all
 * Kairo extensions. Defined here (next to the binder) to avoid
 * a circular import with product.ts.
 */
export const KairoProduct = new ContainerModule(bind => {
  bindKairoProduct(bind);
});

// Default export is the ContainerModule itself. Theia's
// `load(container, jsModule)` reads `jsModule.default`, so
// every product entry needs to expose one.
export default new ContainerModule(bind => {
  bindKairoProduct(bind);
});

/**
 * Load all Kairo extensions into the given container.
 * Apps call this once during Theia composition.
 */
export function loadKairoProduct(container: Container): void {
  container.load(KairoRuntimeModule);
  container.load(KairoProduct);
}
