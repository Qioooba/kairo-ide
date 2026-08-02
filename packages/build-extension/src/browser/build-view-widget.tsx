import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import URI from '@theia/core/lib/common/uri';
import { KairoI18nService } from '@kairo/i18n';
import { BuildStore, BuildRun, BuildDiagnostic, ConnectionState } from './build-store';

function stateIconClass(state: BuildRun['state'] | 'idle' | 'disconnected'): string {
    switch (state) {
        case 'pending': return 'codicon-circle-outline';
        case 'running': return 'codicon-sync codicon-modifier-spin';
        case 'succeeded': return 'codicon-check';
        case 'failed': return 'codicon-error';
        case 'cancelled': return 'codicon-close';
        case 'idle': return 'codicon-circle-outline';
        case 'disconnected': return 'codicon-warning';
    }
}

function severityIconClass(severity: BuildDiagnostic['severity']): string {
    switch (severity) {
        case 'error': return 'codicon-error';
        case 'warning': return 'codicon-warning';
        case 'info': return 'codicon-info';
    }
}

function diagnosticToUri(file: string): URI {
    const normalized = file.replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/')) {
        return new URI(`file:///${normalized.replace(/^\/+/, '')}`);
    }
    if (normalized.startsWith('file:')) {
        return new URI(normalized);
    }
    return new URI(normalized);
}

interface BuildViewProps {
    store: BuildStore;
    commandService: CommandService;
    openerService: OpenerService;
    i18n: KairoI18nService;
}

const BuildViewComponent: React.FC<BuildViewProps> = ({ store, commandService, openerService, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [builds, setBuilds] = React.useState<BuildRun[]>(store.getBuilds());
    const [connectionState, setConnectionState] = React.useState<ConnectionState>(store.getConnectionState());
    const [cancelError, setCancelError] = React.useState('');
    const [cancelling, setCancelling] = React.useState(false);

    React.useEffect(() => {
        const sub = store.onDidChange(b => setBuilds([...b]));
        return () => sub.dispose();
    }, [store]);

    React.useEffect(() => {
        const sub = store.onConnectionStateChange(s => setConnectionState(s));
        return () => sub.dispose();
    }, [store]);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    const latest = builds.length > 0 ? builds[builds.length - 1] : undefined;
    const isBusy = latest?.state === 'running' || latest?.state === 'pending';
    const isDisconnected = connectionState === 'disconnected';
    const isEmpty = builds.length === 0 && connectionState !== 'loading';

    const handleBuild = () => commandService.executeCommand('kairo.build');
    const handleCleanBuild = () => commandService.executeCommand('kairo.cleanBuild');
    const handleCancel = async () => {
        if (!latest || cancelling) return;
        setCancelError('');
        setCancelling(true);
        try {
            await store.cancelBuild(latest.id);
        } catch (error) {
            setCancelError(error instanceof Error ? error.message : String(error));
        } finally {
            setCancelling(false);
        }
    };

    const openDiagnostic = (d: BuildDiagnostic) => {
        const uri = diagnosticToUri(d.file);
        const line = Math.max(0, (d.line || 1) - 1);
        const character = Math.max(0, (d.column || 1) - 1);
        void open(openerService, uri, {
            selection: { start: { line, character }, end: { line, character } },
        });
    };

    const buildStateLabel = (state: BuildRun['state'] | 'idle' | 'disconnected'): string => {
        switch (state) {
            case 'idle': return t('widget.builds.state.idle');
            case 'pending': return t('widget.builds.state.pending');
            case 'running': return t('widget.builds.state.running');
            case 'succeeded': return t('widget.builds.state.succeeded');
            case 'failed': return t('widget.builds.state.failed');
            case 'cancelled': return t('widget.builds.state.cancelled');
            case 'disconnected': return t('common.disconnected');
        }
    };

    if (connectionState === 'loading') {
        return (
            <div className="kairo-widget" data-testid="build-view">
                <div className="kairo-widget-header" data-testid="build-view-header">
                    <span className="kairo-widget-title">{t('widget.builds.title')}</span>
                </div>
                <div className="kairo-widget-body">
                    <div className="kairo-empty-state" data-testid="build-loading">
                        <span className="kairo-empty-state-glyph codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{t('common.loading')}</h3>
                    </div>
                </div>
            </div>
        );
    }

    if (isDisconnected) {
        return (
            <div className="kairo-widget" data-testid="build-view">
                <div className="kairo-widget-header" data-testid="build-view-header">
                    <span className="kairo-widget-title">{t('widget.builds.title')}</span>
                    <span className="kairo-build-state" data-testid="build-state" data-state="disconnected">
                        <span className={`codicon ${stateIconClass('disconnected')}`} aria-hidden="true" /> {buildStateLabel('disconnected')}
                    </span>
                </div>
                <div className="kairo-widget-body">
                    <div className="kairo-empty-state" data-testid="build-disconnected">
                        <span className="kairo-empty-state-glyph codicon codicon-plug" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{t('widget.builds.disconnectedStateTitle')}</h3>
                        <p className="kairo-empty-state-reason">{t('widget.builds.disconnectedStateReason')}</p>
                        <div className="kairo-empty-state-action">
                            <button className="theia-button main" onClick={() => commandService.executeCommand('kairo.agent.reconnect')}>
                                {t('widget.builds.disconnectedStateAction')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="kairo-widget" data-testid="build-view">
            <div className="kairo-widget-header" data-testid="build-view-header">
                <span className="kairo-widget-title">{t('widget.builds.title')}</span>
                {latest && (
                    <span
                        className="kairo-build-state"
                        data-testid="build-state"
                        data-state={latest.state}
                        aria-live="polite"
                    >
                        <span className={`codicon ${stateIconClass(latest.state)}`} aria-hidden="true" /> {buildStateLabel(latest.state)}
                    </span>
                )}
                {!latest && (
                    <span className="kairo-build-state" data-testid="build-state" data-state="idle" aria-live="polite">
                        <span className={`codicon ${stateIconClass('idle')}`} aria-hidden="true" /> {buildStateLabel('idle')}
                    </span>
                )}
            </div>

            <div className="kairo-build-toolbar" data-testid="build-view-toolbar">
                <button
                    className="theia-button main"
                    data-testid="build-button"
                    onClick={handleBuild}
                    disabled={isBusy || isDisconnected}
                    aria-label={t('widget.builds.toolbar.buildAria')}
                >
                    <span className="codicon codicon-play" aria-hidden="true" />
                    {t('widget.builds.toolbar.build')}
                </button>
                <button
                    className="theia-button secondary"
                    data-testid="clean-build-button"
                    onClick={handleCleanBuild}
                    disabled={isBusy || isDisconnected}
                    aria-label={t('widget.builds.toolbar.cleanBuildAria')}
                >
                    <span className="codicon codicon-trash" aria-hidden="true" />
                    {t('widget.builds.toolbar.cleanBuild')}
                </button>
                <div className="kairo-build-toolbar-separator" />
                <button
                    className="theia-button toolbar"
                    data-testid="cancel-build-button"
                    onClick={handleCancel}
                    disabled={!isBusy || isDisconnected || cancelling}
                    aria-label={t('widget.builds.toolbar.cancelBuildAria')}
                >
                    <span className="codicon codicon-primitive-square" aria-hidden="true" />
                    {cancelling ? t('widget.builds.toolbar.cancelling') : t('widget.builds.toolbar.cancel')}
                </button>
            </div>

            {cancelError && (
                <div className="kairo-error-banner" role="alert" data-testid="cancel-build-error">
                    <span className="codicon codicon-error" aria-hidden="true" />
                    <span>{cancelError}</span>
                </div>
            )}

            {latest && latest.summary && (
                <div className="kairo-build-summary" data-testid="build-summary">
                    {latest.summary}
                </div>
            )}

            {latest && latest.diagnostics && latest.diagnostics.length > 0 && (
                <div className="kairo-widget-section" data-testid="build-diagnostics">
                    <div className="kairo-section-title">{t('widget.builds.diagnosticsTitle')}</div>
                    <ul className="kairo-diagnostics-list" data-testid="diagnostics-list">
                        {latest.diagnostics.map((d, i) => (
                            <li
                                key={`${d.file}:${d.line}:${d.column}:${i}`}
                                className={`kairo-diagnostic kairo-diagnostic-${d.severity}`}
                                data-testid={d.severity === 'error' ? 'build-error' : `diagnostic-${d.severity}`}
                                role="button"
                                tabIndex={0}
                                style={{ cursor: 'pointer' }}
                                onClick={() => openDiagnostic(d)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        openDiagnostic(d);
                                    }
                                }}
                                title={`${d.file}:${d.line}:${d.column}`}
                            >
                                <span className={`kairo-diagnostic-icon codicon ${severityIconClass(d.severity)}`} aria-hidden="true" />
                                <span className="kairo-diagnostic-location">
                                    {d.file}:{d.line}:{d.column}
                                </span>
                                <span className="kairo-diagnostic-message">{d.message}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="kairo-widget-section" data-testid="build-history">
                <div className="kairo-section-title">{t('widget.builds.historyTitle')}</div>
                {isEmpty ? (
                    <div className="kairo-empty-state" data-testid="build-empty">
                        <span className="kairo-empty-state-glyph codicon codicon-tools" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{t('widget.builds.emptyStateTitle')}</h3>
                        <p className="kairo-empty-state-reason">{t('widget.builds.emptyStateReason')}</p>
                    </div>
                ) : (
                    <ul className="kairo-build-list" data-testid="build-list">
                        {builds.map(b => (
                            <li key={b.id} className="kairo-build-item" data-testid={`build-${b.id}`}>
                                <span className={`kairo-build-state-icon codicon ${stateIconClass(b.state)}`} aria-hidden="true" />
                                <span className="kairo-build-id">{b.id}</span>
                                <span className="kairo-build-item-state" data-state={b.state}>{buildStateLabel(b.state)}</span>
                                <span className="kairo-build-time">{b.startTime}</span>
                                {b.endTime && (
                                    <span className="kairo-build-end-time">{b.endTime}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

@injectable()
export class BuildViewWidget extends ReactWidget {
    static readonly ID = 'kairo-build-view';

    @inject(BuildStore) protected readonly buildStore!: BuildStore;
    @inject(CommandService) protected readonly commandService!: CommandService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = BuildViewWidget.ID;
        this.title.label = '';
        this.title.caption = '';
        this.addClass('kairo-widget');
    }

    @postConstruct()
    protected init(): void {
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.builds.title');
        this.title.caption = this.i18n.t('widget.builds.caption');
    }

    protected render(): React.ReactNode {
        return React.createElement(BuildViewComponent, {
            store: this.buildStore,
            commandService: this.commandService,
            openerService: this.openerService,
            i18n: this.i18n,
        });
    }
}
