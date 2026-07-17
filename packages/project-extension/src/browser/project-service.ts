/**
 * Kairo workspace and project models.
 *
 * The mirror of the agent's domain types. The UI keeps a
 * faithful, read-mostly view; mutations go through the
 * KairoRuntime HTTP client.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  Workspace as WorkspaceDTO,
  ProjectConfig,
} from '@kairo/protocol';
import { KairoRuntime } from '@kairo/runtime-extension/lib/browser';

export const KairoProjectService = Symbol('KairoProjectService');

@injectable()
export class KairoProjectService {
  @inject(KairoRuntime) protected runtime: KairoRuntime;

  protected current: WorkspaceDTO | undefined;
  protected projects = new Map<string, ProjectConfig>();

  async openWorkspace(rootPath: string, name?: string): Promise<WorkspaceDTO> {
    const ws = await this.runtime.request('POST /api/v1/workspaces', { rootPath, name });
    this.current = ws;
    this.runtime.setWorkspace(ws.id);
    return ws;
  }

  async closeWorkspace(): Promise<void> {
    if (!this.current) return;
    await this.runtime.request('DELETE /api/v1/workspaces/{id}', undefined, { /* path param */ } as never);
    this.current = undefined;
    this.projects.clear();
  }

  async listWorkspaces(): Promise<WorkspaceDTO[]> {
    return this.runtime.request('GET /api/v1/workspaces', undefined);
  }

  async detectLayout(workspaceId: string): Promise<unknown> {
    return this.runtime.request('POST /api/v1/workspaces/{id}/scan', { deep: true }, workspaceId);
  }

  async listProjects(): Promise<ProjectConfig[]> {
    const raw = await this.runtime.request('GET /api/v1/projects', undefined) as any[];
    return raw as ProjectConfig[];
  }

  async getProject(id: string): Promise<ProjectConfig> {
    return this.runtime.request('GET /api/v1/projects/{id}', undefined, id);
  }

  async saveProject(id: string, cfg: ProjectConfig): Promise<ProjectConfig> {
    return this.runtime.request('PUT /api/v1/projects/{id}', { config: cfg }, id);
  }

  currentWorkspace(): WorkspaceDTO | undefined {
    return this.current;
  }
}

export function bindProjectExtension(bind: any): void {
  bind(KairoProjectService).to(KairoProjectService).inSingletonScope();
}
