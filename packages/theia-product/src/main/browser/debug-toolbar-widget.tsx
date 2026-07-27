/**
 * Kairo Debug Toolbar Widget — debug session control buttons.
 *
 * Provides Continue/Resume, Step Over, Step Into, Step Out,
 * Stop, and Restart buttons with proper enable/disable states
 * based on the current debug session state. Keyboard shortcuts
 * are displayed as tooltips.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import { KairoJavaDebugService, type KairoJavaDebugState } from './kairo-java-debug-service';
import { KairoDebugSessionService } from './kairo-debug-session-service';

export const KAIRO_DEBUG_TOOLBAR_FACTORY_ID = 'kairo-debug-toolbar';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface ToolbarButtonState {
    continueDisabled: boolean;
    stepOverDisabled: boolean;
    stepIntoDisabled: boolean;
    stepOutDisabled: boolean;
    stopDisabled: boolean;
    restartDisabled: boolean;
    debugState: KairoJavaDebugState;
    sessionLabel: string;
}

export interface ToolbarState {
    buttons: ToolbarButtonState;
    busy: boolean;
    error: string | null;
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface ToolbarViewProps {
    state: ToolbarState;
    onContinue: () => void;
    onStepOver: () => void;
    onStepInto: () => void;
    onStepOut: () => void;
    onStop: () => void;
    onRestart: () => void;
}

interface ToolButtonProps {
    icon: string;
    label: string;
    shortcut: string;
    disabled: boolean;
    onClick: () => void;
    primary?: boolean;
}

const ToolButton: React.FC<ToolButtonProps> = ({ icon, label, shortcut, disabled, onClick, primary }) => (
    <button
        className={`theia-button ${primary ? '' : 'secondary'}`}
        disabled={disabled}
        onClick={onClick}
        title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
        style={{
            padding: '4px 10px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap',
        }}
        aria-label={label}
    >
        <span className={`codicon ${icon}`} style={{ fontSize: '14px' }} />
        <span>{label}</span>
        {shortcut && (
            <span style={{
                fontSize: '10px',
                opacity: 0.6,
                marginLeft: 2,
            }}>
                {shortcut}
            </span>
        )}
    </button>
);

const ToolbarView: React.FC<ToolbarViewProps> = ({
    state, onContinue, onStepOver, onStepInto, onStepOut, onStop, onRestart,
}) => {
    const b = state.buttons;
    const isSuspended = b.debugState === 'paused';
    const isRunning = b.debugState === 'connected';
    const isTerminated = b.debugState === 'terminated' || b.debugState === 'error';
    const hasSession = isSuspended || isRunning;

    return (
        <div className="kairo-debug-toolbar-widget" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '12px' }}>Debug</span>
                {b.sessionLabel && (
                    <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                        {b.sessionLabel}
                    </span>
                )}
                <div style={{ flex: 1 }} />
                <span style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: statusColor(b.debugState),
                    color: 'var(--theia-editor-background)',
                }}>
                    {b.debugState.toUpperCase()}
                </span>
            </div>

            {/* Button groups */}
            <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Execution control */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <ToolButton
                        icon="codicon-debug-continue"
                        label="Continue"
                        shortcut="F5"
                        disabled={b.continueDisabled}
                        onClick={onContinue}
                        primary
                    />
                    <ToolButton
                        icon="codicon-debug-stop"
                        label="Stop"
                        shortcut="⇧F5"
                        disabled={b.stopDisabled}
                        onClick={onStop}
                    />
                    <ToolButton
                        icon="codicon-debug-restart"
                        label="Restart"
                        shortcut="⌃⇧F5"
                        disabled={b.restartDisabled}
                        onClick={onRestart}
                    />
                </div>

                {/* Step control */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <ToolButton
                        icon="codicon-debug-step-over"
                        label="Step Over"
                        shortcut="F10"
                        disabled={b.stepOverDisabled}
                        onClick={onStepOver}
                    />
                    <ToolButton
                        icon="codicon-debug-step-into"
                        label="Step Into"
                        shortcut="F11"
                        disabled={b.stepIntoDisabled}
                        onClick={onStepInto}
                    />
                    <ToolButton
                        icon="codicon-debug-step-out"
                        label="Step Out"
                        shortcut="⇧F11"
                        disabled={b.stepOutDisabled}
                        onClick={onStepOut}
                    />
                </div>
            </div>

            {/* State indicator */}
            {!hasSession && !isTerminated && (
                <div style={{ padding: '8px 12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                    No active debug session. Start a debug session to use these controls.
                </div>
            )}
            {isTerminated && (
                <div style={{ padding: '8px 12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                    Debug session has ended. Start a new session to debug again.
                </div>
            )}

            {state.error && (
                <div style={{ padding: '8px 12px', color: 'var(--theia-errorForeground)', fontSize: '12px' }}>
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
export class KairoDebugToolbarWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_TOOLBAR_FACTORY_ID;

    @inject(DebugSessionManager)
    protected readonly sessionManager!: DebugSessionManager;

    @inject(KairoJavaDebugService)
    protected readonly javaDebug!: KairoJavaDebugService;

    @inject(KairoDebugSessionService)
    protected readonly debugSessionService!: KairoDebugSessionService;

    protected state: ToolbarState = {
        buttons: {
            continueDisabled: true,
            stepOverDisabled: true,
            stepIntoDisabled: true,
            stepOutDisabled: true,
            stopDisabled: true,
            restartDisabled: true,
            debugState: 'unknown',
            sessionLabel: '',
        },
        busy: false,
        error: null,
    };
    protected readonly onStateChangeEmitter = new Emitter<ToolbarState>();
    readonly onDidStateChange: Event<ToolbarState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugToolbarWidget.ID;
        this.title.label = 'Debug';
        this.title.caption = 'Kairo Java Debug Toolbar';
        this.title.iconClass = 'codicon codicon-debug-alt';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.debugSessionService.onDidChangeState(() => this.update());
    }

    protected onAfterShow(): void {
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(ToolbarView, {
            state: this.state,
            onContinue: () => this.continue_(),
            onStepOver: () => this.stepOver(),
            onStepInto: () => this.stepInto(),
            onStepOut: () => this.stepOut(),
            onStop: () => this.stop(),
            onRestart: () => this.restart(),
        });
    }

    update(): void {
        const sessionState = this.debugSessionService.currentState;
        const debugState = sessionState.debugState;
        const isSuspended = sessionState.isSuspended;
        const hasSession = sessionState.hasSession;

        this.setState({
            buttons: {
                continueDisabled: !isSuspended,
                stepOverDisabled: !isSuspended,
                stepIntoDisabled: !isSuspended,
                stepOutDisabled: !isSuspended,
                stopDisabled: !hasSession,
                restartDisabled: !hasSession,
                debugState,
                sessionLabel: sessionState.sessionLabel,
            },
            busy: false,
            error: null,
        });
    }

    async continue_(): Promise<void> {
        try {
            await this.debugSessionService.continue();
        } catch (error) {
            this.setState({
                buttons: this.state.buttons,
                busy: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    async stepOver(): Promise<void> {
        try {
            await this.debugSessionService.stepOver();
        } catch (error) {
            this.setState({
                buttons: this.state.buttons,
                busy: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    async stepInto(): Promise<void> {
        try {
            await this.debugSessionService.stepInto();
        } catch (error) {
            this.setState({
                buttons: this.state.buttons,
                busy: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    async stepOut(): Promise<void> {
        try {
            await this.debugSessionService.stepOut();
        } catch (error) {
            this.setState({
                buttons: this.state.buttons,
                busy: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    async stop(): Promise<void> {
        try {
            await this.debugSessionService.stop();
        } catch (error) {
            this.setState({
                buttons: this.state.buttons,
                busy: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    async restart(): Promise<void> {
        try {
            await this.javaDebug.stop();
            // Re-attach would need the original target info; for now
            // stop is a clean teardown — user can re-debug from toolbar.
            this.update();
        } catch (error) {
            this.setState({
                buttons: this.state.buttons,
                busy: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    protected setState(partial: Partial<ToolbarState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChangeEmitter.fire(this.state);
        this.update();
    }
}

function statusColor(state: KairoJavaDebugState): string {
    switch (state) {
        case 'connected': return 'var(--theia-debugIcon-startForeground)';
        case 'paused': return 'var(--theia-editorWarning-foreground)';
        case 'terminated': return 'var(--theia-disabledForeground)';
        case 'error': return 'var(--theia-errorForeground)';
        case 'available': return 'var(--theia-terminal-ansiGreen)';
        case 'connecting': return 'var(--theia-terminal-ansiYellow)';
        default: return 'var(--theia-descriptionForeground)';
    }
}