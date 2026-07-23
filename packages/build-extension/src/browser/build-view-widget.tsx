import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common';
import { BuildStore, BuildRun, BuildDiagnostic, ConnectionState } from './build-store';

function stateIcon(state: BuildRun['state'] | 'idle'): string {
    switch (state) {
        case 'pending': return '\u25CB'; // hollow circle
        case 'running': return '\u25D0'; // half circle (left black)
        case 'succeeded': return '\u2713'; // check mark
        case 'failed': return '\u2717'; // ballot x
        case 'cancelled': return '\u25A1'; // white square
        case 'idle': return '\u25CB'; // hollow circle
    }
}

function severityIcon(severity: BuildDiagnostic['severity']): string {
    switch (severity) {
        case 'error': return '\u274c';
        case 'warning': return '\u26a0\ufe0f';
        case 'info': return '\u2139\ufe0f';
    }
}

interface BuildViewProps {
    store: BuildStore;
    commandService: CommandService;
}

const BuildViewComponent: React.FC<BuildViewProps> = ({ store, commandService }) => {
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

    if (connectionState === 'loading') {
        return (
            <div className="kairo-widget" data-testid="build-view">
                <div className="kairo-widget-header" data-testid="build-view-header">
                    <span className="kairo-widget-title">Build Status</span>
                </div>
                <p className="kairo-empty" data-testid="build-loading">Loading...</p>
            </div>
        );
    }

    if (isDisconnected) {
        return (
            <div className="kairo-widget" data-testid="build-view">
                <div className="kairo-widget-header" data-testid="build-view-header">
                    <span className="kairo-widget-title">Build Status</span>
                    <span className="kairo-build-state" data-testid="build-state" data-state="disconnected">
                        Disconnected
                    </span>
                </div>
                <p className="kairo-empty" data-testid="build-disconnected">
                    Cannot reach the runtime agent. Build commands are unavailable.
                </p>
            </div>
        );
    }

    return (
        <div className="kairo-widget" data-testid="build-view">
            <div className="kairo-widget-header" data-testid="build-view-header">
                <span className="kairo-widget-title">Build Status</span>
                {latest && (
                    <span
                        className="kairo-build-state"
                        data-testid="build-state"
                        data-state={latest.state}
                        aria-live="polite"
                    >
                        {stateIcon(latest.state)} {latest.state}
                    </span>
                )}
                {!latest && (
                    <span className="kairo-build-state" data-testid="build-state" data-state="idle" aria-live="polite">
                        {stateIcon('idle')} idle
                    </span>
                )}
            </div>

            <div className="kairo-widget-toolbar" data-testid="build-view-toolbar">
                <button
                    className="theia-button"
                    data-testid="build-button"
                    onClick={handleBuild}
                    disabled={isBusy || isDisconnected}
                    aria-label="Build project"
                >
                    Build
                </button>
                <button
                    className="theia-button"
                    data-testid="clean-build-button"
                    onClick={handleCleanBuild}
                    disabled={isBusy || isDisconnected}
                    aria-label="Clean and build project"
                >
                    Clean Build
                </button>
                <button
                    className="theia-button secondary"
                    data-testid="cancel-build-button"
                    onClick={handleCancel}
                    disabled={!isBusy || isDisconnected || cancelling}
                    aria-label="Cancel current build"
                >
                    {cancelling ? 'Cancelling…' : 'Cancel'}
                </button>
            </div>

            {cancelError && <div className="theia-error" role="alert" data-testid="cancel-build-error">{cancelError}</div>}

            {latest && latest.summary && (
                <div className="kairo-build-summary" data-testid="build-summary">
                    {latest.summary}
                </div>
            )}

            {latest && latest.diagnostics && latest.diagnostics.length > 0 && (
                <div className="kairo-widget-section" data-testid="build-diagnostics">
                    <div className="kairo-section-title">Diagnostics</div>
                    <ul className="kairo-diagnostics-list" data-testid="diagnostics-list">
                        {latest.diagnostics.map((d, i) => (
                            <li
                                key={`${d.file}:${d.line}:${d.column}:${i}`}
                                className={`kairo-diagnostic kairo-diagnostic-${d.severity}`}
                                data-testid={`diagnostic-${d.severity}`}
                            >
                                <span className="kairo-diagnostic-icon">{severityIcon(d.severity)}</span>
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
                <div className="kairo-section-title">Build History</div>
                {isEmpty ? (
                    <p className="kairo-empty" data-testid="build-empty">
                        No builds yet. Press <strong>Build</strong> to start one.
                    </p>
                ) : (
                    <ul className="kairo-build-list" data-testid="build-list">
                        {builds.map(b => (
                            <li key={b.id} className="kairo-build-item" data-testid={`build-${b.id}`}>
                                <span className="kairo-build-state-icon">{stateIcon(b.state)}</span>
                                <span className="kairo-build-id">{b.id}</span>
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

    constructor() {
        super();
        this.id = BuildViewWidget.ID;
        this.title.label = 'Kairo Build';
        this.title.caption = 'Kairo Build View';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(BuildViewComponent, {
            store: this.buildStore,
            commandService: this.commandService,
        });
    }
}
