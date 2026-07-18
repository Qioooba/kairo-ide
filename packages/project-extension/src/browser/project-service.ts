/**
 * Kairo workspace and project models.
 *
 * The mirror of the agent's domain types. The UI keeps a
 * faithful, read-mostly view; mutations go through the
 * KairoRuntime HTTP client.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import type { Workspace as WorkspaceDTO, ProjectConfig } from '@kairo/protocol';
import { KairoRuntimeImpl } from '@kairo/runtime-extension';

@injectable()
export class KairoProjectService {
  @inject(KairoRuntimeImpl) protected runtime!: KairoRuntimeImpl;

  protected current?: WorkspaceDTO;
  protected projects = new Map<string, ProjectConfig>();

  async openWorkspace(rootPath: string, name?: string): Promise<WorkspaceDTO> {
    const ws = await this.runtime.request('POST /api/v1/workspaces', { rootPath, name });
    this.current = ws;
    this.runtime.setWorkspace(ws.id);
    return ws;
  }

  async listWorkspaces(): Promise<WorkspaceDTO[]> {
    return this.runtime.request('GET /api/v1/workspaces', undefined);
  }

  async closeWorkspace(id: string): Promise<void> {
    await this.runtime.request('DELETE /api/v1/workspaces/{id}', undefined, { pathParams: { id } });
    if (this.current?.id === id) {
      this.current = undefined;
      this.projects.clear();
    }
  }

  async detectLayout(workspaceId: string): Promise<unknown> {
    return this.runtime.request('POST /api/v1/workspaces/{id}/scan', { deep: true }, { pathParams: { id: workspaceId } });
  }

  async listProjects(): Promise<ProjectConfig[]> {
    return (await this.runtime.request('GET /api/v1/projects', undefined)) as ProjectConfig[];
  }

  async getProject(id: string): Promise<ProjectConfig> {
    return this.runtime.request('GET /api/v1/projects/{id}', undefined, { pathParams: { id } });
  }

  async saveProject(id: string, cfg: ProjectConfig): Promise<ProjectConfig> {
    return this.runtime.request('PUT /api/v1/projects/{id}', { config: cfg }, { pathParams: { id } });
  }

  currentWorkspace(): WorkspaceDTO | undefined {
    return this.current;
  }
}

export function bindProjectExtension(bind: any): void {
  bind(KairoProjectService).toSelf().inSingletonScope();
}
