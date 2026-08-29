/**
 * Kairo Extensions Backend Module — Theia backend ContainerModule.
 *
 * Binds the KairoExtensionService implementation and the
 * PluginHost contribution so the IDE can load VS Code extensions.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { KairoExtensionServiceImpl } from './kairo-extension-service';
import { JsonRpcConnectionHandler, ConnectionHandler } from '@theia/core/lib/common/messaging';

import { KairoExtensionService, KAIRO_EXTENSION_SERVICE_PATH } from '../common/kairo-extension-protocol';
export default new ContainerModule((bind, unbind, isBound, rebind) => {
  // Bind the extension service implementation
  bind(KairoExtensionServiceImpl).toSelf().inSingletonScope();
  bind(KairoExtensionService).toService(KairoExtensionServiceImpl);

  // Register RPC handler so the frontend can call the backend
  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(KairoExtensionServiceImpl);
    return new JsonRpcConnectionHandler(KAIRO_EXTENSION_SERVICE_PATH, () => service);
  }).inSingletonScope();
});