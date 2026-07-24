/**
 * Kairo Debug Console Widget — expression evaluation and output viewer.
 *
 * Provides an interactive console for evaluating Java expressions
 * in the context of the current suspended thread, viewing stdout/stderr
 * output from the debuggee, and managing evaluation history.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import type { DebugSession } from '@theia/debug/lib/browser/debug-session';
import { KairoJavaDebugService } from './kairo-java-debug-service';

export const KAIRO_DEBUG_CONSOLE_FACTORY_ID = 'kairo-debug-console';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type ConsoleMessageKind = 'input' | 'output' | 'error' | 'info' | 'stdout' | 'stderr';

export interface ConsoleEntry {
    id: number;
    kind: ConsoleMessageKind;
    text: string;
    timestamp: number;
    /** Optional expression that produced this output */
    expression?: string;
    /** Optional evaluation result details */
    resultType?: string;
    hasError?: boolean;
}

export interface ConsoleState {
    entries: ConsoleEntry[];
    inputValue: string;
    history: string[];
    historyIndex: number;
    busy: boolean;
    error: string | null;
    sessionId: string | undefined;
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface ConsoleViewProps {
    state: ConsoleState;
    session: DebugSession | undefined;
    onEvaluate: (expression: string) => void;
    onClear: () => void;
    onInputChange: (value: string) => void;
    onInputKeyDown: (e: React.KeyboardEvent) => void;
}

const ConsoleView: React.FC<ConsoleViewProps> = ({
    state, session, onEvaluate, onClear, onInputChange, onInputKeyDown,
}) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const outputRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [state.entries]);

    React.useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleSubmit = () => {
        const trimmed = state.inputValue.trim();
        if (trimmed) {
            onEvaluate(trimmed);
        }
    };

    return (
        <div className="kairo-debug-console-widget" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '12px' }}>Debug Console</span>
                <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                    {state.entries.length} entries
                </span>
                <div style={{ flex: 1 }} />
                <button
                    className="theia-button secondary"
                    disabled={state.entries.length === 0}
                    onClick={onClear}
                    style={{ padding: '1px 8px', fontSize: '11px' }}
                    title="Clear console"
                >
                    Clear
                </button>
            </div>

            {/* Output area */}
            <div ref={outputRef} style={{ flex: 1, overflow: 'auto', padding: '4px 0', fontFamily: 'var(--theia-monaco-font-family, monospace)', fontSize: '12px' }}>
                {!session && state.entries.length === 0 && (
                    <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                        No active debug session. Start debugging to use the console.
                    </div>
                )}
                {session && state.entries.length === 0 && !state.busy && (
                    <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                        Type an expression and press Enter to evaluate it.
                    </div>
                )}
                {state.entries.map(entry => (
                    <div
                        key={entry.id}
                        style={{
                            padding: '2px 12px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            color: entryColor(entry.kind, entry.hasError),
                            borderBottom: entry.kind === 'input' ? '1px solid var(--theia-panel-border)' : undefined,
                            background: entry.kind === 'input' ? 'var(--theia-input-background)' : undefined,
                        }}
                    >
                        {entry.kind === 'input' && (
                            <span style={{ color: 'var(--theia-terminal-ansiGreen)', marginRight: 4 }}>{'>'}</span>
                        )}
                        {entry.kind === 'error' && (
                            <span className="codicon codicon-error" style={{ fontSize: '12px', marginRight: 4 }} />
                        )}
                        {entry.kind === 'stderr' && (
                            <span className="codicon codicon-error" style={{ fontSize: '12px', marginRight: 4, color: 'var(--theia-errorForeground)' }} />
                        )}
                        {entry.resultType && (
                            <span style={{ color: 'var(--theia-debugTokenExpression-type)', marginRight: 4 }}>
                                [{entry.resultType}]
                            </span>
                        )}
                        {entry.text}
                    </div>
                ))}
                {state.busy && (
                    <div style={{ padding: '2px 12px', color: 'var(--theia-descriptionForeground)', fontStyle: 'italic' }}>
                        Evaluating...
                    </div>
                )}
            </div>

            {/* Input area */}
            <div style={{
                padding: '4px 8px',
                borderTop: '1px solid var(--theia-panel-border)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
            }}>
                <span style={{ color: 'var(--theia-terminal-ansiGreen)', fontWeight: 600, fontSize: '12px' }}>{'>'}</span>
                <input
                    ref={inputRef}
                    type="text"
                    value={state.inputValue}
                    onChange={e => onInputChange(e.target.value)}
                    onKeyDown={onInputKeyDown}
                    disabled={!session || state.busy}
                    placeholder={session ? 'Type expression, Enter to evaluate...' : 'No active session'}
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
                    aria-label="Debug console expression input"
                />
                <button
                    className="theia-button secondary"
                    disabled={!session || state.busy || !state.inputValue.trim()}
                    onClick={handleSubmit}
                    style={{ padding: '2px 10px', fontSize: '12px' }}
                    title="Evaluate expression"
                >
                    Eval
                </button>
            </div>

            {state.error && (
                <div style={{ padding: '4px 12px', color: 'var(--theia-errorForeground)', fontSize: '12px', borderTop: '1px solid var(--theia-panel-border)' }}>
                    {state.error}
                </div>
            )}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugConsoleWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_CONSOLE_FACTORY_ID;

    @inject(DebugSessionManager)
    protected readonly sessionManager!: DebugSessionManager;

    static nextEntryId = 0;

    protected state: ConsoleState = {
        entries: [],
        inputValue: '',
        history: [],
        historyIndex: -1,
        busy: false,
        error: null,
        sessionId: undefined,
    };
    protected readonly onStateChangeEmitter = new Emitter<ConsoleState>();
    readonly onDidStateChange: Event<ConsoleState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugConsoleWidget.ID;
        this.title.label = 'Debug Console';
        this.title.caption = 'Kairo Java Debug Console';
        this.title.iconClass = 'codicon codicon-debug-console';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.sessionManager.onDidDestroyDebugSession(() => {
            if (this.state.entries.length > 0) {
                this.addEntry({ kind: 'info', text: 'Debug session ended.' });
            }
        });
    }

    protected onAfterShow(): void {
        this.update();
    }

    protected render(): React.ReactNode {
        const session = this.sessionManager.currentSession;
        return React.createElement(ConsoleView, {
            state: this.state,
            session: session ?? undefined,
            onEvaluate: (expr: string) => this.evaluate(expr),
            onClear: () => this.clear(),
            onInputChange: (value: string) => this.setInputValue(value),
            onInputKeyDown: (e: React.KeyboardEvent) => this.handleKeyDown(e),
        });
    }

    async evaluate(expression: string): Promise<void> {
        const session = this.sessionManager.currentSession;
        if (!session) {
            this.setState({
                entries: this.state.entries,
                inputValue: '',
                history: this.state.history,
                historyIndex: this.state.historyIndex,
                busy: false,
                error: 'No active debug session.',
                sessionId: undefined,
            });
            return;
        }

        // Add to history
        const newHistory = [expression, ...this.state.history.filter(h => h !== expression)].slice(0, 50);

        // Add input entry
        this.addEntry({ kind: 'input', text: expression, expression });

        this.setState({
            entries: this.state.entries,
            inputValue: '',
            history: newHistory,
            historyIndex: -1,
            busy: true,
            error: null,
            sessionId: session.id,
        });

        try {
            const thread = session.currentThread;
            if (!thread) {
                this.addEntry({ kind: 'error', text: 'No suspended thread — cannot evaluate expression.', expression, hasError: true });
                this.setState({
                    entries: this.state.entries,
                    inputValue: this.state.inputValue,
                    history: this.state.history,
                    historyIndex: this.state.historyIndex,
                    busy: false,
                    error: null,
                    sessionId: this.state.sessionId,
                });
                return;
            }

            const frameId = session.currentFrame?.raw?.id;
            const response = await session.sendRequest('evaluate', {
                expression,
                frameId: frameId ?? 0,
                context: 'repl',
            });

            const body = response.body;
            const result = body?.result ?? 'undefined';
            const resultType = body?.type;

            this.addEntry({
                kind: 'output',
                text: result,
                expression,
                resultType,
            });
            this.setState({
                entries: this.state.entries,
                inputValue: this.state.inputValue,
                history: this.state.history,
                historyIndex: this.state.historyIndex,
                busy: false,
                error: null,
                sessionId: this.state.sessionId,
            });
        } catch (error) {
            this.addEntry({
                kind: 'error',
                text: error instanceof Error ? error.message : String(error),
                expression,
                hasError: true,
            });
            this.setState({
                entries: this.state.entries,
                inputValue: this.state.inputValue,
                history: this.state.history,
                historyIndex: this.state.historyIndex,
                busy: false,
                error: null,
                sessionId: this.state.sessionId,
            });
        }
    }

    clear(): void {
        this.setState({
            entries: [],
            inputValue: this.state.inputValue,
            history: this.state.history,
            historyIndex: this.state.historyIndex,
            busy: false,
            error: null,
            sessionId: this.state.sessionId,
        });
    }

    protected setInputValue(value: string): void {
        this.setState({
            entries: this.state.entries,
            inputValue: value,
            history: this.state.history,
            historyIndex: this.state.historyIndex,
            busy: this.state.busy,
            error: this.state.error,
            sessionId: this.state.sessionId,
        });
    }

    protected handleKeyDown(e: React.KeyboardEvent): void {
        if (e.key === 'Enter') {
            e.preventDefault();
            const trimmed = this.state.inputValue.trim();
            if (trimmed) {
                this.evaluate(trimmed);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const idx = this.state.historyIndex + 1;
            if (idx < this.state.history.length) {
                this.setState({
                    entries: this.state.entries,
                    inputValue: this.state.history[idx],
                    history: this.state.history,
                    historyIndex: idx,
                    busy: this.state.busy,
                    error: this.state.error,
                    sessionId: this.state.sessionId,
                });
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const idx = this.state.historyIndex - 1;
            if (idx >= 0) {
                this.setState({
                    entries: this.state.entries,
                    inputValue: this.state.history[idx],
                    history: this.state.history,
                    historyIndex: idx,
                    busy: this.state.busy,
                    error: this.state.error,
                    sessionId: this.state.sessionId,
                });
            } else if (idx === -1) {
                this.setState({
                    entries: this.state.entries,
                    inputValue: '',
                    history: this.state.history,
                    historyIndex: -1,
                    busy: this.state.busy,
                    error: this.state.error,
                    sessionId: this.state.sessionId,
                });
            }
        }
    }

    protected addEntry(entry: Omit<ConsoleEntry, 'id' | 'timestamp'>): void {
        const id = ++KairoDebugConsoleWidget.nextEntryId;
        this.state.entries.push({ ...entry, id, timestamp: Date.now() });
    }

    protected setState(partial: Partial<ConsoleState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChangeEmitter.fire(this.state);
        this.update();
    }
}

function entryColor(kind: ConsoleMessageKind, hasError?: boolean): string {
    switch (kind) {
        case 'input': return 'var(--theia-input-foreground)';
        case 'output': return 'var(--theia-debugConsole-infoForeground)';
        case 'error': return 'var(--theia-errorForeground)';
        case 'info': return 'var(--theia-descriptionForeground)';
        case 'stdout': return 'var(--theia-debugConsole-infoForeground)';
        case 'stderr': return 'var(--theia-errorForeground)';
        default: return 'var(--theia-foreground)';
    }
}