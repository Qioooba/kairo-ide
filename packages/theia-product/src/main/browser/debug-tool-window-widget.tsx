import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { EditorManager } from '@theia/editor/lib/browser';
import { KAIRO_DEBUG_TOOL_WINDOW_FACTORY_ID } from './kairo-factory-ids';
import { KairoDebugSessionService } from './kairo-debug-session-service';
import { IDEADebugToolbar } from './debug-toolbar-idea';
import { IDEAVariablesTree } from './debug-variables-idea';
import { IDEAFramesPanel } from './debug-frames-idea';
import { IDEAWatchesPanel } from './debug-watches-idea';
import { CollapsibleSection } from './debug-collapsible-section';

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface DebugToolWindowViewProps {
    sessionService: KairoDebugSessionService;
    commandService: CommandService;
    editorManager: EditorManager;
}

type TabType = 'debugger' | 'console';

const DebugToolWindowView: React.FC<DebugToolWindowViewProps> = ({ sessionService, commandService, editorManager }) => {
    const [state, setState] = React.useState(sessionService.currentState);
    const [activeTab, setActiveTab] = React.useState<TabType>('debugger');
    const [framesHeight, setFramesHeight] = React.useState(200);

    React.useEffect(() => {
        const disposable = sessionService.onDidChangeState(newState => {
            setState(newState);
            if (newState.isSuspended) {
                setActiveTab('debugger');
            }
        });
        return () => disposable.dispose();
    }, [sessionService]);

    const handleResume = () => commandService.executeCommand('workbench.action.debug.continue');
    const handlePause = () => commandService.executeCommand('workbench.action.debug.pause');
    const handleStop = () => commandService.executeCommand('workbench.action.debug.stop');
    const handleStepOver = () => commandService.executeCommand('workbench.action.debug.stepOver');
    const handleStepInto = () => commandService.executeCommand('workbench.action.debug.stepInto');
    const handleStepOut = () => commandService.executeCommand('workbench.action.debug.stepOut');
    const handleRerun = () => commandService.executeCommand('kairo.debug.restart');
    const handleMuteBreakpoints = () => sessionService.toggleMuteBreakpoints();
    const handleViewBreakpoints = () => commandService.executeCommand('workbench.view.debug');
    const handleRunToCursor = () => commandService.executeCommand('editor.debug.action.runToCursor');
    const handleForceStepInto = () => commandService.executeCommand('workbench.action.debug.stepInto');
    const handleDropFrame = () => commandService.executeCommand('kairo.debug.dropFrame');
    const handleEvaluateExpression = () => commandService.executeCommand('kairo.debug.evaluateExpression');

    const handleNavigate = React.useCallback(async (path: string, line: number) => {
        try {
            const uri = `file://${path}`;
            await editorManager.open(uri as any, {
                selection: { start: { line: line - 1, character: 0 }, end: { line: line - 1, character: 0 } },
                mode: 'activate',
            });
        } catch {
            // ignore navigation errors
        }
    }, [editorManager]);

    // Frames splitter
    const splitterRef = React.useRef<HTMLDivElement>(null);
    const draggingRef = React.useRef(false);
    const startYRef = React.useRef(0);
    const startHeightRef = React.useRef(0);

    const onSplitterMouseDown = React.useCallback((e: React.MouseEvent) => {
        draggingRef.current = true;
        startYRef.current = e.clientY;
        startHeightRef.current = framesHeight;
        e.preventDefault();
    }, [framesHeight]);

    React.useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!draggingRef.current) return;
            const delta = e.clientY - startYRef.current;
            const newHeight = Math.max(60, Math.min(500, startHeightRef.current + delta));
            setFramesHeight(newHeight);
        };
        const onMouseUp = () => {
            draggingRef.current = false;
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    const statusText = React.useMemo(() => {
        if (!state.hasSession) return 'No debug session';
        if (state.isSuspended) {
            if (state.threadName) return `Suspended: ${state.threadName}`;
            return 'Suspended';
        }
        if (state.isRunning) return 'Running';
        return state.debugState;
    }, [state]);

    return (
        <div className="kairo-debug-tool-window" style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            background: 'var(--theia-editor-background)',
            color: 'var(--theia-foreground)',
            overflow: 'hidden',
        }}>
            {/* IDEA-style Toolbar */}
            <IDEADebugToolbar
                state={state}
                onRerun={handleRerun}
                onResume={handleResume}
                onPause={handlePause}
                onStop={handleStop}
                onViewBreakpoints={handleViewBreakpoints}
                onMuteBreakpoints={handleMuteBreakpoints}
                onStepOver={handleStepOver}
                onStepInto={handleStepInto}
                onForceStepInto={handleForceStepInto}
                onStepOut={handleStepOut}
                onRunToCursor={handleRunToCursor}
                onDropFrame={handleDropFrame}
                onEvaluateExpression={handleEvaluateExpression}
                onSelectThread={(_threadId) => {
                    // Switch thread - future enhancement
                }}
                onShowConsole={() => setActiveTab('console')}
                onShowDebugger={() => setActiveTab('debugger')}
            />

            {/* Status bar */}
            <div style={{
                padding: '2px 10px',
                fontSize: '10px',
                color: state.isSuspended
                    ? '#ffc66d'
                    : state.isRunning
                    ? 'var(--theia-successForeground, #6aab73)'
                    : 'var(--theia-descriptionForeground)',
                background: 'var(--theia-statusBar-background, #007acc)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
                borderBottom: '1px solid var(--theia-panel-border)',
                minHeight: 20,
            }}>
                <span className="codicon" style={{ fontSize: 10 }}>
                    {state.isSuspended ? 'codicon-debug-pause' : state.isRunning ? 'codicon-debug-continue' : 'codicon-circle-outline'}
                </span>
                <span>{statusText}</span>
                {state.breakpointsMuted && (
                    <span style={{ color: 'var(--theia-warningForeground)', marginLeft: 'auto' }}>
                        Breakpoints muted
                    </span>
                )}
            </div>

            {/* Tab Bar: Debugger / Console */}
            <div className="kairo-debug-tab-bar" style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--theia-editor-background)',
                borderBottom: '1px solid var(--theia-panel-border)',
                flexShrink: 0,
                padding: '0 4px',
                minHeight: 24,
            }}>
                {(['debugger', 'console'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: '3px 12px',
                            fontSize: '11px',
                            border: 'none',
                            background: 'transparent',
                            color: activeTab === tab
                                ? 'var(--theia-foreground)'
                                : 'var(--theia-descriptionForeground)',
                            cursor: 'pointer',
                            borderBottom: activeTab === tab
                                ? '2px solid var(--theia-focusBorder, #007acc)'
                                : '2px solid transparent',
                            fontWeight: activeTab === tab ? 600 : 400,
                            textTransform: 'capitalize',
                        }}
                    >
                        {tab === 'debugger' ? 'Debugger' : 'Console'}
                    </button>
                ))}
            </div>

            {/* Content area */}
            {activeTab === 'debugger' ? (
                <div style={{
                    flex: 1,
                    display: 'flex',
                    overflow: 'hidden',
                    minHeight: 0,
                }}>
                    {/* Left panel: Frames/Threads + Breakpoints */}
                    <div style={{
                        width: 320,
                        display: 'flex',
                        flexDirection: 'column',
                        borderRight: '1px solid var(--theia-panel-border)',
                        flexShrink: 0,
                        overflow: 'hidden',
                    }}>
                        <div style={{ flex: `0 0 ${framesHeight}px`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                            <CollapsibleSection
                                title="Frames"
                                icon="codicon-callstack"
                                defaultExpanded={true}
                            >
                                <IDEAFramesPanel
                                    sessionService={sessionService}
                                    onNavigate={handleNavigate}
                                />
                            </CollapsibleSection>
                        </div>

                        {/* Horizontal splitter */}
                        <div
                            ref={splitterRef}
                            onMouseDown={onSplitterMouseDown}
                            style={{
                                height: 4,
                                background: 'var(--theia-panel-border)',
                                cursor: 'ns-resize',
                                flexShrink: 0,
                                position: 'relative',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--theia-focusBorder)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'var(--theia-panel-border)')}
                        >
                            <div style={{
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                width: 30,
                                height: 2,
                                background: 'var(--theia-descriptionForeground)',
                                borderRadius: 1,
                                opacity: 0.5,
                            }} />
                        </div>

                        {/* Breakpoints section */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                            <CollapsibleSection
                                title="Breakpoints"
                                icon="codicon-debug-breakpoint"
                                defaultExpanded={true}
                            >
                                <div style={{ padding: '4px 8px', color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                                    View and manage breakpoints from the Breakpoints panel
                                </div>
                            </CollapsibleSection>
                        </div>
                    </div>

                    {/* Right panel: Variables + Watches */}
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        minWidth: 0,
                    }}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                            <CollapsibleSection
                                title="Variables"
                                icon="codicon-symbol-variable"
                                defaultExpanded={true}
                            >
                                <IDEAVariablesTree sessionService={sessionService} />
                            </CollapsibleSection>
                        </div>

                        <div style={{ height: 200, borderTop: '1px solid var(--theia-panel-border)', display: 'flex', flexDirection: 'column', minHeight: 80, flexShrink: 0 }}>
                            <CollapsibleSection
                                title="Watches"
                                icon="codicon-watch"
                                defaultExpanded={true}
                            >
                                <IDEAWatchesPanel sessionService={sessionService} />
                            </CollapsibleSection>
                        </div>
                    </div>
                </div>
            ) : (
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}>
                    <div id="kairo-debug-console-slot" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <div style={{
                            padding: '20px',
                            color: 'var(--theia-descriptionForeground)',
                            fontSize: '11px',
                            textAlign: 'center',
                        }}>
                            Debug Console is available in the bottom panel.
                            <br />
                            <button
                                onClick={() => commandService.executeCommand('kairo.debug.view.console')}
                                style={{
                                    marginTop: 8,
                                    padding: '4px 12px',
                                    background: 'var(--theia-button-background)',
                                    color: 'var(--theia-button-foreground)',
                                    border: 'none',
                                    borderRadius: 3,
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                }}
                            >
                                Open Console
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Widget Class                                                        */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugToolWindowWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_TOOL_WINDOW_FACTORY_ID;
    static readonly LABEL = 'Debug';

    @inject(KairoDebugSessionService)
    protected readonly sessionService!: KairoDebugSessionService;

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugToolWindowWidget.ID;
        this.title.label = KairoDebugToolWindowWidget.LABEL;
        this.title.caption = 'Debug';
        this.title.iconClass = 'codicon codicon-debug-alt';
        this.title.closable = true;
        this.addClass('kairo-debug-tool-window-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return <DebugToolWindowView
            sessionService={this.sessionService}
            commandService={this.commandService}
            editorManager={this.editorManager}
        />;
    }
}
