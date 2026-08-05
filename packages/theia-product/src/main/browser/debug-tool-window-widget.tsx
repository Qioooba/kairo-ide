import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { EditorManager } from '@theia/editor/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
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
    i18n: KairoI18nService;
    workspaceKey: string;
}

const DebugToolWindowView: React.FC<DebugToolWindowViewProps> = ({ sessionService, commandService, editorManager, i18n, workspaceKey }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const [state, setState] = React.useState(sessionService.currentState);
    const [framesHeight, setFramesHeight] = React.useState(200);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    React.useEffect(() => {
        const disposable = sessionService.onDidChangeState(newState => {
            setState(newState);
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
    const handleStartDebugging = () => commandService.executeCommand('kairo.debug.openView');

    const handleNavigate = React.useCallback(async (path: string, line: number) => {
        try {
            const uri = path.includes('://') ? new URI(path) : URI.fromFilePath(path);
            await editorManager.open(uri, {
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
        if (!state.hasSession) return t('debug.toolWindow.noSession');
        if (state.isSuspended) {
            if (state.threadName) return t('debug.toolWindow.suspendedThread', { threadName: state.threadName });
            return t('debug.toolWindow.suspended');
        }
        if (state.isRunning) return t('debug.toolWindow.running');
        return state.debugState;
    }, [state, t]);

    const statusIcon = state.isSuspended ? 'codicon-debug-pause' : state.isRunning ? 'codicon-debug-continue' : 'codicon-circle-outline';
    const statusClass = state.isSuspended ? 'suspended' : state.isRunning ? 'running' : 'inactive';

    return (
        <div className="kairo-debug-tool-window">
            {/* IDEA-style Toolbar */}
            <IDEADebugToolbar
                state={state}
                i18n={i18n}
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
            />

            {/* Status bar */}
            <div className={`kairo-debug-status-bar ${statusClass}`} role="status" aria-live="polite">
                <span className={`codicon ${statusIcon}`} aria-hidden="true" />
                <span>{statusText}</span>
                {state.breakpointsMuted && (
                    <span className="kairo-debug-status-muted">
                        {t('debug.toolWindow.breakpointsMuted')}
                    </span>
                )}
            </div>

            {/* Content area */}
            {!state.hasSession ? (
                <div className="kairo-empty-state">
                    <div className="kairo-empty-state-glyph">
                        <span className="codicon codicon-debug-alt" aria-hidden="true" />
                    </div>
                    <h3 className="kairo-empty-state-title">{t('debug.toolWindow.noSession')}</h3>
                    <p className="kairo-empty-state-reason">
                        {t('debug.toolWindow.emptyStateReason')}
                    </p>
                    <div className="kairo-empty-state-action">
                        <button
                            className="theia-button"
                            onClick={handleStartDebugging}
                            data-testid="debug-empty-start"
                        >
                            {t('command.openDebugView')}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="kairo-debug-panels">
                    {/* Left panel: Frames/Threads + Breakpoints */}
                    <div className="kairo-debug-left-panel">
                        <div className="kairo-debug-panel-frames" style={{ '--kairo-debug-frames-height': `${framesHeight}px` } as React.CSSProperties}>
                            <CollapsibleSection
                                title={t('debug.toolWindow.frames')}
                                icon="codicon-callstack"
                                defaultExpanded={true}
                            >
                                <IDEAFramesPanel
                                    sessionService={sessionService}
                                    i18n={i18n}
                                    onNavigate={handleNavigate}
                                />
                            </CollapsibleSection>
                        </div>

                        {/* Horizontal splitter */}
                        <div
                            ref={splitterRef}
                            onMouseDown={onSplitterMouseDown}
                            className="kairo-debug-splitter"
                        >
                            <div className="kairo-debug-splitter-grip" />
                        </div>

                        {/* Breakpoints section */}
                        <div className="kairo-debug-panel-breakpoints">
                            <CollapsibleSection
                                title={t('debug.toolWindow.breakpoints')}
                                icon="codicon-debug-breakpoint"
                                defaultExpanded={true}
                            >
                                <div className="kairo-debug-breakpoints-placeholder">
                                    {t('debug.toolWindow.breakpointsPlaceholder')}
                                </div>
                            </CollapsibleSection>
                        </div>
                    </div>

                    {/* Right panel: Variables + Watches */}
                    <div className="kairo-debug-right-panel">
                        <div className="kairo-debug-panel-variables">
                            <CollapsibleSection
                                title={t('debug.toolWindow.variables')}
                                icon="codicon-symbol-variable"
                                defaultExpanded={true}
                            >
                                <IDEAVariablesTree sessionService={sessionService} i18n={i18n} />
                            </CollapsibleSection>
                        </div>

                        <div className="kairo-debug-panel-watches">
                            <CollapsibleSection
                                title={t('debug.toolWindow.watches')}
                                icon="codicon-watch"
                                defaultExpanded={true}
                            >
                                <IDEAWatchesPanel sessionService={sessionService} i18n={i18n} workspaceKey={workspaceKey} />
                            </CollapsibleSection>
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

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugToolWindowWidget.ID;
        this.updateTitle();
        this.title.caption = 'Debug';
        this.title.iconClass = 'codicon codicon-debug-alt';
        this.title.closable = true;
        this.addClass('kairo-debug-tool-window-widget');
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
        this.update();
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.debug.toolbar.title');
    }

    protected render(): React.ReactNode {
        const workspaceKey = this.workspaceContext.context?.workspaceId || 'default';
        return <DebugToolWindowView
            sessionService={this.sessionService}
            commandService={this.commandService}
            editorManager={this.editorManager}
            i18n={this.i18n}
            workspaceKey={workspaceKey}
        />;
    }
}
