/**
 * Kairo views — the Theia-side panels the user actually sees
 * while working in the IDE.
 *
 *   * Kairo Servers View     — tree of server instances, start/stop/restart
 *   * Kairo Build View       — list of builds with progress and diagnostics
 *   * Kairo Deployment View  — list of deployments with file counts
 *   * Kairo Tomcat Logs View — live log lines from the active server
 *
 * The views subscribe to the Runtime Agent's WebSocket event
 * stream so the UI updates as the agent reports progress, log
 * lines, and state changes. No polling, no fake events.
 *
 * Buttons in the editor area title bar (Build / Build & Deploy /
 * Start / Debug / Stop / Restart / Open Application) trigger
 * commands that go through the high-level services (Server,
 * Project). The buttons do NOT bypass the API by spawning
 * javac or Tomcat locally.
 */

import * as React from 'react';
import { injectable, inject, postConstruct, Container } from '@theia/core/shared/inversify';
import {
  Widget,
  ReactWidget,
  WidgetManager,
  FrontendApplicationContribution,
  ApplicationShell,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry, CommandService, MenuContribution, MenuModelRegistry, MenuPath, MessageService } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import { CommonMenus } from '@theia/core/lib/browser/common-menus';
import { MAIN_MENU_BAR } from '@theia/core/lib/common/menu/menu-types';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import {
  KairoServerService,
} from '@kairo/tomcat-extension';
import {
  KairoProjectService,
  ActiveProjectService,
} from '@kairo/project-extension';
import { BuildViewWidget } from '@kairo/build-extension';
import { BuildStore, mapBuildResult } from '@kairo/build-extension';
import { ServerViewWidget, LogViewerWidget } from '@kairo/tomcat-extension';
import { ImportWizardWidget, ProjectSelectorWidget } from '@kairo/project-extension';
import { MavenViewWidget } from './maven-view-widget';
import { KairoTodoWidget } from './kairo-todo-widget';
import { KAIRO_WELCOME_FACTORY_ID } from './kairo-welcome-widget';
import {
  KAIRO_IMPORT_WIZARD_FACTORY_ID,
  KAIRO_PROJECT_SELECTOR_FACTORY_ID,
  KAIRO_RUN_CONFIGURATIONS_FACTORY_ID,
  KAIRO_KEYMAP_FACTORY_ID,
  KAIRO_MAVEN_FACTORY_ID as _KAIRO_MAVEN_FACTORY_ID,
  KAIRO_TODO_FACTORY_ID as _KAIRO_TODO_FACTORY_ID,
  KAIRO_TESTS_FACTORY_ID,
  KAIRO_REMOTE_FACTORY_ID as _KAIRO_REMOTE_FACTORY_ID,
  KAIRO_SQL_CONSOLE_FACTORY_ID,
  KAIRO_PERF_FACTORY_ID,
  KAIRO_DEBUG_VARIABLES_FACTORY_ID,
  KAIRO_DEBUG_CALLSTACK_FACTORY_ID,
  KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID,
  KAIRO_DEBUG_TOOLBAR_FACTORY_ID,
  KAIRO_DEBUG_CONSOLE_FACTORY_ID,
  KAIRO_DEBUG_WATCH_FACTORY_ID,
  KAIRO_DEBUG_DIAGNOSTICS_FACTORY_ID,
  KAIRO_DEBUG_TOOL_WINDOW_FACTORY_ID,
} from './kairo-factory-ids';
import type {
  ServerInstance,
  BuildResult,
  DeploymentResult,
  WsEvent,
} from '@kairo/protocol';
import { KairoJavaDebugService } from './kairo-java-debug-service';
import { KairoDebugSessionService } from './kairo-debug-session-service';
import { HotDeployService } from '@kairo/tomcat-extension';

/* ------------------------------------------------------------------ */
/*  Commands                                                            */
/* ------------------------------------------------------------------ */

export namespace KairoCommands {
  export const IMPORT_PROJECT: Command = { id: 'kairo.project.import', label: 'Kairo: Import Project' };
  export const SELECT_PROJECT: Command = { id: 'kairo.project.select', label: 'Kairo: Select Project' };
  export const SCAN_PROJECT: Command = { id: 'kairo.project.scan', label: 'Kairo: Scan Project' };
  export const BUILD: Command = { id: 'kairo.build', label: 'Kairo: Build' };
  export const CLEAN_BUILD: Command = { id: 'kairo.cleanBuild', label: 'Kairo: Clean Build' };
  export const BUILD_AND_DEPLOY: Command = { id: 'kairo.buildAndDeploy', label: 'Kairo: Build and Deploy' };
  export const PUBLISH: Command = { id: 'kairo.publish', label: 'Kairo: Publish' };
  export const START_SERVER: Command = { id: 'kairo.server.start', label: 'Kairo: Start Server' };
  export const DEBUG_SERVER: Command = { id: 'kairo.server.debug', label: 'Kairo: Start Server (Debug)' };
  export const CHECK_DEBUG_ADAPTER: Command = { id: 'kairo.debug.checkAdapter', label: 'Kairo: Check Java Debug Adapter' };
  export const OPEN_DEBUG_VIEW: Command = { id: 'kairo.debug.openView', label: 'Kairo: Open Debug View' };
  export const OPEN_DEBUG_CONSOLE: Command = { id: 'kairo.debug.openConsole', label: 'Kairo: Open Debug Console' };
  export const STOP_SERVER: Command = { id: 'kairo.server.stop', label: 'Kairo: Stop Server' };
  export const RESTART_SERVER: Command = { id: 'kairo.server.restart', label: 'Kairo: Restart Server' };
  export const OPEN_APPLICATION: Command = { id: 'kairo.app.open', label: 'Kairo: Open Application' };
  export const REVEAL_KAIRO_SERVERS: Command = { id: 'kairo.view.servers', label: 'Kairo: Show Servers' };
  export const REVEAL_KAIRO_BUILDS: Command = { id: 'kairo.view.builds', label: 'Kairo: Show Builds' };
  export const REVEAL_KAIRO_DEPLOYMENTS: Command = { id: 'kairo.view.deployments', label: 'Kairo: Show Deployments' };
  export const REVEAL_KAIRO_LOGS: Command = { id: 'kairo.view.logs', label: 'Kairo: Show Tomcat Logs' };
  export const REVEAL_KAIRO_MAVEN: Command = { id: 'kairo.view.maven', label: 'Kairo: Show Maven' };
  export const REVEAL_KAIRO_TODO: Command = { id: 'kairo.view.todo', label: 'Kairo: Show TODO/FIXME' };
  export const REVEAL_KAIRO_SQL_CONSOLE: Command = { id: 'kairo.view.sqlConsole', label: 'Kairo: Show SQL Console' };
  export const REVEAL_KAIRO_TESTS: Command = { id: 'kairo.view.tests', label: 'Kairo: Show Test Results' };
  export const MANAGE_RUN_CONFIGURATIONS: Command = { id: 'kairo.runConfigurations.manage', label: 'Kairo: Manage Run Configurations' };
  export const SWITCH_JDK: Command = { id: 'kairo.jdk.switch', label: 'Kairo: Switch JDK' };
  export const RECONNECT_AGENT: Command = { id: 'kairo.agent.reconnect', label: 'Kairo: Reconnect Agent' };
  export const OPEN_KEYMAP: Command = { id: 'kairo.keymap.open', label: 'Kairo: Open Keyboard Shortcuts' };
  export const TOGGLE_TERMINAL: Command = { id: 'kairo.terminal.toggle', label: 'Kairo: Toggle Terminal' };
  export const REVEAL_KAIRO_REMOTE: Command = { id: 'kairo.view.remote', label: 'Kairo: Show Remote Development', iconClass: 'codicon codicon-remote' };
  export const REVEAL_KAIRO_PERF: Command = { id: 'kairo.view.perf', label: 'Kairo: Show Performance' };
  export const REVEAL_KAIRO_DEBUG_VARIABLES: Command = { id: 'kairo.debug.view.variables', label: 'Kairo: Show Debug Variables' };
  export const REVEAL_KAIRO_DEBUG_CALLSTACK: Command = { id: 'kairo.debug.view.callstack', label: 'Kairo: Show Debug Callstack' };
  export const REVEAL_KAIRO_DEBUG_BREAKPOINTS: Command = { id: 'kairo.debug.view.breakpoints', label: 'Kairo: Show Debug Breakpoints' };
  export const REVEAL_KAIRO_DEBUG_TOOLBAR: Command = { id: 'kairo.debug.view.toolbar', label: 'Kairo: Show Debug Toolbar' };
  export const REVEAL_KAIRO_DEBUG_CONSOLE: Command = { id: 'kairo.debug.view.console', label: 'Kairo: Show Debug Console' };
  export const REVEAL_KAIRO_DEBUG_WATCH: Command = { id: 'kairo.debug.view.watch', label: 'Kairo: Show Debug Watch' };
  export const OPEN_DEBUG_DIAGNOSTICS: Command = { id: 'kairo:open-debug-diagnostics', label: 'Kairo: Open Debug Diagnostics' };
  export const OPEN_IDEA_DEBUG_TOOL_WINDOW: Command = { id: 'kairo.debug.openToolWindow', label: 'Debug: Open Debug Tool Window (IDEA-style)' };
  export const DEBUG_RESTART: Command = { id: 'kairo.debug.restart', label: 'Debug: Rerun' };
  export const DEBUG_DROP_FRAME: Command = { id: 'kairo.debug.dropFrame', label: 'Debug: Drop Frame' };
  export const DEBUG_SHOW_INLINE_VALUES: Command = { id: 'kairo.debug.toggleInlineValues', label: 'Debug: Toggle Inline Values' };
  export const DEBUG_MUTE_BREAKPOINTS: Command = { id: 'kairo.debug.muteBreakpoints', label: 'Debug: Mute Breakpoints' };
  export const DEBUG_EVALUATE_EXPRESSION: Command = { id: 'kairo.debug.evaluateExpression', label: 'Debug: Evaluate Expression' };
  export const DEBUG_CONSOLE_FOCUS: Command = { id: 'kairo.debug.console.focus', label: 'Debug: Focus Console' };
  export const UPDATE_APPLICATION: Command = { id: 'kairo.server.update', label: 'Kairo: Update Application' };
  export const RELOAD_CONTEXT: Command = { id: 'kairo.server.reloadContext', label: 'Kairo: Reload Context' };
  export const SHOW_WELCOME: Command = { id: 'kairo.welcome.show', label: 'Help: Welcome', category: 'Help' };
  export const TOGGLE_DEVTOOLS: Command = { id: 'kairo.devtools.toggle', label: 'Help: Toggle Developer Tools', category: 'Help' };
}

/* ------------------------------------------------------------------ */
/*  Widgets                                                             */
/* ------------------------------------------------------------------ */

type ViewDeploymentState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'idle';

function mapDeploymentState(state: DeploymentResult['state']): ViewDeploymentState {
  switch (state) {
    case 'queued': return 'pending';
    case 'success': return 'succeeded';
    case 'failure': return 'failed';
    default: return state;
  }
}

function deploymentStateIconClass(state: ViewDeploymentState): string {
  switch (state) {
    case 'idle': return 'codicon-circle-outline';
    case 'pending': return 'codicon-circle-outline';
    case 'running': return 'codicon-sync codicon-modifier-spin';
    case 'succeeded': return 'codicon-check';
    case 'failed': return 'codicon-error';
    case 'cancelled': return 'codicon-close';
  }
}

function deploymentStateLabel(state: ViewDeploymentState, t: (key: string, params?: Record<string, string | number>) => string): string {
  switch (state) {
    case 'idle': return t('widget.deployments.state.idle');
    case 'pending': return t('widget.deployments.state.pending');
    case 'running': return t('widget.deployments.state.running');
    case 'succeeded': return t('widget.deployments.state.succeeded');
    case 'failed': return t('widget.deployments.state.failed');
    case 'cancelled': return t('widget.deployments.state.cancelled');
  }
}

function deploymentTriggerLabel(trigger: DeploymentResult['trigger'], t: (key: string, params?: Record<string, string | number>) => string): string {
  switch (trigger) {
    case 'manual': return t('widget.deployments.trigger.manual');
    case 'auto': return t('widget.deployments.trigger.auto');
    case 'post-save': return t('widget.deployments.trigger.postSave');
  }
}

function deploymentReloadLabel(mode: DeploymentResult['hotReloadMode'], t: (key: string, params?: Record<string, string | number>) => string): string {
  switch (mode) {
    case 'staticSync': return t('widget.deployments.hotReloadMode.synced');
    case 'compileOnly': return t('widget.deployments.hotReloadMode.compiling');
    case 'classHotSwap': return t('widget.deployments.hotReloadMode.synced');
    case 'contextReload': return t('widget.deployments.hotReloadMode.restartRequired');
  }
}

interface DeploymentsViewProps {
  deployments: DeploymentResult[];
  loading: boolean;
  error: string | null;
  commandService?: CommandService;
  i18n?: KairoI18nService;
  onRefresh?: () => void;
  onDismissError?: () => void;
}

const DeploymentsViewComponent: React.FC<DeploymentsViewProps> = ({
  deployments,
  loading,
  error,
  commandService,
  i18n,
  onRefresh,
  onDismissError,
}) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => {
    if (i18n) {
      return i18n.t(key as any, params);
    }
    // Fallback for unit tests / environments without DI.
    const fallbacks: Record<string, string> = {
      'widget.deployments.title': 'Kairo Deployments',
      'widget.deployments.caption': 'Kairo Deployments',
      'widget.deployments.loading': 'Loading deployments...',
      'widget.deployments.error': 'Error loading deployments',
      'widget.deployments.emptyStateTitle': 'No deployments yet.',
      'widget.deployments.emptyStateReason': 'Build and deploy your project to see deployment history here.',
      'widget.deployments.emptyStateAction': 'Build & Deploy',
      'widget.deployments.toolbar.deploy': 'Deploy',
      'widget.deployments.toolbar.deployAria': 'Build and deploy project',
      'widget.deployments.toolbar.refresh': 'Refresh',
      'widget.deployments.toolbar.refreshAria': 'Refresh deployment history',
      'widget.deployments.table.title': 'Deployments list',
      'widget.deployments.table.id': 'ID',
      'widget.deployments.table.state': 'State',
      'widget.deployments.table.files': 'Files',
      'widget.deployments.table.trigger': 'Trigger',
      'widget.deployments.table.reload': 'Reload',
      'widget.deployments.state.idle': 'Idle',
      'widget.deployments.state.pending': 'Pending',
      'widget.deployments.state.running': 'Running',
      'widget.deployments.state.succeeded': 'Succeeded',
      'widget.deployments.state.failed': 'Failed',
      'widget.deployments.state.cancelled': 'Cancelled',
      'widget.deployments.trigger.manual': 'Manual',
      'widget.deployments.trigger.auto': 'Auto',
      'widget.deployments.trigger.postSave': 'Post-save',
      'widget.deployments.hotReloadMode.synced': 'Synced',
      'widget.deployments.hotReloadMode.compiling': 'Compiling',
      'widget.deployments.hotReloadMode.restartRequired': 'Restart Required',
      'common.close': 'Close',
    };
    let text = fallbacks[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  }, [i18n]);

  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    if (!i18n) {
      return undefined;
    }
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);

  const latest = deployments[deployments.length - 1];
  const latestState = latest ? mapDeploymentState(latest.state) : 'idle';
  const isEmpty = deployments.length === 0 && !loading;

  const handleDeploy = () => commandService?.executeCommand('kairo.buildAndDeploy');

  if (loading) {
    return (
      <div className="kairo-widget" data-testid="deployments-view">
        <div className="kairo-widget-header" data-testid="deployments-view-header">
          <span className="kairo-widget-title">{t('widget.deployments.title')}</span>
        </div>
        <div className="kairo-widget-body">
          <div className="kairo-empty-state" data-testid="deployments-loading" role="status">
            <span className="kairo-empty-state-glyph codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            <h3 className="kairo-empty-state-title">{t('widget.deployments.loading')}</h3>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kairo-widget" data-testid="deployments-view">
      <div className="kairo-widget-header" data-testid="deployments-view-header">
        <span className="kairo-widget-title">{t('widget.deployments.title')}</span>
        <span
          className="kairo-deployment-state"
          data-testid="deployments-state"
          data-state={latestState}
          aria-live="polite"
        >
          <span className={`codicon ${deploymentStateIconClass(latestState)}`} aria-hidden="true" />
          {deploymentStateLabel(latestState, t)}
        </span>
      </div>

      <div className="kairo-widget-toolbar" data-testid="deployments-view-toolbar">
        <button
          className="theia-button main"
          data-testid="deployments-deploy-button"
          onClick={handleDeploy}
          disabled={!commandService}
          aria-label={t('widget.deployments.toolbar.deployAria')}
        >
          <span className="codicon codicon-rocket" aria-hidden="true" />
          {t('widget.deployments.toolbar.deploy')}
        </button>
        <button
          className="theia-button secondary"
          data-testid="deployments-refresh-button"
          onClick={onRefresh}
          disabled={!onRefresh}
          aria-label={t('widget.deployments.toolbar.refreshAria')}
        >
          <span className="codicon codicon-refresh" aria-hidden="true" />
          {t('widget.deployments.toolbar.refresh')}
        </button>
      </div>

      {error && (
        <div className="kairo-error-banner" role="alert" data-testid="deployments-error">
          <span className="codicon codicon-error" aria-hidden="true" />
          <span className="kairo-error-title">{t('widget.deployments.error')}</span>
          <span>{error}</span>
          {onDismissError && (
            <button className="theia-button toolbar" onClick={onDismissError} aria-label={t('common.close')}>
              {t('common.close')}
            </button>
          )}
        </div>
      )}

      {isEmpty ? (
        <div className="kairo-widget-body">
          <div className="kairo-empty-state" data-testid="deployments-empty">
            <span className="kairo-empty-state-glyph codicon codicon-rocket" aria-hidden="true" />
            <h3 className="kairo-empty-state-title">{t('widget.deployments.emptyStateTitle')}</h3>
            <p className="kairo-empty-state-reason">{t('widget.deployments.emptyStateReason')}</p>
          </div>
        </div>
      ) : (
        <div className="kairo-widget-body">
          <table className="kairo-deployments-table" aria-label={t('widget.deployments.table.title')}>
            <thead>
              <tr>
                <th>{t('widget.deployments.table.id')}</th>
                <th>{t('widget.deployments.table.state')}</th>
                <th>{t('widget.deployments.table.files')}</th>
                <th>{t('widget.deployments.table.trigger')}</th>
                <th>{t('widget.deployments.table.reload')}</th>
              </tr>
            </thead>
            <tbody>
              {deployments.slice(0, 50).map(d => (
                <tr key={d.id} data-testid={`deployment-${d.id}`}>
                  <td>{d.id}</td>
                  <td>
                    <span className="kairo-deployment-state" data-state={mapDeploymentState(d.state)}>
                      {deploymentStateLabel(mapDeploymentState(d.state), t)}
                    </span>
                  </td>
                  <td>{`${d.filesTouched} files / ${d.bytes} bytes`}</td>
                  <td>{deploymentTriggerLabel(d.trigger, t)}</td>
                  <td>{deploymentReloadLabel(d.hotReloadMode, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

@injectable()
export class KairoDeploymentsWidget extends ReactWidget {
  static readonly ID = 'kairo-deployments';
  deployments: DeploymentResult[] = [];
  private _loading = false;
  private _error: string | null = null;

  @inject(CommandService) protected readonly commands!: CommandService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  constructor() {
    super();
    this.id = KairoDeploymentsWidget.ID;
    this.title.label = '';
    this.title.caption = '';
    this.addClass('kairo-widget');
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    if (this.i18n) {
      this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
        this.updateTitle();
        this.update();
      }));
    }
  }

  protected updateTitle(): void {
    if (this.i18n) {
      this.title.label = this.i18n.t('widget.deployments.title');
      this.title.caption = this.i18n.t('widget.deployments.caption');
    }
  }

  setLoading(loading: boolean): void {
    this._loading = loading;
    this.update();
  }

  setError(error: string | null): void {
    this._error = error;
    this._loading = false;
    this.update();
  }

  setDeployments(deployments: DeploymentResult[]): void {
    this.deployments = deployments;
    this._loading = false;
    this._error = null;
    this.update();
  }

  async refresh(): Promise<void> {
    this.setLoading(true);
    try {
      const list = (await this.runtime.request('GET /api/v1/deployments', undefined)) as DeploymentResult[];
      this.setDeployments(Array.isArray(list) ? list : []);
    } catch (err) {
      this.setError(err instanceof Error ? err.message : String(err));
    }
  }

  protected render(): React.ReactNode {
    return React.createElement(DeploymentsViewComponent, {
      deployments: this.deployments,
      loading: this._loading,
      error: this._error,
      commandService: this.commands,
      i18n: this.i18n,
      onRefresh: () => { void this.refresh(); },
      onDismissError: () => { this._error = null; this.update(); },
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Contribution — wires commands, views, and event subscriptions       */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoViewsContribution implements FrontendApplicationContribution, MenuContribution, KeybindingContribution {
  @inject(ApplicationShell) protected shell!: ApplicationShell;
  @inject(WidgetManager) protected widgetManager!: WidgetManager;
  @inject(CommandService) protected commands!: CommandService;
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  @inject(KairoServerService) protected serverSvc!: KairoServerService;
  @inject(KairoProjectService) protected projectSvc!: KairoProjectService;
  @inject(ActiveProjectService) protected activeProject!: ActiveProjectService;
  @inject(MessageService) protected messages!: MessageService;
  @inject(BuildStore) protected buildStore!: BuildStore;
  @inject(Container) protected readonly container!: Container;
  @inject(HotDeployService) protected hotDeploy!: HotDeployService;
  @inject(KairoI18nService) protected i18n!: KairoI18nService;
  protected javaDebug: KairoJavaDebugService | undefined;
  protected debugSessionService: KairoDebugSessionService | undefined;
  /** Captured during registerCommands so labels can be refreshed after async i18n load. */
  protected commandRegistry: CommandRegistry | undefined;

  protected eventsUnsub: (() => void) | undefined;
  protected statusUnsub: (() => void) | undefined;

  /**
   * KairoJavaDebugService transitively depends on @theia/debug's
   * DebugSessionManager, which has an async @postConstruct. We resolve
   * it lazily so synchronous FrontendApplicationContribution construction
   * (and command registration) is not blocked.
   */
  protected async getJavaDebug(): Promise<KairoJavaDebugService> {
    if (!this.javaDebug) {
      this.javaDebug = await this.container.getAsync(KairoJavaDebugService);
    }
    return this.javaDebug;
  }

  protected async getDebugSessionService(): Promise<KairoDebugSessionService> {
    if (!this.debugSessionService) {
      this.debugSessionService = await this.container.getAsync(KairoDebugSessionService);
    }
    return this.debugSessionService;
  }

  /**
   * Maps Kairo command IDs to i18n keys so command palette and
   * menu labels are translated instead of hard-coded English.
   */
  protected readonly commandI18nKeys: Record<string, string> = {
    [KairoCommands.IMPORT_PROJECT.id]: 'command.importProject',
    [KairoCommands.SELECT_PROJECT.id]: 'command.selectProject',
    [KairoCommands.SCAN_PROJECT.id]: 'command.scanProject',
    [KairoCommands.BUILD.id]: 'command.build',
    [KairoCommands.CLEAN_BUILD.id]: 'command.cleanBuild',
    [KairoCommands.BUILD_AND_DEPLOY.id]: 'command.buildAndDeploy',
    [KairoCommands.PUBLISH.id]: 'command.publish',
    [KairoCommands.START_SERVER.id]: 'command.startServer',
    [KairoCommands.DEBUG_SERVER.id]: 'command.debugServer',
    [KairoCommands.CHECK_DEBUG_ADAPTER.id]: 'command.checkDebugAdapter',
    [KairoCommands.OPEN_DEBUG_VIEW.id]: 'command.openDebugView',
    [KairoCommands.OPEN_DEBUG_CONSOLE.id]: 'command.openDebugConsoleCmd',
    [KairoCommands.STOP_SERVER.id]: 'command.stopServer',
    [KairoCommands.RESTART_SERVER.id]: 'command.restartServer',
    [KairoCommands.OPEN_APPLICATION.id]: 'command.openApplication',
    [KairoCommands.REVEAL_KAIRO_SERVERS.id]: 'command.revealServers',
    [KairoCommands.REVEAL_KAIRO_BUILDS.id]: 'command.revealBuilds',
    [KairoCommands.REVEAL_KAIRO_DEPLOYMENTS.id]: 'command.revealDeployments',
    [KairoCommands.REVEAL_KAIRO_LOGS.id]: 'command.revealLogs',
    [KairoCommands.REVEAL_KAIRO_MAVEN.id]: 'command.revealMaven',
    [KairoCommands.REVEAL_KAIRO_TODO.id]: 'command.revealTodo',
    [KairoCommands.REVEAL_KAIRO_SQL_CONSOLE.id]: 'command.revealSqlConsole',
    [KairoCommands.REVEAL_KAIRO_TESTS.id]: 'command.revealTests',
    [KairoCommands.MANAGE_RUN_CONFIGURATIONS.id]: 'command.manageRunConfigurations',
    [KairoCommands.SWITCH_JDK.id]: 'command.switchJdk',
    [KairoCommands.RECONNECT_AGENT.id]: 'command.reconnectAgent',
    [KairoCommands.OPEN_KEYMAP.id]: 'command.openKeymap',
    [KairoCommands.TOGGLE_TERMINAL.id]: 'command.toggleTerminal',
    [KairoCommands.REVEAL_KAIRO_REMOTE.id]: 'command.revealRemote',
    [KairoCommands.REVEAL_KAIRO_PERF.id]: 'command.revealPerf',
    [KairoCommands.REVEAL_KAIRO_DEBUG_VARIABLES.id]: 'command.revealDebugVariables',
    [KairoCommands.REVEAL_KAIRO_DEBUG_CALLSTACK.id]: 'command.revealDebugCallstack',
    [KairoCommands.REVEAL_KAIRO_DEBUG_BREAKPOINTS.id]: 'command.revealDebugBreakpoints',
    [KairoCommands.REVEAL_KAIRO_DEBUG_TOOLBAR.id]: 'command.revealDebugToolbar',
    [KairoCommands.REVEAL_KAIRO_DEBUG_CONSOLE.id]: 'command.revealDebugConsole',
    [KairoCommands.REVEAL_KAIRO_DEBUG_WATCH.id]: 'command.revealDebugWatch',
    [KairoCommands.OPEN_DEBUG_DIAGNOSTICS.id]: 'command.openDebugDiagnostics',
    [KairoCommands.OPEN_IDEA_DEBUG_TOOL_WINDOW.id]: 'command.openIdeaDebugToolWindow',
    [KairoCommands.DEBUG_RESTART.id]: 'command.debugRestart',
    [KairoCommands.DEBUG_DROP_FRAME.id]: 'command.debugDropFrame',
    [KairoCommands.DEBUG_SHOW_INLINE_VALUES.id]: 'command.debugShowInlineValues',
    [KairoCommands.DEBUG_MUTE_BREAKPOINTS.id]: 'command.debugMuteBreakpoints',
    [KairoCommands.DEBUG_EVALUATE_EXPRESSION.id]: 'command.debugEvaluateExpression',
    [KairoCommands.DEBUG_CONSOLE_FOCUS.id]: 'command.debugConsoleFocus',
    [KairoCommands.UPDATE_APPLICATION.id]: 'command.updateApplication',
    [KairoCommands.RELOAD_CONTEXT.id]: 'command.reloadContext',
    [KairoCommands.SHOW_WELCOME.id]: 'command.showWelcome',
    [KairoCommands.TOGGLE_DEVTOOLS.id]: 'command.toggleDevtools',
  };

  /**
   * Returns a Command with its label translated via the current i18n.
   * Falls back to the original command if no i18n key is mapped.
   */
  protected withLabel(cmd: Command): Command {
    const key = this.commandI18nKeys[cmd.id];
    return key ? { ...cmd, label: this.i18n.t(key as KairoI18nKey) } : cmd;
  }

  /** Re-apply translated labels after language pack finishes loading / switching. */
  protected refreshCommandLabels(): void {
    if (!this.commandRegistry) {
      return;
    }
    for (const [id, key] of Object.entries(this.commandI18nKeys)) {
      const cmd = this.commandRegistry.getCommand(id);
      if (cmd) {
        cmd.label = this.i18n.t(key as KairoI18nKey);
      }
    }
  }

  protected serversView: ServerViewWidget | undefined;
  protected buildsView: BuildViewWidget | undefined;
  protected deploymentsView: KairoDeploymentsWidget | undefined;
  protected logsView: LogViewerWidget | undefined;
  protected mavenView: MavenViewWidget | undefined;
  protected todoView: KairoTodoWidget | undefined;

  @postConstruct()
  init(): void {
    // Defer until the application shell is ready (onStart fires
    // before the workbench is fully constructed).
  }

  onStart(): void {
    // Register commands. The commands accept a `Widget | undefined`
    // argument when triggered from a view, but most user flows
    // come from the toolbar / command palette.
    // KAIRO-RC-WEB-017: onStatusChange fires immediately with the
    // current status, which is 'disconnected' before the first
    // connect — warning on that initial emission produced a stale
    // "disconnected" toast sitting next to a "Runtime: connected"
    // status bar. Only warn on a genuine open -> disconnected
    // transition, and let the toast time out so it cannot linger
    // past a reconnect.
    let lastStatus: string | undefined;
    this.statusUnsub = this.runtime.onStatusChange(s => {
      if (s === 'disconnected' && lastStatus === 'open') {
        this.messages.warn('Runtime Agent is disconnected. Buttons will retry on click.', { timeout: 12000 });
      }
      lastStatus = s;
    });
    this.eventsUnsub = this.runtime.subscribeEvents(this.runtime.workspace(), (e: WsEvent) => this.handleEvent(e));

    // N-029: clear the WidgetManager cache so the new React Build/Server
    // views replace any stale cached factories from earlier module loads.
    const wm = this.widgetManager as unknown as { _cachedFactories?: unknown; factories?: Map<string, unknown> };
    if (wm._cachedFactories) {
      wm._cachedFactories = undefined;
      void wm.factories?.size;
    }

    // KAIRO-RC-WEB-018: cold start with no active project shows
    // the Welcome tab so the first task is discoverable; the tab
    // closes itself once a project is selected.
    // P2-UX-02: on first launch (no recent projects), auto-open the
    // import wizard to guide the user through onboarding.
    void this.maybeOpenWelcome();
    this.activeProject.onDidChangeProject(p => {
      if (p) void this.closeWelcome();
    });

    // Wire the native Electron menu (desktop build) to the Theia
    // command system. The main process sends menu-action IPC events
    // with a command ID; we execute the corresponding command via
    // the CommandService.
    const ipc = (window as any).kairoIPC;
    if (ipc && typeof ipc.onMenuAction === 'function') {
      ipc.onMenuAction((action: string) => {
        try {
          this.commands.executeCommand(action);
        } catch (err) {
          console.warn(`[kairo] menu action failed: ${action}`, err);
        }
      });
    }

    // Locale may finish loading after registerCommands; refresh once more.
    this.refreshCommandLabels();
  }

  protected async maybeOpenWelcome(): Promise<void> {
    if (this.activeProject.project) {
      return;
    }
    try {
      await this.revealOrCreateMain(KAIRO_WELCOME_FACTORY_ID, () => undefined, () => { /* singleton via WidgetManager */ });
      // P2-UX-02: detect first launch — if no recent projects exist,
      // auto-open the import wizard to guide the user.
      try {
        const recent = await this.projectSvc.getRecentProjects();
        if (recent.length === 0) {
          // First launch: show a brief welcome tip before opening the import wizard
          this.messages.info(this.i18n.t('widget.importWizard.welcomeToast'), { timeout: 5000 });
          // Auto-open the import wizard after a short delay
          setTimeout(() => {
            void this.commands.executeCommand('kairo.project.import');
          }, 500);
        }
      } catch {
        // If getRecentProjects fails (e.g., agent not connected),
        // still show the welcome page but skip auto-import.
      }
    } catch (err) {
      console.warn('[kairo] welcome tab failed to open', err);
    }
  }

  protected async closeWelcome(): Promise<void> {
    const w = this.shell.getWidgets('main').find(widget => widget.id === KAIRO_WELCOME_FACTORY_ID);
    w?.close();
  }

  onStop(): void {
    this.eventsUnsub?.();
    this.statusUnsub?.();
  }

  async registerCommands(registry: CommandRegistry): Promise<void> {
    console.log('[kairo] KairoViewsContribution.registerCommands called');
    this.commandRegistry = registry;
    // Language pack may still be loading when commands first register;
    // refresh once now and again whenever the locale changes.
    this.refreshCommandLabels();
    this.i18n.onDidChangeLanguage(() => this.refreshCommandLabels());

    registry.registerCommand(this.withLabel(KairoCommands.IMPORT_PROJECT), {
      execute: async () => {
        try {
          await this.revealOrCreateMain<ImportWizardWidget>(
            KAIRO_IMPORT_WIZARD_FACTORY_ID,
            () => undefined,
            _w => { /* singleton via WidgetManager */ },
          );
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Open Import Wizard failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.SELECT_PROJECT), {
      execute: async () => {
        try {
          await this.revealOrCreateMain<ProjectSelectorWidget>(
            KAIRO_PROJECT_SELECTOR_FACTORY_ID,
            () => undefined,
            _w => { /* singleton via WidgetManager */ },
          );
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Open Project Selector failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.SCAN_PROJECT), {
      execute: async () => {
        try {
          const ws = this.projectSvc.currentWorkspace();
          if (!ws) {
            this.messages.warn('Open a workspace first via File > Open Folder.');
            return undefined;
          }
          const out = await this.projectSvc.detectLayout(ws.id);
          this.messages.info(`Scanned ${ws.rootPath}.`);
          return out;
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Scan failed'));
          return undefined;
        }
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.BUILD), {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const result = await this.runtime.request('POST /api/v1/builds', { projectId: p.projectId });
          this.messages.info(`Build ${result.state}.`);
          await this.refreshBuilds();
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Build failed'));
        }
        return undefined;
      },
    });

    // Same as Build but with clean:true — the backend wipes the
    // previous build output first. The Build view's "Clean Build"
    // button must run THIS (KAIRO-RC-WEB-007: it used to fire
    // buildAndDeploy, contradicting its label).
    registry.registerCommand(this.withLabel(KairoCommands.CLEAN_BUILD), {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const result = await this.runtime.request('POST /api/v1/builds', { projectId: p.projectId, clean: true });
          this.messages.info(`Clean build ${result.state}.`);
          await this.refreshBuilds();
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Clean build failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.BUILD_AND_DEPLOY), {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const build = await this.runtime.request('POST /api/v1/builds', { projectId: p.projectId });
          const deploy = await this.runtime.request('POST /api/v1/deployments', { projectId: p.projectId, buildId: build.id, scope: 'all' });
          this.messages.info(`Build ${build.state} → Deploy ${deploy.state}.`);
          await this.refreshBuilds();
          await this.refreshDeployments();
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Build and deploy failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.PUBLISH), {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const deploy = await this.runtime.request('POST /api/v1/deployments', {
            projectId: p.projectId,
            buildId: '',
            scope: 'webapp',
            intent: 'publish-static-changes',
          });
          this.messages.info(`Published ${deploy.filesTouched} file(s), ${deploy.bytes} bytes.`);
          await this.refreshDeployments();
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Publish failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.START_SERVER), {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const srv = await this.serverSvc.start(p.projectId, false);
          this.messages.info(`Server ${srv.id} ${srv.state}.`);
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Server start failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.DEBUG_SERVER), {
      execute: async () => {
        let serverId: string | undefined;
        try {
          const p = await this.activeProject.requireProject();
          const javaDebug = await this.getJavaDebug();
          const capability = await javaDebug.probeAvailability();
          if (capability.state !== 'available') {
            throw new Error(capability.message ?? 'Java Debug Adapter is unavailable');
          }
          const srv = await this.serverSvc.start(p.projectId, true);
          serverId = srv.id;
          const port = srv.ports.debug;
          if (!port) throw new Error('Tomcat started without a verified JDWP port');
          const status = await javaDebug.attach({
            serverId: srv.id,
            projectId: p.projectId,
            projectName: p.name,
            projectRoot: p.root,
            port,
          });
          this.messages.info(`Java Debug Adapter connected to JDWP 127.0.0.1:${port} (session ${status.sessionId}).`);
        } catch (err) {
          if (serverId) {
            try { await this.serverSvc.stop(serverId, false); } catch { /* preserve the attach error */ }
          }
          this.messages.error(kairoErrorMessage(err, 'Server debug start failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.CHECK_DEBUG_ADAPTER), {
      execute: async () => {
        const javaDebug = await this.getJavaDebug();
        const status = await javaDebug.probeAvailability();
        if (status.state === 'available') this.messages.info('Java Debug Adapter is available.');
        else this.messages.warn(status.message ?? `Java Debug Adapter state: ${status.state}`);
        return status;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.OPEN_DEBUG_VIEW), {
      execute: () => this.commands.executeCommand('debug:toggle'),
    });
    registry.registerCommand(this.withLabel(KairoCommands.OPEN_DEBUG_CONSOLE), {
      execute: () => this.commands.executeCommand('debug:console:toggle'),
    });

    registry.registerCommand(this.withLabel(KairoCommands.STOP_SERVER), {
      execute: async () => {
        try {
          // A broken adapter must not prevent the owned Tomcat process from
          // being stopped. Preserve the debug error for the user, but continue
          // with server teardown as the authoritative cleanup boundary.
          let debugStopError: unknown;
          try {
            const javaDebug = await this.getJavaDebug();
            await javaDebug.stop();
          } catch (error) { debugStopError = error; }
          const list = (await this.runtime.request('GET /api/v1/servers', undefined)) as ServerInstance[];
          // Only stop servers that are actually up — the agent
          // persists server metadata across sessions, so the list
          // contains stale stopped/error entries whose ids are dead
          // (stopping them used to fail the whole command).
          const alive = list.filter(s => s.state !== 'stopped' && s.state !== 'error' && s.state !== 'crashed');
          if (alive.length === 0) {
            this.messages.info('No running server.');
            return undefined;
          }
          const failures: string[] = [];
          for (const srv of alive) {
            try {
              await this.serverSvc.stop(srv.id, false);
              this.messages.info(`Server ${srv.id} stopped.`);
            } catch (err) {
              failures.push(`${srv.id}: ${(err as Error).message}`);
            }
          }
          if (failures.length > 0) {
            this.messages.error(`Failed to stop: ${failures.join('; ')}`);
          }
          if (debugStopError) {
            this.messages.warn(`Debug Adapter termination reported an error; Tomcat stop was still attempted: ${kairoErrorMessage(debugStopError, 'unknown error')}`);
          }
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Server stop failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.RESTART_SERVER), {
      execute: async () => {
        try {
          await this.activeProject.requireProject();
          const list = await this.runtime.request('GET /api/v1/servers', undefined) as ServerInstance[];
          for (const srv of list) {
            const result = await this.runtime.request(
              'POST /api/v1/servers/{serverId}/restart',
              undefined,
              { pathParams: { serverId: srv.id } },
            ) as ServerInstance;
            this.messages.info(`Server ${result.id} restarted, new PID: ${result.pid}`);
          }
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Server restart failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.OPEN_APPLICATION), {
      execute: async () => {
        try {
          const list = (await this.runtime.request('GET /api/v1/servers', undefined)) as ServerInstance[];
          const srv = list[0];
          if (!srv || !srv.ports.http) {
            this.messages.warn('No running server with an HTTP port.');
            return undefined;
          }
          const url = `http://127.0.0.1:${srv.ports.http}`;
          window.open(url, '_blank', 'noopener');
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Open application failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_SERVERS), {
      execute: () => { void this.revealOrCreate(ServerViewWidget.ID, () => this.serversView, w => { this.serversView = w; }); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_BUILDS), {
      execute: () => { void this.revealOrCreate(BuildViewWidget.ID, () => this.buildsView, w => { this.buildsView = w; }); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_DEPLOYMENTS), {
      execute: () => { void this.revealOrCreate(KairoDeploymentsWidget.ID, () => this.deploymentsView, w => { this.deploymentsView = w; }); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_LOGS), {
      execute: () => { void this.revealOrCreate(LogViewerWidget.ID, () => this.logsView, w => { this.logsView = w; }); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_MAVEN), {
      execute: () => { void this.revealOrCreate(MavenViewWidget.ID, () => this.mavenView, w => { this.mavenView = w; }); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_TODO), {
      execute: () => { void this.revealOrCreate(KairoTodoWidget.ID, () => this.todoView, w => { this.todoView = w; }); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_TESTS), {
      execute: () => { void this.revealOrCreate(KAIRO_TESTS_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_PERF), {
      execute: () => { void this.revealOrCreate(KAIRO_PERF_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_SQL_CONSOLE), {
      execute: () => { void this.revealOrCreateMain(KAIRO_SQL_CONSOLE_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_REMOTE), {
      execute: () => { void this.revealOrCreateMain(_KAIRO_REMOTE_FACTORY_ID, () => undefined, () => undefined); },
    });
    // ── Debug View Commands ──────────────────────────────────────
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_DEBUG_VARIABLES), {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_VARIABLES_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_DEBUG_CALLSTACK), {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_CALLSTACK_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_DEBUG_BREAKPOINTS), {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_DEBUG_TOOLBAR), {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_TOOLBAR_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_DEBUG_CONSOLE), {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_CONSOLE_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.REVEAL_KAIRO_DEBUG_WATCH), {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_WATCH_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(this.withLabel(KairoCommands.OPEN_DEBUG_DIAGNOSTICS), {
      execute: () => { void this.revealOrCreateMain(KAIRO_DEBUG_DIAGNOSTICS_FACTORY_ID, () => undefined, () => undefined); },
    });

    // IDEA-style debug tool window (bottom panel)
    registry.registerCommand(this.withLabel(KairoCommands.OPEN_IDEA_DEBUG_TOOL_WINDOW), {
      execute: async () => {
        try {
          return await this.revealOrCreateBottom(KAIRO_DEBUG_TOOL_WINDOW_FACTORY_ID);
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Failed to open Debug tool window'));
          return undefined;
        }
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.DEBUG_RESTART), {
      execute: async () => {
        const svc = await this.getDebugSessionService();
        try { await svc.restart(); } catch {
          await svc.stop();
        }
      },
      isEnabled: () => !!this.debugSessionService?.currentState.hasSession,
    });

    registry.registerCommand(this.withLabel(KairoCommands.DEBUG_DROP_FRAME), {
      execute: async () => {
        try {
          const svc = await this.getDebugSessionService();
          const session = (svc as any).sessionManager?.currentSession;
          if (session) {
            await session.sendRequest('stepBack', { threadId: session.currentThread?.threadId ?? 0 });
          }
        } catch {
          // not supported
        }
      },
      isEnabled: () => !!this.debugSessionService?.currentState.isSuspended,
    });

    registry.registerCommand(this.withLabel(KairoCommands.DEBUG_MUTE_BREAKPOINTS), {
      execute: async () => {
        const svc = await this.getDebugSessionService();
        svc.toggleMuteBreakpoints();
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.DEBUG_EVALUATE_EXPRESSION), {
      execute: async () => {
        this.commands.executeCommand('kairo.debug.view.console');
      },
      isEnabled: () => !!this.debugSessionService?.currentState.isSuspended,
    });

    registry.registerCommand(this.withLabel(KairoCommands.DEBUG_CONSOLE_FOCUS), {
      execute: () => {
        return this.commands.executeCommand('kairo.debug.view.console');
      },
    });

    registry.registerCommand(this.withLabel(KairoCommands.MANAGE_RUN_CONFIGURATIONS), {
      execute: () => { void this.revealOrCreateMain(KAIRO_RUN_CONFIGURATIONS_FACTORY_ID, () => undefined, () => undefined); },
    });
    // P1-INT-01: JDK switch — opens the project selector so the user
    // can switch to a different project / JDK configuration.
    registry.registerCommand(this.withLabel(KairoCommands.SWITCH_JDK), {
      execute: async () => {
        try {
          await this.revealOrCreateMain<ProjectSelectorWidget>(
            KAIRO_PROJECT_SELECTOR_FACTORY_ID,
            () => undefined,
            _w => { /* singleton via WidgetManager */ },
          );
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, '打开项目选择器失败'));
        }
        return undefined;
      },
    });
    // P1-INT-01: Agent reconnect — forces the EventStream to
    // disconnect and reconnect to the Runtime Agent.
    registry.registerCommand(this.withLabel(KairoCommands.RECONNECT_AGENT), {
      execute: () => {
        this.runtime.disconnectEvents();
        this.runtime.openEvents();
        return undefined;
      },
    });

    // G1: P2-UX-01 — Open the Keyboard Shortcuts (Keymap) widget.
    registry.registerCommand(this.withLabel(KairoCommands.OPEN_KEYMAP), {
      execute: () => {
        void this.revealOrCreateMain(KAIRO_KEYMAP_FACTORY_ID, () => undefined, () => undefined);
      },
    });

    // Terminal toggle — delegates to @theia/terminal's built-in command.
    registry.registerCommand(this.withLabel(KairoCommands.TOGGLE_TERMINAL), {
      execute: () => this.commands.executeCommand('terminal:new'),
    });

    // Welcome: reveal or create the welcome tab (closes automatically
    // once a project is selected).
    registry.registerCommand(this.withLabel(KairoCommands.SHOW_WELCOME), {
      execute: () => {
        void this.revealOrCreateMain(KAIRO_WELCOME_FACTORY_ID, () => undefined, () => undefined);
      },
    });

    // Toggle Developer Tools: use IPC to the Electron main process.
    registry.registerCommand(this.withLabel(KairoCommands.TOGGLE_DEVTOOLS), {
      execute: () => {
        try {
          const ipc = (window as any).kairoIPC;
          if (ipc && typeof ipc.toggleDevTools === 'function') {
            ipc.toggleDevTools();
          } else {
            // Fallback: try webContents from electron remote (not available in sandbox)
            console.warn('[kairo] kairoIPC.toggleDevTools not available');
          }
        } catch (err) {
          console.warn('[kairo] failed to toggle DevTools:', err);
        }
      },
    });

    // Update Application (Ctrl+F10): save all + compile + sync
    registry.registerCommand(this.withLabel(KairoCommands.UPDATE_APPLICATION), {
      execute: async () => {
        try {
          // Save all files first
          await this.commands.executeCommand('core.saveAll');
          // Trigger hot deploy update
          await this.hotDeploy.updateApplication();
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Update application failed'));
        }
        return undefined;
      },
    });

    // Reload Context: touch WEB-INF/web.xml to trigger Tomcat context reload
    registry.registerCommand(this.withLabel(KairoCommands.RELOAD_CONTEXT), {
      execute: async () => {
        try {
          await this.hotDeploy.reloadContext();
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Reload context failed'));
        }
        return undefined;
      },
    });
  }

  async registerViewContainers(): Promise<void> {
    // In Theia 1.73.1 views are wired via the WidgetManager and
    // the ApplicationShell's `getDockPanel` API. We register the
    // widget factories in the frontend module (see
    // `kairo-product-frontend-module.ts`) and the
    // `WidgetManager.getOrCreateWidget` call below opens the
    // right panel.
  }

  registerMenus(menus: MenuModelRegistry): void {
    // KAIRO-RC-WEB-021: register the top-level "Kairo" menu in the
    // main menu bar so the user has a discoverable entry point
    // even when the File menu (managed by another extension) is
    // missing. The menu ID is the LAST element of the menuPath;
    // using MAIN_MENU_BAR (which resolves to ['menubar']) as the
    // path would make the Kairo menu's ID 'menubar' — same as the
    // bar's own group — and the child submenus registered with
    // path [...KAIRO_MENU] would never find it. So
    // the Kairo parent uses a dedicated id '5_kairo' and lives at
    // [...KAIRO_MENU].
    const KAIRO_MENU: MenuPath = [...MAIN_MENU_BAR, '5_kairo'];
    menus.registerSubmenu(KAIRO_MENU, this.i18n.t('menu.kairo.top'), { sortString: '5_kairo' });
    menus.registerMenuAction(KAIRO_MENU, {
      commandId: KairoCommands.IMPORT_PROJECT.id,
      icon: 'codicon codicon-folder-opened',
      order: 'a1',
    });
    menus.registerMenuAction(KAIRO_MENU, {
      commandId: KairoCommands.SELECT_PROJECT.id,
      icon: 'codicon codicon-file-directory',
      order: 'a2',
    });
    menus.registerMenuAction(KAIRO_MENU, {
      commandId: KairoCommands.SCAN_PROJECT.id,
      icon: 'codicon codicon-search',
      order: 'a3',
    });
    menus.registerMenuAction(KAIRO_MENU, {
      commandId: KairoCommands.MANAGE_RUN_CONFIGURATIONS.id,
      icon: 'codicon codicon-gear',
      order: 'a4',
    });

    // KAIRO-RC-WEB-022: build / run / debug submenu under "Kairo".
    // Registering the submenu in the main bar keeps the top-level
    // bar from getting visually crowded while still surfacing all
    // the actions the user needs in one menu.
    menus.registerSubmenu([...KAIRO_MENU, 'b_build'], this.i18n.t('menu.kairo.buildAndRun'), { sortString: 'b_build' });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.BUILD.id,
      icon: 'codicon codicon-play-circle',
      order: 'b1',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.CLEAN_BUILD.id,
      icon: 'codicon codicon-trash',
      order: 'b2',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.BUILD_AND_DEPLOY.id,
      icon: 'codicon codicon-rocket',
      order: 'b3',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.PUBLISH.id,
      icon: 'codicon codicon-cloud-upload',
      order: 'b3a',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.UPDATE_APPLICATION.id,
      icon: 'codicon codicon-sync',
      order: 'b3b',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.RELOAD_CONTEXT.id,
      icon: 'codicon codicon-refresh',
      order: 'b3c',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.START_SERVER.id,
      icon: 'codicon codicon-play',
      order: 'b4',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.DEBUG_SERVER.id,
      icon: 'codicon codicon-debug-alt',
      order: 'b5',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.STOP_SERVER.id,
      icon: 'codicon codicon-primitive-square',
      order: 'b6',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.RESTART_SERVER.id,
      icon: 'codicon codicon-refresh',
      order: 'b7',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.OPEN_APPLICATION.id,
      icon: 'codicon codicon-globe',
      order: 'b8',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'b_build'], {
      commandId: KairoCommands.CHECK_DEBUG_ADAPTER.id,
      icon: 'codicon codicon-bug',
      order: 'b9',
    });

    // KAIRO-RC-WEB-023: a "View" submenu that opens the most-used
    // Kairo panels. Each menu action is idempotent and falls back
    // to a toast if the widget cannot be created.
    menus.registerSubmenu([...KAIRO_MENU, 'c_view'], this.i18n.t('menu.kairo.view'), { sortString: 'c_view' });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_SERVERS.id,
      icon: 'codicon codicon-server',
      order: 'c1',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_BUILDS.id,
      icon: 'codicon codicon-gear',
      order: 'c2',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_DEPLOYMENTS.id,
      icon: 'codicon codicon-rocket',
      order: 'c3',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_LOGS.id,
      icon: 'codicon codicon-output',
      order: 'c4',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_MAVEN.id,
      icon: 'codicon codicon-package',
      order: 'c5',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_TODO.id,
      icon: 'codicon codicon-checklist',
      order: 'c6',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_TESTS.id,
      icon: 'codicon codicon-beaker',
      order: 'c7',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_SQL_CONSOLE.id,
      icon: 'codicon codicon-database',
      order: 'c8',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_REMOTE.id,
      icon: 'codicon codicon-remote',
      order: 'c9',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'c_view'], {
      commandId: KairoCommands.REVEAL_KAIRO_PERF.id,
      icon: 'codicon codicon-dashboard',
      order: 'c10',
    });

    // KAIRO-RC-WEB-024: debug submenu. Lifted from the
    // REVEAL_KAIRO_DEBUG_* commands so the user has one place
    // to find every debug-related panel.
    menus.registerSubmenu([...KAIRO_MENU, 'd_debug'], this.i18n.t('menu.kairo.debug'), { sortString: 'd_debug' });
    menus.registerMenuAction([...KAIRO_MENU, 'd_debug'], {
      commandId: KairoCommands.OPEN_DEBUG_VIEW.id,
      icon: 'codicon codicon-bug',
      order: 'd1',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'd_debug'], {
      commandId: KairoCommands.OPEN_DEBUG_CONSOLE.id,
      icon: 'codicon codicon-terminal',
      order: 'd2',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'd_debug'], {
      commandId: KairoCommands.REVEAL_KAIRO_DEBUG_VARIABLES.id,
      icon: 'codicon codicon-symbol-variable',
      order: 'd3',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'd_debug'], {
      commandId: KairoCommands.REVEAL_KAIRO_DEBUG_CALLSTACK.id,
      icon: 'codicon codicon-callstack',
      order: 'd4',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'd_debug'], {
      commandId: KairoCommands.REVEAL_KAIRO_DEBUG_BREAKPOINTS.id,
      icon: 'codicon codicon-debug-breakpoint',
      order: 'd5',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'd_debug'], {
      commandId: KairoCommands.REVEAL_KAIRO_DEBUG_WATCH.id,
      icon: 'codicon codicon-watch',
      order: 'd6',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'd_debug'], {
      commandId: KairoCommands.REVEAL_KAIRO_DEBUG_TOOLBAR.id,
      icon: 'codicon codicon-debug-alt',
      order: 'd7',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'd_debug'], {
      commandId: KairoCommands.OPEN_DEBUG_DIAGNOSTICS.id,
      icon: 'codicon codicon-tools',
      order: 'd8',
    });

    // KAIRO-RC-WEB-025: window/system submenu. The other items
    // (terminal, keymap, JDK switch, agent reconnect) belong
    // together because they all deal with the IDE runtime,
    // not the project.
    menus.registerSubmenu([...KAIRO_MENU, 'e_window'], this.i18n.t('menu.kairo.window'), { sortString: 'e_window' });
    menus.registerMenuAction([...KAIRO_MENU, 'e_window'], {
      commandId: KairoCommands.TOGGLE_TERMINAL.id,
      order: 'e1',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'e_window'], {
      commandId: KairoCommands.OPEN_KEYMAP.id,
      order: 'e2',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'e_window'], {
      commandId: KairoCommands.SWITCH_JDK.id,
      order: 'e3',
    });
    menus.registerMenuAction([...KAIRO_MENU, 'e_window'], {
      commandId: KairoCommands.RECONNECT_AGENT.id,
      order: 'e4',
    });

    // Keep a single File entry for Import — Select Project / Run Configs
    // already live under the Kairo top menu; duplicating them here makes
    // File feel cluttered for daily use.
    menus.registerMenuAction(CommonMenus.FILE_OPEN, {
      commandId: KairoCommands.IMPORT_PROJECT.id,
      order: 'a1',
    });

    // Desktop/local IDE: Upload/Download are Theia browser leftovers and
    // clutter File for daily use. Navigator context menu can keep them;
    // strip from the top File menu only.
    const downloadUploadMenu: MenuPath = [...CommonMenus.FILE, '4_downloadupload'];
    menus.unregisterMenuAction('file.upload', downloadUploadMenu);
    menus.unregisterMenuAction('file.download', downloadUploadMenu);
    menus.unregisterMenuAction('file.copyDownloadLink', CommonMenus.EDIT_CLIPBOARD);

    menus.registerMenuAction(CommonMenus.HELP, {
      commandId: KairoCommands.SHOW_WELCOME.id,
      order: 'a1',
    });
    menus.registerMenuAction(CommonMenus.HELP, {
      commandId: KairoCommands.TOGGLE_DEVTOOLS.id,
      order: 'z0',
    });
    menus.registerMenuAction(CommonMenus.HELP, {
      commandId: KairoCommands.OPEN_DEBUG_DIAGNOSTICS.id,
      order: 'z1',
    });
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: KairoCommands.TOGGLE_TERMINAL.id,
      keybinding: 'alt+f12',
    });

    // IDEA-style Update Application (Ctrl+F10)
    keybindings.registerKeybinding({
      command: KairoCommands.UPDATE_APPLICATION.id,
      keybinding: isOSX ? 'cmd+f10' : 'ctrl+f10',
    });

    // IDEA-style Debug keybindings (platform-specific)
    // Note: stepOver/stepInto/stepOut/continue/runToCursor are registered
    // in the platform keymap files (kairo-idea-*-keymap.ts) to avoid duplication.
    if (isOSX) {
      keybindings.registerKeybinding({
        command: KairoCommands.DEBUG_RESTART.id,
        keybinding: 'cmd+r',
        when: 'inDebugMode',
      });
      keybindings.registerKeybinding({
        command: 'workbench.action.debug.stop',
        keybinding: 'cmd+f2',
        when: 'inDebugMode',
      });
      keybindings.registerKeybinding({
        command: KairoCommands.DEBUG_EVALUATE_EXPRESSION.id,
        keybinding: 'alt+f8',
        when: 'inDebugMode',
      });
      keybindings.registerKeybinding({
        command: 'workbench.view.debug',
        keybinding: 'cmd+5',
      });
    } else {
      keybindings.registerKeybinding({
        command: KairoCommands.DEBUG_RESTART.id,
        keybinding: 'ctrl+f5',
        when: 'inDebugMode',
      });
      keybindings.registerKeybinding({
        command: 'workbench.action.debug.stop',
        keybinding: 'shift+f5',
        when: 'inDebugMode',
      });
      keybindings.registerKeybinding({
        command: KairoCommands.DEBUG_EVALUATE_EXPRESSION.id,
        keybinding: 'alt+f8',
        when: 'inDebugMode',
      });
      keybindings.registerKeybinding({
        command: 'workbench.view.debug',
        keybinding: 'alt+5',
      });
    }
  }

  protected async revealOrCreateMain<T extends Widget>(
    id: string,
    _getter: () => T | undefined,
    _setter: (w: T) => void,
  ): Promise<void> {
    const w = await this.widgetManager.getOrCreateWidget(id) as T;
    try {
      this.shell.addWidget(w, { area: 'main' });
    } catch (_e) {
      // Already attached — that's fine.
    }
    this.shell.activateWidget(w.id);
    w.update();
    // Focus the first focusable element in the target panel (D4.1)
    this.focusFirstFocusable(w.node);
  }

  protected async revealOrCreateBottom<T extends Widget>(
    id: string,
  ): Promise<void> {
    const w = await this.widgetManager.getOrCreateWidget(id) as T;
    try {
      this.shell.addWidget(w, { area: 'bottom' });
    } catch (_e) {
      // Already attached
    }
    this.shell.activateWidget(w.id);
    this.shell.revealWidget(w.id);
    w.update();
  }

  protected async revealOrCreate<T extends Widget>(
    id: string,
    getter: () => T | undefined,
    setter: (w: T) => void,
  ): Promise<void> {
    let w: T | undefined = getter();
    if (!w) {
      const created = await this.widgetManager.getOrCreateWidget(id);
      w = created as T;
      setter(w);
    }
    // `getOrCreateWidget` only creates the widget instance; it
    // does NOT add the widget to any visible shell area. We
    // attach it to the left sidebar (the canonical location for
    // the Servers / Builds / Deployments / Logs views) and only
    // then activate it. Without `addWidget`, the widget exists
    // in memory but never appears in the DOM, and `activateWidget`
    // is a silent no-op.
    try {
      this.shell.addWidget(w, { area: 'left' });
    } catch (_e) {
      // Already attached — that's fine.
    }
    this.shell.activateWidget(w.id);
    // `ReactWidget` only mounts its React tree on `onUpdateRequest`,
    // and theia 1.73 does not always fire that immediately after
    // `addWidget`. Force a render so the React content shows up
    // on first open (otherwise the node is just a `<div
    // class="kairo-widget">` shell with scrollbar placeholders and
    // no `data-testid`).
    w.update();
    // Focus the first focusable element in the target panel (D4.1)
    this.focusFirstFocusable(w.node);
  }

  protected async refreshBuilds(): Promise<void> {
    try {
      const list = (await this.runtime.request('GET /api/v1/builds', undefined)) as BuildResult[];
      if (Array.isArray(list)) {
        // KAIRO-RC-WEB-237: delegate to the null-tolerant mapper —
        // the inline version crashed on b.summary.errors for builds
        // whose compiler never ran (summary: null), killing the
        // whole refresh and leaving the Build view empty.
        const ws = this.runtime.workspace() ?? '';
        this.buildStore.setBuilds(list.map(b => mapBuildResult(b, ws)));
      }
    } catch (err) {
      this.messages.error(kairoErrorMessage(err, 'Refresh builds failed'));
    }
  }

  protected async refreshDeployments(): Promise<void> {
    if (!this.deploymentsView) return;
    try {
      const list = (await this.runtime.request('GET /api/v1/deployments', undefined)) as DeploymentResult[];
      this.deploymentsView.setDeployments(Array.isArray(list) ? list : []);
    } catch (err) {
      this.messages.error(kairoErrorMessage(err, 'Refresh deployments failed'));
    }
  }

  protected handleEvent(e: WsEvent): void {
    switch (e.type) {
      case 'build.progress':
        void this.refreshBuilds();
        return;
      case 'deployment.progress':
        void this.refreshDeployments();
        return;
      case 'server.state':
        void this.refreshBuilds();
        void this.refreshDeployments();
        return;
      // N-033: log events are handled by the LogViewerWidget's own
      // subscription; we forward them here to ensure the event stream
      // is known to carry log data.
      case 'log':
        return;
      default:
        return;
    }
  }

  /** Focus the first focusable element inside a container node (D4.1). */
  protected focusFirstFocusable(container: HTMLElement): void {
    const selector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const el = container.querySelector<HTMLElement>(selector);
    if (el) {
      // Use requestAnimationFrame to allow React/monaco to finish
      // rendering before attempting focus.
      requestAnimationFrame(() => el.focus());
    }
  }
}

function kairoErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof KairoError) return err.format();
  if (err instanceof Error) return `${fallback}: ${err.message}`;
  return fallback;
}
