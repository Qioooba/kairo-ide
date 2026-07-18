/**
 * Kairo server runtime service — wraps the lifecycle of a
 * server instance (start, stop, debug, logs).
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import type { ServerInstance } from '@kairo/protocol';
import { KairoRuntimeImpl } from '@kairo/runtime-extension';

@injectable()
export class KairoServerService {
  @inject(KairoRuntimeImpl) protected runtime!: KairoRuntimeImpl;

  protected cache = new Map<string, ServerInstance>();

  async start(projectId: string, debug = false): Promise<ServerInstance> {
    const s = await this.runtime.request('POST /api/v1/servers', { projectId, debug });
    this.cache.set(s.id, s);
    return s;
  }

  async get(id: string): Promise<ServerInstance> {
    const s = await this.runtime.request('GET /api/v1/servers/{id}', undefined, { pathParams: { id } });
    this.cache.set(id, s);
    return s;
  }

  async stop(id: string, force = false): Promise<ServerInstance> {
    const s = await this.runtime.request('DELETE /api/v1/servers/{id}', { force }, { pathParams: { id } });
    this.cache.set(id, s);
    return s;
  }

  async debug(id: string): Promise<ServerInstance> {
    const s = await this.runtime.request('POST /api/v1/servers/{id}/debug', undefined, { pathParams: { id } });
    this.cache.set(id, s);
    return s;
  }

  async logs(id: string, follow = false): Promise<{ line: string; ts: string }[]> {
    return this.runtime.request('GET /api/v1/servers/{id}/logs', { follow }, { pathParams: { id } });
  }
}

export function bindTomcatExtension(bind: any): void {
  bind(KairoServerService).toSelf().inSingletonScope();
}
