import * as React from 'react';
import { KairoI18nService } from '@kairo/i18n';
import { KairoDebugSessionService } from './kairo-debug-session-service';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface WatchEntry {
    expression: string;
    result?: string;
    type?: string;
    error?: string;
    variablesReference?: number;
    loading?: boolean;
    children?: WatchChild[];
    childrenLoaded?: boolean;
    expanded?: boolean;
}

interface WatchChild {
    name: string;
    value: string;
    type?: string;
    variablesReference?: number;
    children?: WatchChild[];
    childrenLoaded?: boolean;
    expanded?: boolean;
}

interface IDEAWatchesPanelProps {
    sessionService: KairoDebugSessionService;
    i18n: KairoI18nService;
    onNewWatch?: (expression: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Child Node                                                          */
/* ------------------------------------------------------------------ */

const WatchChildNode: React.FC<{
    child: WatchChild;
    depth: number;
    sessionService: KairoDebugSessionService;
    onToggle: (child: WatchChild) => void;
}> = ({ child, depth, sessionService, onToggle }) => {
    const hasChildren = (child.variablesReference ?? 0) > 0;
    const indent = depth * 14;
    const cls = classifyValue(child.value);

    return (
        <div>
            <div
                className="kairo-debug-watch-child"
                style={{ paddingLeft: indent + 4 }}
                onClick={() => hasChildren && onToggle(child)}
            >
                <span className={`kairo-debug-watch-toggle ${hasChildren ? 'opaque' : ''}`}>
                    {child.expanded ? '▾' : '▸'}
                </span>
                <span className="kairo-debug-watch-name">
                    {child.name}
                </span>
                {child.type && (
                    <span className="kairo-debug-watch-type">
                        : {child.type}
                    </span>
                )}
                <span className="kairo-debug-watch-equals">=</span>
                <span className={`kairo-debug-watch-value ${cls}`}>
                    {child.value}
                </span>
            </div>
            {child.expanded && child.children && child.children.map((c, i) => (
                <WatchChildNode
                    key={`${c.name}-${i}`}
                    child={c}
                    depth={depth + 1}
                    sessionService={sessionService}
                    onToggle={onToggle}
                />
            ))}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Watch Row                                                           */
/* ------------------------------------------------------------------ */

const WatchRow: React.FC<{
    entry: WatchEntry;
    isSelected: boolean;
    onSelect: () => void;
    onToggle: () => void;
    onRemove: () => void;
    onEdit: () => void;
    onToggleChild: (child: WatchChild) => void;
    sessionService: KairoDebugSessionService;
    removeTitle: string;
}> = ({ entry, isSelected, onSelect, onToggle, onRemove, onEdit, onToggleChild, sessionService, removeTitle }) => {
    const hasChildren = (entry.variablesReference ?? 0) > 0;

    const valueCls = entry.error ? 'error' : classifyValue(entry.result ?? '');

    return (
        <div>
            <div
                className={`kairo-debug-watch-row${isSelected ? ' selected' : ''}`}
                onClick={onSelect}
                onDoubleClick={onEdit}
            >
                <span
                    className={`kairo-debug-watch-toggle ${hasChildren ? 'opaque' : ''}`}
                    onClick={(e) => { e.stopPropagation(); onToggle(); }}
                >
                    {entry.loading ? '…' : (entry.expanded ? '▾' : '▸')}
                </span>
                <span className="codicon codicon-watch" style={{ fontSize: 11, flexShrink: 0, color: 'var(--theia-debugIcon-watchForeground, #75beff)' }} />
                <span className="kairo-debug-watch-name">
                    {entry.expression}
                </span>
                {entry.type && !entry.error && (
                    <span className="kairo-debug-watch-type">
                        : {entry.type}
                    </span>
                )}
                {!entry.error && <span className="kairo-debug-watch-equals">=</span>}
                {entry.loading ? (
                    <span className="kairo-debug-watch-loading">...</span>
                ) : entry.error ? (
                    <span className="kairo-debug-watch-error">
                        {entry.error}
                    </span>
                ) : (
                    <span className={`kairo-debug-watch-value ${valueCls}`}>
                        {entry.result ?? ''}
                    </span>
                )}
                <button
                    className="kairo-debug-watch-remove"
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    title={removeTitle}
                >
                    ×
                </button>
            </div>
            {entry.expanded && entry.children && entry.children.map((c, i) => (
                <WatchChildNode
                    key={`${c.name}-${i}`}
                    child={c}
                    depth={0}
                    sessionService={sessionService}
                    onToggle={onToggleChild}
                />
            ))}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Watches Panel                                                       */
/* ------------------------------------------------------------------ */

export const IDEAWatchesPanel: React.FC<IDEAWatchesPanelProps> = ({ sessionService, i18n, onNewWatch }) => {
    const t = React.useCallback((key: string) => i18n.t(key as any), [i18n]);
    const [entries, setEntries] = React.useState<WatchEntry[]>([]);
    const [selectedIndex, setSelectedIndex] = React.useState<number>(-1);
    const [adding, setAdding] = React.useState(false);
    const [newExpression, setNewExpression] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Load watches from localStorage
    const storageKey = 'kairo-debug-watches';

    const loadWatches = React.useCallback(() => {
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                const exprs: string[] = JSON.parse(saved);
                setEntries(exprs.map(e => ({ expression: e })));
            }
        } catch {
            // ignore
        }
    }, []);

    const saveWatches = React.useCallback((exprs: string[]) => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(exprs));
        } catch {
            // ignore
        }
    }, []);

    const evaluateAll = React.useCallback(async () => {
        if (!sessionService.isSuspended) {
            setEntries(e => e.map(en => ({ ...en, result: undefined, error: undefined, loading: false })));
            return;
        }
        setEntries(e => e.map(en => ({ ...en, loading: true })));
        const updated = await Promise.all(
            entries.map(async (entry) => {
                if (!entry.expression.trim()) return entry;
                const result = await sessionService.evaluate(entry.expression, undefined, 'watch');
                return {
                    ...entry,
                    result: result.result,
                    type: result.type,
                    variablesReference: result.variablesReference,
                    error: result.error,
                    loading: false,
                    childrenLoaded: false,
                    expanded: false,
                    children: undefined,
                };
            })
        );
        setEntries(updated);
    }, [entries, sessionService]);

    const addWatch = React.useCallback((expression: string) => {
        const expr = expression.trim();
        if (!expr) return;
        if (entries.some(e => e.expression === expr)) return;
        const newEntry: WatchEntry = { expression: expr };
        setEntries(prev => [...prev, newEntry]);
        saveWatches([...entries.map(e => e.expression), expr]);
        setNewExpression('');
        setAdding(false);
    }, [entries, saveWatches]);

    const removeWatch = React.useCallback((idx: number) => {
        const newEntries = entries.filter((_, i) => i !== idx);
        setEntries(newEntries);
        saveWatches(newEntries.map(e => e.expression));
        setSelectedIndex(-1);
    }, [entries, saveWatches]);

    const editWatch = React.useCallback((idx: number) => {
        setSelectedIndex(idx);
        setNewExpression(entries[idx].expression);
        setAdding(true);
    }, [entries]);

    const toggleEntry = React.useCallback(async (idx: number) => {
        const entry = entries[idx];
        if (!entry) return;
        const newExpanded = !entry.expanded;
        entry.expanded = newExpanded;
        if (newExpanded && !entry.childrenLoaded && entry.variablesReference && entry.variablesReference > 0) {
            setEntries([...entries]);
            try {
                const vars = await sessionService.getVariables(entry.variablesReference);
                entry.children = vars.map(v => ({
                    name: v.name,
                    value: v.value,
                    type: v.type,
                    variablesReference: v.variablesReference,
                    childrenLoaded: false,
                    expanded: false,
                }));
                entry.childrenLoaded = true;
            } catch {
                // ignore
            }
        }
        setEntries([...entries]);
    }, [entries, sessionService]);

    const toggleChild = React.useCallback(async (child: WatchChild) => {
        const newExpanded = !child.expanded;
        child.expanded = newExpanded;
        if (newExpanded && !child.childrenLoaded && child.variablesReference && child.variablesReference > 0) {
            try {
                const vars = await sessionService.getVariables(child.variablesReference);
                child.children = vars.map(v => ({
                    name: v.name,
                    value: v.value,
                    type: v.type,
                    variablesReference: v.variablesReference,
                    childrenLoaded: false,
                    expanded: false,
                }));
                child.childrenLoaded = true;
            } catch {
                // ignore
            }
        }
        setEntries(e => [...e]);
    }, [sessionService]);

    React.useEffect(() => {
        loadWatches();
    }, [loadWatches]);

    React.useEffect(() => {
        evaluateAll();
        const disposable = sessionService.onDidChangeState(state => {
            if (state.isSuspended) {
                setTimeout(evaluateAll, 100);
            }
        });
        return () => disposable.dispose();
    }, [evaluateAll, sessionService]);

    React.useEffect(() => {
        if (adding && inputRef.current) {
            inputRef.current.focus();
        }
    }, [adding]);

    return (
        <div className="kairo-debug-watches-idea">
            {/* Toolbar */}
            <div className="kairo-debug-watches-toolbar">
                <button
                    className="kairo-debug-watches-btn"
                    onClick={() => setAdding(true)}
                    title={t('widget.debug.watch.newWatch')}
                >
                    <span className="codicon codicon-add" style={{ fontSize: 14 }} />
                </button>
                <button
                    className="kairo-debug-watches-btn"
                    onClick={() => { setEntries([]); saveWatches([]); }}
                    title={t('widget.debug.watch.removeAll')}
                >
                    <span className="codicon codicon-clear-all" style={{ fontSize: 13 }} />
                </button>
            </div>

            {/* Entries */}
            <div className="kairo-debug-watches-entries">
                {entries.length === 0 && !adding && (
                    <div className="kairo-debug-empty-text">
                        {t('debug.toolWindow.addWatchHint')}
                    </div>
                )}
                {entries.map((entry, idx) => (
                    <WatchRow
                        key={`watch-${idx}-${entry.expression}`}
                        entry={entry}
                        isSelected={idx === selectedIndex}
                        onSelect={() => setSelectedIndex(idx)}
                        onToggle={() => toggleEntry(idx)}
                        onRemove={() => removeWatch(idx)}
                        onEdit={() => editWatch(idx)}
                        onToggleChild={toggleChild}
                        sessionService={sessionService}
                        removeTitle={t('widget.debug.watch.removeAria')}
                    />
                ))}
                {adding && (
                    <div className="kairo-debug-watch-input-row">
                        <input
                            ref={inputRef}
                            className="kairo-debug-watch-input"
                            value={newExpression}
                            onChange={e => setNewExpression(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    addWatch(newExpression);
                                } else if (e.key === 'Escape') {
                                    setAdding(false);
                                    setNewExpression('');
                                }
                            }}
                            onBlur={() => {
                                if (newExpression.trim()) {
                                    addWatch(newExpression);
                                } else {
                                    setAdding(false);
                                }
                            }}
                            placeholder={t('widget.debug.watch.expressionPlaceholder')}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

function classifyValue(value: string): string {
    if (value === 'null' || value === 'undefined') return 'null';
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return 'string';
    if (/^-?\d/.test(value) || value === 'true' || value === 'false') return 'number';
    if (value.startsWith('{') || value.startsWith('[')) return 'object';
    if (value.includes('Exception') || value.includes('Error')) return 'error';
    return '';
}
