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
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';

export const KAIRO_DEBUG_CONSOLE_FACTORY_ID = 'kairo-debug-console';

type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

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
    t: TFunction;
    onEvaluate: (expression: string) => void;
    onClear: () => void;
    onInputChange: (value: string) => void;
    onInputKeyDown: (e: React.KeyboardEvent) => void;
}

const ConsoleView: React.FC<ConsoleViewProps> = ({
    state, session, t, onEvaluate, onClear, onInputChange, onInputKeyDown,
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
        <div className="kairo-debug-console-widget">
            {/* Header */}
            <div className="kairo-debug-console-toolbar">
                <span className="kairo-debug-console-title">{t('widget.debug.console.title')}</span>
                <span className="kairo-debug-console-count">
                    {t('widget.debug.console.entries', { count: state.entries.length })}
                </span>
                <div className="kairo-debug-console-spacer" />
                <button
                    className="theia-button secondary kairo-debug-console-clear-btn"
                    disabled={state.entries.length === 0}
                    onClick={onClear}
                    title={t('widget.debug.console.clearTooltip')}
                >
                    {t('widget.debug.console.clear')}
                </button>
            </div>

            {/* Output area */}
            <div ref={outputRef} className="kairo-debug-console-output">
                {!session && state.entries.length === 0 && (
                    <div className="kairo-empty-state kairo-debug-console-empty">
                        <span className="kairo-empty-state-glyph codicon codicon-debug-console" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{t('widget.debug.console.emptyNoSessionTitle')}</h3>
                        <p className="kairo-empty-state-reason">
                            {t('widget.debug.console.emptyNoSessionReason')}
                        </p>
                    </div>
                )}
                {session && state.entries.length === 0 && !state.busy && (
                    <div className="kairo-empty-state kairo-debug-console-empty">
                        <span className="kairo-empty-state-glyph codicon codicon-terminal" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{t('widget.debug.console.emptyReadyTitle')}</h3>
                        <p className="kairo-empty-state-reason">
                            {t('widget.debug.console.emptyReadyReason')}
                        </p>
                    </div>
                )}
                {state.entries.map(entry => (
                    <div
                        key={entry.id}
                        className={`kairo-debug-console-entry ${entry.kind}`}
                    >
                        {entry.kind === 'input' && (
                            <span className="kairo-debug-console-prompt">{'>'}</span>
                        )}
                        {entry.kind === 'error' && (
                            <span className="codicon codicon-error" aria-hidden="true" />
                        )}
                        {entry.kind === 'stderr' && (
                            <span className="codicon codicon-error" aria-hidden="true" />
                        )}
                        {entry.resultType && (
                            <span className="kairo-debug-console-result-type">
                                [{entry.resultType}]
                            </span>
                        )}
                        {entry.text}
                    </div>
                ))}
                {state.busy && (
                    <div className="kairo-debug-console-busy">
                        {t('widget.debug.console.evaluating')}
                    </div>
                )}
            </div>

            {/* Input area */}
            <div className="kairo-debug-console-input-area">
                <span className="kairo-debug-console-prompt">{'>'}</span>
                <input
                    ref={inputRef}
                    type="text"
                    className="kairo-debug-console-input"
                    value={state.inputValue}
                    onChange={e => onInputChange(e.target.value)}
                    onKeyDown={onInputKeyDown}
                    disabled={!session || state.busy}
                    placeholder={session ? t('widget.debug.console.inputPlaceholder') : t('widget.debug.console.noSessionPlaceholder')}
                    aria-label={t('widget.debug.console.inputPlaceholder')}
                />
                <button
                    className="theia-button secondary kairo-debug-console-eval-btn"
                    disabled={!session || state.busy || !state.inputValue.trim()}
                    onClick={handleSubmit}
                    title={t('widget.debug.console.evalTooltip')}
                >
                    {t('widget.debug.console.eval')}
                </button>
            </div>

            {state.error && (
                <div className="kairo-debug-console-error">
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

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

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
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        this.id = KairoDebugConsoleWidget.ID;
        this.title.label = t('widget.debug.console.title');
        this.title.caption = t('widget.debug.console.caption');
        this.title.iconClass = 'codicon codicon-debug-console';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.sessionManager.onDidDestroyDebugSession(() => {
            if (this.state.entries.length > 0) {
                this.addEntry({ kind: 'info', text: t('widget.debug.console.sessionEnded') });
            }
        });
    }

    protected onAfterShow(): void {
        this.update();
    }

    protected render(): React.ReactNode {
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        const session = this.sessionManager.currentSession;
        return React.createElement(ConsoleView, {
            state: this.state,
            session: session ?? undefined,
            t,
            onEvaluate: (expr: string) => this.evaluate(expr),
            onClear: () => this.clear(),
            onInputChange: (value: string) => this.setInputValue(value),
            onInputKeyDown: (e: React.KeyboardEvent) => this.handleKeyDown(e),
        });
    }

    async evaluate(expression: string): Promise<void> {
        const session = this.sessionManager.currentSession;
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        if (!session) {
            this.setState({
                entries: this.state.entries,
                inputValue: '',
                history: this.state.history,
                historyIndex: this.state.historyIndex,
                busy: false,
                error: t('widget.debug.console.noSessionError'),
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
                this.addEntry({ kind: 'error', text: t('widget.debug.console.noThreadError'), expression, hasError: true });
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
