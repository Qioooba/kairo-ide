import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { TomcatRunConfiguration, PortDiagnostics } from '@kairo/protocol';
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
  onCancel(): void;
  onSave(value: TomcatRunConfiguration): Promise<void>;
}

const ConfigurationEditor: React.FC<EditorProps> = ({ initial, idReadOnly, busy, onCancel, onSave }) => {
  const [draft, setDraft] = React.useState<TomcatRunConfiguration>(() => structuredClone(initial));
  const [environment, setEnvironment] = React.useState(() => envText(initial.env));
  const [localError, setLocalError] = React.useState<string>();
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
  return <form onSubmit={submit} className="kairo-runconfig-form" aria-label="Run configuration editor">
    <h3 className="kairo-runconfig-title">{initial.id ? 'Edit Run Configuration' : 'New Run Configuration'}</h3>

    {/* General Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">General</legend>
      <div className="kairo-runconfig-grid">
        {field('ID', draft.id, value => setDraft({ ...draft, id: value }), 'text', idReadOnly)}
        {field('Name', draft.name, value => setDraft({ ...draft, name: value }))}
        {field('Project ID', draft.projectId, value => setDraft({ ...draft, projectId: value }))}
        {field('JDK reference', draft.jdkRef, value => setDraft({ ...draft, jdkRef: value }))}
        <label className="kairo-runconfig-field">
          <span className="kairo-runconfig-field-label">Mode</span>
          <select className="theia-select kairo-runconfig-select" value={draft.mode} disabled={busy} onChange={event => setDraft({ ...draft, mode: event.target.value as 'run' | 'debug', suspend: false })} aria-label="Run mode">
            <option value="run">Run</option>
            <option value="debug">Debug</option>
          </select>
        </label>
        <label className="kairo-runconfig-field kairo-runconfig-checkbox">
          <input type="checkbox" checked={draft.suspend} disabled={busy || draft.mode !== 'debug'} onChange={event => setDraft({ ...draft, suspend: event.target.checked })} />
          <span>Suspend until debugger attaches</span>
        </label>
      </div>
    </fieldset>

    {/* Server Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">Server</legend>
      <div className="kairo-runconfig-grid">
        {field('Server reference', draft.server.id, value => setDraft({ ...draft, server: { ...draft.server, id: value } }))}
        {field('HTTP port', draft.server.httpPort, value => setDraft({ ...draft, server: { ...draft.server, httpPort: Number(value) } }), 'number')}
        {field('Debug port', draft.server.debugPort, value => setDraft({ ...draft, server: { ...draft.server, debugPort: Number(value) } }), 'number')}
        {field('Context path', draft.server.contextPath, value => setDraft({ ...draft, server: { ...draft.server, contextPath: value } }))}
      </div>
    </fieldset>

    {/* Build Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">Build</legend>
      <div className="kairo-runconfig-grid">
        <label className="kairo-runconfig-field">
          <span className="kairo-runconfig-field-label">Build type</span>
          <select className="theia-select kairo-runconfig-select" value={draft.build.type} disabled={busy} onChange={event => {
            const type = event.target.value;
            setDraft({ ...draft, build: type === 'ant' ? { type, target: 'war', clean: false } : type === 'javac' ? { type, clean: false } : { type: 'custom', command: '', clean: false } });
          }} aria-label="Build type">
            <option value="ant">Ant</option>
            <option value="javac">javac</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {draft.build.type === 'ant' && field('Ant target', draft.build.target, value => setDraft({ ...draft, build: { ...draft.build, type: 'ant', target: value } }))}
        {draft.build.type === 'custom' && <div className="kairo-runconfig-field">{field('Custom command', draft.build.command, value => setDraft({ ...draft, build: { ...draft.build, type: 'custom', command: value } }))}<small className="kairo-runconfig-hint">Stored only; this version never executes custom commands. Execution wiring is deferred to P1-RUN-04.</small></div>}
        <label className="kairo-runconfig-field kairo-runconfig-checkbox">
          <input type="checkbox" checked={draft.build.clean} disabled={busy} onChange={event => setDraft({ ...draft, build: { ...draft.build, clean: event.target.checked } })} />
          <span>Clean before build</span>
        </label>
      </div>
    </fieldset>

    {/* Deploy Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">Deploy</legend>
      <div className="kairo-runconfig-grid">
        <label className="kairo-runconfig-field">
          <span className="kairo-runconfig-field-label">Deploy mode</span>
          <select className="theia-select kairo-runconfig-select" value={draft.deploy.mode} disabled={busy} onChange={event => setDraft({ ...draft, deploy: { ...draft.deploy, mode: event.target.value as 'exploded' | 'war' } })} aria-label="Deploy mode">
            <option value="exploded">Exploded</option>
            <option value="war">WAR</option>
          </select>
        </label>
        {field('Artifact (project-relative)', draft.deploy.artifact, value => setDraft({ ...draft, deploy: { ...draft.deploy, artifact: value } }))}
      </div>
    </fieldset>

    {/* Advanced Settings */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">Advanced</legend>
      <div className="kairo-runconfig-advanced">
        <label className="kairo-runconfig-field" style={{ gridColumn: '1 / -1' }}>
          <span className="kairo-runconfig-field-label">VM options (one per line)</span>
          <textarea className="theia-input kairo-runconfig-textarea" rows={3} value={draft.vmOptions.join('\n')} disabled={busy} onChange={event => setDraft({ ...draft, vmOptions: event.target.value.split(/\r?\n/).filter(Boolean) })} aria-label="VM options" />
        </label>
        <label className="kairo-runconfig-field" style={{ gridColumn: '1 / -1' }}>
          <span className="kairo-runconfig-field-label">Environment (one NAME=value per line)</span>
          <textarea className="theia-input kairo-runconfig-textarea" rows={4} value={environment} disabled={busy} onChange={event => setEnvironment(event.target.value)} aria-describedby="kairo-env-help" />
          <small className="kairo-runconfig-hint" id="kairo-env-help">Sensitive names such as PASSWORD, TOKEN or SECRET must use references like ${'{env:HOST_SECRET}'}. Plaintext is rejected and never saved.</small>
        </label>
      </div>
    </fieldset>

    {/* Before Launch */}
    <fieldset className="kairo-runconfig-fieldset">
      <legend className="kairo-runconfig-legend">Before Launch</legend>
      <div className="kairo-runconfig-checkbox-group">
        {(['build', 'deploy'] as const).map(task => (
          <label key={task} className="kairo-runconfig-field kairo-runconfig-checkbox">
            <input type="checkbox" checked={draft.beforeLaunchTasks.includes(task)} disabled={busy} onChange={event => setDraft({ ...draft, beforeLaunchTasks: event.target.checked ? [...draft.beforeLaunchTasks, task].sort((a, b) => a === 'build' ? -1 : b === 'build' ? 1 : 0) : draft.beforeLaunchTasks.filter(value => value !== task) })} />
            <span>{task.charAt(0).toUpperCase() + task.slice(1)}</span>
          </label>
        ))}
      </div>
    </fieldset>

    {localError && <div className="kairo-runconfig-error" role="alert">{localError}</div>}
    <div className="kairo-runconfig-actions">
      <button className="theia-button main" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      <button className="theia-button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
};

const PortOccupationError: React.FC<{ diagnostics: PortDiagnostics; onModifyPort(): void }> = ({ diagnostics, onModifyPort }) => (
  <div role="alert" style={{ padding: 8, border: '1px solid var(--theia-errorForeground)', borderRadius: 4, marginBottom: 8 }}>
    <strong>Port {diagnostics.port} is occupied</strong>
    {diagnostics.pid && diagnostics.processName && (
      <div style={{ marginTop: 4 }}>Process: <code>{diagnostics.processName}</code> (PID {diagnostics.pid})</div>
    )}
    {diagnostics.suggestion && <div style={{ marginTop: 4, opacity: 0.8 }}>{diagnostics.suggestion}</div>}
    <button className="theia-button" style={{ marginTop: 8 }} onClick={onModifyPort}>Modify Port</button>
  </div>
);

const RunConfigurationsView: React.FC<{ service: KairoRunConfigurationService }> = ({ service }) => {
  const [state, setState] = React.useState<RunConfigurationViewState>(service.current as RunConfigurationViewState);
  const [editing, setEditing] = React.useState<{ originalId?: string; value: TomcatRunConfiguration }>();
  React.useEffect(() => {
    const subscription = service.onDidChange(next => setState({ ...next }));
    void service.load().catch(() => undefined);
    return () => subscription.dispose();
  }, [service]);
  const busy = state.loading || state.submitting;
  const selected = state.document.configurations.find(item => item.id === state.document.selectedConfigurationId);
  const isLaunching = state.submitting && state.operation === 'launch';
  if (editing) return <ConfigurationEditor initial={editing.value} idReadOnly={Boolean(editing.originalId)} busy={busy} onCancel={() => setEditing(undefined)} onSave={async value => {
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
  return <div className="kairo-widget" aria-busy={busy}>
    <div className="kairo-widget-header"><span className="kairo-widget-title">Run Configurations</span><span aria-live="polite" aria-atomic="true">{busy ? `${state.operation ?? 'operation'}…` : `${state.document.configurations.length} configuration(s)`}</span></div>
    <div className="kairo-widget-toolbar">
      <button className="theia-button main" disabled={busy} onClick={newConfiguration} aria-label="Create new run configuration">New</button>
      <button className="theia-button" disabled={busy} onClick={() => void service.load().catch(() => undefined)} aria-label="Refresh run configurations">Refresh</button>
      <button className="theia-button" disabled={busy || !selected} aria-label="Run selected configuration" onClick={() => selected && void service.launch(selected).catch(() => undefined)}>Run</button>
      <button className="theia-button" disabled={busy || !selected} aria-label="Debug selected configuration" onClick={() => selected && void service.launch({ ...selected, mode: 'debug' }).catch(() => undefined)}>Debug</button>
    </div>
    {state.error && !state.portDiagnostics && <div role="alert" style={{ padding: 8 }}>{state.error}</div>}
    {state.portDiagnostics && <PortOccupationError diagnostics={state.portDiagnostics} onModifyPort={() => {
      const selected = state.document.configurations.find(item => item.id === state.document.selectedConfigurationId);
      if (selected) {
        setEditing({ originalId: selected.id, value: { ...selected, server: { ...selected.server, httpPort: selected.server.httpPort + 1 } } });
      }
    }} />}
    {isLaunching && launchSteps.length > 0 && <div style={{ padding: '8px 12px' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Launch progress</div>
      {launchSteps.map(step => <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
        <span style={{ opacity: 0.5, width: 16, textAlign: 'center' }}>⏳</span>
        <span>{step}</span>
      </div>)}
    </div>}
    {state.validationIssues.length > 0 && <ul role="alert">{state.validationIssues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.path}: {issue.message}</li>)}</ul>}
    {selected && !isLaunching && (
      <div className="kairo-runconfig-summary" data-testid="runconfig-summary">
        <div className="kairo-runconfig-summary-row">
          <span className="kairo-runconfig-summary-label">Mode</span>
          <span className={`kairo-runconfig-badge kairo-runconfig-badge-${selected.mode}`}>{selected.mode.toUpperCase()}</span>
        </div>
        <div className="kairo-runconfig-summary-row">
          <span className="kairo-runconfig-summary-label">Server</span>
          <span>HTTP {selected.server.httpPort} / JDWP {selected.server.debugPort}</span>
        </div>
        <div className="kairo-runconfig-summary-row">
          <span className="kairo-runconfig-summary-label">Build</span>
          <span>{selected.build.type === 'ant' ? `Ant (${selected.build.target})` : selected.build.type === 'javac' ? 'javac' : 'Custom'}{selected.build.clean ? ' + Clean' : ''}</span>
        </div>
        <div className="kairo-runconfig-summary-row">
          <span className="kairo-runconfig-summary-label">Deploy</span>
          <span>{selected.deploy.mode} → {selected.deploy.artifact}</span>
        </div>
      </div>
    )}
    {state.document.configurations.length === 0 ? <p className="kairo-empty">No run configurations. Create one to launch Tomcat consistently.</p> : <ul className="kairo-runconfig-list" role="list" aria-label="Run configurations">
      {state.document.configurations.map(configuration => <li key={configuration.id} className="kairo-runconfig-list-item">
        <div className="kairo-runconfig-list-item-header">
          <strong>{configuration.name}</strong>
          {configuration.id === state.document.selectedConfigurationId && <span className="kairo-runconfig-badge kairo-runconfig-badge-default" aria-label="default configuration">★ Default</span>}
        </div>
        <div className="kairo-runconfig-list-item-info">{configuration.mode.toUpperCase()} · {configuration.projectId} · HTTP {configuration.server.httpPort} · JDWP {configuration.server.debugPort}</div>
        <div className="kairo-widget-toolbar">
          <button className="theia-button" disabled={busy} onClick={() => setEditing({ originalId: configuration.id, value: configuration })} aria-label={`Edit configuration ${configuration.name}`}>Edit</button>
          <button className="theia-button" disabled={busy} onClick={() => void service.copy(configuration).catch(() => undefined)} aria-label={`Copy configuration ${configuration.name}`}>Copy</button>
          <button className="theia-button" disabled={busy || configuration.id === state.document.selectedConfigurationId} onClick={() => void service.selectDefault(configuration.id).catch(() => undefined)} aria-label={`Set ${configuration.name} as default`}>Set Default</button>
          <button className="theia-button" disabled={busy} aria-label={`Run ${configuration.name}`} onClick={() => void service.launch(configuration).catch(() => undefined)}>Run</button>
          <button className="theia-button" disabled={busy} aria-label={`Debug ${configuration.name}`} onClick={() => void service.launch({ ...configuration, mode: 'debug' }).catch(() => undefined)}>Debug</button>
          <button className="theia-button secondary" disabled={busy} onClick={() => { if (window.confirm(`Delete run configuration "${configuration.name}"?`)) void service.delete(configuration.id).catch(() => undefined); }} aria-label={`Delete configuration ${configuration.name}`}>Delete</button>
        </div>
      </li>)}
    </ul>}
  </div>;
};

@injectable()
export class KairoRunConfigurationsWidget extends ReactWidget {
  static readonly ID = KAIRO_RUN_CONFIGURATIONS_FACTORY_ID;
  @inject(KairoRunConfigurationService) protected readonly service!: KairoRunConfigurationService;

  @postConstruct()
  protected init(): void {
    this.id = KairoRunConfigurationsWidget.ID;
    this.title.label = 'Run Configurations';
    this.title.caption = 'Tomcat Run and Debug configurations';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.update();
  }

  protected render(): React.ReactNode {
    return <RunConfigurationsView service={this.service} />;
  }
}
