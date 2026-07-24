/**
 * Kairo Debug Breakpoints Widget — list of all breakpoints with
 * enable/disable toggle, remove button, and condition display.
 *
 * This widget provides a consolidated view of all Java breakpoints
 * with fast toggle and management controls. It complements the native
 * Theia DebugBreakpointsWidget with Kairo-specific enhancements.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import URI from '@theia/core/lib/common/uri';
import { BreakpointManager } from '@theia/debug/lib/browser/breakpoint/breakpoint-manager';
import { DebugSourceBreakpoint } from '@theia/debug/lib/browser/model/debug-source-breakpoint';

export const KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID = 'kairo-debug-breakpoints';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface BreakpointDisplayInfo {
    id: string;
    uri: string;
    fileName: string;
    line: number;
    enabled: boolean;
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
    message?: string;
}

export interface BreakpointsState {
    breakpoints: BreakpointDisplayInfo[];
    busy: boolean;
    error: string | null;
    allEnabled: boolean;
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface BreakpointsViewProps {
    state: BreakpointsState;
    openerService: OpenerService;
    onToggle: (bp: BreakpointDisplayInfo) => void;
    onRemove: (bp: BreakpointDisplayInfo) => void;
    onToggleAll: () => void;
    onRefresh: () => void;
}

const BreakpointsView: React.FC<BreakpointsViewProps> = ({
    state, openerService, onToggle, onRemove, onToggleAll, onRefresh,
}) => {
    const handleClick = (bp: BreakpointDisplayInfo) => {
        try {
            const uri = new URI(bp.uri);
            open(openerService, uri, {
                selection: {
                    start: { line: Math.max(0, bp.line - 1), character: 0 },
                    end: { line: Math.max(0, bp.line - 1), character: 0 },
                },
            });
        } catch {
            // Silently ignore navigation errors
        }
    };

    return (
        <div className="kairo-debug-breakpoints-widget" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '12px' }}>Breakpoints</span>
                <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                    {state.breakpoints.length} items
                </span>
                <div style={{ flex: 1 }} />
                <button
                    className="theia-button secondary"
                    disabled={state.busy || state.breakpoints.length === 0}
                    onClick={onToggleAll}
                    style={{ padding: '1px 8px', fontSize: '11px' }}
                    title={state.allEnabled ? 'Disable all breakpoints' : 'Enable all breakpoints'}
                >
                    {state.allEnabled ? 'Disable All' : 'Enable All'}
                </button>
                <button
                    className="theia-button secondary"
                    disabled={state.busy}
                    onClick={onRefresh}
                    style={{ padding: '1px 8px', fontSize: '11px' }}
                    title="Refresh breakpoints"
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
                {!state.error && !state.busy && state.breakpoints.length === 0 && (
                    <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                        No breakpoints set. Click in the editor gutter to add breakpoints.
                    </div>
                )}
                {state.breakpoints.map(bp => (
                    <div
                        key={bp.id}
                        className="kairo-debug-bp-row"
                        style={{
                            padding: '4px 8px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 6,
                            fontSize: '12px',
                            lineHeight: '18px',
                            opacity: bp.enabled ? 1 : 0.5,
                            borderBottom: '1px solid var(--theia-panel-border)',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                    >
                        {/* Toggle checkbox */}
                        <input
                            type="checkbox"
                            checked={bp.enabled}
                            onChange={() => onToggle(bp)}
                            style={{ marginTop: 2, flexShrink: 0, cursor: 'pointer' }}
                            title={bp.enabled ? 'Disable breakpoint' : 'Enable breakpoint'}
                            aria-label={`${bp.enabled ? 'Disable' : 'Enable'} breakpoint at ${bp.fileName}:${bp.line}`}
                        />

                        {/* Main content */}
                        <div style={{ minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={() => handleClick(bp)}>
                            <div style={{
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}>
                                <span className="codicon codicon-circle-filled" style={{
                                    fontSize: '10px',
                                    color: bp.enabled ? 'var(--theia-debugIcon-breakpointForeground)' : 'var(--theia-descriptionForeground)',
                                    marginRight: 4,
                                }} />
                                {bp.fileName}:{bp.line}
                            </div>
                            {bp.condition && (
                                <div style={{
                                    fontSize: '11px',
                                    opacity: 0.7,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    paddingLeft: 16,
                                }}>
                                    <span className="codicon codicon-symbol-operator" style={{ fontSize: '11px', marginRight: 2 }} />
                                    Condition: {bp.condition}
                                </div>
                            )}
                            {bp.hitCondition && (
                                <div style={{
                                    fontSize: '11px',
                                    opacity: 0.7,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    paddingLeft: 16,
                                }}>
                                    <span className="codicon codicon-debug-hint" style={{ fontSize: '11px', marginRight: 2 }} />
                                    Hit count: {bp.hitCondition}
                                </div>
                            )}
                            {bp.logMessage && (
                                <div style={{
                                    fontSize: '11px',
                                    opacity: 0.7,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    paddingLeft: 16,
                                }}>
                                    <span className="codicon codicon-output" style={{ fontSize: '11px', marginRight: 2 }} />
                                    Log: {bp.logMessage}
                                </div>
                            )}
                            {bp.message && (
                                <div style={{
                                    fontSize: '11px',
                                    color: 'var(--theia-errorForeground)',
                                    paddingLeft: 16,
                                }}>
                                    {bp.message}
                                </div>
                            )}
                        </div>

                        {/* Remove button */}
                        <button
                            className="theia-button secondary"
                            onClick={(e) => { e.stopPropagation(); onRemove(bp); }}
                            style={{ padding: '0 6px', fontSize: '14px', lineHeight: '18px', flexShrink: 0 }}
                            title="Remove breakpoint"
                            aria-label={`Remove breakpoint at ${bp.fileName}:${bp.line}`}
                        >
                            ×
                        </button>
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
export class KairoDebugBreakpointsWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID;

    @inject(BreakpointManager)
    protected readonly breakpointManager!: BreakpointManager;

    @inject(OpenerService)
    protected readonly openerService!: OpenerService;

    protected state: BreakpointsState = { breakpoints: [], busy: false, error: null, allEnabled: true };
    protected readonly onStateChangeEmitter = new Emitter<BreakpointsState>();
    readonly onDidStateChange: Event<BreakpointsState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugBreakpointsWidget.ID;
        this.title.label = 'Breakpoints';
        this.title.caption = 'Kairo Java Debug Breakpoints';
        this.title.iconClass = 'codicon codicon-debug-breakpoint';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.breakpointManager.onDidChangeBreakpoints(() => this.refresh());
        this.breakpointManager.onDidChangeMarkers(() => this.refresh());
    }

    protected onAfterShow(): void {
        this.refresh();
    }

    protected render(): React.ReactNode {
        return React.createElement(BreakpointsView, {
            state: this.state,
            openerService: this.openerService,
            onToggle: (bp: BreakpointDisplayInfo) => this.toggleBreakpoint(bp),
            onRemove: (bp: BreakpointDisplayInfo) => this.removeBreakpoint(bp),
            onToggleAll: () => this.toggleAll(),
            onRefresh: () => this.refresh(),
        });
    }

    refresh(): void {
        try {
            const breakpoints = this.breakpointManager.getBreakpoints();
            const javaBps = breakpoints.filter((bp): bp is DebugSourceBreakpoint => {
                const uri = bp.uri?.toString() ?? '';
                return uri.endsWith('.java');
            });

            const displayBps: BreakpointDisplayInfo[] = javaBps.map(bp => {
                const uri = bp.uri?.toString() ?? '';
                const fileName = uri.split('/').pop()?.split('\\').pop() ?? 'Unknown';
                return {
                    id: bp.id,
                    uri,
                    fileName,
                    line: bp.line ?? bp.raw?.line ?? 0,
                    enabled: bp.enabled,
                    condition: bp.condition,
                    hitCondition: bp.hitCondition,
                    logMessage: bp.logMessage,
                    message: bp.raw?.message,
                };
            });

            this.setState({
                breakpoints: displayBps,
                busy: false,
                error: null,
                allEnabled: this.breakpointManager.breakpointsEnabled,
            });
        } catch (error) {
            this.setState({
                breakpoints: [],
                busy: false,
                error: error instanceof Error ? error.message : String(error),
                allEnabled: true,
            });
        }
    }

    protected toggleBreakpoint(bp: BreakpointDisplayInfo): void {
        try {
            const debugBp = this.breakpointManager.getBreakpointById(bp.id);
            if (debugBp) {
                this.breakpointManager.enableBreakpoint(debugBp, !bp.enabled);
            }
        } catch {
            // Silently ignore
        }
    }

    protected removeBreakpoint(bp: BreakpointDisplayInfo): void {
        try {
            const debugBp = this.breakpointManager.getBreakpointById(bp.id);
            if (debugBp instanceof DebugSourceBreakpoint) {
                this.breakpointManager.removeBreakpoint(debugBp);
            }
        } catch {
            // Silently ignore
        }
    }

    protected toggleAll(): void {
        this.breakpointManager.breakpointsEnabled = !this.breakpointManager.breakpointsEnabled;
    }

    protected setState(partial: Partial<BreakpointsState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChangeEmitter.fire(this.state);
        this.update();
    }
}