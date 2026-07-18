/**
 * KairoProduct — the Theia ContainerModule that composes all
 * Kairo extensions.
 *
 * Apps load this module via:
 *
 *   import { KairoProduct } from '@kairo/theia-product';
 *   new ContainerModule(bind => bind(KairoProduct).toConstantValue(KairoProduct));
 *
 * Or, more commonly, simply:
 *
 *   const container = new Container();
 *   container.load(KairoProduct);
 *
 * which is what `apps/browser/index.js` does.
 *
 * The frontend module (status bar, views, commands) is loaded
 * via a separate import path so that the Theia server app does
 * not pull browser-only code into its own process.
 */

import type { interfaces } from '@theia/core/shared/inversify';
import { KairoProduct as KairoProductFromBindings } from './product-bindings';

export {
  KAIRO_SERVERS_FACTORY_ID,
  KAIRO_BUILDS_FACTORY_ID,
  KAIRO_DEPLOYMENTS_FACTORY_ID,
  KAIRO_LOGS_FACTORY_ID,
} from './browser/kairo-product-frontend-module';

// Re-export from product-bindings so that the runtime bindings
// (KairoRuntimeImpl, KairoRuntime, KairoErrorListener) are
// always included, whether the caller uses `loadKairoProduct()`
// or loads KairoProduct directly.
export const KairoProduct: interfaces.ContainerModule = KairoProductFromBindings;

export default KairoProduct;
