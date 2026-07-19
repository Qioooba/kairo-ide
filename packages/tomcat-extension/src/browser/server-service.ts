/**
 * Kairo server runtime service — wraps the lifecycle of a
 * server instance (start, stop, debug, logs).
 */

import { injectable, inject, interfaces } from '@theia/core/shared/inversify';
import type { ServerInstance } from '@kairo/protocol';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { ServerStore } from './server-store';
import { ServerViewWidget } from './server-view-widget';

@injectable()
export class KairoServerService {
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;

  protected cache = new Map<string, ServerInstance>();

  async start(projectId: string, debug = false): Promise<ServerInstance> {
    const s = await this.runtime.request('POST /api/v1/servers', { projectId, debug });
    this.cache.set(s.id, s);
    return s;
  }

  async stop(id: string, force = false): Promise<ServerInstance> {
    const s = await this.runtime.request('DELETE /api/v1/servers/{serverId}', { force }, { pathParams: { serverId: id } });
    this.cache.set(id, s);
    return s;
  }
}

export function bindTomcatExtension(bind: interfaces.Bind): void {
  bind(KairoServerService).toSelf().inSingletonScope();
  bind(ServerStore).toSelf().inSingletonScope();
  bind(ServerViewWidget).toSelf();
}
