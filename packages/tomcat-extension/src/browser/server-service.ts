/**
 * Kairo server runtime service — wraps the lifecycle of a
 * server instance (start, stop, debug, logs).
 */

import { injectable, inject, interfaces } from '@theia/core/shared/inversify';
import type { ServerInstance } from '@kairo/protocol';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { ServerStore } from './server-store';
import { ServerViewWidget } from './server-view-widget';
import { LogViewerWidget } from './log-viewer-widget';
import { toStoreServer } from './server-model';

export { toStoreServer } from './server-model';

@injectable()
export class KairoServerService {
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  @inject(ServerStore) protected store!: ServerStore;

  protected cache = new Map<string, ServerInstance>();

  /** Adopt a ServerInstance created by another trusted typed endpoint. */
  adopt(instance: ServerInstance): ServerInstance {
    this.cache.set(instance.id, instance);
    this.store.upsertServer(toStoreServer(instance), { force: true });
    return instance;
  }

  async start(projectId: string, debug = false): Promise<ServerInstance> {
    const s = await this.runtime.request('POST /api/v1/servers', { projectId, debug });
    return this.adopt(s);
  }

  async stop(id: string, force = false): Promise<ServerInstance> {
    const s = await this.runtime.request('DELETE /api/v1/servers/{serverId}', { force }, { pathParams: { serverId: id } });
    return this.adopt(s);
  }
}

export function bindTomcatExtension(bind: interfaces.Bind): void {
  bind(KairoServerService).toSelf().inSingletonScope();
  bind(ServerStore).toSelf().inSingletonScope();
  bind(ServerViewWidget).toSelf();
  bind(LogViewerWidget).toSelf();
}
