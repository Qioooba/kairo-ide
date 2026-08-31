import * as React from 'react';
import { KairoI18nService } from '@kairo/i18n';
import { KairoDebugSessionService } from './kairo-debug-session-service';
import { classifyValue } from './debug-value-classify';

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
    /** Workspace-scoped storage dimension to avoid cross-project watch bleed. */
    workspaceKey?: string;
}

const WATCH_STORAGE_PREFIX = 'kairo-debug-watches';
export const KAIRO_DEBUG_WATCH_ADDED = 'kairo-debug-watch-added';

function watchStorageKey(workspaceKey?: string): string {
    const dim = (workspaceKey || 'default').replace(/[^\w.-]+/g, '_');
    return `${WATCH_STORAGE_PREFIX}:${dim}`;
}

/** Persist a watch from hover / other surfaces and notify the IDEA watches panel. */
export function persistDebugWatch(expression: string, workspaceKey?: string): void {
    const expr = expression.trim();
    if (!expr || typeof localStorage === 'undefined') {
        return;
    }
    const key = watchStorageKey(workspaceKey);
    let exprs: string[] = [];
    try {
        const saved = localStorage.getItem(key);
        if (saved) {
            exprs = JSON.parse(saved);
        }
    } catch {
        exprs = [];
    }
    if (!Array.isArray(exprs)) {
        exprs = [];
    }
    if (!exprs.includes(expr)) {
        exprs.push(expr);
        try {
            localStorage.setItem(key, JSON.stringify(exprs));
        } catch {
            // quota / private mode — still notify in-memory listeners
        }
    }
    window.dispatchEvent(new CustomEvent(KAIRO_DEBUG_WATCH_ADDED, { detail: { expression: expr, workspaceKey } }));
}

function mapVariablesToChildren(vars: Array<{ name: string; value: string; type?: string; variablesReference?: number }>): WatchChild[] {
    return vars.map(v => ({
        name: v.name,
        value: v.value,
        type: v.type,
        variablesReference: v.variablesReference,
        childrenLoaded: false,
        expanded: false,
    }));
}

function updateChildTree(
    children: WatchChild[] | undefined,
    match: (c: WatchChild) => boolean,
    updater: (c: WatchChild) => WatchChild,
): WatchChild[] | undefined {
    if (!children) return children;
    let changed = false;
    const next = children.map(c => {
        if (match(c)) {
            changed = true;
            return updater(c);
        }
        if (c.children) {
            const updatedKids = updateChildTree(c.children, match, updater);
            if (updatedKids !== c.children) {
                changed = true;
                return { ...c, children: updatedKids };
            }
        }
        return c;
    });
    return changed ? next : children;
}

function sameChild(a: WatchChild, b: WatchChild): boolean {
    return a.name === b.name
        && a.variablesReference === b.variablesReference
        && a.value === b.value
        && a.type === b.type;
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
                <span className="codicon codicon-watch" style={{ fontSize: 11, flexShrink: 0, color: 'var(--theia-debugIcon-watchForeground)' }} />
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

export const IDEAWatchesPanel: React.FC<IDEAWatchesPanelProps> = ({ sessionService, i18n, onNewWatch, workspaceKey }) => {
    const t = React.useCallback((key: string) => i18n.t(key as any), [i18n]);
    const [entries, setEntries] = React.useState<WatchEntry[]>([]);
    const [selectedIndex, setSelectedIndex] = React.useState<number>(-1);
    const [adding, setAdding] = React.useState(false);
    const [newExpression, setNewExpression] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);
    const entriesRef = React.useRef(entries);
    entriesRef.current = entries;

    const storageKey = watchStorageKey(workspaceKey);

    const loadWatches = React.useCallback(() => {
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                const exprs: string[] = JSON.parse(saved);
                setEntries(exprs.map(e => ({ expression: e })));
                return;
            }
            // One-time migrate from legacy unscoped key
            const legacy = localStorage.getItem(WATCH_STORAGE_PREFIX);
            if (legacy) {
                const exprs: string[] = JSON.parse(legacy);
                setEntries(exprs.map(e => ({ expression: e })));
                localStorage.setItem(storageKey, legacy);
                localStorage.removeItem(WATCH_STORAGE_PREFIX);
            }
        } catch {
            // ignore
        }
    }, [storageKey]);

    const saveWatches = React.useCallback((exprs: string[]) => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(exprs));
        } catch {
            // ignore
        }
    }, [storageKey]);

    const evaluateAll = React.useCallback(async () => {
        const current = entriesRef.current;
        if (!sessionService.isSuspended) {
            setEntries(e => e.map(en => ({ ...en, result: undefined, error: undefined, loading: false })));
            return;
        }
        setEntries(e => e.map(en => ({ ...en, loading: true })));
        const updated = await Promise.all(
            current.map(async (entry) => {
                if (!entry.expression.trim()) return { ...entry, loading: false };
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
    }, [sessionService]);

    const addWatch = React.useCallback((expression: string) => {
        const expr = expression.trim();
        if (!expr) return;
        setEntries(prev => {
            if (prev.some(e => e.expression === expr)) return prev;
            const next = [...prev, { expression: expr }];
            saveWatches(next.map(e => e.expression));
            return next;
        });
        setNewExpression('');
        setAdding(false);
        onNewWatch?.(expr);
    }, [saveWatches, onNewWatch]);

    const removeWatch = React.useCallback((idx: number) => {
        setEntries(prev => {
            const next = prev.filter((_, i) => i !== idx);
            saveWatches(next.map(e => e.expression));
            return next;
        });
        setSelectedIndex(-1);
    }, [saveWatches]);

    const editWatch = React.useCallback((idx: number) => {
        const entry = entriesRef.current[idx];
        if (!entry) return;
        setSelectedIndex(idx);
        setNewExpression(entry.expression);
        setAdding(true);
    }, []);

    const toggleEntry = React.useCallback(async (idx: number) => {
        const entry = entriesRef.current[idx];
        if (!entry) return;
        const newExpanded = !entry.expanded;

        if (newExpanded && !entry.childrenLoaded && entry.variablesReference && entry.variablesReference > 0) {
            setEntries(prev => prev.map((e, i) => i === idx ? { ...e, expanded: true } : e));
            try {
                const vars = await sessionService.getVariables(entry.variablesReference);
                const children = mapVariablesToChildren(vars);
                setEntries(prev => prev.map((e, i) => i === idx
                    ? { ...e, expanded: true, children, childrenLoaded: true }
                    : e));
            } catch {
                setEntries(prev => prev.map((e, i) => i === idx ? { ...e, expanded: true } : e));
            }
            return;
        }

        setEntries(prev => prev.map((e, i) => i === idx ? { ...e, expanded: newExpanded } : e));
    }, [sessionService]);

    const toggleChild = React.useCallback(async (child: WatchChild) => {
        const newExpanded = !child.expanded;
        const match = (c: WatchChild) => sameChild(c, child);

        if (newExpanded && !child.childrenLoaded && child.variablesReference && child.variablesReference > 0) {
            setEntries(prev => prev.map(entry => ({
                ...entry,
                children: updateChildTree(entry.children, match, c => ({ ...c, expanded: true })),
            })));
            try {
                const vars = await sessionService.getVariables(child.variablesReference);
                const kids = mapVariablesToChildren(vars);
                setEntries(prev => prev.map(entry => ({
                    ...entry,
                    children: updateChildTree(entry.children, match, c => ({
                        ...c,
                        expanded: true,
                        children: kids,
                        childrenLoaded: true,
                    })),
                })));
            } catch {
                // ignore
            }
            return;
        }

        setEntries(prev => prev.map(entry => ({
            ...entry,
            children: updateChildTree(entry.children, match, c => ({ ...c, expanded: newExpanded })),
        })));
    }, [sessionService]);

    React.useEffect(() => {
        loadWatches();
    }, [loadWatches]);

    React.useEffect(() => {
        const onAdded = (event: Event) => {
            const detail = (event as CustomEvent<{ expression?: string; workspaceKey?: string }>).detail;
            if (!detail?.expression) return;
            if (detail.workspaceKey && workspaceKey && detail.workspaceKey !== workspaceKey) return;
            addWatch(detail.expression);
        };
        window.addEventListener(KAIRO_DEBUG_WATCH_ADDED, onAdded);
        return () => window.removeEventListener(KAIRO_DEBUG_WATCH_ADDED, onAdded);
    }, [addWatch, workspaceKey]);

    React.useEffect(() => {
        void evaluateAll();
        const disposable = sessionService.onDidChangeState(state => {
            if (state.isSuspended) {
                setTimeout(() => void evaluateAll(), 100);
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
                        onToggle={() => void toggleEntry(idx)}
                        onRemove={() => removeWatch(idx)}
                        onEdit={() => editWatch(idx)}
                        onToggleChild={child => void toggleChild(child)}
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
