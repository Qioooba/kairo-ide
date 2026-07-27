import * as React from 'react';
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
    onShowConsole?: () => void;
    onShowDebugger?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Toolbar Button                                                      */
/* ------------------------------------------------------------------ */

interface ToolbarIconButtonProps {
    icon: string;
    title: string;
    disabled?: boolean;
    active?: boolean;
    onClick: () => void;
}

const ToolbarIconButton: React.FC<ToolbarIconButtonProps> = ({
    icon, title, disabled, active, onClick,
}) => {
    const [hovered, setHovered] = React.useState(false);

    return (
        <button
            className="kairo-debug-toolbar-btn"
            disabled={disabled}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title={title}
            style={{
                width: 24,
                height: 24,
                minWidth: 24,
                padding: 0,
                border: 'none',
                background: active
                    ? 'var(--theia-toolbar-activeBackground, rgba(255,255,255,0.1))'
                    : hovered && !disabled
                    ? 'var(--theia-toolbar-hoverBackground, rgba(255,255,255,0.08))'
                    : 'transparent',
                color: disabled ? 'var(--theia-disabledForeground)' : 'var(--theia-icon-foreground)',
                cursor: disabled ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 3,
                transition: 'background 0.1s',
            }}
            aria-label={title}
        >
            <span className={`codicon ${icon}`} style={{ fontSize: 16 }} />
        </button>
    );
};

/* ------------------------------------------------------------------ */
/*  Separator                                                           */
/* ------------------------------------------------------------------ */

const ToolbarSeparator: React.FC = () => (
    <div style={{
        width: 1,
        height: 18,
        background: 'var(--theia-panel-border)',
        margin: '0 3px',
        flexShrink: 0,
    }} />
);

/* ------------------------------------------------------------------ */
/*  Thread Selector                                                     */
/* ------------------------------------------------------------------ */

interface ThreadSelectorProps {
    threads: KairoDebugThreadInfo[];
    currentThreadId: number | undefined;
    onSelect: (threadId: number) => void;
}

const ThreadSelector: React.FC<ThreadSelectorProps> = ({ threads, currentThreadId, onSelect }) => {
    if (threads.length === 0) return null;

    const currentThread = threads.find(t => t.id === currentThreadId);
    const displayName = currentThread?.name ?? `Thread ${currentThreadId ?? ''}`;

    return (
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', gap: 4 }}>
            <select
                value={currentThreadId ?? ''}
                onChange={e => onSelect(Number(e.target.value))}
                className="kairo-debug-thread-selector"
                style={{
                    background: 'var(--theia-dropdown-background)',
                    color: 'var(--theia-dropdown-foreground)',
                    border: '1px solid var(--theia-dropdown-border)',
                    borderRadius: 3,
                    padding: '1px 4px',
                    fontSize: '11px',
                    maxWidth: 180,
                    outline: 'none',
                    cursor: 'pointer',
                    height: 22,
                }}
                title="Select thread"
            >
                {threads.map(t => (
                    <option key={t.id} value={t.id}>
                        {t.name}
                    </option>
                ))}
            </select>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Tab Switcher (Debugger / Console)                                   */
/* ------------------------------------------------------------------ */

interface TabSwitcherProps {
    activeTab: 'debugger' | 'console';
    onTabChange: (tab: 'debugger' | 'console') => void;
}

const TabSwitcher: React.FC<TabSwitcherProps> = ({ activeTab, onTabChange }) => (
    <div style={{ display: 'flex', gap: 0 }}>
        {(['debugger', 'console'] as const).map(tab => (
            <button
                key={tab}
                onClick={() => onTabChange(tab)}
                style={{
                    padding: '2px 10px',
                    fontSize: '11px',
                    border: 'none',
                    borderBottom: activeTab === tab
                        ? '2px solid var(--theia-focusBorder)'
                        : '2px solid transparent',
                    background: 'transparent',
                    color: activeTab === tab
                        ? 'var(--theia-foreground)'
                        : 'var(--theia-descriptionForeground)',
                    cursor: 'pointer',
                    fontWeight: activeTab === tab ? 600 : 400,
                    textTransform: 'capitalize',
                }}
            >
                {tab}
            </button>
        ))}
    </div>
);

/* ------------------------------------------------------------------ */
/*  Main Toolbar Component                                              */
/* ------------------------------------------------------------------ */

export const IDEADebugToolbar: React.FC<IDEADebugToolbarProps> = ({
    state,
    onRerun, onResume, onPause, onStop,
    onViewBreakpoints, onMuteBreakpoints,
    onStepOver, onStepInto, onForceStepInto, onStepOut, onRunToCursor,
    onDropFrame, onEvaluateExpression,
    onSelectThread, onShowConsole, onShowDebugger,
}) => {
    const isSuspended = state.isSuspended;
    const hasSession = state.hasSession;
    const isRunning = state.isRunning;

    const buttons: (IDEAToolbarButton | 'sep')[] = [
        {
            id: 'rerun',
            icon: 'codicon-debug-restart',
            label: 'Rerun',
            shortcut: '⌘R',
            group: 0,
            disabled: !hasSession,
            onClick: onRerun,
        },
        {
            id: 'resume',
            icon: 'codicon-debug-continue',
            label: 'Resume Program',
            shortcut: '⌃⌘R',
            group: 0,
            disabled: !isSuspended,
            onClick: onResume,
        },
        {
            id: 'pause',
            icon: 'codicon-debug-pause',
            label: 'Pause Program',
            shortcut: '',
            group: 0,
            disabled: !isRunning,
            onClick: onPause,
        },
        {
            id: 'stop',
            icon: 'codicon-debug-stop',
            label: 'Stop',
            shortcut: '⌘F2',
            group: 0,
            disabled: !hasSession,
            onClick: onStop,
        },
        'sep',
        {
            id: 'viewBreakpoints',
            icon: 'codicon-debug-breakpoint',
            label: 'View Breakpoints',
            shortcut: '⇧⌘F8',
            group: 1,
            onClick: onViewBreakpoints,
        },
        {
            id: 'muteBreakpoints',
            icon: state.breakpointsMuted ? 'codicon-debug-breakpoint-unverified' : 'codicon-debug-breakpoint-muted',
            label: state.breakpointsMuted ? 'Unmute Breakpoints' : 'Mute Breakpoints',
            shortcut: '',
            group: 1,
            active: state.breakpointsMuted,
            onClick: onMuteBreakpoints,
        },
        'sep',
        {
            id: 'stepOver',
            icon: 'codicon-debug-step-over',
            label: 'Step Over',
            shortcut: 'F8',
            group: 2,
            disabled: !isSuspended,
            onClick: onStepOver,
        },
        {
            id: 'stepInto',
            icon: 'codicon-debug-step-into',
            label: 'Step Into',
            shortcut: 'F7',
            group: 2,
            disabled: !isSuspended,
            onClick: onStepInto,
        },
        {
            id: 'forceStepInto',
            icon: 'codicon-debug-step-into',
            label: 'Force Step Into',
            shortcut: '⌥⇧F7',
            group: 2,
            disabled: !isSuspended,
            onClick: onForceStepInto,
        },
        {
            id: 'stepOut',
            icon: 'codicon-debug-step-out',
            label: 'Step Out',
            shortcut: '⇧F8',
            group: 2,
            disabled: !isSuspended,
            onClick: onStepOut,
        },
        {
            id: 'runToCursor',
            icon: 'codicon-debug-continue',
            label: 'Run to Cursor',
            shortcut: '⌥F9',
            group: 2,
            disabled: !isSuspended,
            onClick: onRunToCursor,
        },
        'sep',
        {
            id: 'dropFrame',
            icon: 'codicon-debug-reverse-continue',
            label: 'Drop Frame',
            shortcut: '',
            group: 3,
            disabled: !isSuspended,
            onClick: onDropFrame,
        },
        {
            id: 'evaluate',
            icon: 'codicon-debug-console',
            label: 'Evaluate Expression',
            shortcut: '⌥F8',
            group: 3,
            disabled: !isSuspended,
            onClick: onEvaluateExpression,
        },
    ];

    return (
        <div className="kairo-debug-toolbar-idea">
            <div className="kairo-debug-toolbar-row" style={{
                display: 'flex',
                alignItems: 'center',
                padding: '2px 8px',
                gap: 1,
                background: 'var(--theia-titleBar-activeBackground, var(--theia-editor-background))',
                borderBottom: '1px solid var(--theia-panel-border)',
                minHeight: 30,
            }}>
                {buttons.map((btn, idx) => {
                    if (btn === 'sep') {
                        return <ToolbarSeparator key={`sep-${idx}`} />;
                    }
                    return (
                        <ToolbarIconButton
                            key={btn.id}
                            icon={btn.icon}
                            title={`${btn.label}${btn.shortcut ? ` (${btn.shortcut})` : ''}`}
                            disabled={btn.disabled}
                            active={btn.active}
                            onClick={btn.onClick}
                        />
                    );
                })}
                {onSelectThread && (
                    <ThreadSelector
                        threads={state.threads}
                        currentThreadId={state.threadId}
                        onSelect={onSelectThread}
                    />
                )}
                {state.sessionLabel && (
                    <span style={{
                        fontSize: '10px',
                        color: 'var(--theia-descriptionForeground)',
                        marginLeft: 'auto',
                        marginRight: 4,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 200,
                    }}>
                        {state.sessionLabel}
                    </span>
                )}
            </div>
            {(onShowConsole || onShowDebugger) && (
                <div className="kairo-debug-tab-bar" style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 8px',
                    background: 'var(--theia-editor-background)',
                    borderBottom: '1px solid var(--theia-panel-border)',
                    minHeight: 24,
                }}>
                    <TabSwitcher
                        activeTab={state.isSuspended || !state.hasSession ? 'debugger' : 'debugger'}
                        onTabChange={tab => {
                            if (tab === 'console' && onShowConsole) onShowConsole();
                            if (tab === 'debugger' && onShowDebugger) onShowDebugger();
                        }}
                    />
                </div>
            )}
        </div>
    );
};
