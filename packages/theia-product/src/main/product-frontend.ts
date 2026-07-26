import { ContainerModule } from '@theia/core/shared/inversify';
import { bindKairoFrontend } from './browser/kairo-product-frontend-module';
import { bindKairoProduct } from './product-bindings';

export { bindKairoFrontend };

export const KairoProductFrontend: ContainerModule = new ContainerModule((bind, _unbind, isBound, rebind) => {
  bindKairoFrontend(bind, undefined, isBound, rebind);
  bindKairoProduct(bind, isBound, rebind);
});

export default KairoProductFrontend;
