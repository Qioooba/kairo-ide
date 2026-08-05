/**
 * Kairo Debug Call Stack Widget — stack frame list with file:line display.
 *
 * Shows the call stack for the current thread with source location
 * information. Clicking a frame navigates to the corresponding source
 * in the editor. The current frame is highlighted.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import type { DebugSession } from '@theia/debug/lib/browser/debug-session';
import type { DebugStackFrame } from '@theia/debug/lib/browser/model/debug-stack-frame';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import { KairoDebugSessionService } from './kairo-debug-session-service';

export const KAIRO_DEBUG_CALLSTACK_FACTORY_ID = 'kairo-debug-callstack';

type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface StackFrameInfo {
    id: number;
    name: string;
    source?: {
        name: string;
        path: string;
    };
    line: number;
    column: number;
    isCurrent: boolean;
}

export interface CallStackState {
    frames: StackFrameInfo[];
    threadName: string;
    busy: boolean;
    error: string | null;
    sessionId: string | undefined;
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface CallStackViewProps {
    state: CallStackState;
    session: DebugSession | undefined;
    t: TFunction;
    onSelectFrame: (frame: StackFrameInfo) => void;
    onRefresh: () => void;
}

const CallStackView: React.FC<CallStackViewProps> = ({ state, session, t, onSelectFrame, onRefresh }) => {
    const handleFrameClick = (frame: StackFrameInfo) => {
        onSelectFrame(frame);
    };

    return (
        <div className="kairo-debug-callstack-widget">
            {/* Header */}
            <div className="kairo-debug-toolbar">
                <span className="kairo-debug-callstack-title">{t('widget.debug.callstack.title')}</span>
                {state.threadName && (
                    <span className="kairo-debug-callstack-count">
                        {state.threadName}
                    </span>
                )}
                <span className="kairo-debug-callstack-count">
                    {t('widget.debug.callstack.frames', { count: state.frames.length })}
                </span>
                <div className="kairo-debug-callstack-spacer" />
                <button
                    className="theia-button secondary kairo-debug-callstack-toolbar-btn"
                    disabled={state.busy}
                    onClick={onRefresh}
                    title={t('widget.debug.callstack.refreshTooltip')}
                >
                    {state.busy ? t('common.loading') : '↻'}
                </button>
            </div>

            {/* Body */}
            <div className="kairo-debug-callstack-body">
                {state.error && (
                    <div className="kairo-debug-callstack-error">
                        {state.error}
                    </div>
                )}
                {!state.error && !state.busy && state.frames.length === 0 && (
                    <div className="kairo-debug-callstack-empty">
                        {session ? t('widget.debug.callstack.running') : t('widget.debug.callstack.noSession')}
                    </div>
                )}
                {state.frames.map(frame => (
                    <div
                        key={frame.id}
                        className="kairo-debug-frame-row"
                        onClick={() => handleFrameClick(frame)}
                        style={{
                            padding: '3px 8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 6,
                            fontSize: '12px',
                            lineHeight: '18px',
                            background: frame.isCurrent ? 'var(--theia-list-activeSelectionBackground)' : undefined,
                            color: frame.isCurrent ? 'var(--theia-list-activeSelectionForeground)' : undefined,
                        }}
                        onMouseEnter={e => {
                            if (!frame.isCurrent) {
                                (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)';
                            }
                        }}
                        onMouseLeave={e => {
                            if (!frame.isCurrent) {
                                (e.currentTarget as HTMLElement).style.background = '';
                            }
                        }}
                    >
                        <span className="codicon codicon-arrow-right" style={{ fontSize: '14px', paddingTop: 1, flexShrink: 0 }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{
                                fontWeight: frame.isCurrent ? 600 : 400,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}>
                                {frame.name}
                            </div>
                            <div style={{
                                fontSize: '11px',
                                opacity: 0.7,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}>
                                {frame.source?.name ?? t('widget.debug.callstack.unknownSource')}:{frame.line}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugCallStackWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_CALLSTACK_FACTORY_ID;

    @inject(DebugSessionManager)
    protected readonly sessionManager!: DebugSessionManager;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    @inject(KairoDebugSessionService)
    protected readonly debugSessionService!: KairoDebugSessionService;

    protected state: CallStackState = { frames: [], threadName: '', busy: false, error: null, sessionId: undefined };
    protected readonly onStateChangeEmitter = new Emitter<CallStackState>();
    readonly onDidStateChange: Event<CallStackState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        this.id = KairoDebugCallStackWidget.ID;
        this.title.label = t('widget.debug.callstack.title');
        this.title.caption = t('widget.debug.callstack.caption');
        this.title.iconClass = 'codicon codicon-debug-stackframe';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.sessionManager.onDidChange(() => this.syncCurrentFrameHighlight());
        this.debugSessionService.onDidChangeState(state => {
            if (state.isSuspended) {
                void this.refresh();
            } else {
                this.clear();
            }
        });
    }

    protected onAfterShow(): void {
        this.refresh();
    }

    protected render(): React.ReactNode {
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        const session = this.sessionManager.currentSession;
        return React.createElement(CallStackView, {
            state: this.state,
            session: session ?? undefined,
            t,
            onSelectFrame: (frame: StackFrameInfo) => void this.selectFrame(frame),
            onRefresh: () => this.refresh(),
        });
    }

    protected mapStackFrame(frame: DebugStackFrame, currentFrameId: number | undefined, index: number): StackFrameInfo {
        const source = frame.source;
        return {
            id: frame.raw.id,
            name: frame.raw.name,
            source: source ? {
                name: source.name ?? 'Unknown',
                path: source.uri.toString(),
            } : frame.raw.source ? {
                name: frame.raw.source.name ?? 'Unknown',
                path: frame.raw.source.path ?? '',
            } : undefined,
            line: frame.raw.line,
            column: frame.raw.column,
            isCurrent: currentFrameId !== undefined
                ? frame.raw.id === currentFrameId
                : index === 0,
        };
    }

    protected syncCurrentFrameHighlight(): void {
        const currentFrameId = this.sessionManager.currentSession?.currentFrame?.raw?.id;
        if (currentFrameId === undefined || this.state.frames.length === 0) {
            this.update();
            return;
        }
        const needsUpdate = this.state.frames.some(f => f.isCurrent !== (f.id === currentFrameId));
        if (needsUpdate) {
            this.setState({
                frames: this.state.frames.map(f => ({
                    ...f,
                    isCurrent: f.id === currentFrameId,
                })),
            });
        } else {
            this.update();
        }
    }

    async refresh(): Promise<void> {
        const session = this.sessionManager.currentSession;
        if (!session) {
            this.setState({ frames: [], threadName: '', busy: false, error: null, sessionId: undefined });
            return;
        }

        this.setState({ frames: this.state.frames, threadName: this.state.threadName, busy: true, error: null, sessionId: session.id });

        try {
            const thread = session.currentThread;
            if (!thread) {
                this.setState({ frames: [], threadName: '', busy: false, error: null, sessionId: session.id });
                return;
            }

            const stackFrames = await thread.fetchFrames();
            const currentFrameId = thread.currentFrame?.raw?.id;
            const frames: StackFrameInfo[] = stackFrames.map((f, i) =>
                this.mapStackFrame(f, currentFrameId, i),
            );

            this.setState({
                frames,
                threadName: thread.raw.name ?? `Thread ${thread.threadId}`,
                busy: false,
                error: null,
                sessionId: session.id,
            });
        } catch (error) {
            this.setState({
                frames: [],
                threadName: '',
                busy: false,
                error: error instanceof Error ? error.message : String(error),
                sessionId: session.id,
            });
        }
    }

    protected async selectFrame(frame: StackFrameInfo): Promise<void> {
        const focused = await this.debugSessionService.focusFrame(frame.id);
        if (focused) {
            void focused.open({ preview: true });
        }

        const currentFrameId = this.sessionManager.currentSession?.currentFrame?.raw?.id ?? frame.id;
        this.setState({
            frames: this.state.frames.map(f => ({
                ...f,
                isCurrent: f.id === currentFrameId,
            })),
        });
    }

    protected clear(): void {
        this.setState({ frames: [], threadName: '', busy: false, error: null, sessionId: undefined });
    }

    protected setState(partial: Partial<CallStackState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChangeEmitter.fire(this.state);
        this.update();
    }
}
