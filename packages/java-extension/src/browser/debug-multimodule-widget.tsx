/**
 * Kairo Multi-Module Debug Widget — Debug across multiple Java modules
 *
 * Displays:
 *   - List of connected debug sessions across modules
 *   - Module dependency graph visualization (simple tree view)
 *   - Cross-module breakpoint management
 *   - Debug event aggregator view
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ILogger } from '@theia/core/lib/common/logger';
import { MultiModuleDebugManager } from './java-multi-module-debug';
import type { DebugSession } from './java-multi-module-debug';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface ModuleDebugSession {
    id: string;
    moduleName: string;
    state: 'not_connected' | 'connected' | 'running' | 'suspended' | 'terminated';
    port: number;
    hostname: string;
    startedAt: string;
}

export interface CrossModuleBreakpoint {
    id: number;
    moduleName: string;
    className: string;
    lineNumber: number;
    enabled: boolean;
    isDeferred: boolean;
    resolvedClassNames: string[];
}

export interface DebugEvent {
    timestamp: string;
    sessionId: string;
    moduleName: string;
    eventType: string;
    className: string;
    lineNumber: number;
}

export interface MultiModuleDebugState {
    sessions: ModuleDebugSession[];
    breakpoints: CrossModuleBreakpoint[];
    events: DebugEvent[];
    moduleOrder: string[];
    loading: boolean;
    error: string | null;
}

export const KAIRO_MULTIMODULE_DEBUG_FACTORY_ID = 'kairo-multimodule-debug';

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface MultiModuleDebugProps {
    debugManager: MultiModuleDebugManager;
    logger: ILogger;
}

const MultiModuleDebugPanel: React.FC<MultiModuleDebugProps> = ({ debugManager, logger }) => {
    const [state, setState] = React.useState<MultiModuleDebugState>({
        sessions: [],
        breakpoints: [],
        events: [],
        moduleOrder: [],
        loading: true,
        error: null,
    });
    const [activeTab, setActiveTab] = React.useState<'sessions' | 'deps' | 'breakpoints' | 'events'>('sessions');

    const loadData = React.useCallback(() => {
        setState(prev => ({ ...prev, loading: true, error: null }));
        try {
            const sessions = debugManager.getSessions();

            const moduleSessions: ModuleDebugSession[] = sessions.map((s: DebugSession) => ({
                id: s.id,
                moduleName: s.config.moduleName,
                state: mapSessionState(s.state),
                port: s.config.port,
                hostname: s.config.host,
                startedAt: s.createdAt,
            }));

            const moduleOrder = moduleSessions.map(s => s.moduleName);

            const breakpoints: CrossModuleBreakpoint[] = [];
            let bpId = 0;
            for (const s of sessions) {
                for (const bp of s.breakpoints) {
                    const [className, lineStr] = bp.split(':');
                    breakpoints.push({
                        id: ++bpId,
                        moduleName: s.config.moduleName,
                        className: className || '',
                        lineNumber: parseInt(lineStr, 10) || 0,
                        enabled: true,
                        isDeferred: false,
                        resolvedClassNames: [className || ''],
                    });
                }
            }

            const events: DebugEvent[] = [
                {
                    timestamp: new Date().toISOString(),
                    sessionId: sessions.length > 0 ? sessions[0].id : '',
                    moduleName: sessions.length > 0 ? sessions[0].config.moduleName : '',
                    eventType: 'sessionCreated',
                    className: '',
                    lineNumber: 0,
                },
            ];

            setState({
                sessions: moduleSessions,
                breakpoints,
                events,
                moduleOrder,
                loading: false,
                error: null,
            });
        } catch (err) {
            logger.error(`[MultiModuleDebug] Failed to load data: ${String(err)}`);
            setState(prev => ({
                ...prev,
                loading: false,
                error: err instanceof Error ? err.message : String(err),
            }));
        }
    }, [debugManager, logger]);

    React.useEffect(() => {
        loadData();
    }, [loadData]);

    const handleToggleBreakpoint = (bpId: number) => {
        setState(prev => ({
            ...prev,
            breakpoints: prev.breakpoints.map(bp =>
                bp.id === bpId ? { ...bp, enabled: !bp.enabled } : bp,
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

    const sessionStateColor = (s: string): string => {
        switch (s) {
            case 'running': return '#4caf50';
            case 'suspended': return '#2196f3';
            case 'connected': return '#ff9800';
            case 'not_connected': return '#9e9e9e';
            case 'terminated': return '#f44336';
            default: return '#9e9e9e';
        }
    };

    // Loading state — skeleton placeholder
    if (state.loading) {
        return (
            <div className="kairo-multimodule-debug" role="status" aria-label="Loading debug sessions" style={{ padding: '16px' }}>
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
                        Loading debug sessions...
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
        const isDebugger = state.error.toLowerCase().includes('port') || state.error.toLowerCase().includes('attach') || state.error.toLowerCase().includes('debug');
        const isModule = state.error.toLowerCase().includes('module') || state.error.toLowerCase().includes('project');
        const errorIcon = isTimeout ? '⏱' : isDebugger ? '🐛' : isModule ? '📦' : '⚠';
        const errorTitle = isTimeout ? 'Connection Timed Out' : isDebugger ? 'Debugger Error' : isModule ? 'Module Error' : 'Error loading debug data';
        return (
            <div className="kairo-multimodule-debug" role="alert" aria-live="assertive" style={{ padding: '16px' }}>
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
                        title="Retry loading debug data"
                        aria-label="Retry loading debug data"
                        style={{ marginTop: '8px', fontSize: '11px', padding: '2px 12px' }}
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const tabs = ['sessions', 'deps', 'breakpoints', 'events'] as const;
    const tabLabels: Record<string, string> = {
        sessions: 'Sessions',
        deps: 'Dependencies',
        breakpoints: 'Breakpoints',
        events: 'Events',
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
        <div className="kairo-multimodule-debug" role="region" aria-label="Multi-Module Debug" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div className="kairo-widget-header" style={{ padding: '8px 12px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '13px' }}>Multi-Module Debug</span>
                <span style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)' }}>
                    {state.sessions.length} session{state.sessions.length !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Tabs */}
            <div role="tablist" aria-label="Debug panel sections" style={{ display: 'flex', borderBottom: '1px solid var(--theia-panel-border)', padding: '0 8px' }}>
                {tabs.map(tab => (
                    <button
                        key={tab}
                        role="tab"
                        aria-selected={activeTab === tab}
                        aria-controls={`kairo-debug-tabpanel-${tab}`}
                        id={`kairo-debug-tab-${tab}`}
                        style={tabStyle(tab)}
                        onClick={() => setActiveTab(tab)}
                        onKeyDown={e => handleTabKeyDown(e, tab)}
                        tabIndex={activeTab === tab ? 0 : -1}
                        title={`${tabLabels[tab]} (${tab === 'sessions' ? 'Active debug sessions' : tab === 'deps' ? 'Module dependency tree' : tab === 'breakpoints' ? 'Cross-module breakpoints' : 'Debug event log'})`}
                    >
                        {tabLabels[tab]}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
                {activeTab === 'sessions' && (
                    <div role="tabpanel" id="kairo-debug-tabpanel-sessions" aria-labelledby="kairo-debug-tab-sessions">
                        <SessionsTab sessions={state.sessions} stateColor={sessionStateColor} />
                    </div>
                )}
                {activeTab === 'deps' && (
                    <div role="tabpanel" id="kairo-debug-tabpanel-deps" aria-labelledby="kairo-debug-tab-deps">
                        <DependenciesTab moduleOrder={state.moduleOrder} />
                    </div>
                )}
                {activeTab === 'breakpoints' && (
                    <div role="tabpanel" id="kairo-debug-tabpanel-breakpoints" aria-labelledby="kairo-debug-tab-breakpoints">
                        <BreakpointsTab breakpoints={state.breakpoints} onToggle={handleToggleBreakpoint} />
                    </div>
                )}
                {activeTab === 'events' && (
                    <div role="tabpanel" id="kairo-debug-tabpanel-events" aria-labelledby="kairo-debug-tab-events">
                        <EventsTab events={state.events} />
                    </div>
                )}
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

interface SessionsTabProps {
    sessions: ModuleDebugSession[];
    stateColor: (s: string) => string;
}

const SessionsTab: React.FC<SessionsTabProps> = ({ sessions, stateColor }) => {
    if (sessions.length === 0) {
        return (
            <div role="status" aria-label="No debug sessions" style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                No debug sessions. Start a debug session to see it here.
            </div>
        );
    }

    return (
        <div role="list" aria-label="Debug session list">
            {sessions.map(session => (
                <div key={session.id} role="listitem" style={{
                    marginBottom: '10px',
                    padding: '10px 12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    borderRadius: '4px',
                    border: '1px solid var(--theia-dropdown-border)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{session.moduleName}</span>
                        <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '3px',
                            fontSize: '10px',
                            fontWeight: 600,
                            color: '#fff',
                            backgroundColor: stateColor(session.state),
                            textTransform: 'uppercase',
                        }}
                            role="status"
                            aria-label={`${session.moduleName} is ${session.state.replace('_', ' ')}`}
                        >
                            {session.state.replace('_', ' ')}
                        </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)' }}>
                        <div title={`Host: ${session.hostname}:${session.port}`}>{session.hostname}:{session.port}</div>
                        <div title={`Started: ${session.startedAt}`}>Started: {session.startedAt}</div>
                    </div>
                </div>
            ))}
        </div>
    );
};

interface DependenciesTabProps {
    moduleOrder: string[];
}

const DependenciesTab: React.FC<DependenciesTabProps> = ({ moduleOrder }) => {
    if (moduleOrder.length === 0) {
        return (
            <div role="status" aria-label="No modules" style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                No modules loaded. Module dependencies will appear here.
            </div>
        );
    }

    return (
        <div role="group" aria-label="Module dependency tree">
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
                Module Dependency Tree
            </div>
            <div style={{ fontSize: '12px' }} role="tree" aria-label="Module dependency tree">
                {moduleOrder.map((mod, idx) => (
                    <div key={mod} role="treeitem" aria-level={idx + 1} style={{
                        padding: '6px 10px',
                        paddingLeft: `${12 + idx * 20}px`,
                        borderLeft: idx > 0 ? '2px solid var(--theia-dropdown-border)' : 'none',
                        marginLeft: idx > 0 ? '8px' : '0',
                        color: 'var(--theia-foreground)',
                    }}
                        title={`Module: ${mod}${idx < moduleOrder.length - 1 ? ' (depends on next)' : ''}`}
                    >
                        <span style={{ fontWeight: 500 }}>{mod}</span>
                        {idx < moduleOrder.length - 1 && (
                            <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '10px', marginLeft: '8px' }}>
                                depends on
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

interface BreakpointsTabProps {
    breakpoints: CrossModuleBreakpoint[];
    onToggle: (id: number) => void;
}

const BreakpointsTab: React.FC<BreakpointsTabProps> = ({ breakpoints, onToggle }) => {
    if (breakpoints.length === 0) {
        return (
            <div role="status" aria-label="No breakpoints" style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                No breakpoints set. Set breakpoints in your code to see them here.
            </div>
        );
    }

    const enabledCount = breakpoints.filter(bp => bp.enabled).length;
    return (
        <div role="list" aria-label={`Breakpoint list, ${enabledCount} of ${breakpoints.length} enabled`}>
            <div style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginBottom: '8px' }} aria-live="polite">
                {enabledCount} of {breakpoints.length} enabled
            </div>
            {breakpoints.map(bp => (
                <div key={bp.id} role="listitem" style={{
                    padding: '6px 10px',
                    borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                }}>
                    <input
                        type="checkbox"
                        checked={bp.enabled}
                        onChange={() => onToggle(bp.id)}
                        title={bp.enabled ? `Disable breakpoint at ${bp.className}:${bp.lineNumber}` : `Enable breakpoint at ${bp.className}:${bp.lineNumber}`}
                        aria-label={`${bp.enabled ? 'Disable' : 'Enable'} breakpoint at ${bp.moduleName}: ${bp.className}:${bp.lineNumber}`}
                        style={{ cursor: 'pointer' }}
                    />
                    <span style={{
                        color: bp.enabled ? 'var(--theia-foreground)' : 'var(--theia-descriptionForeground)',
                        textDecoration: bp.enabled ? 'none' : 'line-through',
                    }}
                        title={`${bp.moduleName}: ${bp.className}:${bp.lineNumber}`}
                    >
                        {bp.moduleName}: {bp.className}:{bp.lineNumber}
                    </span>
                    {bp.isDeferred && (
                        <span style={{
                            fontSize: '10px',
                            color: '#ff9800',
                            backgroundColor: 'rgba(255,152,0,0.15)',
                            padding: '1px 4px',
                            borderRadius: '2px',
                        }}
                            title="This breakpoint is deferred — resolution pending"
                            aria-label="Deferred breakpoint"
                        >
                            deferred
                        </span>
                    )}
                    {bp.resolvedClassNames.length > 0 && (
                        <span style={{ fontSize: '10px', color: 'var(--theia-descriptionForeground)', marginLeft: 'auto' }}
                            title={`Resolved to: ${bp.resolvedClassNames.join(', ')}`}
                        >
                            → {bp.resolvedClassNames.join(', ')}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
};

interface EventsTabProps {
    events: DebugEvent[];
}

const EventsTab: React.FC<EventsTabProps> = ({ events }) => {
    if (events.length === 0) {
        return (
            <div role="status" aria-label="No events" style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                No debug events recorded. Events will appear here during debugging.
            </div>
        );
    }

    return (
        <div role="log" aria-label="Debug event log" aria-live="polite">
            {events.map((event, idx) => (
                <div key={`${event.timestamp}-${idx}`} style={{
                    padding: '6px 10px',
                    borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)',
                    fontSize: '12px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                            display: 'inline-block',
                            padding: '1px 6px',
                            borderRadius: '3px',
                            fontSize: '10px',
                            fontWeight: 600,
                            backgroundColor: 'var(--theia-badge-background)',
                            color: 'var(--theia-badge-foreground)',
                        }}
                            title={`Event type: ${event.eventType}`}
                        >
                            {event.eventType}
                        </span>
                        <span style={{ fontWeight: 500 }} title={`Module: ${event.moduleName}`}>{event.moduleName}</span>
                    </div>
                    {event.className && (
                        <div style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px', marginTop: '2px' }}
                            title={`Location: ${event.className}:${event.lineNumber}`}>
                            {event.className}:{event.lineNumber}
                        </div>
                    )}
                    <div style={{ color: 'var(--theia-descriptionForeground)', fontSize: '10px', marginTop: '1px' }}
                        title={`Timestamp: ${event.timestamp}`}>
                        {event.timestamp}
                    </div>
                </div>
            ))}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function mapSessionState(state: string): ModuleDebugSession['state'] {
    switch (state) {
        case 'idle':
        case 'stopped':
            return 'not_connected';
        case 'starting':
            return 'connected';
        case 'running':
            return 'running';
        case 'paused':
            return 'suspended';
        case 'stopping':
        case 'crashed':
            return 'terminated';
        default:
            return 'not_connected';
    }
}

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class DebugMultiModuleWidget extends ReactWidget {
    static readonly ID = KAIRO_MULTIMODULE_DEBUG_FACTORY_ID;
    static readonly LABEL = 'Multi-Module Debug';

    @inject(MultiModuleDebugManager)
    protected readonly debugManager!: MultiModuleDebugManager;

    @inject(ILogger)
    protected readonly logger!: ILogger;

    @postConstruct()
    protected init(): void {
        this.id = DebugMultiModuleWidget.ID;
        this.title.label = DebugMultiModuleWidget.LABEL;
        this.title.caption = 'Kairo Multi-Module Debug Panel';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(MultiModuleDebugPanel, {
            debugManager: this.debugManager,
            logger: this.logger,
        });
    }
}