/**
 * Kairo Debug Variables Widget — tree view for Java debug variables.
 *
 * Displays local variables, fields, and array elements with
 * expandable/collapsible tree structure. Supports lazy loading
 * of child nodes, value formatting (hex for numbers, truncation
 * for strings), and type information.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import type { DebugSession } from '@theia/debug/lib/browser/debug-session';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { KairoDebugSessionService } from './kairo-debug-session-service';

export const KAIRO_DEBUG_VARIABLES_FACTORY_ID = 'kairo-debug-variables';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface DebugVariable {
    id: string;
    name: string;
    value: string;
    type: string;
    variablesReference: number;
    /** Number of indexed children (for arrays) or named children */
    indexedVariables?: number;
    namedVariables?: number;
    /** If true, children are already loaded */
    childrenLoaded?: boolean;
    children?: DebugVariable[];
}

export interface VariablesState {
    variables: DebugVariable[];
    busy: boolean;
    error: string | null;
    sessionId: string | undefined;
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface VariableNodeProps {
    variable: DebugVariable;
    depth: number;
    session: DebugSession | undefined;
    onExpand: (variable: DebugVariable) => void;
}

const VariableNode: React.FC<VariableNodeProps> = ({ variable, depth, session, onExpand }) => {
    const [expanded, setExpanded] = React.useState(false);
    const hasChildren = (variable.indexedVariables ?? 0) > 0
        || (variable.namedVariables ?? 0) > 0
        || variable.variablesReference > 0;

    const toggleExpand = async () => {
        if (!hasChildren) return;
        if (!variable.childrenLoaded && !expanded) {
            onExpand(variable);
        }
        setExpanded(!expanded);
    };

    const indent = depth * 16;

    return (
        <div>
            <div
                className="kairo-debug-var-row"
                onClick={toggleExpand}
                style={{
                    paddingLeft: indent + 8,
                    paddingRight: 8,
                    paddingTop: 2,
                    paddingBottom: 2,
                    cursor: hasChildren ? 'pointer' : 'default',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '12px',
                    lineHeight: '20px',
                    userSelect: 'none',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
            >
                <span style={{ width: 16, textAlign: 'center', fontSize: '10px', flexShrink: 0 }}>
                    {hasChildren ? (expanded ? '▼' : '▶') : ' '}
                </span>
                <span className="codicon codicon-symbol-variable" style={{ fontSize: '14px', flexShrink: 0 }} />
                <span style={{ fontWeight: 500, flexShrink: 0 }}>{variable.name}</span>
                <span style={{ color: 'var(--theia-debugTokenExpression-type)', flexShrink: 0 }}>:</span>
                <span style={{ color: 'var(--theia-debugTokenExpression-type)', fontSize: '11px', flexShrink: 0 }}>{variable.type}</span>
                <span style={{ color: 'var(--theia-debugTokenExpression-type)', flexShrink: 0 }}>=</span>
                <span style={{
                    color: variable.value === 'null' ? 'var(--theia-debugTokenExpression-string)' : 'var(--theia-debugTokenExpression-value)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>{variable.value}</span>
            </div>
            {expanded && hasChildren && variable.children && variable.children.map(child => (
                <VariableNode
                    key={child.id}
                    variable={child}
                    depth={depth + 1}
                    session={session}
                    onExpand={onExpand}
                />
            ))}
            {expanded && hasChildren && !variable.children && (
                <div style={{ paddingLeft: indent + 32, fontSize: '11px', color: 'var(--theia-descriptionForeground)', padding: '2px 0' }}>
                    Loading...
                </div>
            )}
        </div>
    );
};

interface VariablesViewProps {
    state: VariablesState;
    session: DebugSession | undefined;
    onExpandVariable: (variable: DebugVariable) => void;
    onRefresh: () => void;
}

const VariablesView: React.FC<VariablesViewProps> = ({ state, session, onExpandVariable, onRefresh }) => {
    return (
        <div className="kairo-debug-variables-widget" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '12px' }}>Variables</span>
                <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                    {state.variables.length} items
                </span>
                <div style={{ flex: 1 }} />
                <button
                    className="theia-button secondary"
                    disabled={state.busy}
                    onClick={onRefresh}
                    style={{ padding: '1px 8px', fontSize: '11px' }}
                    title="Refresh variables"
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
                {!state.error && !state.busy && state.variables.length === 0 && (
                    <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                        {session ? 'No variables in current scope.' : 'No active debug session.'}
                    </div>
                )}
                {state.variables.map(v => (
                    <VariableNode
                        key={v.id}
                        variable={v}
                        depth={0}
                        session={session}
                        onExpand={onExpandVariable}
                    />
                ))}
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugVariablesWidget extends ReactWidget {
    static readonly ID = KAIRO_DEBUG_VARIABLES_FACTORY_ID;

    @inject(DebugSessionManager)
    protected readonly sessionManager!: DebugSessionManager;

    @inject(KairoDebugSessionService)
    protected readonly debugSessionService!: KairoDebugSessionService;

    protected state: VariablesState = { variables: [], busy: false, error: null, sessionId: undefined };
    protected readonly onStateChangeEmitter = new Emitter<VariablesState>();
    readonly onDidStateChange: Event<VariablesState> = this.onStateChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = KairoDebugVariablesWidget.ID;
        this.title.label = 'Variables';
        this.title.caption = 'Kairo Java Debug Variables';
        this.title.iconClass = 'codicon codicon-symbol-variable';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.sessionManager.onDidChange(() => this.update());
        this.sessionManager.onDidStopDebugSession(() => this.refresh());
        this.sessionManager.onDidDestroyDebugSession(() => this.clear());
    }

    protected onAfterShow(): void {
        this.refresh();
    }

    protected render(): React.ReactNode {
        const session = this.sessionManager.currentSession;
        return React.createElement(VariablesView, {
            state: this.state,
            session: session ?? undefined,
            onExpandVariable: (v: DebugVariable) => this.expandVariable(v),
            onRefresh: () => this.refresh(),
        });
    }

    async refresh(): Promise<void> {
        const session = this.sessionManager.currentSession;
        if (!session) {
            this.setState({ variables: [], busy: false, error: null, sessionId: undefined });
            return;
        }

        this.setState({ variables: this.state.variables, busy: true, error: null, sessionId: session.id });

        try {
            const thread = session.currentThread;
            if (!thread) {
                this.setState({ variables: [], busy: false, error: null, sessionId: session.id });
                return;
            }

            // Use batch variable processing for parallel scope fetching
            const scopeData = await this.debugSessionService.getScopesAndVariables();
            const allVars: DebugVariable[] = [];
            for (const scope of scopeData) {
                const converted = scope.variables.map((v: DebugProtocol.Variable, i: number) =>
                    mapDebugVariable(v, `${scope.scopeName}-${i}`),
                );
                allVars.push(...converted);
            }

            this.setState({ variables: allVars, busy: false, error: null, sessionId: session.id });
        } catch (error) {
            this.setState({
                variables: [],
                busy: false,
                error: error instanceof Error ? error.message : String(error),
                sessionId: session.id,
            });
        }
    }

    async expandVariable(variable: DebugVariable): Promise<void> {
        const session = this.sessionManager.currentSession;
        if (!session) return;

        // If children are already loaded, just toggle — no need to re-fetch.
        if (variable.childrenLoaded && variable.children) {
            return;
        }

        try {
            const response = await session.sendRequest('variables', { variablesReference: variable.variablesReference });
            const vars = response.body?.variables ?? [];
            const children = vars.map((v: DebugProtocol.Variable, i: number) => mapDebugVariable(v, `${variable.id}-${i}`));
            variable.children = children;
            variable.childrenLoaded = true;
            this.update();
        } catch (error) {
            // Silently ignore — children just won't load
        }
    }

    protected clear(): void {
        this.setState({ variables: [], busy: false, error: null, sessionId: undefined });
    }

    protected setState(partial: Partial<VariablesState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChangeEmitter.fire(this.state);
        this.update();
    }
}

function mapDebugVariable(v: DebugProtocol.Variable, id: string): DebugVariable {
    return {
        id,
        name: v.name,
        value: v.value,
        type: v.type ?? '',
        variablesReference: v.variablesReference,
        indexedVariables: v.indexedVariables,
        namedVariables: v.namedVariables,
        childrenLoaded: false,
    };
}