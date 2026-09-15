import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { ProjectConfig } from '@kairo/protocol';
import { ActiveProjectService, type ProjectInfo } from '@kairo/project-extension';
import { ServerStore, type ServerInstance } from '@kairo/tomcat-extension';
import { KairoI18nService } from '@kairo/i18n';
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
  i18n: KairoI18nService;
}

const KairoToolbarComponent: React.FC<KairoToolbarProps> = ({
  activeProject,
  runConfigService,
  commandService,
  serverStore,
  runtime,
  i18n,
}) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);
  const [project, setProject] = React.useState<ProjectInfo | undefined>(activeProject.project);
  const [projects, setProjects] = React.useState<ProjectConfig[]>([]);
  // UI-10: explicit list lifecycle — loading / ready / error with stale
  // retention, instead of a one-shot fetch that silently freezes on failure.
  const [listStatus, setListStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [listError, setListError] = React.useState<string>('');
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

  // Load project list with refresh sources: initial mount, agent
  // reconnect, and any active-project change (import/select/delete flows
  // publish through ActiveProjectService). Failures keep the previous list
  // marked stale and offer a retry instead of silently emptying (UI-10).
  const hasListRef = React.useRef(false);
  const loadProjects = React.useCallback(async () => {
    // While reloading, the previous list stays on screen (stale) instead of
    // flashing to empty; the status flag drives loading/error messaging.
    // hasListRef keeps this callback identity stable so refresh effects
    // never loop (UI-10).
    if (!hasListRef.current) setListStatus('loading');
    try {
      const list = await runtime.request('GET /api/v1/projects', undefined);
      if (Array.isArray(list)) {
        hasListRef.current = true;
        setProjects(list as ProjectConfig[]);
        setListStatus('ready');
        setListError('');
      } else {
        throw new Error('Unexpected project list response');
      }
    } catch (err) {
      // Agent not reachable — keep the previous list (possibly empty).
      setListStatus('error');
      setListError(err instanceof Error ? err.message : String(err));
    }
  }, [runtime]);

  React.useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  React.useEffect(() => {
    const unsubscribe = runtime.onStatusChange(status => {
      // Offline at boot, then reconnected: pick up projects/imports (UI-10).
      if (status === 'open') void loadProjects();
    });
    return unsubscribe;
  }, [runtime, loadProjects]);

  React.useEffect(() => {
    const sub = activeProject.onDidChangeProject(() => {
      void loadProjects();
    });
    return () => sub.dispose();
  }, [activeProject, loadProjects]);

  const hasRunningServer = servers.some(s => s.state === 'running' || s.state === 'starting');
  const selectedConfig = runConfigState.document.configurations.find(
    c => c.id === runConfigState.document.selectedConfigurationId
  ) ?? runConfigState.document.configurations[0];
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
    <div className={`kairo-toolbar${busy ? ' kairo-toolbar-busy' : ''}`} role="toolbar" aria-label={t('widget.toolbar.title')}>
      {/* Project selector */}
      <div className="kairo-toolbar-group kairo-toolbar-project-group">
        <label className="kairo-toolbar-label" htmlFor="kairo-toolbar-project">{t('widget.toolbar.projectLabel')}</label>
        <select
          id="kairo-toolbar-project"
          data-testid="toolbar-project-select"
          className="theia-select kairo-toolbar-select"
          value={project?.projectId ?? ''}
          disabled={busy !== null || (projects.length === 0 && listStatus === 'loading')}
          onChange={handleProjectChange}
          title={listStatus === 'error'
            ? t('widget.toolbar.projectListError', { message: listError })
            : t('widget.toolbar.selectProjectAria')}
          aria-label={t('widget.toolbar.selectProjectAria')}
          aria-busy={listStatus === 'loading'}
        >
          {projects.length === 0 && (
            <option value="">
              {listStatus === 'loading' ? t('widget.toolbar.projectsLoading') : listStatus === 'error' ? t('widget.toolbar.projectsLoadFailed') : t('widget.toolbar.noProjects')}
            </option>
          )}
          {/* Stable selection: the active project stays selectable even when
              it is momentarily absent from the list (UI-10). */}
          {project && project.projectId && !projects.some(p => p.id === project.projectId) && (
            <option key={project.projectId} value={project.projectId}>{project.name}</option>
          )}
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {listStatus === 'error' && (
          <button
            className="theia-button secondary kairo-toolbar-btn kairo-toolbar-btn-retry"
            data-testid="toolbar-project-retry"
            disabled={busy !== null}
            onClick={() => void loadProjects()}
            title={t('widget.toolbar.projectListError', { message: listError })}
            aria-label={t('common.retry')}
          >
            <span className="codicon codicon-refresh" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Run configuration selector */}
      <div className="kairo-toolbar-group kairo-toolbar-runconfig-group">
        <label className="kairo-toolbar-label" htmlFor="kairo-toolbar-run-config">{t('widget.toolbar.runConfigLabel')}</label>
        <select
          id="kairo-toolbar-run-config"
          className="theia-select kairo-toolbar-select"
          value={runConfigState.document.selectedConfigurationId ?? ''}
          disabled={busy !== null || runConfigState.document.configurations.length === 0}
          onChange={handleRunConfigChange}
          title={t('widget.toolbar.selectRunConfigAria')}
          aria-label={t('widget.toolbar.selectRunConfigAria')}
        >
          {runConfigState.document.configurations.length === 0 && <option value="">{t('widget.toolbar.noConfigurations')}</option>}
          {runConfigState.document.configurations.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.mode.toUpperCase()})</option>
          ))}
        </select>
      </div>

      <div className="kairo-toolbar-separator" role="separator" aria-orientation="vertical" />

      {/* Action buttons */}
      <div className="kairo-toolbar-group kairo-toolbar-actions">
        <button
          className="theia-button main kairo-toolbar-btn kairo-toolbar-btn-run"
          disabled={busy !== null || !selectedConfig || isLaunching}
          onClick={() => executeCommand('run', 'kairo.server.start')}
          title={t('widget.toolbar.runTooltip')}
          aria-label={t('widget.toolbar.run')}
        >
          <span className="codicon codicon-play" aria-hidden="true" />
          {busy === 'run' ? t('widget.toolbar.running') : t('widget.toolbar.run')}
        </button>
        <button
          className="theia-button kairo-toolbar-btn kairo-toolbar-btn-debug"
          disabled={busy !== null || !selectedConfig || selectedConfig?.mode !== 'debug' || isLaunching}
          onClick={() => executeCommand('debug', 'kairo.server.debug')}
          title={t('widget.toolbar.debugTooltip')}
          aria-label={t('widget.toolbar.debug')}
        >
          <span className="codicon codicon-debug-alt" aria-hidden="true" />
          {busy === 'debug' ? t('widget.toolbar.debugging') : t('widget.toolbar.debug')}
        </button>
        <button
          className="theia-button secondary kairo-toolbar-btn kairo-toolbar-btn-stop"
          disabled={busy !== null || !hasRunningServer}
          onClick={() => executeCommand('stop', 'kairo.server.stop')}
          title={t('widget.toolbar.stopTooltip')}
          aria-label={t('widget.toolbar.stop')}
        >
          <span className="codicon codicon-stop" aria-hidden="true" />
          {busy === 'stop' ? t('widget.toolbar.stopping') : t('widget.toolbar.stop')}
        </button>
        <button
          className="theia-button kairo-toolbar-btn kairo-toolbar-btn-build"
          disabled={busy !== null}
          onClick={() => executeCommand('build', 'kairo.build')}
          title={t('widget.toolbar.buildTooltip')}
          aria-label={t('widget.toolbar.build')}
        >
          <span className="codicon codicon-tools" aria-hidden="true" />
          {busy === 'build' ? t('widget.toolbar.building') : t('widget.toolbar.build')}
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
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  @postConstruct()
  protected init(): void {
    this.id = KairoToolbarWidget.ID;
    this.title.label = this.i18n.t('widget.toolbar.title');
    this.title.caption = this.i18n.t('widget.toolbar.title');
    this.title.closable = false;
    this.addClass('kairo-widget');
    this.addClass('kairo-toolbar-widget');
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      this.title.label = this.i18n.t('widget.toolbar.title');
      this.title.caption = this.i18n.t('widget.toolbar.title');
      this.update();
    }));
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
        i18n={this.i18n}
      />
    );
  }
}