import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import {
  RUN_CONFIGURATION_SCHEMA_VERSION,
  validateRunConfigurationDocument,
  type RunConfigurationValidationIssue,
} from '@kairo/config-schema';
import type { RunConfigurationDocument, TomcatRunConfiguration } from '@kairo/protocol';
import type { ServerInstance } from '@kairo/protocol';
import type { PortDiagnostics } from '@kairo/protocol';
import { ActiveProjectService } from '@kairo/project-extension';
import { KairoServerService } from '@kairo/tomcat-extension';
import { KairoJavaDebugService } from './kairo-java-debug-service';

export type RunConfigurationOperation = 'load' | 'create' | 'update' | 'copy' | 'delete' | 'select' | 'launch';

export interface RunConfigurationViewState {
  document: RunConfigurationDocument;
  loading: boolean;
  submitting: boolean;
  operation?: RunConfigurationOperation;
  error?: string;
  portDiagnostics?: PortDiagnostics;
  validationIssues: RunConfigurationValidationIssue[];
}

export const emptyRunConfigurationDocument = (): RunConfigurationDocument => ({
  version: RUN_CONFIGURATION_SCHEMA_VERSION,
  configurations: [],
  selectedConfigurationId: null,
});

export function parseEnvironmentReferences(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    const separator = raw.indexOf('=');
    if (separator < 1) throw new Error(`Environment line ${index + 1} must use NAME=value`);
    const name = raw.slice(0, separator);
    const value = raw.slice(separator + 1);
    if (Object.prototype.hasOwnProperty.call(result, name)) throw new Error(`Environment variable ${name} is duplicated`);
    result[name] = value;
  }
  return result;
}

export function createTomcatRunConfiguration(id = 'tomcat-local', projectId = 'project'): TomcatRunConfiguration {
  return {
    id,
    name: 'Tomcat Local',
    type: 'tomcat6',
    projectId,
    mode: 'run',
    suspend: false,
    jdkRef: 'jdk6-local',
    build: { type: 'ant', target: 'war', clean: false },
    server: { id: 'tomcat6-local', httpPort: 18080, debugPort: 8000, contextPath: '/' },
    deploy: { mode: 'exploded', artifact: 'dist' },
    env: {},
    vmOptions: [],
    beforeLaunchTasks: ['build', 'deploy'],
  };
}

export function copiedConfiguration(source: TomcatRunConfiguration, document: RunConfigurationDocument): TomcatRunConfiguration {
  const ids = new Set(document.configurations.map(item => item.id));
  const names = new Set(document.configurations.map(item => item.name.toLocaleLowerCase('en-US')));
  let suffix = 2;
  let id = `${source.id}-copy`;
  let name = `${source.name} Copy`;
  while (ids.has(id) || names.has(name.toLocaleLowerCase('en-US'))) {
    id = `${source.id}-copy-${suffix}`;
    name = `${source.name} Copy ${suffix}`;
    suffix++;
  }
  return {
    ...source,
    id,
    name,
    build: { ...source.build },
    server: { ...source.server },
    deploy: { ...source.deploy },
    env: { ...source.env },
    vmOptions: [...source.vmOptions],
    beforeLaunchTasks: [...source.beforeLaunchTasks],
  };
}

export function runConfigurationExecutionBlockReason(_configuration: TomcatRunConfiguration): string | undefined {
  return undefined;
}

@injectable()
export class KairoRunConfigurationService {
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
  @inject(ActiveProjectService) protected readonly activeProject!: ActiveProjectService;
  @inject(KairoServerService) protected readonly servers!: KairoServerService;
  @inject(KairoJavaDebugService) protected readonly javaDebug!: KairoJavaDebugService;
  protected state: RunConfigurationViewState = {
    document: emptyRunConfigurationDocument(), loading: false, submitting: false, validationIssues: [],
  };
  protected readonly emitter = new Emitter<RunConfigurationViewState>();
  readonly onDidChange: Event<RunConfigurationViewState> = this.emitter.event;

  get current(): Readonly<RunConfigurationViewState> { return this.state; }

  async load(): Promise<RunConfigurationDocument> {
    return this.run('load', async workspaceId => {
      try {
        return await this.runtime.request('GET /api/v1/workspaces/{workspaceId}/run-configurations', undefined, {
          pathParams: { workspaceId }, timeoutMs: 15_000,
        });
      } catch (error) {
        if (errorCode(error) === 'not_found') return emptyRunConfigurationDocument();
        throw error;
      }
    });
  }

  async create(configuration: TomcatRunConfiguration): Promise<RunConfigurationDocument> {
    this.assertCandidate(configuration);
    return this.run('create', workspaceId => this.runtime.request(
      'POST /api/v1/workspaces/{workspaceId}/run-configurations', configuration,
      { pathParams: { workspaceId }, timeoutMs: 15_000, noRetry: true },
    ));
  }

  async update(originalId: string, configuration: TomcatRunConfiguration): Promise<RunConfigurationDocument> {
    if (configuration.id !== originalId) throw new Error('Configuration ID cannot be changed while editing');
    this.assertCandidate(configuration, originalId);
    return this.run('update', workspaceId => this.runtime.request(
      'PUT /api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}', configuration,
      { pathParams: { workspaceId, configurationId: originalId }, timeoutMs: 15_000, noRetry: true },
    ));
  }

  async copy(configuration: TomcatRunConfiguration): Promise<RunConfigurationDocument> {
    const copy = copiedConfiguration(configuration, this.state.document);
    this.assertCandidate(copy);
    return this.run('copy', workspaceId => this.runtime.request(
      'POST /api/v1/workspaces/{workspaceId}/run-configurations', copy,
      { pathParams: { workspaceId }, timeoutMs: 15_000, noRetry: true },
    ));
  }

  async delete(id: string): Promise<RunConfigurationDocument> {
    return this.run('delete', workspaceId => this.runtime.request(
      'DELETE /api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}', undefined,
      { pathParams: { workspaceId, configurationId: id }, timeoutMs: 15_000, noRetry: true },
    ));
  }

  async selectDefault(id: string): Promise<RunConfigurationDocument> {
    if (!this.state.document.configurations.some(item => item.id === id)) throw new Error('Configuration no longer exists');
    const document = { ...this.state.document, selectedConfigurationId: id };
    this.assertDocument(document);
    return this.run('select', workspaceId => this.runtime.request(
      'PUT /api/v1/workspaces/{workspaceId}/run-configurations', document,
      { pathParams: { workspaceId }, timeoutMs: 15_000, noRetry: true },
    ));
  }

  async launch(configuration: TomcatRunConfiguration): Promise<ServerInstance> {
    if (this.state.loading || this.state.submitting) throw new Error('A run configuration operation is already in progress');
    const workspaceId = this.runtime.workspace();
    if (!workspaceId) throw new Error('Select a workspace before launching a run configuration');
    if (!this.state.document.configurations.some(item => item.id === configuration.id)) throw new Error('Configuration no longer exists');
    // Acquire the UI/service lock before any asynchronous preflight. Otherwise
    // two rapid clicks can both pass the guard and launch duplicate processes.
    this.setState({ submitting: true, operation: 'launch', error: undefined, portDiagnostics: undefined, validationIssues: [] });
    let server: ServerInstance | undefined;
    try {
      const project = await this.activeProject.requireProject();
      if (project.workspaceId !== workspaceId || project.projectId !== configuration.projectId) {
        throw new Error(`Select project ${configuration.projectId} before launching this configuration`);
      }
      if (configuration.mode === 'debug') {
        const capability = await this.javaDebug.probeAvailability();
        if (capability.state !== 'available') throw new Error(capability.message ?? 'Java Debug Adapter is unavailable');
      }
      server = await this.runtime.request(
        'POST /api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}/launch',
        { mode: configuration.mode },
        { pathParams: { workspaceId, configurationId: configuration.id }, timeoutMs: 45_000, noRetry: true },
      );
      this.servers.adopt(server);
      if (configuration.mode === 'debug') {
        const port = server.ports?.debug;
        if (!port) throw new Error('Runtime launched Debug without a verified JDWP port');
        await this.javaDebug.attach({
          serverId: server.id, projectId: project.projectId, projectName: project.name, projectRoot: project.root, port,
        });
      }
      return server;
    } catch (error) {
      if (server && configuration.mode === 'debug') {
        try { await this.servers.stop(server.id, false); } catch { /* preserve attach failure */ }
      }
      const msg = errorMessage(error);
      // Check if the error looks like a port occupation issue
      if (isPortOccupationError(error)) {
        try {
          const port = configuration.server.httpPort;
          const diagnostics = await this.runtime.diagnosePort(port);
          if (diagnostics.occupied) {
            this.setState({ error: msg, portDiagnostics: diagnostics });
            throw error;
          }
        } catch (_diagError) {
          // If diagnostics itself fails, just show the original error
        }
      }
      this.setState({ error: msg });
      throw error;
    } finally {
      this.setState({ submitting: false, operation: undefined });
    }
  }

  protected assertCandidate(configuration: TomcatRunConfiguration, replacingId?: string): void {
    const configurations = this.state.document.configurations
      .filter(item => item.id !== replacingId)
      .concat(configuration);
    this.assertDocument({
      version: RUN_CONFIGURATION_SCHEMA_VERSION,
      configurations,
      selectedConfigurationId: replacingId && this.state.document.selectedConfigurationId === replacingId
        ? configuration.id : (this.state.document.selectedConfigurationId ?? configuration.id),
    });
  }

  protected assertDocument(document: RunConfigurationDocument): void {
    const result = validateRunConfigurationDocument(document);
    if (!result.valid) {
      this.setState({ validationIssues: result.issues, error: 'Please fix the listed configuration fields.' });
      throw new Error(result.issues.map(issue => `${issue.path} ${issue.message}`).join('; '));
    }
  }

  protected async run(operation: RunConfigurationOperation, action: (workspaceId: string) => Promise<RunConfigurationDocument>): Promise<RunConfigurationDocument> {
    if (this.state.submitting || this.state.loading) throw new Error('A run configuration operation is already in progress');
    const workspaceId = this.runtime.workspace();
    if (!workspaceId) {
      const error = new Error('Select a workspace before managing run configurations');
      this.setState({ error: error.message });
      throw error;
    }
    this.setState({ loading: operation === 'load', submitting: operation !== 'load', operation, error: undefined, validationIssues: [] });
    try {
      const document = await action(workspaceId);
      const result = validateRunConfigurationDocument(document);
      if (!result.valid) throw new Error(`Runtime returned an invalid run configuration document: ${result.issues.map(i => `${i.path} ${i.message}`).join('; ')}`);
      this.setState({ document: result.value });
      return result.value;
    } catch (error) {
      this.setState({ error: errorMessage(error) });
      throw error;
    } finally {
      this.setState({ loading: false, submitting: false, operation: undefined });
    }
  }

  protected setState(patch: Partial<RunConfigurationViewState>): void {
    this.state = { ...this.state, ...patch };
    this.emitter.fire(this.state);
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Check if the error is likely a port occupation issue. */
function isPortOccupationError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  return lower.includes('address already in use')
    || lower.includes('port')
    || lower.includes('bind')
    || lower.includes('process_spawn_failed');
}
