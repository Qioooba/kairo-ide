/**
 * Kairo Debug Module Selector Widget — choose which Maven modules
 * to debug in a multi-module project.
 *
 * Shows a list of detected modules with checkboxes. When a module
 * is selected, breakpoints in that module are active; when deselected,
 * breakpoints in that module are hidden/disabled.
 */

import * as React from 'react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';

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

type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

interface ModuleSelectorViewProps {
    state: ModuleSelectorState;
    onToggleModule: (module: ModuleInfo) => void;
    onSelectAll: () => void;
    onDeselectAll: () => void;
    onRefresh: () => void;
    i18n: KairoI18nService;
}

const ModuleSelectorView: React.FC<ModuleSelectorViewProps> = ({
    state: s, onToggleModule, onSelectAll, onDeselectAll, onRefresh, i18n,
}) => {
    const t: TFunction = React.useCallback((key: KairoI18nKey, params?: Record<string, string | number>) => i18n.t(key, params), [i18n]);
    return (
    <div className="kairo-debug-module-selector">
        <div className="kairo-debug-module-header">
            <span className="kairo-debug-module-title">{t('widget.debug.moduleSelector.modules')}</span>
            <span className="kairo-debug-module-count">
                {t('widget.debug.moduleSelector.activeCount', { active: s.modules.filter(m => m.enabled).length, total: s.modules.length })}
            </span>
            <div className="kairo-debug-module-actions">
                <button
                    className="theia-button secondary"
                    disabled={s.busy || s.modules.length === 0}
                    onClick={s.allEnabled ? onDeselectAll : onSelectAll}
                    title={s.allEnabled ? t('widget.debug.moduleSelector.deselectAll') : t('widget.debug.moduleSelector.selectAll')}
                >
                    {s.allEnabled ? t('widget.debug.moduleSelector.deselectAll') : t('widget.debug.moduleSelector.selectAll')}
                </button>
                <button
                    className="theia-button secondary"
                    disabled={s.busy}
                    onClick={onRefresh}
                    title={t('widget.debug.moduleSelector.refresh')}
                    aria-label={t('widget.debug.moduleSelector.refresh')}
                >
                    <span className={`codicon ${s.busy ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} aria-hidden="true" />
                </button>
            </div>
        </div>

        <div className="kairo-debug-module-body">
            {s.error && (
                <div className="kairo-error-banner" role="alert">
                    <span className="codicon codicon-error" aria-hidden="true" />
                    {s.error}
                </div>
            )}
            {!s.error && s.modules.length === 0 && (
                <div className="kairo-empty-state">
                    <span className="codicon codicon-package" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.debug.moduleSelector.noModulesTitle')}</h3>
                    <p className="kairo-empty-state-reason">{t('widget.debug.moduleSelector.noModulesReason')}</p>
                </div>
            )}
            {s.modules.map(m => (
                <div
                    key={m.name}
                    className="kairo-debug-module-row"
                    style={{ '--kairo-module-opacity': m.enabled ? 1 : 0.5 } as React.CSSProperties}
                >
                    <input
                        type="checkbox"
                        checked={m.enabled}
                        onChange={() => onToggleModule(m)}
                        title={m.enabled ? t('widget.debug.moduleSelector.disableModule', { name: m.name }) : t('widget.debug.moduleSelector.enableModule', { name: m.name })}
                        aria-label={m.enabled ? t('widget.debug.moduleSelector.disableAria', { name: m.name }) : t('widget.debug.moduleSelector.enableAria', { name: m.name })}
                    />
                    <div className="kairo-debug-module-info">
                        <div className="kairo-debug-module-name">
                            <span className="codicon codicon-package" aria-hidden="true" />
                            {m.name}
                        </div>
                        <div className="kairo-debug-module-path">
                            {m.path}
                        </div>
                    </div>
                    <span className="kairo-debug-module-bp">
                        {t('widget.debug.moduleSelector.breakpointCount', { count: m.breakpointCount })}
                    </span>
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
export class KairoDebugModuleSelectorWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    protected state: ModuleSelectorState = { modules: [], allEnabled: true, busy: false, error: null };
    protected readonly onStateChangeEmitter = new Emitter<ModuleSelectorState>();
    readonly onDidStateChange: Event<ModuleSelectorState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugModuleSelectorWidget.ID;
        this.title.label = this.i18n.t('widget.debug.moduleSelector.title');
        this.title.caption = this.i18n.t('widget.debug.moduleSelector.caption');
        this.title.iconClass = 'codicon codicon-package';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
            this.title.label = this.i18n.t('widget.debug.moduleSelector.title');
            this.title.caption = this.i18n.t('widget.debug.moduleSelector.caption');
            this.update();
        }));
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
            i18n: this.i18n,
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