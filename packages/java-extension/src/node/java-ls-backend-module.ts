// SPDX-License-Identifier: Apache-2.0
//
// Kairo java-extension — backend Theia module.
//
// KAIRO-RC-WEB-251: the browser bundle used to instantiate the
// node-side JdtLsService in-process (java-language-client.ts
// injected it directly). In the web product every fs/spawn
// call inside it hit webpack's browser shims — the JDT LS
// install check failed with a phantom "path does not exist"
// and the language server could NEVER start outside unit
// tests. This module hosts the real JdtLsService in the Theia
// backend and exposes it over JSON-RPC at JdtLsBackendPath;
// the browser client talks to that proxy.

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { JdtLsBackendPath, JdtLsFrontendClient } from '../common/java-ls-protocol';
import { JdtLsService } from './jdt-ls-service';

export default new ContainerModule(bind => {
  bind(JdtLsService).toSelf().inSingletonScope();
  bind(ConnectionHandler).toDynamicValue(ctx =>
    new JsonRpcConnectionHandler<JdtLsFrontendClient>(JdtLsBackendPath, client => {
      const service = ctx.container.get(JdtLsService);
      service.setClient(client);
      return service;
    }),
  ).inSingletonScope();
});
