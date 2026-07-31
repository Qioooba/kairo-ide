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
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';

export const KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID = 'kairo-debug-breakpoints';

type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

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
    t: TFunction;
    onToggle: (bp: BreakpointDisplayInfo) => void;
    onRemove: (bp: BreakpointDisplayInfo) => void;
    onToggleAll: () => void;
    onRefresh: () => void;
}

const BreakpointsView: React.FC<BreakpointsViewProps> = ({
    state, openerService, t, onToggle, onRemove, onToggleAll, onRefresh,
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
        <div className="kairo-debug-breakpoints-widget">
            {/* Header */}
            <div className="kairo-debug-bp-toolbar">
                <span className="kairo-debug-bp-title">{t('widget.debug.breakpoints.title')}</span>
                <span className="kairo-debug-bp-count">
                    {t('widget.debug.breakpoints.items', { count: state.breakpoints.length })}
                </span>
                <div className="kairo-debug-bp-spacer" />
                <button
                    className="theia-button secondary kairo-debug-bp-toolbar-btn"
                    disabled={state.busy || state.breakpoints.length === 0}
                    onClick={onToggleAll}
                    title={state.allEnabled ? t('widget.debug.breakpoints.disableAll') : t('widget.debug.breakpoints.enableAll')}
                >
                    {state.allEnabled ? t('widget.debug.breakpoints.disableAll') : t('widget.debug.breakpoints.enableAll')}
                </button>
                <button
                    className="theia-button secondary kairo-debug-bp-toolbar-btn"
                    disabled={state.busy}
                    onClick={onRefresh}
                    title={t('widget.debug.breakpoints.refreshTooltip')}
                >
                    {state.busy ? '...' : '↻'}
                </button>
            </div>

            {/* Body */}
            <div className="kairo-debug-bp-body">
                {state.error && (
                    <div className="kairo-debug-bp-error">
                        {state.error}
                    </div>
                )}
                {!state.error && !state.busy && state.breakpoints.length === 0 && (
                    <div className="kairo-empty-state kairo-debug-bp-empty">
                        <span className="kairo-empty-state-glyph codicon codicon-debug-breakpoint" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{t('widget.debug.breakpoints.emptyTitle')}</h3>
                        <p className="kairo-empty-state-reason">
                            {t('widget.debug.breakpoints.emptyReason')}
                        </p>
                    </div>
                )}
                {state.breakpoints.map(bp => (
                    <div
                        key={bp.id}
                        className={`kairo-debug-bp-row ${bp.enabled ? '' : 'kairo-debug-bp-disabled'}`}
                    >
                        {/* Toggle checkbox */}
                        <input
                            type="checkbox"
                            className="kairo-debug-bp-checkbox"
                            checked={bp.enabled}
                            onChange={() => onToggle(bp)}
                            title={bp.enabled ? t('widget.debug.breakpoints.disableTooltip') : t('widget.debug.breakpoints.enableTooltip')}
                            aria-label={`${bp.enabled ? t('widget.debug.breakpoints.disableTooltip') : t('widget.debug.breakpoints.enableTooltip')} ${bp.fileName}:${bp.line}`}
                        />

                        {/* Main content */}
                        <div className="kairo-debug-bp-main" onClick={() => handleClick(bp)}>
                            <div className="kairo-debug-bp-location">
                                <span className={`codicon codicon-circle-filled kairo-debug-bp-icon ${bp.enabled ? 'enabled' : 'disabled'}`} />
                                {bp.fileName}:{bp.line}
                            </div>
                            {bp.condition && (
                                <div className="kairo-debug-bp-meta">
                                    <span className="codicon codicon-symbol-operator kairo-debug-bp-meta-icon" />
                                    {t('widget.debug.breakpoints.condition', { condition: bp.condition })}
                                </div>
                            )}
                            {bp.hitCondition && (
                                <div className="kairo-debug-bp-meta">
                                    <span className="codicon codicon-debug-hint kairo-debug-bp-meta-icon" />
                                    {t('widget.debug.breakpoints.hitCount', { hitCount: bp.hitCondition })}
                                </div>
                            )}
                            {bp.logMessage && (
                                <div className="kairo-debug-bp-meta">
                                    <span className="codicon codicon-output kairo-debug-bp-meta-icon" />
                                    {t('widget.debug.breakpoints.logMessage', { logMessage: bp.logMessage })}
                                </div>
                            )}
                            {bp.message && (
                                <div className="kairo-debug-bp-message">
                                    {bp.message}
                                </div>
                            )}
                        </div>

                        {/* Remove button */}
                        <button
                            className="theia-button secondary kairo-debug-bp-remove"
                            onClick={(e) => { e.stopPropagation(); onRemove(bp); }}
                            title={t('widget.debug.breakpoints.removeTooltip')}
                            aria-label={`${t('widget.debug.breakpoints.removeTooltip')} ${bp.fileName}:${bp.line}`}
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

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    protected state: BreakpointsState = { breakpoints: [], busy: false, error: null, allEnabled: true };
    protected readonly onStateChangeEmitter = new Emitter<BreakpointsState>();
    readonly onDidStateChange: Event<BreakpointsState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        this.id = KairoDebugBreakpointsWidget.ID;
        this.title.label = t('widget.debug.breakpoints.title');
        this.title.caption = t('widget.debug.breakpoints.caption');
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
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        return React.createElement(BreakpointsView, {
            state: this.state,
            openerService: this.openerService,
            t,
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
