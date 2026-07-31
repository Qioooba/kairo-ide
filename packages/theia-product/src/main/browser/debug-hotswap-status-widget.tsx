/**
 * Kairo Hot Swap Status Indicator Widget — shows the status of
 * class redefinition / hot swap operations.
 *
 * Displays a list of recent hot swap operations with their status
 * (pending, in progress, completed, failed, rolled back) and
 * provides rollback controls.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { KairoI18nService } from '@kairo/i18n';

export const KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID = 'kairo-debug-hotswap-status';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type HotSwapStatusType = 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled_back' | 'not_supported';

export interface HotSwapEntry {
    id: string;
    className: string;
    status: HotSwapStatusType;
    timestamp: string;
    errorMessage?: string;
    methodsChanged: number;
    wasRolledBack: boolean;
}

export interface HotSwapStatusState {
    entries: HotSwapEntry[];
    activeCount: number;
    canRedefine: boolean;
    busy: boolean;
    error: string | null;
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface HotSwapStatusViewProps {
    state: HotSwapStatusState;
    onRollback: (entry: HotSwapEntry) => void;
    onRollbackAll: () => void;
    onClear: () => void;
    onRefresh: () => void;
    i18n: KairoI18nService;
}

const statusBadge = (status: HotSwapStatusType, t: (key: string) => string): { iconClass: string; badgeClass: string; label: string } => {
    switch (status) {
        case 'completed': return { iconClass: 'codicon-pass', badgeClass: 'kairo-badge-success', label: t('widget.hotswap.status.completed') };
        case 'in_progress': return { iconClass: 'codicon-sync codicon-modifier-spin', badgeClass: 'kairo-badge-warning', label: t('widget.hotswap.status.in_progress') };
        case 'pending': return { iconClass: 'codicon-clock', badgeClass: 'kairo-badge-default', label: t('widget.hotswap.status.pending') };
        case 'failed': return { iconClass: 'codicon-error', badgeClass: 'kairo-badge-error', label: t('widget.hotswap.status.failed') };
        case 'rolled_back': return { iconClass: 'codicon-discard', badgeClass: 'kairo-badge-info', label: t('widget.hotswap.status.rolled_back') };
        case 'not_supported': return { iconClass: 'codicon-question', badgeClass: 'kairo-badge-default', label: t('widget.hotswap.status.not_supported') };
        default: return { iconClass: 'codicon-question', badgeClass: 'kairo-badge-default', label: '?' };
    }
};

const HotSwapStatusView: React.FC<HotSwapStatusViewProps> = ({
    state: s, onRollback, onRollbackAll, onClear, onRefresh, i18n,
}) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    return (
    <div className="kairo-debug-hotswap-status">
        {/* Header */}
        <div className="kairo-widget-toolbar kairo-debug-hotswap-header">
            <span className="kairo-debug-hotswap-title">{t('widget.hotswap.header')}</span>
            <span className={`kairo-badge ${s.canRedefine ? 'kairo-badge-success' : 'kairo-badge-default'}`}>
                {s.canRedefine ? t('widget.hotswap.redefineOk') : t('widget.hotswap.unavailable')}
            </span>
            <span className="kairo-debug-hotswap-meta">
                {t('widget.hotswap.activeCount', { count: s.activeCount })}
            </span>
            <div className="kairo-debug-hotswap-actions">
                <button
                    className="theia-button secondary"
                    disabled={s.busy || s.activeCount === 0}
                    onClick={onRollbackAll}
                    title={t('widget.hotswap.rollbackAll')}
                >
                    {t('widget.hotswap.rollbackAll')}
                </button>
                <button
                    className="theia-button secondary"
                    disabled={s.busy || s.entries.length === 0}
                    onClick={onClear}
                    title={t('widget.hotswap.clear')}
                >
                    {t('widget.hotswap.clear')}
                </button>
                <button
                    className="theia-button secondary"
                    disabled={s.busy}
                    onClick={onRefresh}
                    title={t('widget.hotswap.refresh')}
                    aria-label={t('widget.hotswap.refresh')}
                >
                    <span className={`codicon ${s.busy ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} aria-hidden="true" />
                </button>
            </div>
        </div>

        {/* Body */}
        <div className="kairo-debug-hotswap-body">
            {s.error && (
                <div className="kairo-debug-hotswap-error" role="alert">
                    {s.error}
                </div>
            )}
            {!s.error && s.entries.length === 0 && (
                <div className="kairo-empty">
                    {t('widget.hotswap.noOperations')}
                </div>
            )}
            {s.entries.map(entry => {
                const badge = statusBadge(entry.status, t);
                return (
                    <div
                        key={entry.id}
                        className="kairo-debug-hotswap-row"
                        title={entry.status}
                    >
                        {/* Status icon */}
                        <span
                            className={`codicon ${badge.iconClass} kairo-debug-hotswap-icon`}
                            aria-hidden="true"
                        />

                        {/* Main content */}
                        <div className="kairo-debug-hotswap-main">
                            <div className="kairo-debug-hotswap-class">
                                {entry.className}
                            </div>
                            <div className="kairo-debug-hotswap-detail">
                                <span>{entry.timestamp}</span>
                                {entry.methodsChanged > 0 && (
                                    <span>{t('widget.hotswap.methodsChanged', { count: entry.methodsChanged })}</span>
                                )}
                                {entry.wasRolledBack && (
                                    <span className="kairo-debug-hotswap-rolledback">{t('widget.hotswap.rolledBack')}</span>
                                )}
                            </div>
                            {entry.errorMessage && (
                                <div className="kairo-debug-hotswap-error">
                                    {entry.errorMessage}
                                </div>
                            )}
                        </div>

                        {/* Status badge */}
                        <span className={`kairo-badge ${badge.badgeClass} kairo-debug-hotswap-badge`}>
                            {badge.label}
                        </span>

                        {/* Rollback button */}
                        {entry.status === 'completed' && (
                            <button
                                className="theia-button secondary kairo-debug-hotswap-rollback-btn"
                                onClick={() => onRollback(entry)}
                                title={t('widget.hotswap.rollback')}
                                aria-label={t('widget.hotswap.rollbackAria', { className: entry.className })}
                            >
                                <span className="codicon codicon-reply" aria-hidden="true" />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugHotSwapStatusWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    protected state: HotSwapStatusState = {
        entries: [],
        activeCount: 0,
        canRedefine: false,
        busy: false,
        error: null,
    };

    protected readonly onStateChangeEmitter = new Emitter<HotSwapStatusState>();
    readonly onDidStateChange: Event<HotSwapStatusState> = this.onStateChangeEmitter.event;

    protected nextId = 1;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugHotSwapStatusWidget.ID;
        this.title.label = this.i18n.t('widget.hotswap.title');
        this.title.caption = this.i18n.t('widget.hotswap.caption');
        this.title.iconClass = 'codicon codicon-sync';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
            this.title.label = this.i18n.t('widget.hotswap.title');
            this.title.caption = this.i18n.t('widget.hotswap.caption');
            this.update();
        }));
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(HotSwapStatusView, {
            state: this.state,
            onRollback: (e: HotSwapEntry) => this.rollback(e),
            onRollbackAll: () => this.rollbackAll(),
            onClear: () => this.clearHistory(),
            onRefresh: () => this.refresh(),
            i18n: this.i18n,
        });
    }

    addEntry(className: string, status: HotSwapStatusType, methodsChanged: number, errorMessage?: string): void {
        const entry: HotSwapEntry = {
            id: `hs-${this.nextId++}`,
            className,
            status,
            timestamp: new Date().toLocaleTimeString(),
            methodsChanged,
            wasRolledBack: false,
            errorMessage,
        };
        const entries = [entry, ...this.state.entries].slice(0, 50); // Keep last 50

        this.setState({
            entries,
            activeCount: entries.filter(e => e.status === 'completed').length,
            busy: false,
            error: null,
        });
    }

    setCanRedefine(canRedefine: boolean): void {
        this.setState({ canRedefine });
    }

    refresh(): void {
        this.setState({ busy: false, error: null });
    }

    protected rollback(entry: HotSwapEntry): void {
        const entries = this.state.entries.map(e =>
            e.id === entry.id ? { ...e, status: 'rolled_back' as HotSwapStatusType, wasRolledBack: true } : e,
        );
        this.setState({
            entries,
            activeCount: entries.filter(e => e.status === 'completed').length,
            busy: false,
            error: null,
        });
    }

    protected rollbackAll(): void {
        const entries = this.state.entries.map(e =>
            e.status === 'completed' ? { ...e, status: 'rolled_back' as HotSwapStatusType, wasRolledBack: true } : e,
        );
        this.setState({
            entries,
            activeCount: 0,
            busy: false,
            error: null,
        });
    }

    protected clearHistory(): void {
        this.setState({ entries: [], activeCount: 0, busy: false, error: null });
    }

    protected setState(partial: Partial<HotSwapStatusState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChangeEmitter.fire(this.state);
        this.update();
    }
}