import * as React from 'react';
import { KairoI18nService } from '@kairo/i18n';
import { KairoDebugSessionService } from './kairo-debug-session-service';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface VariableNode {
    name: string;
    value: string;
    type?: string;
    variablesReference: number;
    evaluateName?: string;
    children?: VariableNode[];
    loaded: boolean;
    expanded: boolean;
    loading: boolean;
}

interface IDEAVariablesTreeProps {
    sessionService: KairoDebugSessionService;
    i18n: KairoI18nService;
}

/* ------------------------------------------------------------------ */
/*  Tree Row Component                                                  */
/* ------------------------------------------------------------------ */

interface TreeRowProps {
    node: VariableNode;
    depth: number;
    sessionService: KairoDebugSessionService;
    onToggle: (node: VariableNode) => void;
    onSetValue: (node: VariableNode, newValue: string) => void;
}

const TreeRow: React.FC<TreeRowProps> = ({ node, depth, sessionService, onToggle, onSetValue }) => {
    const [editing, setEditing] = React.useState(false);
    const [editValue, setEditValue] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

    const hasChildren = node.variablesReference > 0;
    const indent = depth * 14;

    const valueStyle = getValueStyle(node.value);

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!node.variablesReference) {
            setEditValue(node.value.replace(/^"/, '').replace(/"$/, ''));
            setEditing(true);
        }
    };

    const commitEdit = async () => {
        setEditing(false);
        if (editValue !== node.value) {
            await sessionService.setVariable(node.variablesReference, node.name, editValue);
            onSetValue(node, editValue);
        }
    };

    React.useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    return (
        <div>
            <div
                className={`kairo-debug-var-row-idea ${hasChildren ? 'has-children' : ''}`}
                style={{ paddingLeft: indent + 4 }}
                onClick={() => hasChildren && onToggle(node)}
                onDoubleClick={handleDoubleClick}
            >
                <span
                    className={`kairo-debug-var-toggle ${hasChildren ? 'opaque' : ''}`}
                    aria-hidden="true"
                >
                    {node.loading ? '…' : (node.expanded ? '▾' : '▸')}
                </span>
                <span
                    className="codicon"
                    style={{ color: getIconColor(node.type, node.value) }}
                    aria-hidden="true"
                >
                    {getIcon(node.type, node.value, hasChildren, node.expanded)}
                </span>
                <span
                    className={`kairo-debug-var-name-idea ${depth === 0 ? 'root' : ''}`}
                >
                    {node.name}
                </span>
                {node.type && (
                    <span className="kairo-debug-var-type-idea">
                        : {node.type}
                    </span>
                )}
                <span className="kairo-debug-var-type-idea" aria-hidden="true">=</span>
                {editing ? (
                    <input
                        ref={inputRef}
                        className="kairo-debug-var-input"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={e => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') setEditing(false);
                        }}
                        onClick={e => e.stopPropagation()}
                    />
                ) : (
                    <span
                        className={`kairo-debug-var-value-idea ${valueStyle.cls}`}
                    >
                        {node.value}
                    </span>
                )}
            </div>
            {node.expanded && node.children && node.children.map((child, i) => (
                <TreeRow
                    key={`${child.name}-${i}`}
                    node={child}
                    depth={depth + 1}
                    sessionService={sessionService}
                    onToggle={onToggle}
                    onSetValue={onSetValue}
                />
            ))}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Main Variables Tree                                                 */
/* ------------------------------------------------------------------ */

export const IDEAVariablesTree: React.FC<IDEAVariablesTreeProps> = ({ sessionService, i18n }) => {
    const t = React.useCallback((key: string) => i18n.t(key as any), [i18n]);
    const [roots, setRoots] = React.useState<VariableNode[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string>('');

    const loadScopes = React.useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const scopes = await sessionService.fetchScopes();
            if (scopes.length === 0) {
                setRoots([]);
                setLoading(false);
                return;
            }

            // Create root nodes for each scope
            const rootNodes: VariableNode[] = scopes.map(scope => ({
                name: scope.name,
                value: '',
                type: undefined,
                variablesReference: scope.variablesReference,
                evaluateName: undefined,
                loaded: false,
                expanded: ['Local Variables', 'Locals', 'Variables'].includes(scope.name),
                loading: false,
                children: undefined,
            }));
            setRoots(rootNodes);

            // Auto-expand and load scopes that are initially expanded
            for (const node of rootNodes) {
                if (node.expanded && node.variablesReference > 0) {
                    await loadChildren(node);
                }
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [sessionService]);

    const loadChildren = React.useCallback(async (node: VariableNode) => {
        if (node.loading || (node.loaded && node.children)) return;
        node.loading = true;
        setRoots(r => [...r]);
        try {
            const vars = await sessionService.getVariables(node.variablesReference);
            node.children = vars.map(v => ({
                name: v.name,
                value: v.value,
                type: v.type,
                variablesReference: v.variablesReference ?? 0,
                evaluateName: v.evaluateName,
                loaded: false,
                expanded: false,
                loading: false,
                children: undefined,
            }));
            node.loaded = true;
        } catch {
            // ignore
        } finally {
            node.loading = false;
            setRoots(r => [...r]);
        }
    }, [sessionService]);

    const handleToggle = React.useCallback(async (node: VariableNode) => {
        node.expanded = !node.expanded;
        if (node.expanded && !node.loaded && node.variablesReference > 0) {
            await loadChildren(node);
        } else {
            setRoots(r => [...r]);
        }
    }, [loadChildren]);

    const handleSetValue = React.useCallback(() => {
        setRoots(r => [...r]);
    }, []);

    React.useEffect(() => {
        loadScopes();
        const disposable = sessionService.onDidChangeState(state => {
            if (state.isSuspended) {
                loadScopes();
            } else if (!state.hasSession) {
                setRoots([]);
            }
        });
        return () => disposable.dispose();
    }, [loadScopes, sessionService]);

    if (loading && roots.length === 0) {
        return (
            <div className="kairo-debug-section-empty">
                {t('debug.toolWindow.loadingVariables')}
            </div>
        );
    }

    if (error) {
        return (
            <div className="kairo-debug-section-empty">
                {error}
            </div>
        );
    }

    if (roots.length === 0) {
        return (
            <div className="kairo-debug-section-empty">
                {sessionService.isSuspended ? t('debug.toolWindow.noVariables') : t('debug.toolWindow.sessionNotPaused')}
            </div>
        );
    }

    return (
        <div className="kairo-debug-variables-idea">
            {roots.map((node, i) => (
                <TreeRow
                    key={`root-${i}`}
                    node={node}
                    depth={0}
                    sessionService={sessionService}
                    onToggle={handleToggle}
                    onSetValue={handleSetValue}
                />
            ))}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function getValueStyle(value: string): { cls: string; style: React.CSSProperties } {
    if (value === 'null' || value === 'undefined') {
        return { cls: 'null', style: { color: 'var(--theia-debugTokenExpression-string, #c0c0c0)' } };
    }
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
        return { cls: 'string', style: { color: 'var(--theia-debugTokenExpression-string, #6a8759)' } };
    }
    if (/^-?\d/.test(value) || value === 'true' || value === 'false') {
        return { cls: 'number', style: { color: 'var(--theia-debugTokenExpression-number, #6897bb)' } };
    }
    if (value.startsWith('{') || value.startsWith('[')) {
        return { cls: 'object', style: { color: 'var(--theia-debugTokenExpression-value, #a9b7c6)' } };
    }
    if (value.includes('Exception') || value.includes('Error')) {
        return { cls: 'error', style: { color: 'var(--theia-errorForeground)' } };
    }
    return { cls: '', style: { color: 'var(--theia-debugTokenExpression-value, #a9b7c6)' } };
}

function getIcon(type: string | undefined, value: string, hasChildren: boolean, expanded: boolean): string {
    if (value === 'null' || value === 'undefined') return 'codicon-symbol-null';
    if (/^".*"$/.test(value)) return 'codicon-symbol-string';
    if (/^-?\d/.test(value) || value === 'true' || value === 'false') return 'codicon-symbol-number';
    if (type === 'boolean') return 'codicon-symbol-boolean';
    if (type?.includes('[]') || type?.includes('Array') || value.startsWith('[')) return 'codicon-symbol-array';
    if (value.startsWith('{') || hasChildren) return expanded ? 'codicon-folder-opened' : 'codicon-symbol-class';
    return 'codicon-symbol-variable';
}

function getIconColor(type: string | undefined, value: string): string {
    if (value === 'null' || value === 'undefined') return 'var(--theia-debugTokenExpression-string, #c0c0c0)';
    if (/^".*"$/.test(value)) return 'var(--theia-debugTokenExpression-string, #6a8759)';
    if (/^-?\d/.test(value) || value === 'true' || value === 'false') return 'var(--theia-debugTokenExpression-number, #6897bb)';
    return 'var(--theia-symbolIcon-foreground, #b5b6e3)';
}
