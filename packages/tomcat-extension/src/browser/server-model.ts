import type { ServerInstance as ProtocolServerInstance } from '@kairo/protocol';
import type { ServerInstance as StoreServerInstance } from './server-store';

/** Keep the protocol-to-view mapping in one DOM-free, tested place. In
 * particular, retaining the JDWP port prevents a debug-ready Tomcat from
 * looking like a normal Run session in the UI. */
export function toStoreServer(s: ProtocolServerInstance): StoreServerInstance {
  return {
    id: s.id,
    workspaceId: '',
    projectId: s.projectId,
    state: s.state,
    httpPort: s.ports.http || 0,
    debugPort: s.ports.debug || 0,
    pid: s.pid || 0,
    startTime: s.startedAt || '',
    url: s.ports.http ? `http://127.0.0.1:${s.ports.http}` : undefined,
  };
}
