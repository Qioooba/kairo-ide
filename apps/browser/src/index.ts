/**
 * Kairo browser entry. Loaded by Theia as a frontend module.
 *
 * The Kairo runtime client is configured at startup by reading
 * a global KairoRuntimeConfig (set by the host HTML page or
 * injected by the Theia backend). The browser app does NOT
 * reach into the DOM to extract the Inversify container; the
 * proper composition is done via the Theia ContainerModule
 * loaded by the product package.
 */

import { Container } from '@theia/core/shared/inversify';
import { KairoProduct } from '@kairo/theia-product';
import { KairoRuntime, KairoRuntimeImpl, RUNTIME_BASE_URL } from '@kairo/runtime-extension';
import { KairoProjectService } from '@kairo/project-extension';
import { KairoServerService } from '@kairo/tomcat-extension';
import { KairoSearchService } from '@kairo/search-extension';
import { KairoJavaService } from '@kairo/java-extension';

// Hook used by the Theia browser app to load Kairo's frontend
// services. The actual Theia composition happens in
// packages/theia-product/src/browser/product.ts (which uses
// theia/lib/browser's FrontendApplicationContribution pattern).
export function configureKairoRuntime(container: Container, baseUrl: string = RUNTIME_BASE_URL): void {
  // Bind Kairo's product modules.
  container.load(KairoProduct);

  // Configure the singleton runtime client. The base URL is
  // either passed in by the host or read from the global config.
  const runtime = container.get<KairoRuntimeImpl>(KairoRuntime);
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
// URL, use it. Otherwise fall back to the loopback default.
if (typeof window !== 'undefined' && window.KAIRO_RUNTIME_BASE_URL) {
  (globalThis as any).__KAIRO_DEFAULT_RUNTIME_URL__ = window.KAIRO_RUNTIME_BASE_URL;
}

export { KairoProjectService, KairoServerService, KairoSearchService, KairoJavaService };
