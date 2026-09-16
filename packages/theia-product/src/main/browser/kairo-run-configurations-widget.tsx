import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import type { TomcatRunConfiguration, PortDiagnostics, RunConfigurationBuild } from '@kairo/protocol';
import { KairoI18nService } from '@kairo/i18n';
import { validatePortText } from '@kairo/ui-kit';
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

type EditorMode = 'create' | 'edit';

/**
 * UI-only edit state (REPORT §5.2). Raw text is kept verbatim while typing;
 * the protocol object is only assembled at submit. Never persisted to the
 * run-configuration schema.
 */
interface RunConfigurationDraftUi {
  mode: EditorMode;
  vmOptionsText: string;
  environmentText: string;
  httpPortText: string;
  debugPortText: string;
  dirty: boolean;
}

interface EditorProps {
  /** Explicit create/edit mode (UI-11): never infer from a generated id. */
  mode: EditorMode;
  /** Stable record identity; drafts rebuild only when this changes (UI-12). */
  recordKey: string;
  initial: TomcatRunConfiguration;
  idReadOnly: boolean;
  busy: boolean;
  i18n: KairoI18nService;
  onCancel(): void;
  onSave(value: TomcatRunConfiguration): Promise<void>;
}

const PORT_RANGE_HINT = '1..65535';

const ConfigurationEditor: React.FC<EditorProps> = ({ mode, recordKey, initial, idReadOnly, busy, i18n, onCancel, onSave }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const buildDraft = (value: TomcatRunConfiguration): RunConfigurationDraftUi => ({
    mode,
    vmOptionsText: value.vmOptions.join('\n'),
    environmentText: envText(value.env),
    httpPortText: String(value.server.httpPort),
    debugPortText: String(value.server.debugPort),
    dirty: false,
  });
  const [draft, setDraft] = React.useState<TomcatRunConfiguration>(() => structuredClone(initial));
  const [ui, setUi] = React.useState<RunConfigurationDraftUi>(() => buildDraft(initial));
  const [localError, setLocalError] = React.useState<string>();
  const [portErrors, setPortErrors] = React.useState<{ httpPort?: string; debugPort?: string }>({});
  /** Per-build-type drafts; only the current type is serialized on save (UI-12). */
  const buildCacheRef = React.useRef<Partial<Record<RunConfigurationBuild['type'], RunConfigurationBuild>>>({ [initial.build.type]: initial.build });
  const activeRecordKey = React.useRef(recordKey);
  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);
  // Rebuild drafts only when switching to a different record — never on a
  // mere parent re-render with a new object identity (UI-12).
  React.useEffect(() => {
    if (activeRecordKey.current !== recordKey) {
      activeRecordKey.current = recordKey;
      setDraft(structuredClone(initial));
      setUi(buildDraft(initial));
      buildCacheRef.current = { [initial.build.type]: initial.build };
      setLocalError(undefined);
      setPortErrors({});
    }
    // initial is intentionally read only when recordKey changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordKey]);
  const patchDraft = (patch: Partial<TomcatRunConfiguration>) => setDraft(prev => ({ ...prev, ...patch }));
  const switchBuildType = (type: RunConfigurationBuild['type']) => {
    // Cache each build type's draft so switching back restores prior input (UI-12).
    buildCacheRef.current = { ...buildCacheRef.current, [draft.build.type]: draft.build };
    const restored = buildCacheRef.current[type];
    const next: RunConfigurationBuild = restored
      ?? (type === 'ant' ? { type, target: 'war', clean: false }
        : type === 'javac' ? { type, clean: false }
        : { type: 'custom', command: '', clean: false });
    setDraft({ ...draft, build: next });
  };
  const field = (
    id: string,
    label: string,
    value: string | number,
    update: (value: string) => void,
    type = 'text',
    readOnly = false,
    error?: string,
  ) => {
    const errorId = `${id}-error`;
    return (
      <label className="kairo-runconfig-field" htmlFor={id}>
        <span className="kairo-runconfig-field-label">{label}</span>
        <input
          id={id}
          className="theia-input kairo-runconfig-input"
          type={type}
          value={value}
          // UI-13: readonly stays focusable/copyable and is never disabled.
          disabled={busy && !readOnly}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={event => update(event.target.value)}
        />
        {error && <span id={errorId} className="kairo-runconfig-field-error" role="alert">{error}</span>}
      </label>
    );
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    // UI-13: ports validate from raw strings at submit time; intermediate
    // states (empty, partial) are preserved while typing.
    const http = validatePortText(ui.httpPortText);
    const debug = validatePortText(ui.debugPortText);
    const errors: { httpPort?: string; debugPort?: string } = {};
    if (!http.port) errors.httpPort = t('widget.runConfigurations.editor.portRange', { range: PORT_RANGE_HINT });
    if (!debug.port) errors.debugPort = t('widget.runConfigurations.editor.portRange', { range: PORT_RANGE_HINT });
    setPortErrors(errors);
    if (http.port === undefined || debug.port === undefined) return;
    try {
      setLocalError(undefined);
      // UI-03: JVM options normalize here, not per keystroke — blank lines
      // and trailing newlines survive editing; only whitespace-only lines drop.
      const vmOptions = ui.vmOptionsText
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0);
      await onSave({
        ...draft,
        server: { ...draft.server, httpPort: http.port, debugPort: debug.port },
        vmOptions,
        env: parseEnvironmentReferences(ui.environmentText),
        suspend: draft.mode === 'debug' && draft.suspend,
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };
  const title = mode === 'create' ? t('widget.runConfigurations.editor.newTitle') : t('widget.runConfigurations.editor.editTitle');
  return <form onSubmit={submit} className="kairo-runconfig-form" aria-label={title}>
    <h3 className="kairo-runconfig-title" data-testid="run-config-title" data-mode={mode}>{title}</h3>

    {/* General Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.general')}</legend>
      <div className="kairo-runconfig-grid">
        {field('run-config-id', t('widget.runConfigurations.editor.id'), draft.id, value => patchDraft({ id: value }), 'text', idReadOnly)}
        {field('run-config-name', t('widget.runConfigurations.editor.name'), draft.name, value => patchDraft({ name: value }))}
        {field('run-config-project', t('widget.runConfigurations.editor.projectId'), draft.projectId, value => patchDraft({ projectId: value }))}
        {field('run-config-jdk', t('widget.runConfigurations.editor.jdkRef'), draft.jdkRef, value => patchDraft({ jdkRef: value }))}
        <label className="kairo-runconfig-field" htmlFor="run-config-mode">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.mode')}</span>
          <select id="run-config-mode" className="theia-select kairo-runconfig-select" value={draft.mode} disabled={busy} onChange={event => patchDraft({ mode: event.target.value as 'run' | 'debug', suspend: false })} aria-label={t('widget.runConfigurations.editor.mode')}>
            <option value="run">{t('widget.runConfigurations.editor.modeRun')}</option>
            <option value="debug">{t('widget.runConfigurations.editor.modeDebug')}</option>
          </select>
        </label>
        <label className="kairo-runconfig-field kairo-runconfig-checkbox">
          <input type="checkbox" checked={draft.suspend} disabled={busy || draft.mode !== 'debug'} onChange={event => patchDraft({ suspend: event.target.checked })} />
          <span>{t('widget.runConfigurations.editor.suspend')}</span>
        </label>
      </div>
    </fieldset>

    {/* Server Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.server')}</legend>
      <div className="kairo-runconfig-grid">
        {field('run-config-server', t('widget.runConfigurations.editor.serverRef'), draft.server.id, value => patchDraft({ server: { ...draft.server, id: value } }))}
        {field('run-config-http-port', t('widget.runConfigurations.editor.httpPort'), ui.httpPortText, value => setUi({ ...ui, httpPortText: value }), 'text', false, portErrors.httpPort)}
        {field('run-config-debug-port', t('widget.runConfigurations.editor.debugPort'), ui.debugPortText, value => setUi({ ...ui, debugPortText: value }), 'text', false, portErrors.debugPort)}
        {field('run-config-context', t('widget.runConfigurations.editor.contextPath'), draft.server.contextPath, value => patchDraft({ server: { ...draft.server, contextPath: value } }))}
      </div>
    </fieldset>

    {/* Build Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.build')}</legend>
      <div className="kairo-runconfig-grid">
        <label className="kairo-runconfig-field" htmlFor="run-config-build-type">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.buildType')}</span>
          <select id="run-config-build-type" className="theia-select kairo-runconfig-select" value={draft.build.type} disabled={busy} onChange={event => {
            switchBuildType(event.target.value as RunConfigurationBuild['type']);
          }} aria-label={t('widget.runConfigurations.editor.buildType')}>
            <option value="ant">{t('widget.runConfigurations.editor.buildTypeAnt')}</option>
            <option value="javac">{t('widget.runConfigurations.editor.buildTypeJavac')}</option>
            <option value="custom">{t('widget.runConfigurations.editor.buildTypeCustom')}</option>
          </select>
        </label>
        {draft.build.type === 'ant' && field('run-config-ant-target', t('widget.runConfigurations.editor.antTarget'), draft.build.target, value => patchDraft({ build: { ...draft.build, type: 'ant', target: value } }))}
        {draft.build.type === 'custom' && <div className="kairo-runconfig-field">{field('run-config-custom-command', t('widget.runConfigurations.editor.customCommand'), draft.build.command, value => patchDraft({ build: { ...draft.build, type: 'custom', command: value } }))}<small className="kairo-runconfig-hint">{t('widget.runConfigurations.editor.customCommandHint')}</small></div>}
        <label className="kairo-runconfig-field kairo-runconfig-checkbox">
          <input type="checkbox" checked={draft.build.clean} disabled={busy} onChange={event => patchDraft({ build: { ...draft.build, clean: event.target.checked } })} />
          <span>{t('widget.runConfigurations.editor.cleanBeforeBuild')}</span>
        </label>
      </div>
    </fieldset>

    {/* Deploy Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.deploy')}</legend>
      <div className="kairo-runconfig-grid">
        <label className="kairo-runconfig-field" htmlFor="run-config-deploy-mode">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.deployMode')}</span>
          <select id="run-config-deploy-mode" className="theia-select kairo-runconfig-select" value={draft.deploy.mode} disabled={busy} onChange={event => patchDraft({ deploy: { ...draft.deploy, mode: event.target.value as 'exploded' | 'war' } })} aria-label={t('widget.runConfigurations.editor.deployMode')}>
            <option value="exploded">{t('widget.runConfigurations.editor.deployModeExploded')}</option>
            <option value="war">{t('widget.runConfigurations.editor.deployModeWar')}</option>
          </select>
        </label>
        {field('run-config-artifact', t('widget.runConfigurations.editor.artifact'), draft.deploy.artifact, value => patchDraft({ deploy: { ...draft.deploy, artifact: value } }))}
      </div>
    </fieldset>

    {/* Advanced Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">{t('widget.runConfigurations.editor.advanced')}</legend>
      <div className="kairo-runconfig-advanced">
        <label className="kairo-runconfig-field kairo-runconfig-field-wide" htmlFor="run-config-vm-options">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.vmOptions')}</span>
          {/* UI-03: raw text state; Enter/newlines preserved verbatim while
              typing (IME/CRLF safe); normalized only at submit. */}
          <textarea id="run-config-vm-options" data-testid="run-config-vm-options" className="theia-input kairo-runconfig-textarea" rows={3} value={ui.vmOptionsText} disabled={busy} onChange={event => setUi({ ...ui, vmOptionsText: event.currentTarget.value })} aria-label={t('widget.runConfigurations.editor.vmOptions')} />
        </label>
        <label className="kairo-runconfig-field kairo-runconfig-field-wide" htmlFor="run-config-environment">
          <span className="kairo-runconfig-field-label">{t('widget.runConfigurations.editor.environment')}</span>
          <textarea id="run-config-environment" className="theia-input kairo-runconfig-textarea" rows={4} value={ui.environmentText} disabled={busy} onChange={event => setUi({ ...ui, environmentText: event.target.value })} aria-describedby="kairo-env-help" />
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
  const [editing, setEditing] = React.useState<{ mode: EditorMode; originalId?: string; value: TomcatRunConfiguration }>();
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
  if (editing) return <ConfigurationEditor mode={editing.mode} recordKey={editing.originalId ?? `new:${editing.value.id}`} initial={editing.value} idReadOnly={Boolean(editing.originalId)} busy={busy} i18n={i18n} onCancel={() => setEditing(undefined)} onSave={async value => {
    if (editing.originalId) await service.update(editing.originalId, value); else await service.create(value);
    setEditing(undefined);
  }} />;
  const newConfiguration = () => {
    const projectId = selected?.projectId ?? 'project';
    let suffix = state.document.configurations.length + 1;
    let value = createTomcatRunConfiguration(`tomcat-${suffix}`, projectId);
    while (state.document.configurations.some(item => item.id === value.id)) value = createTomcatRunConfiguration(`tomcat-${++suffix}`, projectId);
    setEditing({ mode: 'create', value });
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
        setEditing({ mode: 'edit', originalId: selected.id, value: { ...selected, server: { ...selected.server, httpPort: selected.server.httpPort + 1 } } });
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
          <button className="theia-button toolbar" disabled={busy} onClick={() => setEditing({ mode: 'edit', originalId: configuration.id, value: configuration })} aria-label={`${t('common.edit')} ${configuration.name}`} title={`${t('common.edit')} ${configuration.name}`}>
            <span className="codicon codicon-edit" aria-hidden="true" />
          </button>
          <button className="theia-button toolbar kairo-runconfig-btn-delete" disabled={busy} onClick={() => {
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
