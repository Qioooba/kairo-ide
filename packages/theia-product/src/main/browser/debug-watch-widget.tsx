/**
 * Kairo Debug Watch Widget — watch expressions with live evaluation.
 *
 * Allows users to add, edit, and remove watch expressions that are
 * automatically evaluated whenever the debug session pauses. Results
 * are displayed inline with type information.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import type { DebugSession } from '@theia/debug/lib/browser/debug-session';

export const KAIRO_DEBUG_WATCH_FACTORY_ID = 'kairo-debug-watch';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface WatchExpression {
    id: number;
    expression: string;
    /** true while the expression is being evaluated */
    evaluating: boolean;
    /** evaluation result */
    result?: string;
    /** result type from DAP */
    resultType?: string;
    /** error message if evaluation failed */
    error?: string;
    /** whether the expression is currently being edited */
    editing: boolean;
}

export interface WatchState {
    expressions: WatchExpression[];
    newExpression: string;
    busy: boolean;
    error: string | null;
    sessionId: string | undefined;
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface WatchViewProps {
    state: WatchState;
    session: DebugSession | undefined;
    onAdd: () => void;
    onRemove: (expr: WatchExpression) => void;
    onEdit: (expr: WatchExpression) => void;
    onSaveEdit: (expr: WatchExpression, newExpression: string) => void;
    onCancelEdit: (expr: WatchExpression) => void;
    onNewExpressionChange: (value: string) => void;
    onNewExpressionKeyDown: (e: React.KeyboardEvent) => void;
    onRefresh: () => void;
}

interface WatchRowProps {
    expr: WatchExpression;
    session: DebugSession | undefined;
    onRemove: (expr: WatchExpression) => void;
    onEdit: (expr: WatchExpression) => void;
    onSaveEdit: (expr: WatchExpression, newExpression: string) => void;
    onCancelEdit: (expr: WatchExpression) => void;
}

const WatchRow: React.FC<WatchRowProps> = ({ expr, session: _session, onRemove, onEdit, onSaveEdit, onCancelEdit }) => {
    const [editValue, setEditValue] = React.useState(expr.expression);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            onSaveEdit(expr, editValue.trim());
        } else if (e.key === 'Escape') {
            onCancelEdit(expr);
        }
    };

    if (expr.editing) {
        return (
            <div style={{
                padding: '4px 8px',
                display: 'flex',
                gap: 4,
                alignItems: 'center',
                borderBottom: '1px solid var(--theia-panel-border)',
            }}>
                <input
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    style={{
                        flex: 1,
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-focusBorder)',
                        padding: '2px 4px',
                        fontSize: '12px',
                        fontFamily: 'var(--theia-monaco-font-family, monospace)',
                        outline: 'none',
                    }}
                />
                <button
                    className="theia-button secondary"
                    onClick={() => onSaveEdit(expr, editValue.trim())}
                    style={{ padding: '1px 6px', fontSize: '11px' }}
                    title="Save"
                >
                    ✓
                </button>
                <button
                    className="theia-button secondary"
                    onClick={() => onCancelEdit(expr)}
                    style={{ padding: '1px 6px', fontSize: '11px' }}
                    title="Cancel"
                >
                    ✗
                </button>
            </div>
        );
    }

    return (
        <div
            style={{
                padding: '4px 8px',
                display: 'flex',
                flexDirection: 'column',
                borderBottom: '1px solid var(--theia-panel-border)',
                cursor: 'pointer',
            }}
            onDoubleClick={() => onEdit(expr)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="codicon codicon-eye" style={{ fontSize: '12px', flexShrink: 0 }} />
                <span style={{
                    flex: 1,
                    fontWeight: 500,
                    fontSize: '12px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--theia-monaco-font-family, monospace)',
                }}>
                    {expr.expression}
                </span>
                <button
                    className="theia-button secondary"
                    onClick={(e) => { e.stopPropagation(); onRemove(expr); }}
                    style={{ padding: '0 5px', fontSize: '12px', lineHeight: '16px', flexShrink: 0 }}
                    title="Remove watch expression"
                    aria-label={`Remove watch expression: ${expr.expression}`}
                >
                    ×
                </button>
            </div>
            {expr.evaluating && (
                <div style={{ paddingLeft: 18, fontSize: '11px', color: 'var(--theia-descriptionForeground)', fontStyle: 'italic' }}>
                    Evaluating...
                </div>
            )}
            {expr.error && (
                <div style={{ paddingLeft: 18, fontSize: '11px', color: 'var(--theia-errorForeground)' }}>
                    {expr.error}
                </div>
            )}
            {!expr.evaluating && !expr.error && expr.result !== undefined && (
                <div style={{ paddingLeft: 18, fontSize: '12px', display: 'flex', gap: 6 }}>
                    {expr.resultType && (
                        <span style={{ color: 'var(--theia-debugTokenExpression-type)', fontSize: '11px' }}>
                            {expr.resultType}
                        </span>
                    )}
                    <span style={{
                        color: expr.result === 'null' ? 'var(--theia-debugTokenExpression-string)' : 'var(--theia-debugTokenExpression-value)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {expr.result === 'null' ? 'null' : expr.result}
                    </span>
                </div>
            )}
            {!expr.evaluating && !expr.error && expr.result === undefined && (
                <div style={{ paddingLeft: 18, fontSize: '11px', color: 'var(--theia-descriptionForeground)' }}>
                    Not available
                </div>
            )}
        </div>
    );
};

const WatchView: React.FC<WatchViewProps> = ({
    state, session, onAdd, onRemove, onEdit, onSaveEdit, onCancelEdit,
    onNewExpressionChange, onNewExpressionKeyDown, onRefresh,
}) => {
    return (
        <div className="kairo-debug-watch-widget" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '12px' }}>Watch</span>
                <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                    {state.expressions.length} items
                </span>
                <div style={{ flex: 1 }} />
                <button
                    className="theia-button secondary"
                    disabled={state.busy}
                    onClick={onRefresh}
                    style={{ padding: '1px 8px', fontSize: '11px' }}
                    title="Refresh all watch expressions"
                >
                    {state.busy ? '...' : '↻'}
                </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                {state.error && (
                    <div style={{ padding: '8px 12px', color: 'var(--theia-errorForeground)', fontSize: '12px' }}>
                        {state.error}
                    </div>
                )}
                {!state.error && state.expressions.length === 0 && (
                    <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                        {session
                            ? 'No watch expressions. Add an expression below to monitor its value.'
                            : 'No active debug session.'}
                    </div>
                )}
                {state.expressions.map(expr => (
                    <WatchRow
                        key={expr.id}
                        expr={expr}
                        session={session}
                        onRemove={onRemove}
                        onEdit={onEdit}
                        onSaveEdit={onSaveEdit}
                        onCancelEdit={onCancelEdit}
                    />
                ))}
            </div>

            {/* Add expression input */}
            <div style={{
                padding: '4px 8px',
                borderTop: '1px solid var(--theia-panel-border)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
            }}>
                <span className="codicon codicon-add" style={{ fontSize: '12px', flexShrink: 0 }} />
                <input
                    type="text"
                    value={state.newExpression}
                    onChange={e => onNewExpressionChange(e.target.value)}
                    onKeyDown={onNewExpressionKeyDown}
                    disabled={!session || state.busy}
                    placeholder={session ? 'Add watch expression...' : 'No active session'}
                    style={{
                        flex: 1,
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        padding: '3px 6px',
                        fontSize: '12px',
                        fontFamily: 'var(--theia-monaco-font-family, monospace)',
                        outline: 'none',
                    }}
                    aria-label="Add watch expression"
                />
                <button
                    className="theia-button secondary"
                    disabled={!session || state.busy || !state.newExpression.trim()}
                    onClick={onAdd}
                    style={{ padding: '2px 10px', fontSize: '12px' }}
                    title="Add watch expression"
                >
                    Add
                </button>
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugWatchWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_WATCH_FACTORY_ID;

    @inject(DebugSessionManager)
    protected readonly sessionManager!: DebugSessionManager;

    static nextExprId = 0;

    protected state: WatchState = {
        expressions: [],
        newExpression: '',
        busy: false,
        error: null,
        sessionId: undefined,
    };
    protected readonly onStateChangeEmitter = new Emitter<WatchState>();
    readonly onDidStateChange: Event<WatchState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugWatchWidget.ID;
        this.title.label = 'Watch';
        this.title.caption = 'Kairo Java Debug Watch Expressions';
        this.title.iconClass = 'codicon codicon-eye';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.sessionManager.onDidStopDebugSession(() => this.evaluateAll());
        this.sessionManager.onDidDestroyDebugSession(() => this.clearResults());
    }

    protected onAfterShow(): void {
        this.update();
    }

    protected render(): React.ReactNode {
        const session = this.sessionManager.currentSession;
        return React.createElement(WatchView, {
            state: this.state,
            session: session ?? undefined,
            onAdd: () => this.addExpression(),
            onRemove: (expr: WatchExpression) => this.removeExpression(expr),
            onEdit: (expr: WatchExpression) => this.startEdit(expr),
            onSaveEdit: (expr: WatchExpression, newExpression: string) => this.saveEdit(expr, newExpression),
            onCancelEdit: (expr: WatchExpression) => this.cancelEdit(expr),
            onNewExpressionChange: (value: string) => this.setNewExpression(value),
            onNewExpressionKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter') this.addExpression();
            },
            onRefresh: () => this.evaluateAll(),
        });
    }

    addExpression(): void {
        const trimmed = this.state.newExpression.trim();
        if (!trimmed) return;

        const id = ++KairoDebugWatchWidget.nextExprId;
        const newExpr: WatchExpression = {
            id,
            expression: trimmed,
            evaluating: false,
            editing: false,
        };

        const expressions = [...this.state.expressions, newExpr];
        this.setState({
            expressions,
            newExpression: '',
            busy: false,
            error: null,
            sessionId: this.state.sessionId,
        });

        this.evaluateSingle(newExpr);
    }

    removeExpression(expr: WatchExpression): void {
        const expressions = this.state.expressions.filter(e => e.id !== expr.id);
        this.setState({
            expressions,
            newExpression: this.state.newExpression,
            busy: false,
            error: null,
            sessionId: this.state.sessionId,
        });
    }

    startEdit(expr: WatchExpression): void {
        const expressions = this.state.expressions.map(e =>
            e.id === expr.id ? { ...e, editing: true } : e
        );
        this.setState({
            expressions,
            newExpression: this.state.newExpression,
            busy: this.state.busy,
            error: this.state.error,
            sessionId: this.state.sessionId,
        });
    }

    saveEdit(expr: WatchExpression, newExpression: string): void {
        if (!newExpression || newExpression === expr.expression) {
            this.cancelEdit(expr);
            return;
        }

        const expressions = this.state.expressions.map(e =>
            e.id === expr.id
                ? { ...e, expression: newExpression, editing: false, result: undefined, error: undefined, evaluating: true }
                : e
        );
        this.setState({
            expressions,
            newExpression: this.state.newExpression,
            busy: false,
            error: null,
            sessionId: this.state.sessionId,
        });

        const updatedExpr = expressions.find(e => e.id === expr.id);
        if (updatedExpr) this.evaluateSingle(updatedExpr);
    }

    cancelEdit(expr: WatchExpression): void {
        const expressions = this.state.expressions.map(e =>
            e.id === expr.id ? { ...e, editing: false } : e
        );
        this.setState({
            expressions,
            newExpression: this.state.newExpression,
            busy: this.state.busy,
            error: this.state.error,
            sessionId: this.state.sessionId,
        });
    }

    setNewExpression(value: string): void {
        this.setState({
            expressions: this.state.expressions,
            newExpression: value,
            busy: this.state.busy,
            error: this.state.error,
            sessionId: this.state.sessionId,
        });
    }

    async evaluateAll(): Promise<void> {
        const session = this.sessionManager.currentSession;
        if (!session || this.state.expressions.length === 0) return;

        const expressions = this.state.expressions.map(e => ({ ...e, evaluating: true, error: undefined }));
        this.setState({
            expressions,
            newExpression: this.state.newExpression,
            busy: true,
            error: null,
            sessionId: session.id,
        });

        const updated = await Promise.all(
            this.state.expressions.map(e => this.evaluateExpression(session, e))
        );
        this.setState({
            expressions: updated,
            newExpression: this.state.newExpression,
            busy: false,
            error: null,
            sessionId: session.id,
        });
    }

    async evaluateSingle(expr: WatchExpression): Promise<void> {
        const session = this.sessionManager.currentSession;
        if (!session) return;

        const updated = await this.evaluateExpression(session, expr);
        const expressions = this.state.expressions.map(e =>
            e.id === expr.id ? updated : e
        );
        this.setState({
            expressions,
            newExpression: this.state.newExpression,
            busy: false,
            error: null,
            sessionId: session.id,
        });
    }

    protected async evaluateExpression(
        session: DebugSession,
        expr: WatchExpression,
    ): Promise<WatchExpression> {
        try {
            const thread = session.currentThread;
            if (!thread) {
                return { ...expr, evaluating: false, error: 'No suspended thread' };
            }

            const frameId = session.currentFrame?.raw?.id;
            const response = await session.sendRequest('evaluate', {
                expression: expr.expression,
                frameId: frameId ?? 0,
                context: 'watch',
            });

            const body = response.body;
            return {
                ...expr,
                evaluating: false,
                result: body?.result ?? 'undefined',
                resultType: body?.type,
                error: undefined,
            };
        } catch (error) {
            return {
                ...expr,
                evaluating: false,
                result: undefined,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    protected clearResults(): void {
        const expressions = this.state.expressions.map(e => ({
            ...e,
            evaluating: false,
            result: undefined,
            error: undefined,
        }));
        this.setState({
            expressions,
            newExpression: this.state.newExpression,
            busy: false,
            error: null,
            sessionId: undefined,
        });
    }

    protected setState(partial: Partial<WatchState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChangeEmitter.fire(this.state);
        this.update();
    }
}