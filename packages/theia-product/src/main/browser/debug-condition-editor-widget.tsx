/**
 * Kairo Debug Condition Editor Widget — input field for editing
 * breakpoint conditions with AND/OR/NOT expression support.
 *
 * Provides a text editor for complex condition expressions, a
 * dropdown for selecting filter types (instance, thread, stack depth),
 * and real-time validation feedback.
 */

import * as React from 'react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';

export const KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID = 'kairo-debug-condition-editor';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type FilterType = 'condition' | 'thread' | 'instance' | 'stackDepth' | 'hitCount';

export interface ConditionEditorState {
    breakpointId: string;
    condition: string;
    filterType: FilterType;
    threadFilter: string;
    instanceFilter: string;
    stackDepthMin: number;
    stackDepthMax: number;
    hitCountMode: string;
    hitCountTarget: number;
    isValid: boolean;
    validationMessage: string;
    busy: boolean;
    error: string | null;
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

interface ConditionEditorViewProps {
    state: ConditionEditorState;
    onConditionChange: (value: string) => void;
    onFilterTypeChange: (type: FilterType) => void;
    onThreadFilterChange: (value: string) => void;
    onInstanceFilterChange: (value: string) => void;
    onStackDepthChange: (min: number, max: number) => void;
    onHitCountChange: (mode: string, target: number) => void;
    onApply: () => void;
    onClear: () => void;
    i18n: KairoI18nService;
}

const FilterTypeTabs: React.FC<{
    active: FilterType;
    onChange: (type: FilterType) => void;
    t: TFunction;
}> = ({ active, onChange, t }) => {
    const tabs: { type: FilterType; labelKey: KairoI18nKey; icon: string }[] = [
        { type: 'condition', labelKey: 'widget.debug.conditionEditor.conditionTab', icon: 'codicon-symbol-operator' },
        { type: 'thread', labelKey: 'widget.debug.conditionEditor.threadTab', icon: 'codicon-debug-console' },
        { type: 'instance', labelKey: 'widget.debug.conditionEditor.instanceTab', icon: 'codicon-symbol-class' },
        { type: 'stackDepth', labelKey: 'widget.debug.conditionEditor.stackTab', icon: 'codicon-callstack-view' },
        { type: 'hitCount', labelKey: 'widget.debug.conditionEditor.hitCountTab', icon: 'codicon-debug-hint' },
    ];

    return (
        <div className="kairo-debug-condition-tabs">
            {tabs.map(tab => (
                <button
                    key={tab.type}
                    className={`kairo-debug-condition-tab${active === tab.type ? ' active' : ''}`}
                    onClick={() => onChange(tab.type)}
                    title={t(tab.labelKey)}
                >
                    <span className={`codicon ${tab.icon}`} aria-hidden="true" />
                    {t(tab.labelKey)}
                </button>
            ))}
        </div>
    );
};

const ConditionEditorView: React.FC<ConditionEditorViewProps> = ({
    state: s, onConditionChange, onFilterTypeChange, onThreadFilterChange,
    onInstanceFilterChange, onStackDepthChange, onHitCountChange,
    onApply, onClear, i18n,
}) => {
    const t: TFunction = React.useCallback((key: KairoI18nKey, params?: Record<string, string | number>) => i18n.t(key, params), [i18n]);
    return (
    <div className="kairo-debug-condition-editor">
        <div className="kairo-debug-condition-header">
            <span className="kairo-debug-condition-title">{t('widget.debug.conditionEditor.title')}</span>
            {s.breakpointId && (
                <span className="kairo-debug-condition-bp">
                    {t('widget.debug.conditionEditor.bp', { id: s.breakpointId })}
                </span>
            )}
            <div className="kairo-debug-condition-actions">
                <button
                    className="theia-button secondary"
                    disabled={s.busy}
                    onClick={onClear}
                    title={t('widget.debug.conditionEditor.clear')}
                >
                    {t('widget.debug.conditionEditor.clear')}
                </button>
                <button
                    className="theia-button main"
                    disabled={s.busy || !s.isValid}
                    onClick={onApply}
                    title={t('widget.debug.conditionEditor.apply')}
                >
                    {s.busy ? t('widget.debug.conditionEditor.applying') : t('widget.debug.conditionEditor.apply')}
                </button>
            </div>
        </div>

        <FilterTypeTabs active={s.filterType} onChange={onFilterTypeChange} t={t} />

        <div className="kairo-debug-condition-body">
            {s.filterType === 'condition' && (
                <div className="kairo-debug-condition-field">
                    <label className="kairo-debug-condition-label">{t('widget.debug.conditionEditor.expressionLabel')}</label>
                    <textarea
                        className="kairo-debug-condition-textarea"
                        value={s.condition}
                        onChange={e => onConditionChange(e.target.value)}
                        placeholder={t('widget.debug.conditionEditor.expressionPlaceholder')}
                        rows={4}
                        aria-label={t('widget.debug.conditionEditor.expressionAria')}
                    />
                    <div className="kairo-debug-condition-hint">{t('widget.debug.conditionEditor.expressionHint')}</div>
                </div>
            )}

            {s.filterType === 'thread' && (
                <div className="kairo-debug-condition-field">
                    <label className="kairo-debug-condition-label">{t('widget.debug.conditionEditor.threadLabel')}</label>
                    <input
                        className="kairo-debug-condition-input"
                        type="text"
                        value={s.threadFilter}
                        onChange={e => onThreadFilterChange(e.target.value)}
                        placeholder={t('widget.debug.conditionEditor.threadPlaceholder')}
                        aria-label={t('widget.debug.conditionEditor.threadAria')}
                    />
                    <div className="kairo-debug-condition-hint">{t('widget.debug.conditionEditor.threadHint')}</div>
                </div>
            )}

            {s.filterType === 'instance' && (
                <div className="kairo-debug-condition-field">
                    <label className="kairo-debug-condition-label">{t('widget.debug.conditionEditor.instanceLabel')}</label>
                    <input
                        className="kairo-debug-condition-input"
                        type="text"
                        value={s.instanceFilter}
                        onChange={e => onInstanceFilterChange(e.target.value)}
                        placeholder={t('widget.debug.conditionEditor.instancePlaceholder')}
                        aria-label={t('widget.debug.conditionEditor.instanceAria')}
                    />
                    <div className="kairo-debug-condition-hint">{t('widget.debug.conditionEditor.instanceHint')}</div>
                </div>
            )}

            {s.filterType === 'stackDepth' && (
                <div className="kairo-debug-condition-field">
                    <label className="kairo-debug-condition-label">{t('widget.debug.conditionEditor.stackDepthLabel')}</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                            className="kairo-debug-condition-input"
                            type="number"
                            value={s.stackDepthMin}
                            onChange={e => onStackDepthChange(parseInt(e.target.value, 10) || 0, s.stackDepthMax)}
                            min={0}
                            placeholder={t('widget.debug.conditionEditor.min')}
                            aria-label={t('widget.debug.conditionEditor.stackDepthMinAria')}
                            style={{ width: 80 }}
                        />
                        <span style={{ fontSize: '12px' }}>{t('widget.debug.conditionEditor.to')}</span>
                        <input
                            className="kairo-debug-condition-input"
                            type="number"
                            value={s.stackDepthMax}
                            onChange={e => onStackDepthChange(s.stackDepthMin, parseInt(e.target.value, 10) || 0)}
                            min={0}
                            placeholder={t('widget.debug.conditionEditor.max')}
                            aria-label={t('widget.debug.conditionEditor.stackDepthMaxAria')}
                            style={{ width: 80 }}
                        />
                    </div>
                    <div className="kairo-debug-condition-hint">{t('widget.debug.conditionEditor.stackDepthHint')}</div>
                </div>
            )}

            {s.filterType === 'hitCount' && (
                <div className="kairo-debug-condition-field">
                    <label className="kairo-debug-condition-label">{t('widget.debug.conditionEditor.hitCountLabel')}</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                            className="kairo-debug-condition-input"
                            value={s.hitCountMode}
                            onChange={e => onHitCountChange(e.target.value, s.hitCountTarget)}
                            aria-label={t('widget.debug.conditionEditor.hitCountModeAria')}
                        >
                            <option value="">{t('widget.debug.conditionEditor.hitCountOff')}</option>
                            <option value="EQ">= {t('widget.debug.conditionEditor.hitCountEqual')}</option>
                            <option value="GT">&gt; {t('widget.debug.conditionEditor.hitCountGreater')}</option>
                            <option value="GE">&gt;= {t('widget.debug.conditionEditor.hitCountGreaterEqual')}</option>
                            <option value="LT">&lt; {t('widget.debug.conditionEditor.hitCountLess')}</option>
                            <option value="LE">&lt;= {t('widget.debug.conditionEditor.hitCountLessEqual')}</option>
                            <option value="MOD">% {t('widget.debug.conditionEditor.hitCountModulo')}</option>
                        </select>
                        <input
                            className="kairo-debug-condition-input"
                            type="number"
                            value={s.hitCountTarget}
                            onChange={e => onHitCountChange(s.hitCountMode, parseInt(e.target.value, 10) || 0)}
                            min={1}
                            placeholder={t('widget.debug.conditionEditor.hitCountTarget')}
                            aria-label={t('widget.debug.conditionEditor.hitCountTargetAria')}
                            style={{ width: 80 }}
                        />
                    </div>
                    <div className="kairo-debug-condition-hint">{t('widget.debug.conditionEditor.hitCountHint')}</div>
                </div>
            )}
        </div>

        {s.validationMessage && (
            <div className={`kairo-debug-condition-validation ${s.isValid ? 'valid' : 'invalid'}`}>
                <span className={`codicon ${s.isValid ? 'codicon-pass' : 'codicon-error'}`} aria-hidden="true" />
                {s.validationMessage}
            </div>
        )}

        {s.error && (
            <div className="kairo-error-banner" role="alert">
                <span className="codicon codicon-error" aria-hidden="true" />
                {s.error}
            </div>
        )}
    </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugConditionEditorWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    protected state: ConditionEditorState = {
        breakpointId: '',
        condition: '',
        filterType: 'condition',
        threadFilter: '',
        instanceFilter: '',
        stackDepthMin: 0,
        stackDepthMax: 0,
        hitCountMode: '',
        hitCountTarget: 1,
        isValid: true,
        validationMessage: '',
        busy: false,
        error: null,
    };

    protected readonly onStateChangeEmitter = new Emitter<ConditionEditorState>();
    readonly onDidStateChange: Event<ConditionEditorState> = this.onStateChangeEmitter.event;
    protected readonly onApplyEmitter = new Emitter<ConditionEditorState>();
    readonly onDidApply: Event<ConditionEditorState> = this.onApplyEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugConditionEditorWidget.ID;
        this.title.label = this.i18n.t('widget.debug.conditionEditor.title');
        this.title.caption = this.i18n.t('widget.debug.conditionEditor.caption');
        this.title.iconClass = 'codicon codicon-symbol-operator';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
            this.title.label = this.i18n.t('widget.debug.conditionEditor.title');
            this.title.caption = this.i18n.t('widget.debug.conditionEditor.caption');
            this.update();
        }));
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(ConditionEditorView, {
            state: this.state,
            onConditionChange: (v: string) => this.updateCondition(v),
            onFilterTypeChange: (t: FilterType) => this.setState({ filterType: t }),
            onThreadFilterChange: (v: string) => this.setState({ threadFilter: v }),
            onInstanceFilterChange: (v: string) => this.setState({ instanceFilter: v }),
            onStackDepthChange: (min: number, max: number) => this.setState({ stackDepthMin: min, stackDepthMax: max }),
            onHitCountChange: (mode: string, target: number) => this.setState({ hitCountMode: mode, hitCountTarget: target }),
            onApply: () => this.apply(),
            onClear: () => this.clear(),
            i18n: this.i18n,
        });
    }

    setBreakpointId(id: string): void {
        this.setState({ breakpointId: id });
    }

    protected updateCondition(value: string): void {
        const isValid = this.validateCondition(value);
        this.setState({
            condition: value,
            isValid,
            validationMessage: isValid ? this.i18n.t('widget.debug.conditionEditor.validExpression') : this.i18n.t('widget.debug.conditionEditor.invalidExpression'),
        });
    }

    protected validateCondition(condition: string): boolean {
        if (!condition.trim()) return true;

        // Check balanced parentheses
        let depth = 0;
        for (const ch of condition) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (depth < 0) return false;
        }
        if (depth !== 0) return false;

        // Check for valid operators
        const hasValidOps = /[=!<>]=/.test(condition) || /&&/.test(condition) || /\|\|/.test(condition) || /^!/.test(condition);
        const hasSimpleExpr = /^\s*\w+\s*$/.test(condition); // Just a variable name
        return hasValidOps || hasSimpleExpr || condition.trim().length > 0;
    }

    protected apply(): void {
        this.onApplyEmitter.fire(this.state);
        this.setState({ busy: false, error: null });
    }

    protected clear(): void {
        this.setState({
            condition: '',
            threadFilter: '',
            instanceFilter: '',
            stackDepthMin: 0,
            stackDepthMax: 0,
            hitCountMode: '',
            hitCountTarget: 1,
            isValid: true,
            validationMessage: '',
        });
    }

    protected setState(partial: Partial<ConditionEditorState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChangeEmitter.fire(this.state);
        this.update();
    }
}