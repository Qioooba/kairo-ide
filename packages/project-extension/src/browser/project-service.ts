/**
 * Kairo workspace and project models.
 *
 * The mirror of the agent's domain types. The UI keeps a
 * faithful, read-mostly view; mutations go through the
 * KairoRuntime HTTP client.
 */

import { injectable, inject, interfaces } from '@theia/core/shared/inversify';
import type { Workspace as WorkspaceDTO, ProjectConfig, ProjectImportRequest, ProjectDetection, ProjectImportConfirmRequest, RecentProject, Toolchain } from '@kairo/protocol';
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

  async detectLayout(workspaceId: string, rootPath?: string): Promise<unknown> {
    return this.runtime.request('POST /api/v1/workspaces/{workspaceId}/scan', { deep: true, rootPath }, { pathParams: { workspaceId }, timeoutMs: 15_000 });
  }

  async listToolchains(): Promise<Toolchain[]> {
    return this.runtime.request('GET /api/v1/toolchains', undefined) as Promise<Toolchain[]>;
  }

  /**
   * List projects from the agent catalog. When `workspaceId` is
   * given the catalog is scoped to that workspace; otherwise the
   * global catalog is returned. Used by the import wizard's
   * conflict fallback (TC-IMP-023) and the project selector.
   */
  async listProjects(workspaceId?: string): Promise<ProjectConfig[]> {
    const list = await this.runtime.request(
      'GET /api/v1/projects',
      undefined,
      workspaceId ? { query: { workspaceId } } : undefined,
    );
    return Array.isArray(list) ? list as ProjectConfig[] : [];
  }

  async importProject(workspaceId: string, project: ProjectImportRequest): Promise<ProjectConfig> {
    const saved = await this.runtime.request(
      'POST /api/v1/workspaces/{workspaceId}/projects/import', project,
      { pathParams: { workspaceId }, timeoutMs: 15_000, noRetry: true },
    ) as ProjectConfig;
    this.projects.set(saved.id, saved);
    return saved;
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

  /** Detect project structure from a directory using the new endpoint. */
  async detectProject(rootPath: string): Promise<ProjectDetection> {
    return this.runtime.request('POST /api/v1/projects/detect', { rootPath }, { timeoutMs: 15_000 }) as Promise<ProjectDetection>;
  }

  /** Import a project with confirmed configuration using the new endpoint. */
  async importProjectNew(params: ProjectImportConfirmRequest): Promise<ProjectConfig> {
    const saved = await this.runtime.request(
      'POST /api/v1/projects/import', params,
      { timeoutMs: 15_000, noRetry: true },
    ) as ProjectConfig;
    this.projects.set(saved.id, saved);
    return saved;
  }

  /** Get recent projects for the welcome page. */
  async getRecentProjects(): Promise<RecentProject[]> {
    return this.runtime.request('GET /api/v1/projects/recent', undefined) as Promise<RecentProject[]>;
  }
}

export function bindProjectExtension(bind: interfaces.Bind): void {
  bind(KairoProjectService).toSelf().inSingletonScope();
  // KAIRO-RC-WEB-2026-07-25-11: ActiveProjectService is bound as a singleton
  // in packages/theia-product/src/main/product-bindings.ts. Do not add a
  // second binding here — that triggers an "Ambiguous match" Inversify
  // error at frontend boot and silently disables the Kairo status bar /
  // commands contributions.
}
