/**
 * Kairo browser entry. Loaded by Theia as a frontend.
 *
 * The Runtime Agent is started by the host process
 * (apps/server or apps/desktop). The Kairo runtime client
 * is configured to point at it on startup.
 */

import '@kairo/theia-product';
import { KairoRuntime, RUNTIME_BASE_URL } from '@kairo/runtime-extension/lib/browser';

export default () => {
  const container = window.$(document.body).data('kairo.container');
  if (container) {
    const runtime = container.get(KairoRuntime);
    runtime.configure({ baseUrl: RUNTIME_BASE_URL });
  }
};
