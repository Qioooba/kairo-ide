/**
 * Kairo Hot Swap Status Indicator Widget — shows the status of
 * class redefinition / hot swap operations.
 *
 * Displays a list of recent hot swap operations with their status
 * (pending, in progress, completed, failed, rolled back) and
 * provides rollback controls.
 */

import * as React from 'react';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';

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
}

const statusBadge = (status: HotSwapStatusType): { color: string; icon: string; label: string } => {
    switch (status) {
        case 'completed': return { color: 'var(--theia-terminal-ansiGreen)', icon: 'codicon-pass', label: 'OK' };
        case 'in_progress': return { color: 'var(--theia-terminal-ansiYellow)', icon: 'codicon-sync~spin', label: 'SWAP' };
        case 'pending': return { color: 'var(--theia-descriptionForeground)', icon: 'codicon-clock', label: 'PEND' };
        case 'failed': return { color: 'var(--theia-errorForeground)', icon: 'codicon-error', label: 'FAIL' };
        case 'rolled_back': return { color: 'var(--theia-terminal-ansiCyan)', icon: 'codicon-discard', label: 'ROLL' };
        case 'not_supported': return { color: 'var(--theia-disabledForeground)', icon: 'codicon-circle-slash', label: 'N/A' };
        default: return { color: 'var(--theia-descriptionForeground)', icon: 'codicon-question', label: '?' };
    }
};

const HotSwapStatusView: React.FC<HotSwapStatusViewProps> = ({
    state: s, onRollback, onRollbackAll, onClear, onRefresh,
}) => (
    <div className="kairo-debug-hotswap-status" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '12px' }}>Hot Swap</span>
            <span style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: 3,
                background: s.canRedefine ? 'var(--theia-terminal-ansiGreen)' : 'var(--theia-disabledForeground)',
                color: 'var(--theia-editor-background)',
            }}>
                {s.canRedefine ? 'REDEFINE OK' : 'UNAVAILABLE'}
            </span>
            <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                {s.activeCount} active
            </span>
            <div style={{ flex: 1 }} />
            <button
                className="theia-button secondary"
                disabled={s.busy || s.activeCount === 0}
                onClick={onRollbackAll}
                style={{ padding: '1px 8px', fontSize: '11px' }}
                title="Rollback all hot swaps"
            >
                Rollback All
            </button>
            <button
                className="theia-button secondary"
                disabled={s.busy || s.entries.length === 0}
                onClick={onClear}
                style={{ padding: '1px 8px', fontSize: '11px' }}
                title="Clear history"
            >
                Clear
            </button>
            <button
                className="theia-button secondary"
                disabled={s.busy}
                onClick={onRefresh}
                style={{ padding: '1px 8px', fontSize: '11px' }}
                title="Refresh"
            >
                {s.busy ? '...' : '↻'}
            </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto' }}>
            {s.error && (
                <div style={{ padding: '8px 12px', color: 'var(--theia-errorForeground)', fontSize: '12px' }}>
                    {s.error}
                </div>
            )}
            {!s.error && s.entries.length === 0 && (
                <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                    No hot swap operations yet. Edit and save a Java file during a debug session to trigger a hot swap.
                </div>
            )}
            {s.entries.map(entry => {
                const badge = statusBadge(entry.status);
                return (
                    <div
                        key={entry.id}
                        className="kairo-debug-hotswap-row"
                        style={{
                            padding: '4px 8px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 6,
                            fontSize: '12px',
                            lineHeight: '18px',
                            borderBottom: '1px solid var(--theia-panel-border)',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                    >
                        {/* Status icon */}
                        <span
                            className={`codicon ${badge.icon}`}
                            style={{ color: badge.color, fontSize: '14px', marginTop: 1, flexShrink: 0 }}
                            title={entry.status}
                        />

                        {/* Main content */}
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {entry.className}
                            </div>
                            <div style={{ fontSize: '10px', opacity: 0.6, display: 'flex', gap: 8 }}>
                                <span>{entry.timestamp}</span>
                                {entry.methodsChanged > 0 && (
                                    <span>{entry.methodsChanged} method{entry.methodsChanged !== 1 ? 's' : ''} changed</span>
                                )}
                                {entry.wasRolledBack && (
                                    <span style={{ color: 'var(--theia-terminal-ansiCyan)' }}>rolled back</span>
                                )}
                            </div>
                            {entry.errorMessage && (
                                <div style={{ fontSize: '10px', color: 'var(--theia-errorForeground)', marginTop: 2 }}>
                                    {entry.errorMessage}
                                </div>
                            )}
                        </div>

                        {/* Status badge */}
                        <span style={{
                            fontSize: '9px',
                            padding: '0 4px',
                            borderRadius: 3,
                            background: badge.color,
                            color: 'var(--theia-editor-background)',
                            fontWeight: 600,
                            flexShrink: 0,
                            marginTop: 1,
                        }}>
                            {badge.label}
                        </span>

                        {/* Rollback button */}
                        {entry.status === 'completed' && (
                            <button
                                className="theia-button secondary"
                                onClick={() => onRollback(entry)}
                                style={{ padding: '0 6px', fontSize: '11px', lineHeight: '18px', flexShrink: 0 }}
                                title="Rollback this hot swap"
                                aria-label={`Rollback hot swap for ${entry.className}`}
                            >
                                ↺
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    </div>
);

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugHotSwapStatusWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID;

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
        this.title.label = 'Hot Swap';
        this.title.caption = 'Kairo Hot Swap Status';
        this.title.iconClass = 'codicon codicon-sync';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(HotSwapStatusView, {
            state: this.state,
            onRollback: (e: HotSwapEntry) => this.rollback(e),
            onRollbackAll: () => this.rollbackAll(),
            onClear: () => this.clearHistory(),
            onRefresh: () => this.refresh(),
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