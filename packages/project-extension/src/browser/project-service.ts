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

  /**
   * Persist a ProjectConfig to the runtime agent via
   * PUT /api/v1/projects/{projectId}. The Save button in the
   * Import Wizard routes through this method instead of
   * calling the runtime client directly, so the service
   * owns the wire contract and the local cache.
   *
   * The agent unmarshals the body directly into domain.Project
   * (flat). Sending `{ config }` used to nest everything under
   * Project.Config and store EMPTY top-level id/name/rootPath
   * (KAIRO-RC-WEB-202) — always send the flat project.
   *
   * The returned value is the canonical ProjectConfig as
   * stored by the agent; callers should treat it as the new
   * source of truth (e.g. the wizard's success step reads
   * `result.id` to drive active-project selection).
   */
  async create(config: ProjectConfig): Promise<ProjectConfig> {
    if (!config || !config.id) {
      throw new Error('KairoProjectService.create: config.id is required');
    }
    const saved = await this.runtime.request(
      'PUT /api/v1/projects/{projectId}',
      config,
      { pathParams: { projectId: config.id } },
    ) as ProjectConfig;
    this.projects.set(saved.id, saved);
    return saved;
  }

  currentWorkspace(): WorkspaceDTO | undefined {
    return this.current;
  }
}

export function bindProjectExtension(bind: interfaces.Bind): void {
  bind(KairoProjectService).toSelf().inSingletonScope();
}
