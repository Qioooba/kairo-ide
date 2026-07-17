/**
 * The browser-side module that wires the KairoRuntime into
 * inversify.
 */

import { interfaces } from '@theia/core/shared/inversify';
import { KairoRuntime, KairoRuntimeFactory, KairoRuntimeConfig } from './runtime';

export { KairoRuntime, KairoRuntimeFactory };

export const RUNTIME_BASE_URL = 'http://127.0.0.1:18099';

export function bindRuntimeExtension(bind: interfaces.Bind): void {
  bind(KairoRuntimeFactory).toFactory(ctx => (cfg: KairoRuntimeConfig) => {
    const r = ctx.container.get(KairoRuntime);
    r.configure(cfg);
    return r;
  });
  bind(KairoRuntime).to(KairoRuntime).inSingletonScope();
}
