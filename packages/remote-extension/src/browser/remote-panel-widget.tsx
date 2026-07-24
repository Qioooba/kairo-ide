/**
 * Kairo Remote Panel Widget — Remote Connection Status & Management
 *
 * Provides:
 *   - Remote connection status indicator
 *   - File sync status and progress
 *   - Container management UI (list, start, stop)
 *   - Session management (active sessions, user count)
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ILogger } from '@theia/core/lib/common/logger';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface ConnectionInfo {
    host: string;
    port: number;
    tlsVersion: string;
    connectedAt: string;
    latency: number;
}

export interface FileSyncStatus {
    syncing: boolean;
    totalFiles: number;
    syncedFiles: number;
    lastSync: string;
    conflicts: number;
}

export interface ContainerInfo {
    id: string;
    name: string;
    image: string;
    state: 'running' | 'stopped' | 'paused';
    ports: { hostPort: number; containerPort: number }[];
}

export interface SessionInfo {
    id: string;
    userId: string;
    username: string;
    role: string;
    activeSince: string;
    lastActive: string;
}

export interface RemotePanelState {
    connected: boolean;
    connectionInfo: ConnectionInfo | null;
    fileSync: FileSyncStatus;
    containers: ContainerInfo[];
    sessions: SessionInfo[];
    loading: boolean;
    error: string | null;
}

export const KAIRO_REMOTE_PANEL_FACTORY_ID = 'kairo-remote-panel';

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface RemotePanelProps {
    logger: ILogger;
}

const RemotePanelComponent: React.FC<RemotePanelProps> = ({ logger }) => {
    const [state, setState] = React.useState<RemotePanelState>({
        connected: false,
        connectionInfo: null,
        fileSync: { syncing: false, totalFiles: 0, syncedFiles: 0, lastSync: '', conflicts: 0 },
        containers: [],
        sessions: [],
        loading: true,
        error: null,
    });
    const [activeTab, setActiveTab] = React.useState<'connection' | 'sync' | 'containers' | 'sessions'>('connection');

    const loadData = React.useCallback(() => {
        setState(prev => ({ ...prev, loading: true, error: null }));
        try {
            // In a real implementation, this would fetch from remote services.
            // For now, we provide the UI structure with mock data.
            const mockConnectionInfo: ConnectionInfo = {
                host: '192.168.1.100',
                port: 22,
                tlsVersion: 'TLS 1.3',
                connectedAt: new Date().toISOString(),
                latency: 12,
            };

            const mockContainers: ContainerInfo[] = [
                {
                    id: 'container-1',
                    name: 'kairo-dev',
                    image: 'kairo:latest',
                    state: 'running',
                    ports: [{ hostPort: 8080, containerPort: 8080 }, { hostPort: 5005, containerPort: 5005 }],
                },
                {
                    id: 'container-2',
                    name: 'kairo-db',
                    image: 'postgres:15',
                    state: 'running',
                    ports: [{ hostPort: 5432, containerPort: 5432 }],
                },
                {
                    id: 'container-3',
                    name: 'kairo-cache',
                    image: 'redis:7',
                    state: 'stopped',
                    ports: [{ hostPort: 6379, containerPort: 6379 }],
                },
            ];

            const mockSessions: SessionInfo[] = [
                {
                    id: 'session-1',
                    userId: 'user-001',
                    username: 'alice',
                    role: 'admin',
                    activeSince: new Date(Date.now() - 3600000).toISOString(),
                    lastActive: new Date().toISOString(),
                },
                {
                    id: 'session-2',
                    userId: 'user-002',
                    username: 'bob',
                    role: 'developer',
                    activeSince: new Date(Date.now() - 7200000).toISOString(),
                    lastActive: new Date(Date.now() - 300000).toISOString(),
                },
            ];

            setState({
                connected: true,
                connectionInfo: mockConnectionInfo,
                fileSync: {
                    syncing: false,
                    totalFiles: 1240,
                    syncedFiles: 1240,
                    lastSync: new Date().toISOString(),
                    conflicts: 0,
                },
                containers: mockContainers,
                sessions: mockSessions,
                loading: false,
                error: null,
            });
        } catch (err) {
            logger.error(`[RemotePanel] Failed to load data: ${String(err)}`);
            setState(prev => ({
                ...prev,
                loading: false,
                error: err instanceof Error ? err.message : String(err),
            }));
        }
    }, [logger]);

    React.useEffect(() => {
        loadData();
    }, [loadData]);

    const handleContainerAction = (containerId: string, action: 'start' | 'stop' | 'pause') => {
        setState(prev => ({
            ...prev,
            containers: prev.containers.map(c =>
                c.id === containerId
                    ? { ...c, state: action === 'start' ? 'running' : action === 'stop' ? 'stopped' : 'paused' as const }
                    : c,
            ),
        }));
    };

    const tabStyle = (tab: string): React.CSSProperties => ({
        padding: '6px 16px',
        cursor: 'pointer',
        borderBottom: activeTab === tab ? '2px solid var(--theia-focusBorder)' : '2px solid transparent',
        color: activeTab === tab ? 'var(--theia-focusBorder)' : 'var(--theia-descriptionForeground)',
        fontWeight: activeTab === tab ? 600 : 400,
        fontSize: '12px',
        background: 'none',
        border: 'none',
    });

    const stateColor = (s: string): string => {
        switch (s) {
            case 'running': return '#4caf50';
            case 'stopped': return '#f44336';
            case 'paused': return '#ff9800';
            default: return '#9e9e9e';
        }
    };

    const syncProgress = state.fileSync.totalFiles > 0
        ? Math.round((state.fileSync.syncedFiles / state.fileSync.totalFiles) * 100)
        : 0;

    // Loading state — skeleton placeholder
    if (state.loading) {
        return (
            <div className="kairo-remote-panel" role="status" aria-label="Loading remote panel" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '24px',
                        height: '24px',
                        border: '3px solid var(--theia-dropdown-border)',
                        borderTopColor: 'var(--theia-focusBorder)',
                        borderRadius: '50%',
                        animation: 'kairo-spin 0.8s linear infinite',
                    }} />
                    <p style={{ color: 'var(--theia-descriptionForeground)', fontSize: '13px', margin: 0 }}>
                        Loading remote panel data...
                    </p>
                    <div style={{ width: '80%', maxWidth: '300px' }}>
                        {[0, 1, 2].map(i => (
                            <div key={i} style={{
                                height: '12px',
                                backgroundColor: 'var(--theia-dropdown-border)',
                                borderRadius: '3px',
                                marginBottom: '8px',
                                opacity: 0.5 - i * 0.15,
                                width: `${90 - i * 15}%`,
                            }} />
                        ))}
                    </div>
                </div>
                <style>{`@keyframes kairo-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    // Error state — categorized by error type
    if (state.error) {
        const isTimeout = state.error.toLowerCase().includes('timeout') || state.error.toLowerCase().includes('timed out');
        const isPermission = state.error.toLowerCase().includes('permission') || state.error.toLowerCase().includes('denied') || state.error.toLowerCase().includes('unauthorized');
        const isNetwork = state.error.toLowerCase().includes('network') || state.error.toLowerCase().includes('connect') || state.error.toLowerCase().includes('unreachable');
        const errorIcon = isTimeout ? '⏱' : isPermission ? '🔒' : isNetwork ? '🌐' : '⚠';
        const errorTitle = isTimeout ? 'Connection Timed Out' : isPermission ? 'Permission Denied' : isNetwork ? 'Network Error' : 'Error loading remote panel';
        return (
            <div className="kairo-remote-panel" role="alert" aria-live="assertive" style={{ padding: '16px' }}>
                <div style={{
                    padding: '12px',
                    backgroundColor: 'rgba(244,67,54,0.1)',
                    border: '1px solid rgba(244,67,54,0.3)',
                    borderRadius: '4px',
                    color: 'var(--theia-errorForeground)',
                    fontSize: '13px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '18px' }} aria-hidden="true">{errorIcon}</span>
                        <strong>{errorTitle}</strong>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>{state.error}</p>
                    <button
                        className="theia-button"
                        onClick={loadData}
                        title="Retry loading remote panel data"
                        aria-label="Retry loading remote panel data"
                        style={{ marginTop: '8px', fontSize: '11px', padding: '2px 12px' }}
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const tabs = ['connection', 'sync', 'containers', 'sessions'] as const;
    const tabLabels: Record<string, string> = {
        connection: 'Connection',
        sync: 'File Sync',
        containers: 'Containers',
        sessions: 'Sessions',
    };

    const handleTabKeyDown = (e: React.KeyboardEvent, tab: string) => {
        const idx = tabs.indexOf(tab as typeof tabs[number]);
        if (e.key === 'ArrowRight' && idx < tabs.length - 1) {
            e.preventDefault();
            setActiveTab(tabs[idx + 1]);
        } else if (e.key === 'ArrowLeft' && idx > 0) {
            e.preventDefault();
            setActiveTab(tabs[idx - 1]);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setActiveTab(tab as typeof tabs[number]);
        }
    };

    return (
        <div className="kairo-remote-panel" role="region" aria-label="Remote Panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div className="kairo-widget-header" style={{ padding: '8px 12px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '13px' }}>Remote Panel</span>
                <span style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: state.connected ? '#4caf50' : '#f44336',
                }}
                    title={state.connected ? 'Connected to remote' : 'Disconnected from remote'}
                    aria-label={state.connected ? 'Connected' : 'Disconnected'}
                />
                <span style={{ fontSize: '11px', color: state.connected ? '#4caf50' : '#f44336' }}>
                    {state.connected ? 'Connected' : 'Disconnected'}
                </span>
            </div>

            {/* Tabs */}
            <div role="tablist" aria-label="Remote panel sections" style={{ display: 'flex', borderBottom: '1px solid var(--theia-panel-border)', padding: '0 8px' }}>
                {tabs.map(tab => (
                    <button
                        key={tab}
                        role="tab"
                        aria-selected={activeTab === tab}
                        aria-controls={`kairo-remote-tabpanel-${tab}`}
                        id={`kairo-remote-tab-${tab}`}
                        style={tabStyle(tab)}
                        onClick={() => setActiveTab(tab)}
                        onKeyDown={e => handleTabKeyDown(e, tab)}
                        tabIndex={activeTab === tab ? 0 : -1}
                        title={`${tabLabels[tab]} (${tab === 'connection' ? 'View connection details' : tab === 'sync' ? 'View file sync status' : tab === 'containers' ? 'Manage containers' : 'View active sessions'})`}
                    >
                        {tabLabels[tab]}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
                {activeTab === 'connection' && (
                    <div role="tabpanel" id="kairo-remote-tabpanel-connection" aria-labelledby="kairo-remote-tab-connection">
                        {state.connectionInfo ? (
                            <ConnectionTab info={state.connectionInfo} />
                        ) : (
                            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                                No connection information available. Connect to a remote host to see details.
                            </div>
                        )}
                    </div>
                )}
                {activeTab === 'sync' && (
                    <div role="tabpanel" id="kairo-remote-tabpanel-sync" aria-labelledby="kairo-remote-tab-sync">
                        <FileSyncTab sync={state.fileSync} progress={syncProgress} />
                    </div>
                )}
                {activeTab === 'containers' && (
                    <div role="tabpanel" id="kairo-remote-tabpanel-containers" aria-labelledby="kairo-remote-tab-containers">
                        <ContainersTab
                            containers={state.containers}
                            onAction={handleContainerAction}
                            stateColor={stateColor}
                        />
                    </div>
                )}
                {activeTab === 'sessions' && (
                    <div role="tabpanel" id="kairo-remote-tabpanel-sessions" aria-labelledby="kairo-remote-tab-sessions">
                        <SessionsTab sessions={state.sessions} />
                    </div>
                )}
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

interface ConnectionTabProps {
    info: ConnectionInfo;
}

const ConnectionTab: React.FC<ConnectionTabProps> = ({ info }) => {
    const latencyLabel = info.latency < 20 ? 'Excellent' : info.latency < 50 ? 'Good' : 'High';
    return (
        <div style={{
            padding: '10px 12px',
            backgroundColor: 'var(--theia-editor-background)',
            borderRadius: '4px',
            border: '1px solid var(--theia-dropdown-border)',
        }}
            role="group"
            aria-label="Connection details"
        >
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
                Connection Details
            </div>
            <div style={{ fontSize: '12px', color: 'var(--theia-descriptionForeground)' }}>
                <div style={rowStyle} title={`Host: ${info.host}`}>
                    <span>Host:</span>
                    <span style={{ fontWeight: 600, color: 'var(--theia-foreground)' }}>{info.host}</span>
                </div>
                <div style={rowStyle} title={`Port: ${info.port}`}>
                    <span>Port:</span>
                    <span style={{ fontWeight: 600, color: 'var(--theia-foreground)' }}>{info.port}</span>
                </div>
                <div style={rowStyle} title={`TLS Version: ${info.tlsVersion}`}>
                    <span>TLS Version:</span>
                    <span style={{ fontWeight: 600, color: '#4caf50' }}>{info.tlsVersion}</span>
                </div>
                <div style={rowStyle} title={`Connected at: ${info.connectedAt}`}>
                    <span>Connected At:</span>
                    <span style={{ fontWeight: 600, color: 'var(--theia-foreground)' }}>{info.connectedAt}</span>
                </div>
                <div style={rowStyle} title={`Latency: ${info.latency}ms (${latencyLabel})`}>
                    <span>Latency:</span>
                    <span style={{ fontWeight: 600, color: info.latency < 50 ? '#4caf50' : '#ff9800' }}>
                        {info.latency}ms
                        <span style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.7 }}>({latencyLabel})</span>
                    </span>
                </div>
            </div>
        </div>
    );
};

interface FileSyncTabProps {
    sync: FileSyncStatus;
    progress: number;
}

const FileSyncTab: React.FC<FileSyncTabProps> = ({ sync, progress }) => {
    return (
        <div role="group" aria-label="File sync status">
            <div style={{
                padding: '10px 12px',
                backgroundColor: 'var(--theia-editor-background)',
                borderRadius: '4px',
                border: '1px solid var(--theia-dropdown-border)',
                marginBottom: '12px',
            }}>
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
                    Sync Status
                </div>
                <div style={{ fontSize: '12px', color: 'var(--theia-descriptionForeground)' }}>
                    <div style={rowStyle} title={`Sync status: ${sync.syncing ? 'Syncing' : 'In Sync'}`}>
                        <span>Status:</span>
                        <span style={{
                            fontWeight: 600,
                            color: sync.syncing ? '#ff9800' : '#4caf50',
                        }}>
                            {sync.syncing ? 'Syncing...' : 'In Sync'}
                        </span>
                    </div>
                    <div style={rowStyle} title={`Files synced: ${sync.syncedFiles} of ${sync.totalFiles}`}>
                        <span>Files:</span>
                        <span style={{ fontWeight: 600, color: 'var(--theia-foreground)' }}>
                            {sync.syncedFiles} / {sync.totalFiles}
                        </span>
                    </div>
                    <div style={rowStyle} title={`Last sync: ${sync.lastSync || 'N/A'}`}>
                        <span>Last Sync:</span>
                        <span style={{ fontWeight: 600, color: 'var(--theia-foreground)' }}>{sync.lastSync || 'N/A'}</span>
                    </div>
                    <div style={rowStyle} title={`Conflicts: ${sync.conflicts}${sync.conflicts > 0 ? ' — action required' : ''}`}>
                        <span>Conflicts:</span>
                        <span style={{
                            fontWeight: 600,
                            color: sync.conflicts > 0 ? '#f44336' : '#4caf50',
                        }}>
                            {sync.conflicts}
                        </span>
                    </div>
                </div>
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginBottom: '4px' }}>
                    Sync Progress: {progress}%
                </div>
                <div
                    style={{
                        height: '8px',
                        backgroundColor: 'var(--theia-dropdown-border)',
                        borderRadius: '4px',
                        overflow: 'hidden',
                    }}
                    role="progressbar"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`File sync progress: ${progress}%`}
                    title={`${progress}% complete`}
                >
                    <div style={{
                        height: '100%',
                        width: `${progress}%`,
                        backgroundColor: '#4caf50',
                        borderRadius: '4px',
                        transition: 'width 0.3s ease',
                    }} />
                </div>
            </div>
        </div>
    );
};

interface ContainersTabProps {
    containers: ContainerInfo[];
    onAction: (id: string, action: 'start' | 'stop' | 'pause') => void;
    stateColor: (s: string) => string;
}

const ContainersTab: React.FC<ContainersTabProps> = ({ containers, onAction, stateColor }) => {
    if (containers.length === 0) {
        return (
            <div role="status" aria-label="No containers" style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                No containers found. Start a container to see it here.
            </div>
        );
    }

    return (
        <div role="list" aria-label="Container list">
            {containers.map(container => (
                <div key={container.id} role="listitem" style={{
                    marginBottom: '10px',
                    padding: '10px 12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    borderRadius: '4px',
                    border: '1px solid var(--theia-dropdown-border)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div>
                            <span style={{ fontWeight: 600, fontSize: '13px' }}>{container.name}</span>
                            <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--theia-descriptionForeground)' }}>
                                {container.image}
                            </span>
                        </div>
                        <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '3px',
                            fontSize: '10px',
                            fontWeight: 600,
                            color: '#fff',
                            backgroundColor: stateColor(container.state),
                            textTransform: 'uppercase',
                        }}
                            role="status"
                            aria-label={`Container ${container.name} is ${container.state}`}
                        >
                            {container.state}
                        </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginBottom: '6px' }}>
                        {container.ports.map((p, i) => (
                            <span key={i} style={{ marginRight: '8px' }} title={`Host port ${p.hostPort} → Container port ${p.containerPort}`}>
                                {p.hostPort}:{p.containerPort}
                            </span>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        {container.state !== 'running' && (
                            <button
                                className="theia-button"
                                onClick={() => onAction(container.id, 'start')}
                                title={`Start container ${container.name}`}
                                aria-label={`Start container ${container.name}`}
                                style={{ fontSize: '10px', padding: '2px 8px' }}
                            >
                                Start
                            </button>
                        )}
                        {container.state === 'running' && (
                            <>
                                <button
                                    className="theia-button secondary"
                                    onClick={() => onAction(container.id, 'stop')}
                                    title={`Stop container ${container.name}`}
                                    aria-label={`Stop container ${container.name}`}
                                    style={{ fontSize: '10px', padding: '2px 8px' }}
                                >
                                    Stop
                                </button>
                                <button
                                    className="theia-button secondary"
                                    onClick={() => onAction(container.id, 'pause')}
                                    title={`Pause container ${container.name}`}
                                    aria-label={`Pause container ${container.name}`}
                                    style={{ fontSize: '10px', padding: '2px 8px' }}
                                >
                                    Pause
                                </button>
                            </>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

interface SessionsTabProps {
    sessions: SessionInfo[];
}

const SessionsTab: React.FC<SessionsTabProps> = ({ sessions }) => {
    if (sessions.length === 0) {
        return (
            <div role="status" aria-label="No sessions" style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                No active sessions. Users will appear here when they connect.
            </div>
        );
    }

    return (
        <div role="list" aria-label="Session list">
            <div style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginBottom: '8px' }} aria-live="polite">
                {sessions.length} active session{sessions.length !== 1 ? 's' : ''}
            </div>
            {sessions.map(session => (
                <div key={session.id} role="listitem" style={{
                    marginBottom: '8px',
                    padding: '8px 12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    borderRadius: '4px',
                    border: '1px solid var(--theia-dropdown-border)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 600, fontSize: '12px' }}>{session.username}</span>
                        <span style={{
                            display: 'inline-block',
                            padding: '1px 6px',
                            borderRadius: '3px',
                            fontSize: '10px',
                            backgroundColor: 'var(--theia-badge-background)',
                            color: 'var(--theia-badge-foreground)',
                            textTransform: 'capitalize',
                        }}
                            title={`Role: ${session.role}`}
                            aria-label={`Role: ${session.role}`}
                        >
                            {session.role}
                        </span>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--theia-descriptionForeground)' }}>
                        <div title={`Active since: ${session.activeSince}`}>Active since: {session.activeSince}</div>
                        <div title={`Last active: ${session.lastActive}`}>Last active: {session.lastActive}</div>
                    </div>
                </div>
            ))}
        </div>
    );
};

const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class RemotePanelWidget extends ReactWidget {
    static readonly ID = KAIRO_REMOTE_PANEL_FACTORY_ID;
    static readonly LABEL = 'Remote Panel';

    @inject(ILogger)
    protected readonly logger!: ILogger;

    @postConstruct()
    protected init(): void {
        this.id = RemotePanelWidget.ID;
        this.title.label = RemotePanelWidget.LABEL;
        this.title.caption = 'Kairo Remote Connection Panel';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(RemotePanelComponent, { logger: this.logger });
    }
}