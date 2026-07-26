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
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import URI from '@theia/core/lib/common/uri';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import type { DebugSession } from '@theia/debug/lib/browser/debug-session';
import type { DebugProtocol } from '@vscode/debugprotocol';

export const KAIRO_DEBUG_CALLSTACK_FACTORY_ID = 'kairo-debug-callstack';

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
    openerService: OpenerService;
    onSelectFrame: (frame: StackFrameInfo) => void;
    onRefresh: () => void;
}

const CallStackView: React.FC<CallStackViewProps> = ({ state, session, openerService, onSelectFrame, onRefresh }) => {
    const handleFrameClick = (frame: StackFrameInfo) => {
        onSelectFrame(frame);
        if (frame.source?.path) {
            const uri = new URI(frame.source.path);
            open(openerService, uri, {
                selection: {
                    start: { line: Math.max(0, frame.line - 1), character: Math.max(0, frame.column - 1) },
                    end: { line: Math.max(0, frame.line - 1), character: Math.max(0, frame.column - 1) },
                },
            });
        }
    };

    return (
        <div className="kairo-debug-callstack-widget" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '12px' }}>Call Stack</span>
                {state.threadName && (
                    <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                        {state.threadName}
                    </span>
                )}
                <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                    {state.frames.length} frames
                </span>
                <div style={{ flex: 1 }} />
                <button
                    className="theia-button secondary"
                    disabled={state.busy}
                    onClick={onRefresh}
                    style={{ padding: '1px 8px', fontSize: '11px' }}
                    title="Refresh call stack"
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
                {!state.error && !state.busy && state.frames.length === 0 && (
                    <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                        {session ? 'Thread is running. Pause to view call stack.' : 'No active debug session.'}
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
                                {frame.source?.name ?? 'Unknown'}:{frame.line}
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

    @inject(OpenerService)
    protected readonly openerService!: OpenerService;

    protected state: CallStackState = { frames: [], threadName: '', busy: false, error: null, sessionId: undefined };
    protected readonly onStateChangeEmitter = new Emitter<CallStackState>();
    readonly onDidStateChange: Event<CallStackState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugCallStackWidget.ID;
        this.title.label = 'Call Stack';
        this.title.caption = 'Kairo Java Debug Call Stack';
        this.title.iconClass = 'codicon codicon-debug-stackframe';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.sessionManager.onDidChange(() => this.update());
        this.sessionManager.onDidStopDebugSession(() => this.refresh());
        this.sessionManager.onDidDestroyDebugSession(() => this.clear());
    }

    protected onAfterShow(): void {
        this.refresh();
    }

    protected render(): React.ReactNode {
        const session = this.sessionManager.currentSession;
        return React.createElement(CallStackView, {
            state: this.state,
            session: session ?? undefined,
            openerService: this.openerService,
            onSelectFrame: (frame: StackFrameInfo) => this.selectFrame(frame),
            onRefresh: () => this.refresh(),
        });
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

            const response = await session.sendRequest('stackTrace', { threadId: thread.threadId });
            const rawFrames = response.body?.stackFrames ?? [];
            const frames: StackFrameInfo[] = rawFrames.map((f: DebugProtocol.StackFrame, i: number) => ({
                id: f.id,
                name: f.name,
                source: f.source ? {
                    name: f.source.name ?? 'Unknown',
                    path: f.source.path ?? '',
                } : undefined,
                line: f.line,
                column: f.column,
                isCurrent: i === 0,
            }));

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

    protected selectFrame(frame: StackFrameInfo): void {
        // The actual frame switching is handled by the native debug session
        // when the user clicks on a frame. Theia's DebugStackFramesWidget
        // already handles this. This is a convenience view.
        const session = this.sessionManager.currentSession;
        if (session) {
            // Mark the selected frame as current
            this.state.frames.forEach(f => { f.isCurrent = f.id === frame.id; });
            this.update();
        }
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

function _mapStackTraceFrame(f: DebugProtocol.StackFrame, index: number): StackFrameInfo {
    return {
        id: f.id,
        name: f.name,
        source: f.source ? {
            name: f.source.name ?? 'Unknown',
            path: f.source.path ?? '',
        } : undefined,
        line: f.line,
        column: f.column,
        isCurrent: index === 0,
    };
}