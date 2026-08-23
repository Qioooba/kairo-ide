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
import { KairoI18nService } from '@kairo/i18n';

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
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function containerBadgeClass(state: ContainerInfo['state']): string {
    switch (state) {
        case 'running': return 'kairo-badge-success';
        case 'stopped': return 'kairo-badge-error';
        case 'paused': return 'kairo-badge-warning';
        default: return 'kairo-badge-default';
    }
}

interface ErrorType {
    icon: string;
    titleKey: string;
}

function classifyError(error: string): ErrorType {
    const lower = error.toLowerCase();
    if (lower.includes('timeout') || lower.includes('timed out')) {
        return { icon: 'codicon-clock', titleKey: 'widget.remote.panel.error.timeoutTitle' };
    }
    if (lower.includes('permission') || lower.includes('denied') || lower.includes('unauthorized')) {
        return { icon: 'codicon-lock', titleKey: 'widget.remote.panel.error.permissionTitle' };
    }
    if (lower.includes('network') || lower.includes('connect') || lower.includes('unreachable')) {
        return { icon: 'codicon-globe', titleKey: 'widget.remote.panel.error.networkTitle' };
    }
    return { icon: 'codicon-warning', titleKey: 'widget.remote.panel.error.genericTitle' };
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface RemotePanelProps {
    logger: ILogger;
    i18n: KairoI18nService;
}

const RemotePanelComponent: React.FC<RemotePanelProps> = ({ logger, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

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

    const syncProgress = state.fileSync.totalFiles > 0
        ? Math.round((state.fileSync.syncedFiles / state.fileSync.totalFiles) * 100)
        : 0;

    const tabs = ['connection', 'sync', 'containers', 'sessions'] as const;

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
        <div className="kairo-widget kairo-remote-panel">
            <div className="kairo-widget-header">
                <span className="kairo-widget-title">
                    {t('widget.remote.panel.header.title' as any)}
                </span>
                <div className="kairo-remote-panel-status">
                    <span className={`kairo-remote-status-dot ${state.connected ? 'kairo-status-dot-success' : 'kairo-status-dot-error'}`} />
                    <span className={`kairo-remote-panel-status-text ${state.connected ? 'connected' : 'disconnected'}`}>
                        {state.connected
                            ? t('widget.remote.panel.header.connected' as any)
                            : t('widget.remote.panel.header.disconnected' as any)}
                    </span>
                </div>
            </div>

            {!state.loading && !state.error && (
                <div
                    className="kairo-widget-toolbar kairo-remote-panel-tabs"
                    role="tablist"
                    aria-label={t('widget.remote.panel.tabsAria' as any)}
                >
                    {tabs.map(tab => (
                        <button
                            key={tab}
                            role="tab"
                            aria-selected={activeTab === tab}
                            aria-controls={`kairo-remote-tabpanel-${tab}`}
                            id={`kairo-remote-tab-${tab}`}
                            className={`kairo-remote-panel-tab ${activeTab === tab ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab)}
                            onKeyDown={e => handleTabKeyDown(e, tab)}
                            tabIndex={activeTab === tab ? 0 : -1}
                            title={t(`widget.remote.panel.tab.${tab}Tooltip` as any)}
                        >
                            {t(`widget.remote.panel.tab.${tab}` as any)}
                        </button>
                    ))}
                </div>
            )}

            <div className="kairo-widget-body kairo-remote-panel-body">
                {state.loading && <LoadingView i18n={i18n} />}
                {!state.loading && state.error && (
                    <ErrorView error={state.error} onRetry={loadData} i18n={i18n} />
                )}
                {!state.loading && !state.error && (
                    <>
                        {activeTab === 'connection' && (
                            <div role="tabpanel" id="kairo-remote-tabpanel-connection" aria-labelledby="kairo-remote-tab-connection">
                                {state.connectionInfo ? (
                                    <ConnectionTab info={state.connectionInfo} i18n={i18n} />
                                ) : (
                                    <EmptyState
                                        icon="codicon-remote"
                                        titleKey="widget.remote.panel.connection.emptyTitle"
                                        reasonKey="widget.remote.panel.connection.emptyReason"
                                        i18n={i18n}
                                    />
                                )}
                            </div>
                        )}
                        {activeTab === 'sync' && (
                            <div role="tabpanel" id="kairo-remote-tabpanel-sync" aria-labelledby="kairo-remote-tab-sync">
                                <FileSyncTab sync={state.fileSync} progress={syncProgress} i18n={i18n} />
                            </div>
                        )}
                        {activeTab === 'containers' && (
                            <div role="tabpanel" id="kairo-remote-tabpanel-containers" aria-labelledby="kairo-remote-tab-containers">
                                <ContainersTab
                                    containers={state.containers}
                                    onAction={handleContainerAction}
                                    i18n={i18n}
                                />
                            </div>
                        )}
                        {activeTab === 'sessions' && (
                            <div role="tabpanel" id="kairo-remote-tabpanel-sessions" aria-labelledby="kairo-remote-tab-sessions">
                                <SessionsTab sessions={state.sessions} i18n={i18n} />
                            </div>
                        )}
                    </>
                )}
            </div>

            <style>{`
                .kairo-remote-panel-status {
                    align-items: center;
                    display: inline-flex;
                    gap: 8px;
                }
                .kairo-remote-panel-status-text {
                    font-size: 12px;
                    font-weight: 600;
                }
                .kairo-remote-panel-status-text.connected {
                    color: var(--kairo-success);
                }
                .kairo-remote-panel-status-text.disconnected {
                    color: var(--kairo-error);
                }
                .kairo-remote-panel-tabs {
                    border-bottom: 1px solid var(--kairo-border);
                    gap: 0;
                    padding: 0 12px;
                }
                .kairo-remote-panel-tab {
                    background: transparent;
                    border: none;
                    border-bottom: 2px solid transparent;
                    color: var(--kairo-text-secondary);
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                    padding: 8px 14px;
                    transition: color 0.15s ease, border-color 0.15s ease;
                }
                .kairo-remote-panel-tab:hover {
                    color: var(--kairo-text);
                }
                .kairo-remote-panel-tab.active {
                    border-bottom-color: var(--kairo-primary);
                    color: var(--kairo-primary);
                }
                .kairo-remote-panel-card {
                    background: var(--kairo-bg-secondary);
                    border: 1px solid var(--kairo-border);
                    border-radius: 6px;
                    margin-bottom: 12px;
                    padding: 12px;
                }
                .kairo-remote-panel-card:last-child {
                    margin-bottom: 0;
                }
                .kairo-remote-panel-row {
                    align-items: center;
                    display: flex;
                    font-size: 12px;
                    justify-content: space-between;
                    padding: 4px 0;
                }
                .kairo-remote-panel-row span:first-child {
                    color: var(--kairo-text-secondary);
                }
                .kairo-remote-panel-row span:last-child {
                    color: var(--kairo-text);
                    font-weight: 600;
                }
                .kairo-remote-panel-latency-good {
                    color: var(--kairo-success);
                }
                .kairo-remote-panel-latency-high {
                    color: var(--kairo-warning);
                }
                .kairo-remote-panel-latency-label {
                    font-size: 10px;
                    margin-left: 4px;
                    opacity: 0.7;
                }
                .kairo-remote-panel-progress {
                    margin-bottom: 12px;
                }
                .kairo-remote-panel-progress-header {
                    color: var(--kairo-text-secondary);
                    font-size: 11px;
                    margin-bottom: 4px;
                }
                .kairo-remote-panel-progress-svg {
                    display: block;
                    width: 100%;
                }
                .kairo-remote-panel-progress-track {
                    fill: var(--kairo-border);
                }
                .kairo-remote-panel-progress-fill {
                    fill: var(--kairo-success);
                    transition: width 0.3s ease;
                }
                .kairo-remote-panel-skeleton {
                    max-width: 300px;
                    width: 80%;
                }
                .kairo-remote-panel-skeleton-bar {
                    background: var(--kairo-border);
                    border-radius: 3px;
                    height: 12px;
                    margin-bottom: 8px;
                }
                .kairo-remote-panel-skeleton-bar:nth-child(1) {
                    opacity: 0.5;
                    width: 90%;
                }
                .kairo-remote-panel-skeleton-bar:nth-child(2) {
                    opacity: 0.35;
                    width: 75%;
                }
                .kairo-remote-panel-skeleton-bar:nth-child(3) {
                    opacity: 0.2;
                    width: 60%;
                }
                .kairo-remote-panel-loading .kairo-empty-state-glyph .codicon {
                    font-size: 32px;
                }
                .kairo-remote-panel-error-detail {
                    color: var(--kairo-text-secondary);
                    font-size: 12px;
                    margin: 4px 0 0 0;
                }
                .kairo-remote-panel-container-header {
                    align-items: center;
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 6px;
                    min-width: 0;
                }
                .kairo-remote-panel-container-header > div {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-width: 0;
                    flex: 1;
                }
                .kairo-remote-panel-container-name {
                    font-size: 13px;
                    font-weight: 600;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .kairo-remote-panel-container-image {
                    color: var(--kairo-text-secondary);
                    font-size: 11px;
                    margin-left: 8px;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    flex: 1;
                }
                .kairo-remote-panel-container-ports {
                    color: var(--kairo-text-secondary);
                    font-size: 11px;
                    margin-bottom: 6px;
                }
                .kairo-remote-panel-container-ports span {
                    margin-right: 8px;
                }
                .kairo-remote-panel-container-actions {
                    display: flex;
                    gap: 4px;
                }
                .kairo-remote-panel-container-actions .codicon {
                    margin-right: 4px;
                }
                .kairo-remote-panel-sessions-count {
                    color: var(--kairo-text-secondary);
                    font-size: 11px;
                    margin-bottom: 8px;
                }
                .kairo-remote-panel-session-header {
                    align-items: center;
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 4px;
                }
                .kairo-remote-panel-session-header > span:first-child {
                    font-size: 12px;
                    font-weight: 600;
                }
                .kairo-remote-panel-session-meta {
                    color: var(--kairo-text-secondary);
                    font-size: 10px;
                }
                .kairo-remote-panel-session-meta > div {
                    margin-bottom: 2px;
                }
            `}</style>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
    icon: string;
    titleKey: string;
    reasonKey: string;
    i18n: KairoI18nService;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, titleKey, reasonKey, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    return (
        <div className="kairo-empty-state">
            <span className="kairo-empty-state-glyph">
                <span className={`codicon ${icon}`} aria-hidden="true" />
            </span>
            <div className="kairo-empty-state-title">{t(titleKey as any)}</div>
            <p className="kairo-empty-state-reason">{t(reasonKey as any)}</p>
        </div>
    );
};

interface LoadingViewProps {
    i18n: KairoI18nService;
}

const LoadingView: React.FC<LoadingViewProps> = ({ i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    return (
        <div className="kairo-empty-state kairo-remote-panel-loading" role="status">
            <span className="kairo-empty-state-glyph">
                <span className="codicon codicon-sync codicon-modifier-spin" aria-hidden="true" />
            </span>
            <div className="kairo-empty-state-title">{t('widget.remote.panel.loadingTitle' as any)}</div>
            <p className="kairo-empty-state-reason">{t('widget.remote.panel.loadingReason' as any)}</p>
            <div className="kairo-remote-panel-skeleton">
                <div className="kairo-remote-panel-skeleton-bar" />
                <div className="kairo-remote-panel-skeleton-bar" />
                <div className="kairo-remote-panel-skeleton-bar" />
            </div>
        </div>
    );
};

interface ErrorViewProps {
    error: string;
    onRetry: () => void;
    i18n: KairoI18nService;
}

const ErrorView: React.FC<ErrorViewProps> = ({ error, onRetry, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const errorType = React.useMemo(() => classifyError(error), [error]);
    return (
        <div className="kairo-error-banner" role="alert" aria-live="assertive">
            <span className={`codicon ${errorType.icon}`} aria-hidden="true" />
            <div>
                <strong>{t(errorType.titleKey as any)}</strong>
                <p className="kairo-remote-panel-error-detail">{error}</p>
                <button
                    className="theia-button secondary"
                    onClick={onRetry}
                    title={t('common.retry' as any)}
                    aria-label={t('common.retry' as any)}
                >
                    {t('common.retry' as any)}
                </button>
            </div>
        </div>
    );
};

interface ConnectionTabProps {
    info: ConnectionInfo;
    i18n: KairoI18nService;
}

const ConnectionTab: React.FC<ConnectionTabProps> = ({ info, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const latencyKey = info.latency < 20 ? 'excellent' : info.latency < 50 ? 'good' : 'high';
    const latencyClass = info.latency < 50 ? 'kairo-remote-panel-latency-good' : 'kairo-remote-panel-latency-high';
    return (
        <div
            className="kairo-remote-panel-card"
            role="group"
            aria-label={t('widget.remote.panel.connection.title' as any)}
        >
            <div className="kairo-section-title">{t('widget.remote.panel.connection.title' as any)}</div>
            <div className="kairo-remote-panel-row" title={`${t('widget.remote.panel.connection.host' as any)}: ${info.host}`}>
                <span>{t('widget.remote.panel.connection.host' as any)}</span>
                <span>{info.host}</span>
            </div>
            <div className="kairo-remote-panel-row" title={`${t('widget.remote.panel.connection.port' as any)}: ${info.port}`}>
                <span>{t('widget.remote.panel.connection.port' as any)}</span>
                <span>{info.port}</span>
            </div>
            <div className="kairo-remote-panel-row" title={`${t('widget.remote.panel.connection.tlsVersion' as any)}: ${info.tlsVersion}`}>
                <span>{t('widget.remote.panel.connection.tlsVersion' as any)}</span>
                <span className="kairo-remote-panel-latency-good">{info.tlsVersion}</span>
            </div>
            <div className="kairo-remote-panel-row" title={`${t('widget.remote.panel.connection.connectedAt' as any)}: ${info.connectedAt}`}>
                <span>{t('widget.remote.panel.connection.connectedAt' as any)}</span>
                <span>{info.connectedAt}</span>
            </div>
            <div className="kairo-remote-panel-row" title={`${t('widget.remote.panel.connection.latency' as any)}: ${info.latency}ms`}>
                <span>{t('widget.remote.panel.connection.latency' as any)}</span>
                <span className={latencyClass}>
                    {info.latency}ms
                    <span className="kairo-remote-panel-latency-label">
                        ({t(`widget.remote.panel.connection.latency.${latencyKey}` as any)})
                    </span>
                </span>
            </div>
        </div>
    );
};

interface FileSyncTabProps {
    sync: FileSyncStatus;
    progress: number;
    i18n: KairoI18nService;
}

const FileSyncTab: React.FC<FileSyncTabProps> = ({ sync, progress, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    return (
        <div role="group" aria-label={t('widget.remote.panel.sync.title' as any)}>
            <div className="kairo-remote-panel-card">
                <div className="kairo-section-title">{t('widget.remote.panel.sync.title' as any)}</div>
                <div className="kairo-remote-panel-row" title={`${t('widget.remote.panel.sync.statusLabel' as any)}: ${sync.syncing ? t('widget.remote.panel.sync.status.syncing' as any) : t('widget.remote.panel.sync.status.inSync' as any)}`}>
                    <span>{t('widget.remote.panel.sync.statusLabel' as any)}</span>
                    <span className={sync.syncing ? 'kairo-remote-panel-latency-high' : 'kairo-remote-panel-latency-good'}>
                        {sync.syncing
                            ? t('widget.remote.panel.sync.status.syncing' as any)
                            : t('widget.remote.panel.sync.status.inSync' as any)}
                    </span>
                </div>
                <div className="kairo-remote-panel-row" title={`${t('widget.remote.panel.sync.files' as any)}: ${sync.syncedFiles} / ${sync.totalFiles}`}>
                    <span>{t('widget.remote.panel.sync.files' as any)}</span>
                    <span>{sync.syncedFiles} / {sync.totalFiles}</span>
                </div>
                <div className="kairo-remote-panel-row" title={`${t('widget.remote.panel.sync.lastSync' as any)}: ${sync.lastSync || 'N/A'}`}>
                    <span>{t('widget.remote.panel.sync.lastSync' as any)}</span>
                    <span>{sync.lastSync || 'N/A'}</span>
                </div>
                <div className="kairo-remote-panel-row" title={`${t('widget.remote.panel.sync.conflicts' as any)}: ${sync.conflicts}`}>
                    <span>{t('widget.remote.panel.sync.conflicts' as any)}</span>
                    <span className={sync.conflicts > 0 ? 'kairo-remote-panel-latency-high' : 'kairo-remote-panel-latency-good'}>
                        {sync.conflicts}
                    </span>
                </div>
            </div>

            <div className="kairo-remote-panel-progress">
                <div className="kairo-remote-panel-progress-header">
                    {t('widget.remote.panel.sync.progress' as any)} {progress}%
                </div>
                <svg
                    className="kairo-remote-panel-progress-svg"
                    role="progressbar"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${t('widget.remote.panel.sync.progress' as any)}: ${progress}%`}
                    height="8"
                    width="100%"
                >
                    <rect className="kairo-remote-panel-progress-track" width="100%" height="8" rx="4" />
                    <rect className="kairo-remote-panel-progress-fill" width={`${progress}%`} height="8" rx="4" />
                </svg>
            </div>
        </div>
    );
};

interface ContainersTabProps {
    containers: ContainerInfo[];
    onAction: (id: string, action: 'start' | 'stop' | 'pause') => void;
    i18n: KairoI18nService;
}

const ContainersTab: React.FC<ContainersTabProps> = ({ containers, onAction, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    if (containers.length === 0) {
        return (
            <EmptyState
                icon="codicon-package"
                titleKey="widget.remote.panel.containers.emptyTitle"
                reasonKey="widget.remote.panel.containers.emptyReason"
                i18n={i18n}
            />
        );
    }

    return (
        <div role="list" aria-label={t('widget.remote.panel.containers.title' as any)}>
            {containers.map(container => (
                <div key={container.id} role="listitem" className="kairo-remote-panel-card kairo-remote-panel-container">
                    <div className="kairo-remote-panel-container-header">
                        <div>
                            <span className="kairo-remote-panel-container-name">{container.name}</span>
                            <span className="kairo-remote-panel-container-image">{container.image}</span>
                        </div>
                        <span
                            className={`kairo-badge ${containerBadgeClass(container.state)}`}
                            role="status"
                            aria-label={`${container.name} ${t(`widget.remote.panel.containers.state.${container.state}` as any)}`}
                        >
                            {t(`widget.remote.panel.containers.state.${container.state}` as any)}
                        </span>
                    </div>
                    <div className="kairo-remote-panel-container-ports">
                        {container.ports.map((p, i) => (
                            <span key={i} title={`Host port ${p.hostPort} → Container port ${p.containerPort}`}>
                                {p.hostPort}:{p.containerPort}
                            </span>
                        ))}
                    </div>
                    <div className="kairo-remote-panel-container-actions">
                        {container.state !== 'running' && (
                            <button
                                className="theia-button main"
                                onClick={() => onAction(container.id, 'start')}
                                title={`${t('widget.remote.panel.containers.action.start' as any)} ${container.name}`}
                                aria-label={`${t('widget.remote.panel.containers.action.start' as any)} ${container.name}`}
                            >
                                <span className="codicon codicon-play" aria-hidden="true" />
                                {t('widget.remote.panel.containers.action.start' as any)}
                            </button>
                        )}
                        {container.state === 'running' && (
                            <>
                                <button
                                    className="theia-button secondary"
                                    onClick={() => onAction(container.id, 'stop')}
                                    title={`${t('widget.remote.panel.containers.action.stop' as any)} ${container.name}`}
                                    aria-label={`${t('widget.remote.panel.containers.action.stop' as any)} ${container.name}`}
                                >
                                    <span className="codicon codicon-debug-stop" aria-hidden="true" />
                                    {t('widget.remote.panel.containers.action.stop' as any)}
                                </button>
                                <button
                                    className="theia-button secondary"
                                    onClick={() => onAction(container.id, 'pause')}
                                    title={`${t('widget.remote.panel.containers.action.pause' as any)} ${container.name}`}
                                    aria-label={`${t('widget.remote.panel.containers.action.pause' as any)} ${container.name}`}
                                >
                                    <span className="codicon codicon-debug-pause" aria-hidden="true" />
                                    {t('widget.remote.panel.containers.action.pause' as any)}
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
    i18n: KairoI18nService;
}

const SessionsTab: React.FC<SessionsTabProps> = ({ sessions, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    if (sessions.length === 0) {
        return (
            <EmptyState
                icon="codicon-person"
                titleKey="widget.remote.panel.sessions.emptyTitle"
                reasonKey="widget.remote.panel.sessions.emptyReason"
                i18n={i18n}
            />
        );
    }

    return (
        <div role="list" aria-label={t('widget.remote.panel.sessions.title' as any)}>
            <div className="kairo-remote-panel-sessions-count" aria-live="polite">
                {t('widget.remote.panel.sessions.count' as any, { count: sessions.length })}
            </div>
            {sessions.map(session => (
                <div key={session.id} role="listitem" className="kairo-remote-panel-card kairo-remote-panel-session">
                    <div className="kairo-remote-panel-session-header">
                        <span>{session.username}</span>
                        <span
                            className="kairo-badge kairo-badge-info"
                            title={`${t('widget.remote.panel.sessions.role' as any)}: ${session.role}`}
                            aria-label={`${t('widget.remote.panel.sessions.role' as any)}: ${session.role}`}
                        >
                            {t(`widget.remote.panel.sessions.role.${session.role}` as any)}
                        </span>
                    </div>
                    <div className="kairo-remote-panel-session-meta">
                        <div title={`${t('widget.remote.panel.sessions.activeSince' as any)}: ${session.activeSince}`}>
                            {t('widget.remote.panel.sessions.activeSince' as any)}: {session.activeSince}
                        </div>
                        <div title={`${t('widget.remote.panel.sessions.lastActive' as any)}: ${session.lastActive}`}>
                            {t('widget.remote.panel.sessions.lastActive' as any)}: {session.lastActive}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
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

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    @postConstruct()
    protected init(): void {
        this.id = RemotePanelWidget.ID;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-remote';
        this.addClass('kairo-widget');
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
            this.updateTitle();
            this.update();
        }));
        this.update();
    }

    private updateTitle(): void {
        this.title.label = this.i18n.t('widget.remote.panel.title' as any);
        this.title.caption = this.i18n.t('widget.remote.panel.caption' as any);
    }

    protected render(): React.ReactNode {
        return React.createElement(RemotePanelComponent, { logger: this.logger, i18n: this.i18n });
    }
}
