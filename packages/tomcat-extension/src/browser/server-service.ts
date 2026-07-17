/**
 * Kairo server runtime service — wraps the lifecycle of a
 * server instance (start, stop, debug, logs).
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ServerInstance } from '@kairo/protocol';
import { KairoRuntime } from '@kairo/runtime-extension/lib/browser';

export const KairoServerService = Symbol('KairoServerService');

@injectable()
export class KairoServerService {
  @inject(KairoRuntime) protected runtime: KairoRuntime;

  protected cache = new Map<string, ServerInstance>();

  async start(projectId: string, debug = false): Promise<ServerInstance> {
    const s = await this.runtime.request('POST /api/v1/servers', { projectId, debug });
    this.cache.set(s.id, s);
    return s;
  }

  async get(id: string): Promise<ServerInstance> {
    const s = await this.runtime.request('GET /api/v1/servers/{id}', undefined, id);
    this.cache.set(id, s);
    return s;
  }

  async stop(id: string, force = false): Promise<ServerInstance> {
    const s = await this.runtime.request('DELETE /api/v1/servers/{id}', { force }, id);
    this.cache.set(id, s);
    return s;
  }

  async debug(id: string): Promise<ServerInstance> {
    const s = await this.runtime.request('POST /api/v1/servers/{id}/debug', undefined, id);
    this.cache.set(id, s);
    return s;
  }

  async logs(id: string, follow = false): Promise<{ line: string; ts: string }[]> {
    return this.runtime.request('GET /api/v1/servers/{id}/logs', { follow }, id);
  }
}

export function bindTomcatExtension(bind: any): void {
  bind(KairoServerService).to(KairoServerService).inSingletonScope();
}
