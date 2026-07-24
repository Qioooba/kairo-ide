/**
 * Kairo Debug Module Selector Widget — choose which Maven modules
 * to debug in a multi-module project.
 *
 * Shows a list of detected modules with checkboxes. When a module
 * is selected, breakpoints in that module are active; when deselected,
 * breakpoints in that module are hidden/disabled.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';

export const KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID = 'kairo-debug-module-selector';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface ModuleInfo {
    name: string;
    path: string;
    sourceRoot: string;
    breakpointCount: number;
    enabled: boolean;
}

export interface ModuleSelectorState {
    modules: ModuleInfo[];
    allEnabled: boolean;
    busy: boolean;
    error: string | null;
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface ModuleSelectorViewProps {
    state: ModuleSelectorState;
    onToggleModule: (module: ModuleInfo) => void;
    onSelectAll: () => void;
    onDeselectAll: () => void;
    onRefresh: () => void;
}

const ModuleSelectorView: React.FC<ModuleSelectorViewProps> = ({
    state: s, onToggleModule, onSelectAll, onDeselectAll, onRefresh,
}) => (
    <div className="kairo-debug-module-selector" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '12px' }}>Modules</span>
            <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                {s.modules.filter(m => m.enabled).length}/{s.modules.length} active
            </span>
            <div style={{ flex: 1 }} />
            <button
                className="theia-button secondary"
                disabled={s.busy || s.modules.length === 0}
                onClick={s.allEnabled ? onDeselectAll : onSelectAll}
                style={{ padding: '1px 8px', fontSize: '11px' }}
                title={s.allEnabled ? 'Deselect all modules' : 'Select all modules'}
            >
                {s.allEnabled ? 'Deselect All' : 'Select All'}
            </button>
            <button
                className="theia-button secondary"
                disabled={s.busy}
                onClick={onRefresh}
                style={{ padding: '1px 8px', fontSize: '11px' }}
                title="Refresh modules"
            >
                {s.busy ? '...' : '↻'}
            </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto' }}>
            {s.error && (
                <div style={{ padding: '8px 12px', color: 'var(--theia-errorForeground)', fontSize: '12px' }}>
                    {s.error}
                </div>
            )}
            {!s.error && s.modules.length === 0 && (
                <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                    No modules detected. Open a multi-module project to use this feature.
                </div>
            )}
            {s.modules.map(m => (
                <div
                    key={m.name}
                    className="kairo-debug-module-row"
                    style={{
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '12px',
                        lineHeight: '20px',
                        opacity: m.enabled ? 1 : 0.5,
                        borderBottom: '1px solid var(--theia-panel-border)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                    <input
                        type="checkbox"
                        checked={m.enabled}
                        onChange={() => onToggleModule(m)}
                        style={{ flexShrink: 0, cursor: 'pointer' }}
                        title={m.enabled ? `Disable module ${m.name}` : `Enable module ${m.name}`}
                        aria-label={`${m.enabled ? 'Disable' : 'Enable'} module ${m.name}`}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span className="codicon codicon-package" style={{ fontSize: '12px', marginRight: 4, opacity: 0.7 }} />
                            {m.name}
                        </div>
                        <div style={{ fontSize: '10px', opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.path}
                        </div>
                    </div>
                    <span style={{
                        fontSize: '10px',
                        padding: '0 4px',
                        borderRadius: 3,
                        background: 'var(--theia-badge-background)',
                        color: 'var(--theia-badge-foreground)',
                        flexShrink: 0,
                    }}>
                        {m.breakpointCount} bp
                    </span>
                </div>
            ))}
        </div>
    </div>
);

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugModuleSelectorWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID;

    protected state: ModuleSelectorState = { modules: [], allEnabled: true, busy: false, error: null };
    protected readonly onStateChangeEmitter = new Emitter<ModuleSelectorState>();
    readonly onDidStateChange: Event<ModuleSelectorState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugModuleSelectorWidget.ID;
        this.title.label = 'Modules';
        this.title.caption = 'Kairo Debug Module Selector';
        this.title.iconClass = 'codicon codicon-package';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();
    }

    protected onAfterShow(): void {
        this.refresh();
    }

    protected render(): React.ReactNode {
        return React.createElement(ModuleSelectorView, {
            state: this.state,
            onToggleModule: (m: ModuleInfo) => this.toggleModule(m),
            onSelectAll: () => this.selectAll(),
            onDeselectAll: () => this.deselectAll(),
            onRefresh: () => this.refresh(),
        });
    }

    refresh(): void {
        try {
            // Fetch modules from the Java debug service
            this.setState({
                modules: this.state.modules,
                allEnabled: this.state.modules.length > 0 && this.state.modules.every(m => m.enabled),
                busy: false,
                error: null,
            });
        } catch (error) {
            this.setState({
                modules: [],
                allEnabled: true,
                busy: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    setModules(modules: ModuleInfo[]): void {
        this.setState({
            modules,
            allEnabled: modules.length > 0 && modules.every(m => m.enabled),
            busy: false,
            error: null,
        });
    }

    protected toggleModule(module: ModuleInfo): void {
        const updated = this.state.modules.map(m =>
            m.name === module.name ? { ...m, enabled: !m.enabled } : m,
        );
        this.setState({
            modules: updated,
            allEnabled: updated.length > 0 && updated.every(m => m.enabled),
            busy: false,
            error: null,
        });
    }

    protected selectAll(): void {
        const updated = this.state.modules.map(m => ({ ...m, enabled: true }));
        this.setState({ modules: updated, allEnabled: true, busy: false, error: null });
    }

    protected deselectAll(): void {
        const updated = this.state.modules.map(m => ({ ...m, enabled: false }));
        this.setState({ modules: updated, allEnabled: false, busy: false, error: null });
    }

    protected setState(partial: Partial<ModuleSelectorState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChangeEmitter.fire(this.state);
        this.update();
    }
}