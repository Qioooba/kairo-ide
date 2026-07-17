/**
 * Composition root for Kairo extensions.
 *
 * Each Kairo extension exports a `bind(Bind)` function from its
 * own package. We import them all and call them in the right
 * order. The order is important: the runtime extension
 * establishes the HTTP client that everything else uses, so it
 * goes first; the project extension registers the workspace
 * model; UI extensions go last.
 */

import { interfaces } from '@theia/core/shared/inversify';

import { bindProjectExtension } from '@kairo/project-extension/lib/browser';
import { bindRuntimeExtension } from '@kairo/runtime-extension/lib/browser';
import { bindSearchExtension } from '@kairo/search-extension/lib/browser';
import { bindJspExtension } from '@kairo/jsp-extension/lib/browser';
import { bindTomcatExtension } from '@kairo/tomcat-extension/lib/browser';
import { bindJavaExtension } from '@kairo/java-extension/lib/browser';

export function bindKairoProduct(bind: interfaces.Bind): void {
  bindRuntimeExtension(bind);
  bindProjectExtension(bind);
  bindSearchExtension(bind);
  bindJspExtension(bind);
  bindTomcatExtension(bind);
  bindJavaExtension(bind);
}
