import * as React from 'react';
import { KairoI18nService } from '@kairo/i18n';
import type { KairoDebugSessionState, KairoDebugThreadInfo } from './kairo-debug-session-service';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface IDEAToolbarButton {
    id: string;
    icon: string;
    label: string;
    shortcut: string;
    group: number;
    disabled?: boolean;
    active?: boolean;
    onClick: () => void;
}

export interface IDEADebugToolbarProps {
    state: KairoDebugSessionState;
    i18n: KairoI18nService;
    onRerun: () => void;
    onResume: () => void;
    onPause: () => void;
    onStop: () => void;
    onViewBreakpoints: () => void;
    onMuteBreakpoints: () => void;
    onStepOver: () => void;
    onStepInto: () => void;
    onForceStepInto: () => void;
    onStepOut: () => void;
    onRunToCursor: () => void;
    onDropFrame: () => void;
    onEvaluateExpression: () => void;
    onSelectThread?: (threadId: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Toolbar Button                                                      */
/* ------------------------------------------------------------------ */

type ToolbarActionTone = 'default' | 'primary' | 'run' | 'pause' | 'stop';

interface ToolbarIconButtonProps {
    icon: string;
    label: string;
    title: string;
    disabled?: boolean;
    active?: boolean;
    tone?: ToolbarActionTone;
    onClick: () => void;
}

const ToolbarIconButton: React.FC<ToolbarIconButtonProps> = ({
    icon, label, title, disabled, active, tone = 'default', onClick,
}) => (
    <button
        className={`kairo-debug-toolbar-btn kairo-debug-toolbar-btn--${tone}${active ? ' active' : ''}`}
        disabled={disabled}
        onClick={onClick}
        title={title}
        aria-label={title}
    >
        <span className={`codicon ${icon}`} aria-hidden="true" />
        <span className="kairo-debug-toolbar-label" aria-hidden="true">{label}</span>
    </button>
);

/* ------------------------------------------------------------------ */
/*  Separator                                                           */
/* ------------------------------------------------------------------ */

const ToolbarSeparator: React.FC = () => (
    <div className="kairo-debug-toolbar-separator" aria-hidden="true" />
);

/* ------------------------------------------------------------------ */
/*  Thread Selector                                                     */
/* ------------------------------------------------------------------ */

interface ThreadSelectorProps {
    threads: KairoDebugThreadInfo[];
    currentThreadId: number | undefined;
    disabled: boolean;
    disabledReason: string;
    onSelect: (threadId: number) => void;
}

const ThreadSelector: React.FC<ThreadSelectorProps & { i18n: KairoI18nService }> = ({ threads, currentThreadId, disabled, disabledReason, onSelect, i18n }) => {
    // UI-05: never offer a clickable control that does nothing. Without a
    // paused session there is no thread to pick, so render nothing; with a
    // session but no thread list yet, render a disabled selector that says why.
    if (threads.length === 0 && disabled) return null;

    const t = React.useCallback((key: string) => i18n.t(key as any), [i18n]);
    const selectLabel = t('debug.toolbar.selectThread');

    return (
        <div className="kairo-debug-thread-selector-wrapper">
            <select
                value={currentThreadId ?? ''}
                onChange={e => onSelect(Number(e.target.value))}
                className="kairo-debug-thread-selector"
                data-testid="debug-thread-selector"
                title={disabled ? disabledReason : selectLabel}
                aria-label={disabled ? disabledReason : selectLabel}
                disabled={disabled || threads.length === 0}
            >
                {threads.length === 0
                    ? <option value="">{disabledReason}</option>
                    : threads.map(th => (
                        <option key={th.id} value={th.id}>
                            {th.name}
                        </option>
                    ))}
            </select>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Main Toolbar Component                                              */
/* ------------------------------------------------------------------ */

export const IDEADebugToolbar: React.FC<IDEADebugToolbarProps> = ({
    state, i18n,
    onRerun, onResume, onPause, onStop,
    onViewBreakpoints, onMuteBreakpoints,
    onStepOver, onStepInto, onForceStepInto, onStepOut, onRunToCursor,
    onDropFrame, onEvaluateExpression,
    onSelectThread,
}) => {
    const t = React.useCallback((key: string) => i18n.t(key as any), [i18n]);
    const isSuspended = state.isSuspended;
    const hasSession = state.hasSession;
    const isRunning = state.isRunning;

    const buttons: (IDEAToolbarButton & { tone?: ToolbarActionTone } | 'sep')[] = [
        {
            id: 'rerun',
            icon: 'codicon-debug-restart',
            label: t('debug.toolbar.rerun'),
            shortcut: t('debug.toolbar.rerunShortcut'),
            group: 0,
            tone: 'run',
            disabled: !hasSession,
            onClick: onRerun,
        },
        {
            id: 'resume',
            icon: 'codicon-debug-continue',
            label: t('debug.toolbar.resume'),
            shortcut: t('debug.toolbar.resumeShortcut'),
            group: 0,
            tone: 'run',
            disabled: !isSuspended,
            onClick: onResume,
        },
        {
            id: 'pause',
            icon: 'codicon-debug-pause',
            label: t('debug.toolbar.pause'),
            shortcut: '',
            group: 0,
            tone: 'pause',
            disabled: !isRunning,
            onClick: onPause,
        },
        {
            id: 'stop',
            icon: 'codicon-debug-stop',
            label: t('debug.toolbar.stop'),
            shortcut: t('debug.toolbar.stopShortcut'),
            group: 0,
            tone: 'stop',
            disabled: !hasSession,
            onClick: onStop,
        },
        'sep',
        {
            id: 'viewBreakpoints',
            icon: 'codicon-debug-breakpoint',
            label: t('debug.toolbar.viewBreakpoints'),
            shortcut: t('debug.toolbar.viewBreakpointsShortcut'),
            group: 1,
            onClick: onViewBreakpoints,
        },
        {
            id: 'muteBreakpoints',
            icon: state.breakpointsMuted ? 'codicon-debug-breakpoint-unverified' : 'codicon-debug-breakpoint-muted',
            label: state.breakpointsMuted ? t('debug.toolbar.unmuteBreakpoints') : t('debug.toolbar.muteBreakpoints'),
            shortcut: '',
            group: 1,
            active: state.breakpointsMuted,
            onClick: onMuteBreakpoints,
        },
        'sep',
        {
            id: 'stepOver',
            icon: 'codicon-debug-step-over',
            label: t('debug.toolbar.stepOver'),
            shortcut: t('debug.toolbar.stepOverShortcut'),
            group: 2,
            tone: 'primary',
            disabled: !isSuspended,
            onClick: onStepOver,
        },
        {
            id: 'stepInto',
            icon: 'codicon-debug-step-into',
            label: t('debug.toolbar.stepInto'),
            shortcut: t('debug.toolbar.stepIntoShortcut'),
            group: 2,
            tone: 'primary',
            disabled: !isSuspended,
            onClick: onStepInto,
        },
        {
            id: 'forceStepInto',
            icon: 'codicon-debug-step-into',
            label: t('debug.toolbar.forceStepInto'),
            shortcut: t('debug.toolbar.forceStepIntoShortcut'),
            group: 2,
            tone: 'primary',
            disabled: !isSuspended,
            onClick: onForceStepInto,
        },
        {
            id: 'stepOut',
            icon: 'codicon-debug-step-out',
            label: t('debug.toolbar.stepOut'),
            shortcut: t('debug.toolbar.stepOutShortcut'),
            group: 2,
            tone: 'primary',
            disabled: !isSuspended,
            onClick: onStepOut,
        },
        {
            id: 'runToCursor',
            icon: 'codicon-debug-continue',
            label: t('debug.toolbar.runToCursor'),
            shortcut: t('debug.toolbar.runToCursorShortcut'),
            group: 2,
            tone: 'run',
            disabled: !isSuspended,
            onClick: onRunToCursor,
        },
        'sep',
        {
            id: 'dropFrame',
            icon: 'codicon-debug-reverse-continue',
            label: t('debug.toolbar.dropFrame'),
            shortcut: '',
            group: 3,
            disabled: !isSuspended,
            onClick: onDropFrame,
        },
        {
            id: 'evaluate',
            icon: 'codicon-debug-console',
            label: t('debug.toolbar.evaluateExpression'),
            shortcut: t('debug.toolbar.evaluateExpressionShortcut'),
            group: 3,
            disabled: !isSuspended,
            onClick: onEvaluateExpression,
        },
    ];

    return (
        <div className="kairo-debug-toolbar-idea">
            <div className="kairo-debug-toolbar-row">
                {buttons.map((btn, idx) => {
                    if (btn === 'sep') {
                        return <ToolbarSeparator key={`sep-${idx}`} />;
                    }
                    return (
                        <ToolbarIconButton
                            key={btn.id}
                            icon={btn.icon}
                            label={btn.label}
                            title={`${btn.label}${btn.shortcut ? ` (${btn.shortcut})` : ''}`}
                            disabled={btn.disabled}
                            active={btn.active}
                            tone={btn.tone}
                            onClick={btn.onClick}
                        />
                    );
                })}
                {onSelectThread && (
                    <ThreadSelector
                        threads={state.threads}
                        currentThreadId={state.threadId}
                        disabled={!isSuspended}
                        disabledReason={t('debug.toolWindow.sessionNotPaused')}
                        onSelect={onSelectThread}
                        i18n={i18n}
                    />
                )}
                {state.sessionLabel && (
                    <span className="kairo-debug-toolbar-session-label" title={state.sessionLabel}>
                        {state.sessionLabel}
                    </span>
                )}
            </div>
        </div>
    );
};
