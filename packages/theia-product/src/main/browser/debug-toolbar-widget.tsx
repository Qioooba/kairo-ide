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
import { KairoI18nService } from '@kairo/i18n';
import { type KairoJavaDebugState } from './kairo-java-debug-service';
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
    i18n: KairoI18nService;
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
        className={`kairo-dtw-btn theia-button ${primary ? '' : 'secondary'}`}
        disabled={disabled}
        onClick={onClick}
        title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
        aria-label={label}
    >
        <span className={`codicon ${icon}`} />
        <span>{label}</span>
        {shortcut && (
            <span className="kairo-dtw-btn-shortcut">
                {shortcut}
            </span>
        )}
    </button>
);

const ToolbarView: React.FC<ToolbarViewProps> = ({
    state, onContinue, onStepOver, onStepInto, onStepOut, onStop, onRestart, i18n,
}) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const b = state.buttons;
    const isSuspended = b.debugState === 'paused';
    const isRunning = b.debugState === 'connected';
    const isTerminated = b.debugState === 'terminated' || b.debugState === 'error';
    const hasSession = isSuspended || isRunning;

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    return (
        <div className="kairo-debug-toolbar-widget">
            {/* Header */}
            <div className="kairo-widget-toolbar">
                <span className="kairo-dtw-title">{t('widget.debug.toolbar.title')}</span>
                {b.sessionLabel && (
                    <span className="kairo-dtw-session">
                        {b.sessionLabel}
                    </span>
                )}
                <div style={{ flex: 1 }} />
                <span className="kairo-dtw-state" style={{ background: statusColor(b.debugState) }}>
                    {b.debugState.toUpperCase()}
                </span>
            </div>

            {/* Button groups */}
            <div className="kairo-dtw-groups">
                {/* Execution control */}
                <div className="kairo-dtw-btn-row">
                    <ToolButton
                        icon="codicon-debug-continue"
                        label={t('widget.debug.toolbar.continue')}
                        shortcut="F5"
                        disabled={b.continueDisabled}
                        onClick={onContinue}
                        primary
                    />
                    <ToolButton
                        icon="codicon-debug-stop"
                        label={t('widget.debug.toolbar.stop')}
                        shortcut="⇧F5"
                        disabled={b.stopDisabled}
                        onClick={onStop}
                    />
                    <ToolButton
                        icon="codicon-debug-restart"
                        label={t('widget.debug.toolbar.restart')}
                        shortcut="⌃⇧F5"
                        disabled={b.restartDisabled}
                        onClick={onRestart}
                    />
                </div>

                {/* Step control */}
                <div className="kairo-dtw-btn-row">
                    <ToolButton
                        icon="codicon-debug-step-over"
                        label={t('widget.debug.toolbar.stepOver')}
                        shortcut="F10"
                        disabled={b.stepOverDisabled}
                        onClick={onStepOver}
                    />
                    <ToolButton
                        icon="codicon-debug-step-into"
                        label={t('widget.debug.toolbar.stepInto')}
                        shortcut="F11"
                        disabled={b.stepIntoDisabled}
                        onClick={onStepInto}
                    />
                    <ToolButton
                        icon="codicon-debug-step-out"
                        label={t('widget.debug.toolbar.stepOut')}
                        shortcut="⇧F11"
                        disabled={b.stepOutDisabled}
                        onClick={onStepOut}
                    />
                </div>
            </div>

            {/* State indicator */}
            {!hasSession && !isTerminated && (
                <div className="kairo-dtw-hint">
                    {t('widget.debug.toolbar.noSession')}
                </div>
            )}
            {isTerminated && (
                <div className="kairo-dtw-hint">
                    {t('widget.debug.toolbar.sessionEnded')}
                </div>
            )}

            {state.error && (
                <div className="kairo-dtw-error">
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

    @inject(KairoDebugSessionService)
    protected readonly debugSessionService!: KairoDebugSessionService;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

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
        this.updateTitle();
        this.title.iconClass = 'codicon codicon-debug-alt';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.refreshFromSession();

        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
        this.debugSessionService.onDidChangeState(() => this.refreshFromSession());
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.debug.toolbar.title');
        this.title.caption = this.i18n.t('widget.debug.toolbar.caption');
    }

    protected onAfterShow(): void {
        this.refreshFromSession();
    }

    protected render(): React.ReactNode {
        return React.createElement(ToolbarView, {
            state: this.state,
            i18n: this.i18n,
            onContinue: () => this.continue_(),
            onStepOver: () => this.stepOver(),
            onStepInto: () => this.stepInto(),
            onStepOut: () => this.stepOut(),
            onStop: () => this.stop(),
            onRestart: () => this.restart(),
        });
    }

    /** Recompute button enablement from the current debug session. */
    protected refreshFromSession(): void {
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
            await this.debugSessionService.restart();
            this.refreshFromSession();
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
        super.update();
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