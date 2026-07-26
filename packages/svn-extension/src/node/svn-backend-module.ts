// SPDX-License-Identifier: Apache-2.0
//
// Kairo svn-extension — backend Theia module.
//
// Mirrors the java-extension pattern: the backend hosts the
// real SvnBackendServiceImpl (which can call child_process / fs)
// and exposes it over JSON-RPC at SvnBackendPath. The browser
// side talks through a proxy created with WebSocketConnectionProvider.

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { SvnBackendPath, SvnFrontendClient, SvnBackendService } from '../common/svn-protocol';
import { SvnBackendServiceImpl } from './svn-backend-service';

export default new ContainerModule(bind => {
  bind(SvnBackendServiceImpl).toSelf().inSingletonScope();
  bind(SvnBackendService).toService(SvnBackendServiceImpl);
  bind(ConnectionHandler).toDynamicValue(ctx =>
    new JsonRpcConnectionHandler<SvnFrontendClient>(SvnBackendPath, client => {
      const service = ctx.container.get(SvnBackendServiceImpl);
      service.setClient(client);
      return service;
    }),
  ).inSingletonScope();
});
