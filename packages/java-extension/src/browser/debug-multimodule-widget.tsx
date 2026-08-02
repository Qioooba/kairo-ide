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
import { KairoI18nService } from '@kairo/i18n';
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
    i18n: KairoI18nService;
}

const MultiModuleDebugPanel: React.FC<MultiModuleDebugProps> = ({ debugManager, logger, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
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

    // Loading state — skeleton placeholder
    if (state.loading) {
        return (
            <div className="kairo-widget kairo-debug-multimodule-widget" role="status" aria-label={t('widget.java.debugMultimodule.loadingAriaLabel')}>
                <div className="kairo-widget-body kairo-loading kairo-debug-multimodule-loading">
                    <span className="kairo-spinner kairo-debug-multimodule-spinner" aria-hidden="true" />
                    <p className="kairo-debug-multimodule-loading-text">{t('widget.java.debugMultimodule.loading')}</p>
                    <div className="kairo-debug-multimodule-skeleton">
                        <div className="kairo-debug-multimodule-skeleton-line" />
                        <div className="kairo-debug-multimodule-skeleton-line" />
                        <div className="kairo-debug-multimodule-skeleton-line" />
                    </div>
                </div>
            </div>
        );
    }

    // Error state — categorized by error type
    if (state.error) {
        const errorLower = state.error.toLowerCase();
        const isTimeout = errorLower.includes('timeout') || errorLower.includes('timed out');
        const isDebugger = errorLower.includes('port') || errorLower.includes('attach') || errorLower.includes('debug');
        const isModule = errorLower.includes('module') || errorLower.includes('project');
        const errorIcon = isTimeout ? 'codicon-clock' : isDebugger ? 'codicon-bug' : isModule ? 'codicon-package' : 'codicon-warning';
        const errorTitleKey = isTimeout
            ? 'widget.java.debugMultimodule.error.timeoutTitle'
            : isDebugger
                ? 'widget.java.debugMultimodule.error.debuggerTitle'
                : isModule
                    ? 'widget.java.debugMultimodule.error.moduleTitle'
                    : 'widget.java.debugMultimodule.error.genericTitle';
        return (
            <div className="kairo-widget kairo-debug-multimodule-widget" role="alert" aria-live="assertive">
                <div className="kairo-widget-body kairo-debug-multimodule-error">
                    <div className="kairo-error-banner" role="alert">
                        <span className={`codicon ${errorIcon}`} aria-hidden="true" />
                        <div className="kairo-debug-multimodule-error-content">
                            <strong>{t(errorTitleKey)}</strong>
                            <p>{state.error}</p>
                            <button
                                className="theia-button kairo-debug-multimodule-retry"
                                onClick={loadData}
                                title={t('widget.java.debugMultimodule.retryTitle')}
                                aria-label={t('widget.java.debugMultimodule.retryTitle')}
                            >
                                {t('widget.java.debugMultimodule.retry')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const tabs = ['sessions', 'deps', 'breakpoints', 'events'] as const;
    const tabTitleKeys: Record<string, string> = {
        sessions: 'widget.java.debugMultimodule.tabTitle.sessions',
        deps: 'widget.java.debugMultimodule.tabTitle.dependencies',
        breakpoints: 'widget.java.debugMultimodule.tabTitle.breakpoints',
        events: 'widget.java.debugMultimodule.tabTitle.events',
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
        <div className="kairo-widget kairo-debug-multimodule-widget" role="region" aria-label={t('widget.java.debugMultimodule.title')}>
            {/* Header */}
            <div className="kairo-widget-header kairo-debug-multimodule-header">
                <span className="kairo-widget-title">{t('widget.java.debugMultimodule.title')}</span>
                <span className="kairo-debug-multimodule-session-count">
                    {t('widget.java.debugMultimodule.sessionCount', { count: state.sessions.length })}
                </span>
            </div>

            {/* Tabs */}
            <div className="kairo-debug-multimodule-tabs" role="tablist" aria-label={t('widget.java.debugMultimodule.tablistAriaLabel')}>
                {tabs.map(tab => (
                    <button
                        key={tab}
                        role="tab"
                        aria-selected={activeTab === tab}
                        aria-controls={`kairo-debug-tabpanel-${tab}`}
                        id={`kairo-debug-tab-${tab}`}
                        className={`kairo-debug-multimodule-tab ${activeTab === tab ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                        onKeyDown={e => handleTabKeyDown(e, tab)}
                        tabIndex={activeTab === tab ? 0 : -1}
                        title={t(tabTitleKeys[tab])}
                    >
                        {t(`widget.java.debugMultimodule.tab.${tab}`)}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="kairo-widget-body kairo-debug-multimodule-body">
                {activeTab === 'sessions' && (
                    <div role="tabpanel" id="kairo-debug-tabpanel-sessions" aria-labelledby="kairo-debug-tab-sessions">
                        <SessionsTab sessions={state.sessions} i18n={i18n} />
                    </div>
                )}
                {activeTab === 'deps' && (
                    <div role="tabpanel" id="kairo-debug-tabpanel-deps" aria-labelledby="kairo-debug-tab-deps">
                        <DependenciesTab moduleOrder={state.moduleOrder} i18n={i18n} />
                    </div>
                )}
                {activeTab === 'breakpoints' && (
                    <div role="tabpanel" id="kairo-debug-tabpanel-breakpoints" aria-labelledby="kairo-debug-tab-breakpoints">
                        <BreakpointsTab breakpoints={state.breakpoints} onToggle={handleToggleBreakpoint} i18n={i18n} />
                    </div>
                )}
                {activeTab === 'events' && (
                    <div role="tabpanel" id="kairo-debug-tabpanel-events" aria-labelledby="kairo-debug-tab-events">
                        <EventsTab events={state.events} i18n={i18n} />
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
    i18n: KairoI18nService;
}

const SessionsTab: React.FC<SessionsTabProps> = ({ sessions, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);

    if (sessions.length === 0) {
        return (
            <div className="kairo-empty-state kairo-debug-multimodule-empty" role="status" aria-label={t('widget.java.debugMultimodule.sessions.emptyAriaLabel')}>
                <div className="kairo-empty-state-glyph">
                    <span className="codicon codicon-debug-alt" aria-hidden="true" />
                </div>
                <p className="kairo-empty-state-title">{t('widget.java.debugMultimodule.sessions.emptyTitle')}</p>
                <p className="kairo-empty-state-reason">{t('widget.java.debugMultimodule.sessions.emptyReason')}</p>
            </div>
        );
    }

    return (
        <div className="kairo-debug-multimodule-session-list" role="list" aria-label={t('widget.java.debugMultimodule.sessions.listAriaLabel')}>
            {sessions.map(session => (
                <div key={session.id} className={`kairo-debug-multimodule-session kairo-debug-multimodule-session-state-${session.state}`} role="listitem">
                    <div className="kairo-debug-multimodule-session-header">
                        <span className="kairo-debug-multimodule-session-name">{session.moduleName}</span>
                        <span
                            className={`kairo-debug-multimodule-state kairo-debug-multimodule-state-${session.state}`}
                            role="status"
                            aria-label={t('widget.java.debugMultimodule.session.stateAria', { moduleName: session.moduleName, state: t(`widget.java.debugMultimodule.state.${session.state}`) })}
                        >
                            {t(`widget.java.debugMultimodule.state.${session.state}`)}
                        </span>
                    </div>
                    <div className="kairo-debug-multimodule-session-info">
                        <div title={t('widget.java.debugMultimodule.session.hostTitle', { hostname: session.hostname, port: session.port })}>
                            {session.hostname}:{session.port}
                        </div>
                        <div title={t('widget.java.debugMultimodule.session.startedTitle', { startedAt: session.startedAt })}>
                            {t('widget.java.debugMultimodule.session.startedLabel', { startedAt: session.startedAt })}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

interface DependenciesTabProps {
    moduleOrder: string[];
    i18n: KairoI18nService;
}

const DependenciesTab: React.FC<DependenciesTabProps> = ({ moduleOrder, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);

    if (moduleOrder.length === 0) {
        return (
            <div className="kairo-empty-state kairo-debug-multimodule-empty" role="status" aria-label={t('widget.java.debugMultimodule.dependencies.emptyAriaLabel')}>
                <div className="kairo-empty-state-glyph">
                    <span className="codicon codicon-package" aria-hidden="true" />
                </div>
                <p className="kairo-empty-state-title">{t('widget.java.debugMultimodule.dependencies.emptyTitle')}</p>
                <p className="kairo-empty-state-reason">{t('widget.java.debugMultimodule.dependencies.emptyReason')}</p>
            </div>
        );
    }

    return (
        <div className="kairo-debug-multimodule-dependencies" role="group" aria-label={t('widget.java.debugMultimodule.dependencies.treeAriaLabel')}>
            <div className="kairo-widget-section-title kairo-debug-multimodule-dependencies-title">
                {t('widget.java.debugMultimodule.dependencies.title')}
            </div>
            <div className="kairo-debug-multimodule-deps-tree" role="tree" aria-label={t('widget.java.debugMultimodule.dependencies.treeAriaLabel')}>
                {moduleOrder.map((mod, idx) => (
                    <div
                        key={mod}
                        className="kairo-debug-multimodule-dep-node"
                        role="treeitem"
                        aria-level={idx + 1}
                        style={{ ['--kairo-debug-multimodule-dep-depth' as any]: idx }}
                        title={t('widget.java.debugMultimodule.dependencies.nodeTitle', { module: mod, relation: idx < moduleOrder.length - 1 ? t('widget.java.debugMultimodule.dependencies.dependsOn') : '' })}
                    >
                        <span className="kairo-debug-multimodule-dep-name">{mod}</span>
                        {idx < moduleOrder.length - 1 && (
                            <span className="kairo-debug-multimodule-dep-relation">
                                {t('widget.java.debugMultimodule.dependencies.dependsOn')}
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
    i18n: KairoI18nService;
}

const BreakpointsTab: React.FC<BreakpointsTabProps> = ({ breakpoints, onToggle, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);

    if (breakpoints.length === 0) {
        return (
            <div className="kairo-empty-state kairo-debug-multimodule-empty" role="status" aria-label={t('widget.java.debugMultimodule.breakpoints.emptyAriaLabel')}>
                <div className="kairo-empty-state-glyph">
                    <span className="codicon codicon-debug-breakpoint" aria-hidden="true" />
                </div>
                <p className="kairo-empty-state-title">{t('widget.java.debugMultimodule.breakpoints.emptyTitle')}</p>
                <p className="kairo-empty-state-reason">{t('widget.java.debugMultimodule.breakpoints.emptyReason')}</p>
            </div>
        );
    }

    const enabledCount = breakpoints.filter(bp => bp.enabled).length;
    return (
        <div className="kairo-debug-multimodule-breakpoint-list" role="list" aria-label={t('widget.java.debugMultimodule.breakpoints.listAriaLabel', { enabled: enabledCount, total: breakpoints.length })}>
            <div className="kairo-debug-multimodule-breakpoint-summary" aria-live="polite">
                {t('widget.java.debugMultimodule.breakpoints.summary', { enabled: enabledCount, total: breakpoints.length })}
            </div>
            {breakpoints.map(bp => (
                <div key={bp.id} className={`kairo-debug-multimodule-breakpoint ${bp.enabled ? '' : 'disabled'}`} role="listitem">
                    <input
                        type="checkbox"
                        checked={bp.enabled}
                        onChange={() => onToggle(bp.id)}
                        title={bp.enabled
                            ? t('widget.java.debugMultimodule.breakpoint.disableTitle', { className: bp.className, lineNumber: bp.lineNumber })
                            : t('widget.java.debugMultimodule.breakpoint.enableTitle', { className: bp.className, lineNumber: bp.lineNumber })}
                        aria-label={bp.enabled
                            ? t('widget.java.debugMultimodule.breakpoint.disableAria', { moduleName: bp.moduleName, className: bp.className, lineNumber: bp.lineNumber })
                            : t('widget.java.debugMultimodule.breakpoint.enableAria', { moduleName: bp.moduleName, className: bp.className, lineNumber: bp.lineNumber })}
                    />
                    <span
                        className="kairo-debug-multimodule-breakpoint-location"
                        title={t('widget.java.debugMultimodule.breakpoint.locationTitle', { moduleName: bp.moduleName, className: bp.className, lineNumber: bp.lineNumber })}
                    >
                        {bp.moduleName}: {bp.className}:{bp.lineNumber}
                    </span>
                    {bp.isDeferred && (
                        <span
                            className="kairo-debug-multimodule-breakpoint-deferred"
                            title={t('widget.java.debugMultimodule.breakpoint.deferredTitle')}
                            aria-label={t('widget.java.debugMultimodule.breakpoint.deferredAria')}
                        >
                            {t('widget.java.debugMultimodule.breakpoint.deferred')}
                        </span>
                    )}
                    {bp.resolvedClassNames.length > 0 && (
                        <span
                            className="kairo-debug-multimodule-breakpoint-resolved"
                            title={t('widget.java.debugMultimodule.breakpoint.resolvedTitle', { classes: bp.resolvedClassNames.join(', ') })}
                        >
                            {t('widget.java.debugMultimodule.breakpoint.resolved', { classes: bp.resolvedClassNames.join(', ') })}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
};

interface EventsTabProps {
    events: DebugEvent[];
    i18n: KairoI18nService;
}

const EventsTab: React.FC<EventsTabProps> = ({ events, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);

    if (events.length === 0) {
        return (
            <div className="kairo-empty-state kairo-debug-multimodule-empty" role="status" aria-label={t('widget.java.debugMultimodule.events.emptyAriaLabel')}>
                <div className="kairo-empty-state-glyph">
                    <span className="codicon codicon-output" aria-hidden="true" />
                </div>
                <p className="kairo-empty-state-title">{t('widget.java.debugMultimodule.events.emptyTitle')}</p>
                <p className="kairo-empty-state-reason">{t('widget.java.debugMultimodule.events.emptyReason')}</p>
            </div>
        );
    }

    return (
        <div className="kairo-debug-multimodule-event-list" role="log" aria-label={t('widget.java.debugMultimodule.events.listAriaLabel')} aria-live="polite">
            {events.map((event, idx) => (
                <div key={`${event.timestamp}-${idx}`} className="kairo-debug-multimodule-event">
                    <div className="kairo-debug-multimodule-event-header">
                        <span
                            className="kairo-debug-multimodule-event-type"
                            title={t('widget.java.debugMultimodule.events.typeTitle', { eventType: event.eventType })}
                        >
                            {event.eventType}
                        </span>
                        <span className="kairo-debug-multimodule-event-module" title={t('widget.java.debugMultimodule.events.moduleTitle', { moduleName: event.moduleName })}>
                            {event.moduleName}
                        </span>
                    </div>
                    {event.className && (
                        <div
                            className="kairo-debug-multimodule-event-location"
                            title={t('widget.java.debugMultimodule.events.locationTitle', { className: event.className, lineNumber: event.lineNumber })}
                        >
                            {event.className}:{event.lineNumber}
                        </div>
                    )}
                    <div
                        className="kairo-debug-multimodule-event-time"
                        title={t('widget.java.debugMultimodule.events.timeTitle', { timestamp: event.timestamp })}
                    >
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

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    @postConstruct()
    protected init(): void {
        this.id = DebugMultiModuleWidget.ID;
        this.title.closable = true;
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
        this.addClass('kairo-widget');
        this.addClass('kairo-debug-multimodule-widget');
        this.update();
    }

    protected t(key: string, params?: Record<string, string | number>): string {
        return this.i18n.t(key as any, params);
    }

    protected updateTitle(): void {
        this.title.label = this.t('widget.java.debugMultimodule.title');
        this.title.caption = this.t('widget.java.debugMultimodule.caption');
    }

    protected render(): React.ReactNode {
        return React.createElement(MultiModuleDebugPanel, {
            debugManager: this.debugManager,
            logger: this.logger,
            i18n: this.i18n,
        });
    }
}
