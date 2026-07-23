import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { ProjectConfig } from '@kairo/protocol';
import { ActiveProjectService, type ProjectInfo } from '@kairo/project-extension';
import { ServerStore, type ServerInstance } from '@kairo/tomcat-extension';
import {
  KairoRunConfigurationService,
  type RunConfigurationViewState,
} from './kairo-run-configuration-service';
import { KAIRO_TOOLBAR_FACTORY_ID } from './kairo-factory-ids';

/* ------------------------------------------------------------------ */
/*  Toolbar React component                                             */
/* ------------------------------------------------------------------ */

type ToolbarOperation = 'run' | 'debug' | 'stop' | 'build' | null;

interface KairoToolbarProps {
  activeProject: ActiveProjectService;
  runConfigService: KairoRunConfigurationService;
  commandService: CommandService;
  serverStore: ServerStore;
  runtime: RuntimeConnectionService;
}

const KairoToolbarComponent: React.FC<KairoToolbarProps> = ({
  activeProject,
  runConfigService,
  commandService,
  serverStore,
  runtime,
}) => {
  const [project, setProject] = React.useState<ProjectInfo | undefined>(activeProject.project);
  const [projects, setProjects] = React.useState<ProjectConfig[]>([]);
  const [runConfigState, setRunConfigState] = React.useState<RunConfigurationViewState>(runConfigService.current as RunConfigurationViewState);
  const [servers, setServers] = React.useState<ServerInstance[]>(serverStore.getServers());
  const [busy, setBusy] = React.useState<ToolbarOperation>(null);

  // Subscribe to active project changes
  React.useEffect(() => {
    const sub = activeProject.onDidChangeProject(p => setProject(p));
    return () => sub.dispose();
  }, [activeProject]);

  // Subscribe to run configuration changes
  React.useEffect(() => {
    const sub = runConfigService.onDidChange(next => setRunConfigState({ ...next }));
    void runConfigService.load().catch(() => undefined);
    return () => sub.dispose();
  }, [runConfigService]);

  // Subscribe to server state changes
  React.useEffect(() => {
    const sub = serverStore.onDidChange(s => setServers([...s]));
    return () => sub.dispose();
  }, [serverStore]);

  // Load project list
  React.useEffect(() => {
    let cancelled = false;
    runtime.request('GET /api/v1/projects', undefined).then((list) => {
      if (!cancelled && Array.isArray(list)) {
        setProjects(list as ProjectConfig[]);
      }
    }).catch(() => {
      // Agent not reachable — keep empty list
    });
    return () => { cancelled = true; };
  }, [runtime]);

  const hasRunningServer = servers.some(s => s.state === 'running' || s.state === 'starting');
  const selectedConfig = runConfigState.document.configurations.find(
    c => c.id === runConfigState.document.selectedConfigurationId
  );
  const isLaunching = runConfigState.submitting && runConfigState.operation === 'launch';

  const handleProjectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = event.target.value;
    const found = projects.find(p => p.id === projectId);
    if (found) {
      const ctx = runtime.workspace();
      if (ctx) {
        void activeProject.setProject({
          workspaceId: ctx,
          projectId: found.id,
          name: found.name,
          root: found.rootPath,
        });
      }
    }
  };

  const handleRunConfigChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const configId = event.target.value;
    if (configId) {
      void runConfigService.selectDefault(configId).catch(() => undefined);
    }
  };

  const executeCommand = async (operation: ToolbarOperation, commandId: string) => {
    if (busy) return;
    setBusy(operation);
    try {
      await commandService.executeCommand(commandId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="kairo-toolbar" role="toolbar" aria-label="Kairo toolbar">
      {/* Project selector */}
      <div className="kairo-toolbar-group">
        <label className="kairo-toolbar-label" htmlFor="kairo-toolbar-project">Project</label>
        <select
          id="kairo-toolbar-project"
          className="theia-select kairo-toolbar-select"
          value={project?.projectId ?? ''}
          disabled={busy !== null}
          onChange={handleProjectChange}
          title="Select active project"
          aria-label="Select active project"
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Run configuration selector */}
      <div className="kairo-toolbar-group">
        <label className="kairo-toolbar-label" htmlFor="kairo-toolbar-run-config">Run Config</label>
        <select
          id="kairo-toolbar-run-config"
          className="theia-select kairo-toolbar-select"
          value={runConfigState.document.selectedConfigurationId ?? ''}
          disabled={busy !== null || runConfigState.document.configurations.length === 0}
          onChange={handleRunConfigChange}
          title="Select run configuration"
          aria-label="Select run configuration"
        >
          {runConfigState.document.configurations.length === 0 && <option value="">No configurations</option>}
          {runConfigState.document.configurations.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.mode.toUpperCase()})</option>
          ))}
        </select>
      </div>

      {/* Action buttons */}
      <div className="kairo-toolbar-group kairo-toolbar-actions">
        <button
          className="theia-button main"
          disabled={busy !== null || !selectedConfig || isLaunching}
          onClick={() => executeCommand('run', 'kairo.server.start')}
          title="Run the selected configuration (Cmd+R)"
          aria-label="Run"
        >
          {busy === 'run' ? '▶ Running…' : '▶ Run'}
        </button>
        <button
          className="theia-button"
          disabled={busy !== null || !selectedConfig || selectedConfig?.mode !== 'debug' || isLaunching}
          onClick={() => executeCommand('debug', 'kairo.server.debug')}
          title="Debug the selected configuration (Cmd+D)"
          aria-label="Debug"
        >
          {busy === 'debug' ? '● Debugging…' : '● Debug'}
        </button>
        <button
          className="theia-button secondary"
          disabled={busy !== null || !hasRunningServer}
          onClick={() => executeCommand('stop', 'kairo.server.stop')}
          title="Stop all running servers (Cmd+.)"
          aria-label="Stop"
        >
          {busy === 'stop' ? '■ Stopping…' : '■ Stop'}
        </button>
        <button
          className="theia-button"
          disabled={busy !== null}
          onClick={() => executeCommand('build', 'kairo.build')}
          title="Build the current project (Cmd+B)"
          aria-label="Build"
        >
          {busy === 'build' ? '⚙ Building…' : '⚙ Build'}
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoToolbarWidget extends ReactWidget {
  static readonly ID = KAIRO_TOOLBAR_FACTORY_ID;

  @inject(ActiveProjectService) protected readonly activeProject!: ActiveProjectService;
  @inject(KairoRunConfigurationService) protected readonly runConfigService!: KairoRunConfigurationService;
  @inject(CommandService) protected readonly commandService!: CommandService;
  @inject(ServerStore) protected readonly serverStore!: ServerStore;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  @postConstruct()
  protected init(): void {
    this.id = KairoToolbarWidget.ID;
    this.title.label = 'Kairo Toolbar';
    this.title.caption = 'Kairo IDE toolbar';
    this.title.closable = false;
    this.addClass('kairo-widget');
    this.addClass('kairo-toolbar-widget');
    this.update();
  }

  protected render(): React.ReactNode {
    return (
      <KairoToolbarComponent
        activeProject={this.activeProject}
        runConfigService={this.runConfigService}
        commandService={this.commandService}
        serverStore={this.serverStore}
        runtime={this.runtime}
      />
    );
  }
}