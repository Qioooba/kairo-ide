// SPDX-License-Identifier: Apache-2.0
//
// Kairo git-extension — backend Theia module.
//
// Hosts the real GitBackendServiceImpl (child_process / fs live here)
// and exposes it over JSON-RPC at GitBackendPath, mirroring the
// svn-extension backend module.

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { GitBackendPath, GitBackendService } from '../common/git-protocol';
import { GitBackendServiceImpl } from './git-backend-service';

export default new ContainerModule(bind => {
  bind(GitBackendServiceImpl).toSelf().inSingletonScope();
  bind(GitBackendService).toService(GitBackendServiceImpl);
  bind(ConnectionHandler).toDynamicValue(ctx =>
    new JsonRpcConnectionHandler<GitBackendService>(GitBackendPath, () =>
      ctx.container.get<GitBackendServiceImpl>(GitBackendServiceImpl),
    ),
  ).inSingletonScope();
});
