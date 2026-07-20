/**
 * Kairo browser entry. Loaded by Theia as a frontend module.
 *
 * The Kairo runtime client is configured at startup by reading
 * a global KairoRuntimeConfig (set by the host HTML page or
 * injected by the Theia backend). The browser app does NOT
 * reach into the DOM to extract the Inversify container; the
 * proper composition is done via the Theia ContainerModule
 * loaded by the product package.
 *
 * @deprecated configureKairoRuntime is no longer needed — the
 * service-layer bindings are now composed inside
 * KairoProductFrontend (loaded by the Theia browser app as the
 * default export of @kairo/theia-product). Calling this function
 * manually is a no-op if the module has already been loaded.
 */

import { Container } from '@theia/core/shared/inversify';
import { KairoProduct } from '@kairo/theia-product';
import { KairoRuntime, RuntimeConnectionService, RUNTIME_BASE_URL } from '@kairo/runtime-extension';
import { KairoProjectService } from '@kairo/project-extension';
import { KairoServerService } from '@kairo/tomcat-extension';
import { KairoSearchService } from '@kairo/search-extension';
import { KairoJavaService } from '@kairo/java-extension';

/**
 * @deprecated Since KairoProductFrontend now composes the
 * service-layer bindings (via bindKairoProduct) and configures
 * the RuntimeConnectionService on activation, this function is
 * no longer required. It is kept for backward compatibility
 * with any code that may still call it, but the DI container
 * will already be fully populated when the Theia browser app
 * loads @kairo/theia-product.
 */
export function configureKairoRuntime(container: Container, baseUrl: string = RUNTIME_BASE_URL): void {
  // Bind Kairo's product modules.
  container.load(KairoProduct);

  // Configure the singleton runtime client. The base URL is
  // either passed in by the host or read from the global config.
  const runtime = container.get<RuntimeConnectionService>(KairoRuntime);
  runtime.configure({ baseUrl });

  // Eagerly construct the high-level services so they are
  // available in the container from the start.
  container.get(KairoProjectService);
  container.get(KairoServerService);
  container.get(KairoSearchService);
  container.get(KairoJavaService);
}

declare const window: Window & {
  KAIRO_RUNTIME_BASE_URL?: string;
};

// Top-level entry: if the host HTML page has set a global base
// URL, use it. Otherwise RuntimeConnectionService.init() falls
// back to the dev default (http://127.0.0.1:18080).
if (typeof window !== 'undefined' && window.KAIRO_RUNTIME_BASE_URL) {
  (globalThis as any).__KAIRO_DEFAULT_RUNTIME_URL__ = window.KAIRO_RUNTIME_BASE_URL;
}

export { KairoProjectService, KairoServerService, KairoSearchService, KairoJavaService };
