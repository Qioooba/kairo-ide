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
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { bindKairoProduct } from './product-bindings';

export const KairoProduct = new ContainerModule(bind => {
  bindKairoProduct(bind);
});

export default KairoProduct;
