import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import type { TomcatRunConfiguration, PortDiagnostics } from '@kairo/protocol';
import { KairoI18nService } from '@kairo/i18n';
import {
  createTomcatRunConfiguration,
  KairoRunConfigurationService,
  parseEnvironmentReferences,
  type RunConfigurationViewState,
} from './kairo-run-configuration-service';
import { KAIRO_RUN_CONFIGURATIONS_FACTORY_ID } from './kairo-factory-ids';

function envText(env: Record<string, string>): string {
  return Object.entries(env).map(([name, value]) => `${name}=${value}`).join('\n');
}

interface EditorProps {
  initial: TomcatRunConfiguration;
  idReadOnly: boolean;
  busy: boolean;
  i18n: KairoI18nService;
  onCancel(): void;
  onSave(value: TomcatRunConfiguration): Promise<void>;
}

const ConfigurationEditor: React.FC<EditorProps> = ({ initial, idReadOnly, busy, i18n, onCancel, onSave }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [draft, setDraft] = React.useState<TomcatRunConfiguration>(() => structuredClone(initial));
  const [environment, setEnvironment] = React.useState(() => envText(initial.env));
  const [localError, setLocalError] = React.useState<string>();
  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);
  const field = (label: string, value: string | number, update: (value: string) => void, type = 'text', readOnly = false) => (
    <label className="kairo-runconfig-field">
      <span className="kairo-runconfig-field-label">{label}</span>
      <input className="theia-input kairo-runconfig-input" type={type} value={value} disabled={busy || readOnly} readOnly={readOnly} onChange={event => update(event.target.value)} aria-label={label} />
    </label>
  );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    try {
      setLocalError(undefined);
      await onSave({ ...draft, env: parseEnvironmentReferences(environment), suspend: draft.mode === 'debug' && draft.suspend });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };
  return <form onSubmit={submit} className="kairo-runconfig-form" aria-label={t('widget.runConfigurations.editor.editTitle')}>
    <h3 className="kairo-runconfig-title">{initial.id ? t('widget.runConfigurations.editor.editTitle') : t('widget.runConfigurations.editor.newTitle')}</h3>

    {/* General Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.general')}</legend>
      <div className="kairo-runconfig-grid">
        {field(t('widget.runConfigurations.editor.id'), draft.id, value => setDraft({ ...draft, id: value }), 'text', idReadOnly)}
        {field(t('widget.runConfigurations.editor.name'), draft.name, value => setDraft({ ...draft, name: value }))}
        {field(t('widget.runConfigurations.editor.projectId'), draft.projectId, value => setDraft({ ...draft, projectId: value }))}
        {field(t('widget.runConfigurations.editor.jdkRef'), draft.jdkRef, value => setDraft({ ...draft, jdkRef: value }))}
        <label className="kairo-runconfig-field">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.mode')}</span>
          <select className="theia-select kairo-runconfig-select" value={draft.mode} disabled={busy} onChange={event => setDraft({ ...draft, mode: event.target.value as 'run' | 'debug', suspend: false })} aria-label={t('widget.runConfigurations.editor.mode')}>
            <option value="run">{t('widget.runConfigurations.editor.modeRun')}</option>
            <option value="debug">{t('widget.runConfigurations.editor.modeDebug')}</option>
          </select>
        </label>
        <label className="kairo-runconfig-field kairo-runconfig-checkbox">
          <input type="checkbox" checked={draft.suspend} disabled={busy || draft.mode !== 'debug'} onChange={event => setDraft({ ...draft, suspend: event.target.checked })} />
          <span>{t('widget.runConfigurations.editor.suspend')}</span>
        </label>
      </div>
    </fieldset>

    {/* Server Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.server')}</legend>
      <div className="kairo-runconfig-grid">
        {field(t('widget.runConfigurations.editor.serverRef'), draft.server.id, value => setDraft({ ...draft, server: { ...draft.server, id: value } }))}
        {field(t('widget.runConfigurations.editor.httpPort'), draft.server.httpPort, value => setDraft({ ...draft, server: { ...draft.server, httpPort: Number(value) } }), 'number')}
        {field(t('widget.runConfigurations.editor.debugPort'), draft.server.debugPort, value => setDraft({ ...draft, server: { ...draft.server, debugPort: Number(value) } }), 'number')}
        {field(t('widget.runConfigurations.editor.contextPath'), draft.server.contextPath, value => setDraft({ ...draft, server: { ...draft.server, contextPath: value } }))}
      </div>
    </fieldset>

    {/* Build Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.build')}</legend>
      <div className="kairo-runconfig-grid">
        <label className="kairo-runconfig-field">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.buildType')}</span>
          <select className="theia-select kairo-runconfig-select" value={draft.build.type} disabled={busy} onChange={event => {
            const type = event.target.value;
            setDraft({ ...draft, build: type === 'ant' ? { type, target: 'war', clean: false } : type === 'javac' ? { type, clean: false } : { type: 'custom', command: '', clean: false } });
          }} aria-label={t('widget.runConfigurations.editor.buildType')}>
            <option value="ant">{t('widget.runConfigurations.editor.buildTypeAnt')}</option>
            <option value="javac">{t('widget.runConfigurations.editor.buildTypeJavac')}</option>
            <option value="custom">{t('widget.runConfigurations.editor.buildTypeCustom')}</option>
          </select>
        </label>
        {draft.build.type === 'ant' && field(t('widget.runConfigurations.editor.antTarget'), draft.build.target, value => setDraft({ ...draft, build: { ...draft.build, type: 'ant', target: value } }))}
        {draft.build.type === 'custom' && <div className="kairo-runconfig-field">{field(t('widget.runConfigurations.editor.customCommand'), draft.build.command, value => setDraft({ ...draft, build: { ...draft.build, type: 'custom', command: value } }))}<small className="kairo-runconfig-hint">{t('widget.runConfigurations.editor.customCommandHint')}</small></div>}
        <label className="kairo-runconfig-field kairo-runconfig-checkbox">
          <input type="checkbox" checked={draft.build.clean} disabled={busy} onChange={event => setDraft({ ...draft, build: { ...draft.build, clean: event.target.checked } })} />
          <span>{t('widget.runConfigurations.editor.cleanBeforeBuild')}</span>
        </label>
      </div>
    </fieldset>

    {/* Deploy Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.deploy')}</legend>
      <div className="kairo-runconfig-grid">
        <label className="kairo-runconfig-field">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.deployMode')}</span>
          <select className="theia-select kairo-runconfig-select" value={draft.deploy.mode} disabled={busy} onChange={event => setDraft({ ...draft, deploy: { ...draft.deploy, mode: event.target.value as 'exploded' | 'war' } })} aria-label={t('widget.runConfigurations.editor.deployMode')}>
            <option value="exploded">{t('widget.runConfigurations.editor.deployModeExploded')}</option>
            <option value="war">{t('widget.runConfigurations.editor.deployModeWar')}</option>
          </select>
        </label>
        {field(t('widget.runConfigurations.editor.artifact'), draft.deploy.artifact, value => setDraft({ ...draft, deploy: { ...draft.deploy, artifact: value } }))}
      </div>
    </fieldset>

    {/* Advanced Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.advanced')}</legend>
      <div className="kairo-runconfig-advanced">
        <label className="kairo-runconfig-field kairo-runconfig-field-wide">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.vmOptions')}</span>
          <textarea className="theia-input kairo-runconfig-textarea" rows={3} value={draft.vmOptions.join('\n')} disabled={busy} onChange={event => setDraft({ ...draft, vmOptions: event.target.value.split(/\r?\n/).filter(Boolean) })} aria-label={t('widget.runConfigurations.editor.vmOptions')} />
        </label>
        <label className="kairo-runconfig-field kairo-runconfig-field-wide">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.environment')}</span>
          <textarea className="theia-input kairo-runconfig-textarea" rows={4} value={environment} disabled={busy} onChange={event => setEnvironment(event.target.value)} aria-describedby="kairo-env-help" />
          <small className="kairo-runconfig-hint" id="kairo-env-help">{t('widget.runConfigurations.editor.environmentHint')}</small>
        </label>
      </div>
    </fieldset>

    {/* Before Launch */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.beforeLaunch')}</legend>
      <div className="kairo-runconfig-checkbox-group">
        {(['build', 'deploy'] as const).map(task => (
          <label key={task} className="kairo-runconfig-field kairo-runconfig-checkbox">
            <input type="checkbox" checked={draft.beforeLaunchTasks.includes(task)} disabled={busy} onChange={event => setDraft({ ...draft, beforeLaunchTasks: event.target.checked ? [...draft.beforeLaunchTasks, task].sort((a, b) => a === 'build' ? -1 : b === 'build' ? 1 : 0) : draft.beforeLaunchTasks.filter(value => value !== task) })} />
            <span>{task === 'build' ? t('widget.runConfigurations.editor.beforeLaunchBuild') : t('widget.runConfigurations.editor.beforeLaunchDeploy')}</span>
          </label>
        ))}
      </div>
    </fieldset>

    {localError && (
      <div className="kairo-error-banner" role="alert">
        <span className="codicon codicon-warning" aria-hidden="true" />
        <span>{localError}</span>
      </div>
    )}
    <div className="kairo-runconfig-actions">
      <button className="theia-button main" type="submit" disabled={busy}>{busy ? t('widget.runConfigurations.editor.saving') : t('widget.runConfigurations.editor.save')}</button>
      <button className="theia-button secondary" type="button" disabled={busy} onClick={onCancel}>{t('widget.runConfigurations.editor.cancel')}</button>
    </div>
  </form>;
};

const PortOccupationError: React.FC<{ diagnostics: PortDiagnostics; i18n: KairoI18nService; onModifyPort(): void }> = ({ diagnostics, i18n, onModifyPort }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  return (
    <div className="kairo-error-banner" role="alert">
      <strong>{t('widget.runConfigurations.portOccupied', { port: diagnostics.port })}</strong>
      {diagnostics.pid && diagnostics.processName && (
        <div className="kairo-error-banner-detail">{t('widget.runConfigurations.portOccupiedProcess', { processName: diagnostics.processName, pid: diagnostics.pid })}</div>
      )}
      {diagnostics.suggestion && <div className="kairo-error-banner-detail">{diagnostics.suggestion}</div>}
      <button className="theia-button secondary" onClick={onModifyPort}>{t('widget.runConfigurations.modifyPort')}</button>
    </div>
  );
};

const RunConfigurationsView: React.FC<{ service: KairoRunConfigurationService; i18n: KairoI18nService }> = ({ service, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [state, setState] = React.useState<RunConfigurationViewState>(service.current as RunConfigurationViewState);
  const [editing, setEditing] = React.useState<{ originalId?: string; value: TomcatRunConfiguration }>();
  React.useEffect(() => {
    const subscription = service.onDidChange(next => setState({ ...next }));
    void service.load().catch(() => undefined);
    return () => subscription.dispose();
  }, [service]);
  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);
  const busy = state.loading || state.submitting;
  const selected = state.document.configurations.find(item => item.id === state.document.selectedConfigurationId);
  const isLaunching = state.submitting && state.operation === 'launch';
  if (editing) return <ConfigurationEditor initial={editing.value} idReadOnly={Boolean(editing.originalId)} busy={busy} i18n={i18n} onCancel={() => setEditing(undefined)} onSave={async value => {
    if (editing.originalId) await service.update(editing.originalId, value); else await service.create(value);
    setEditing(undefined);
  }} />;
  const newConfiguration = () => {
    const projectId = selected?.projectId ?? 'project';
    let suffix = state.document.configurations.length + 1;
    let value = createTomcatRunConfiguration(`tomcat-${suffix}`, projectId);
    while (state.document.configurations.some(item => item.id === value.id)) value = createTomcatRunConfiguration(`tomcat-${++suffix}`, projectId);
    setEditing({ value });
  };
  const launchSteps = selected ? [...selected.beforeLaunchTasks, 'run'] : [];
  const stepLabel = (step: string) => step === 'build' ? t('widget.runConfigurations.editor.beforeLaunchBuild') : step === 'deploy' ? t('widget.runConfigurations.editor.beforeLaunchDeploy') : t('common.run');
  const buildSummary = selected ? `${selected.build.type === 'ant' ? `${t('widget.runConfigurations.editor.buildTypeAnt')} (${selected.build.target})` : selected.build.type === 'javac' ? t('widget.runConfigurations.editor.buildTypeJavac') : t('widget.runConfigurations.editor.buildTypeCustom')}${selected.build.clean ? ` + ${t('widget.runConfigurations.summary.clean')}` : ''}` : '';
  return <div className="kairo-widget" aria-busy={busy}>
    <div className="kairo-widget-header"><span className="kairo-widget-title">{t('widget.runConfigurations.title')}</span><span className="kairo-runconfig-header-count" aria-live="polite" aria-atomic="true">{busy ? `${state.operation ?? t('widget.runConfigurations.operationPlaceholder')}…` : t('widget.runConfigurations.configurationCount', { count: state.document.configurations.length })}</span></div>
    <div className="kairo-runconfig-toolbar">
      <button className="theia-button main" disabled={busy} onClick={newConfiguration} aria-label={t('widget.runConfigurations.newConfiguration')}>
        <span className="codicon codicon-add" aria-hidden="true" />
        {t('widget.runConfigurations.newConfiguration')}
      </button>
      <button className="theia-button secondary" disabled={busy} onClick={() => void service.load().catch(() => undefined)} aria-label={t('common.refresh')}>
        <span className="codicon codicon-refresh" aria-hidden="true" />
        {t('common.refresh')}
      </button>
    </div>
    {state.error && !state.portDiagnostics && (
      <div className="kairo-error-banner" role="alert">
        <span className="codicon codicon-warning" aria-hidden="true" />
        <span>{state.error}</span>
      </div>
    )}
    {state.portDiagnostics && <PortOccupationError diagnostics={state.portDiagnostics} i18n={i18n} onModifyPort={() => {
      const selected = state.document.configurations.find(item => item.id === state.document.selectedConfigurationId);
      if (selected) {
        setEditing({ originalId: selected.id, value: { ...selected, server: { ...selected.server, httpPort: selected.server.httpPort + 1 } } });
      }
    }} />}
    {isLaunching && launchSteps.length > 0 && <div className="kairo-runconfig-launch-progress">
      <div className="kairo-runconfig-launch-title">{t('widget.runConfigurations.launchProgress')}</div>
      {launchSteps.map(step => <div key={step} className="kairo-runconfig-launch-step">
        <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
        <span>{stepLabel(step)}</span>
      </div>)}
    </div>}
    {state.validationIssues.length > 0 && <ul className="kairo-runconfig-validation-issues" role="alert">{state.validationIssues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.path}: {issue.message}</li>)}</ul>}
    {selected && !isLaunching && (
      <div className="kairo-runconfig-summary" data-testid="runconfig-summary">
        <div className="kairo-runconfig-summary-row">
          <span className="kairo-runconfig-summary-label">{t('widget.runConfigurations.summary.mode')}</span>
          <span className={`kairo-runconfig-badge kairo-runconfig-badge-${selected.mode}`}>{selected.mode.toUpperCase()}</span>
        </div>
        <div className="kairo-runconfig-summary-row">
          <span className="kairo-runconfig-summary-label">{t('widget.runConfigurations.summary.server')}</span>
          <span>HTTP {selected.server.httpPort} / JDWP {selected.server.debugPort}</span>
        </div>
        <div className="kairo-runconfig-summary-row">
          <span className="kairo-runconfig-summary-label">{t('widget.runConfigurations.summary.build')}</span>
          <span>{buildSummary}</span>
        </div>
        <div className="kairo-runconfig-summary-row">
          <span className="kairo-runconfig-summary-label">{t('widget.runConfigurations.summary.deploy')}</span>
          <span>{selected.deploy.mode === 'exploded' ? t('widget.runConfigurations.editor.deployModeExploded') : t('widget.runConfigurations.editor.deployModeWar')} → {selected.deploy.artifact}</span>
        </div>
      </div>
    )}
    {state.document.configurations.length === 0 ? <div className="kairo-empty-state" role="status">
      <div className="kairo-empty-state-glyph">
        <span className="codicon codicon-gear" aria-hidden="true" />
      </div>
      <h3 className="kairo-empty-state-title">{t('widget.runConfigurations.emptyStateTitle')}</h3>
      <p className="kairo-empty-state-reason">{t('widget.runConfigurations.emptyStateReason')}</p>
      <div className="kairo-empty-state-action">
        <button className="theia-button main" onClick={newConfiguration}>{t('widget.runConfigurations.emptyStateAction')}</button>
      </div>
    </div> : <ul className="kairo-runconfig-list" role="list" aria-label={t('widget.runConfigurations.title')}>
      {state.document.configurations.map(configuration => <li key={configuration.id} className="kairo-runconfig-list-item">
        <div className="kairo-runconfig-list-item-header">
          <strong>{configuration.name}</strong>
          {configuration.id === state.document.selectedConfigurationId && <span className="kairo-runconfig-badge kairo-runconfig-badge-default" aria-label={t('widget.runConfigurations.defaultBadge')}>{t('widget.runConfigurations.defaultBadge')}</span>}
        </div>
        <div className="kairo-runconfig-list-item-info">
          <span className="kairo-runconfig-list-item-info-pill" data-kind="mode">{configuration.mode.toUpperCase()}</span>
          <span className="kairo-runconfig-list-item-info-pill" data-kind="project">{configuration.projectId}</span>
          <span className="kairo-runconfig-list-item-info-pill" data-kind="ports">HTTP {configuration.server.httpPort} · JDWP {configuration.server.debugPort}</span>
        </div>
        <div className="kairo-runconfig-list-item-actions">
          <button className="theia-button toolbar" disabled={busy} aria-label={`${t('common.run')} ${configuration.name}`} title={`${t('common.run')} ${configuration.name}`} onClick={() => void service.launch(configuration).catch(() => undefined)}>
            <span className="codicon codicon-play" aria-hidden="true" />
          </button>
          <button className="theia-button toolbar" disabled={busy} aria-label={`${t('common.debug')} ${configuration.name}`} title={`${t('common.debug')} ${configuration.name}`} onClick={() => void service.debugConfiguration(configuration).catch(() => undefined)}>
            <span className="codicon codicon-debug-alt" aria-hidden="true" />
          </button>
          <button className="theia-button toolbar" disabled={busy} onClick={() => setEditing({ originalId: configuration.id, value: configuration })} aria-label={`${t('common.edit')} ${configuration.name}`} title={`${t('common.edit')} ${configuration.name}`}>
            <span className="codicon codicon-edit" aria-hidden="true" />
          </button>
          <button className="theia-button danger" disabled={busy} onClick={() => {
            void (async () => {
              const confirmed = await new ConfirmDialog({
                title: t('common.delete'),
                msg: t('widget.runConfigurations.deleteConfirm', { name: configuration.name }),
                ok: t('common.delete'),
                cancel: t('common.cancel'),
              }).open();
              if (confirmed) {
                void service.delete(configuration.id).catch(() => undefined);
              }
            })();
          }} aria-label={`${t('common.delete')} ${configuration.name}`} title={`${t('common.delete')} ${configuration.name}`}>
            <span className="codicon codicon-trash" aria-hidden="true" />
          </button>
        </div>
      </li>)}
    </ul>}
  </div>;
};

@injectable()
export class KairoRunConfigurationsWidget extends ReactWidget {
  static readonly ID = KAIRO_RUN_CONFIGURATIONS_FACTORY_ID;
  @inject(KairoRunConfigurationService) protected readonly service!: KairoRunConfigurationService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  @postConstruct()
  protected init(): void {
    this.id = KairoRunConfigurationsWidget.ID;
    this.title.label = this.i18n.t('widget.runConfigurations.title');
    this.title.caption = this.i18n.t('widget.runConfigurations.caption');
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      this.title.label = this.i18n.t('widget.runConfigurations.title');
      this.title.caption = this.i18n.t('widget.runConfigurations.caption');
    }));
    this.update();
  }

  protected render(): React.ReactNode {
    return <RunConfigurationsView service={this.service} i18n={this.i18n} />;
  }
}
