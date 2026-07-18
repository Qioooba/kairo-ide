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
 * The actual definition lives in `./product-bindings` to keep
 * the binder and the ContainerModule in one place and avoid a
 * circular import.
 */

export { KairoProduct, default } from './product-bindings';
