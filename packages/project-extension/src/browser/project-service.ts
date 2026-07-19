/**
 * Kairo workspace and project models.
 *
 * The mirror of the agent's domain types. The UI keeps a
 * faithful, read-mostly view; mutations go through the
 * KairoRuntime HTTP client.
 */

import { injectable, inject, interfaces } from '@theia/core/shared/inversify';
import type { Workspace as WorkspaceDTO, ProjectConfig } from '@kairo/protocol';
import { RuntimeConnectionService } from '@kairo/runtime-extension';

@injectable()
export class KairoProjectService {
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;

  protected current?: WorkspaceDTO;
  protected projects = new Map<string, ProjectConfig>();

  async openWorkspace(rootPath: string, name?: string): Promise<WorkspaceDTO> {
    const ws = await this.runtime.request('POST /api/v1/workspaces', { rootPath, name });
    this.current = ws;
    this.runtime.setWorkspace(ws.id);
    return ws;
  }

  async detectLayout(workspaceId: string): Promise<unknown> {
    return this.runtime.request('POST /api/v1/workspaces/{workspaceId}/scan', { deep: true }, { pathParams: { workspaceId } });
  }

  currentWorkspace(): WorkspaceDTO | undefined {
    return this.current;
  }
}

export function bindProjectExtension(bind: interfaces.Bind): void {
  bind(KairoProjectService).toSelf().inSingletonScope();
}
