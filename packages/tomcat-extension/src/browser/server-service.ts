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

@injectable()
export class KairoServerService {
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  @inject(ServerStore) protected store!: ServerStore;

  protected cache = new Map<string, ServerInstance>();

  async start(projectId: string, debug = false): Promise<ServerInstance> {
    const s = await this.runtime.request('POST /api/v1/servers', { projectId, debug });
    this.cache.set(s.id, s);
    this.store.upsertServer(this.toStoreServer(s), { force: true });
    return s;
  }

  async stop(id: string, force = false): Promise<ServerInstance> {
    const s = await this.runtime.request('DELETE /api/v1/servers/{serverId}', { force }, { pathParams: { serverId: id } });
    this.cache.set(id, s);
    this.store.upsertServer(this.toStoreServer(s), { force: true });
    return s;
  }

  private toStoreServer(s: ServerInstance) {
    return {
      id: s.id, workspaceId: '', projectId: s.projectId, state: s.state,
      httpPort: s.ports.http || 0, pid: s.pid || 0, startTime: s.startedAt || '',
      url: s.ports.http ? `http://127.0.0.1:${s.ports.http}` : undefined,
    } as import('./server-store').ServerInstance;
  }
}

export function bindTomcatExtension(bind: interfaces.Bind): void {
  bind(KairoServerService).toSelf().inSingletonScope();
  bind(ServerStore).toSelf().inSingletonScope();
  bind(ServerViewWidget).toSelf();
  bind(LogViewerWidget).toSelf();
}
