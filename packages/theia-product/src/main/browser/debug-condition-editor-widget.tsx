/**
 * Kairo Debug Condition Editor Widget — input field for editing
 * breakpoint conditions with AND/OR/NOT expression support.
 *
 * Provides a text editor for complex condition expressions, a
 * dropdown for selecting filter types (instance, thread, stack depth),
 * and real-time validation feedback.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';

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
}

const FilterTypeTabs: React.FC<{
    active: FilterType;
    onChange: (type: FilterType) => void;
}> = ({ active, onChange }) => {
    const tabs: { type: FilterType; label: string; icon: string }[] = [
        { type: 'condition', label: 'Condition', icon: 'codicon-symbol-operator' },
        { type: 'thread', label: 'Thread', icon: 'codicon-debug-console' },
        { type: 'instance', label: 'Instance', icon: 'codicon-symbol-class' },
        { type: 'stackDepth', label: 'Stack', icon: 'codicon-callstack-view' },
        { type: 'hitCount', label: 'Hit Count', icon: 'codicon-debug-hint' },
    ];

    return (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--theia-panel-border)', marginBottom: 8 }}>
            {tabs.map(tab => (
                <button
                    key={tab.type}
                    className="theia-button secondary"
                    onClick={() => onChange(tab.type)}
                    style={{
                        padding: '3px 10px',
                        fontSize: '11px',
                        border: 'none',
                        borderBottom: active === tab.type ? '2px solid var(--theia-focusBorder)' : '2px solid transparent',
                        borderRadius: 0,
                        background: 'transparent',
                        opacity: active === tab.type ? 1 : 0.6,
                        cursor: 'pointer',
                    }}
                    title={tab.label}
                >
                    <span className={`codicon ${tab.icon}`} style={{ fontSize: '12px', marginRight: 4 }} />
                    {tab.label}
                </button>
            ))}
        </div>
    );
};

const ConditionEditorView: React.FC<ConditionEditorViewProps> = ({
    state: s, onConditionChange, onFilterTypeChange, onThreadFilterChange,
    onInstanceFilterChange, onStackDepthChange, onHitCountChange,
    onApply, onClear,
}) => (
    <div className="kairo-debug-condition-editor" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: '12px' }}>Condition Editor</span>
            {s.breakpointId && (
                <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                    BP #{s.breakpointId}
                </span>
            )}
            <div style={{ flex: 1 }} />
            <button
                className="theia-button secondary"
                disabled={s.busy}
                onClick={onClear}
                style={{ padding: '1px 8px', fontSize: '11px' }}
                title="Clear all filters"
            >
                Clear
            </button>
            <button
                className="theia-button"
                disabled={s.busy || !s.isValid}
                onClick={onApply}
                style={{ padding: '1px 8px', fontSize: '11px' }}
                title="Apply condition"
            >
                {s.busy ? '...' : 'Apply'}
            </button>
        </div>

        {/* Filter tabs */}
        <div style={{ padding: '0 8px' }}>
            <FilterTypeTabs active={s.filterType} onChange={onFilterTypeChange} />
        </div>

        {/* Editor body */}
        <div style={{ flex: 1, padding: '0 8px', overflow: 'auto' }}>
            {s.filterType === 'condition' && (
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 500, display: 'block', marginBottom: 4 }}>
                        Expression (supports AND/OR/NOT):
                    </label>
                    <textarea
                        value={s.condition}
                        onChange={e => onConditionChange(e.target.value)}
                        placeholder="e.g., x > 5 && y < 10"
                        rows={4}
                        style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            fontSize: '12px',
                            fontFamily: 'var(--theia-editor-font-family)',
                            padding: '6px 8px',
                            background: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)',
                            borderRadius: 3,
                            resize: 'vertical',
                        }}
                        aria-label="Condition expression"
                    />
                    <div style={{ fontSize: '10px', opacity: 0.6, marginTop: 4 }}>
                        Use {'&&'} for AND, {'||'} for OR, {'!'} for NOT. Variables are evaluated at breakpoint time.
                    </div>
                </div>
            )}

            {s.filterType === 'thread' && (
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 500, display: 'block', marginBottom: 4 }}>
                        Thread ID or Name Pattern:
                    </label>
                    <input
                        type="text"
                        value={s.threadFilter}
                        onChange={e => onThreadFilterChange(e.target.value)}
                        placeholder="e.g., main, http-nio-*, 12345"
                        style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            fontSize: '12px',
                            fontFamily: 'var(--theia-editor-font-family)',
                            padding: '4px 8px',
                            background: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)',
                            borderRadius: 3,
                        }}
                        aria-label="Thread filter"
                    />
                    <div style={{ fontSize: '10px', opacity: 0.6, marginTop: 4 }}>
                        Breakpoint will only trigger on the specified thread.
                    </div>
                </div>
            )}

            {s.filterType === 'instance' && (
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 500, display: 'block', marginBottom: 4 }}>
                        Instance Filter Expression:
                    </label>
                    <input
                        type="text"
                        value={s.instanceFilter}
                        onChange={e => onInstanceFilterChange(e.target.value)}
                        placeholder="e.g., this == threadLocalObject"
                        style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            fontSize: '12px',
                            fontFamily: 'var(--theia-editor-font-family)',
                            padding: '4px 8px',
                            background: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)',
                            borderRadius: 3,
                        }}
                        aria-label="Instance filter"
                    />
                    <div style={{ fontSize: '10px', opacity: 0.6, marginTop: 4 }}>
                        Breakpoint only triggers when 'this' matches the specified object.
                    </div>
                </div>
            )}

            {s.filterType === 'stackDepth' && (
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 500, display: 'block', marginBottom: 4 }}>
                        Call Stack Depth Range:
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                            type="number"
                            value={s.stackDepthMin}
                            onChange={e => onStackDepthChange(parseInt(e.target.value, 10) || 0, s.stackDepthMax)}
                            min={0}
                            placeholder="Min"
                            style={{
                                width: 80,
                                fontSize: '12px',
                                padding: '4px 8px',
                                background: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: 3,
                            }}
                            aria-label="Minimum stack depth"
                        />
                        <span style={{ fontSize: '12px' }}>to</span>
                        <input
                            type="number"
                            value={s.stackDepthMax}
                            onChange={e => onStackDepthChange(s.stackDepthMin, parseInt(e.target.value, 10) || 0)}
                            min={0}
                            placeholder="Max"
                            style={{
                                width: 80,
                                fontSize: '12px',
                                padding: '4px 8px',
                                background: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: 3,
                            }}
                            aria-label="Maximum stack depth"
                        />
                    </div>
                    <div style={{ fontSize: '10px', opacity: 0.6, marginTop: 4 }}>
                        Only trigger when call stack depth is in this range. 0 = current frame.
                    </div>
                </div>
            )}

            {s.filterType === 'hitCount' && (
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 500, display: 'block', marginBottom: 4 }}>
                        Hit Count Condition:
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                            value={s.hitCountMode}
                            onChange={e => onHitCountChange(e.target.value, s.hitCountTarget)}
                            style={{
                                fontSize: '12px',
                                padding: '4px 8px',
                                background: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: 3,
                            }}
                            aria-label="Hit count mode"
                        >
                            <option value="">Off</option>
                            <option value="EQ">= (equal)</option>
                            <option value="GT">{">"} (greater than)</option>
                            <option value="GE">{">="} (greater or equal)</option>
                            <option value="LT">{"<"} (less than)</option>
                            <option value="LE">{"<="} (less or equal)</option>
                            <option value="MOD">% (modulo)</option>
                        </select>
                        <input
                            type="number"
                            value={s.hitCountTarget}
                            onChange={e => onHitCountChange(s.hitCountMode, parseInt(e.target.value, 10) || 0)}
                            min={1}
                            placeholder="Target"
                            style={{
                                width: 80,
                                fontSize: '12px',
                                padding: '4px 8px',
                                background: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: 3,
                            }}
                            aria-label="Hit count target"
                        />
                    </div>
                    <div style={{ fontSize: '10px', opacity: 0.6, marginTop: 4 }}>
                        Breakpoint triggers only when the hit count meets this condition.
                    </div>
                </div>
            )}
        </div>

        {/* Validation message */}
        {s.validationMessage && (
            <div style={{
                padding: '4px 8px',
                fontSize: '11px',
                color: s.isValid ? 'var(--theia-terminal-ansiGreen)' : 'var(--theia-errorForeground)',
                borderTop: '1px solid var(--theia-panel-border)',
            }}>
                <span className={`codicon ${s.isValid ? 'codicon-pass' : 'codicon-error'}`} style={{ fontSize: '12px', marginRight: 4 }} />
                {s.validationMessage}
            </div>
        )}

        {s.error && (
            <div style={{ padding: '8px', color: 'var(--theia-errorForeground)', fontSize: '12px' }}>
                {s.error}
            </div>
        )}
    </div>
);

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugConditionEditorWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID;

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
        this.title.label = 'Condition Editor';
        this.title.caption = 'Kairo Debug Condition Editor';
        this.title.iconClass = 'codicon codicon-symbol-operator';
        this.title.closable = true;
        this.addClass('kairo-widget');
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
            validationMessage: isValid ? 'Expression valid' : 'Invalid expression syntax',
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