import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as monaco from '@theia/monaco-editor-core';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { KairoDebugSessionService } from './kairo-debug-session-service';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface HoverValueResult {
    expression: string;
    result: string;
    type?: string;
    variablesReference?: number;
    children?: HoverValueChild[];
    childrenLoaded?: boolean;
    error?: string;
}

export interface HoverValueChild {
    name: string;
    value: string;
    type?: string;
    variablesReference?: number;
    children?: HoverValueChild[];
    childrenLoaded?: boolean;
    expanded?: boolean;
}

interface DebugHoverWidgetProps {
    result: HoverValueResult;
    sessionService: KairoDebugSessionService;
    onSetValue?: () => void;
    onAddToWatch?: (expression: string) => void;
    onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Child Node Component                                                */
/* ------------------------------------------------------------------ */

interface HoverChildNodeProps {
    child: HoverValueChild;
    depth: number;
    sessionService: KairoDebugSessionService;
    variablesRef: number;
    onToggleExpand: (child: HoverValueChild, variablesRef: number) => void;
}

const HoverChildNode: React.FC<HoverChildNodeProps> = ({
    child, depth, sessionService, variablesRef, onToggleExpand,
}) => {
    const hasChildren = child.variablesReference && child.variablesReference > 0;
    const indent = depth * 12;

    const valueClass = classifyValue(child.value);

    return (
        <div>
            <div
                style={{
                    paddingLeft: indent + 4,
                    paddingRight: 4,
                    paddingTop: 1,
                    paddingBottom: 1,
                    cursor: hasChildren ? 'pointer' : 'default',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '11px',
                    lineHeight: '16px',
                    whiteSpace: 'nowrap',
                }}
                onClick={() => hasChildren && onToggleExpand(child, variablesRef)}
            >
                <span style={{ width: 10, textAlign: 'center', fontSize: '8px', flexShrink: 0, opacity: 0.6 }}>
                    {hasChildren ? (child.expanded ? '▾' : '▸') : ' '}
                </span>
                <span style={{ color: 'var(--theia-debugTokenExpression-name)', flexShrink: 0 }}>
                    {child.name}
                </span>
                {child.type && (
                    <>
                        <span style={{ color: 'var(--theia-debugTokenExpression-type)', opacity: 0.7, fontSize: '10px', flexShrink: 0 }}>
                            : {child.type}
                        </span>
                    </>
                )}
                <span style={{ color: 'var(--theia-debugTokenExpression-type)', flexShrink: 0 }}>=</span>
                <span className={`kairo-debug-hover-value ${valueClass}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {child.value}
                </span>
            </div>
            {child.expanded && child.children && child.children.map((c, i) => (
                <HoverChildNode
                    key={`${child.name}-${i}`}
                    child={c}
                    depth={depth + 1}
                    sessionService={sessionService}
                    variablesRef={child.variablesReference ?? 0}
                    onToggleExpand={onToggleExpand}
                />
            ))}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Main Hover Widget                                                   */
/* ------------------------------------------------------------------ */

const DebugHoverWidgetContent: React.FC<DebugHoverWidgetProps> = ({
    result, sessionService, onAddToWatch, onClose,
}) => {
    const [children, setChildren] = React.useState<HoverValueChild[]>([]);
    const [loadingChildren, setLoadingChildren] = React.useState(false);
    const [expanded, setExpanded] = React.useState(false);

    const valueClass = classifyValue(result.result);
    const hasChildren = (result.variablesReference ?? 0) > 0;

    const loadChildren = React.useCallback(async () => {
        if (!result.variablesReference || loadingChildren) return;
        setLoadingChildren(true);
        try {
            const vars = await sessionService.getVariables(result.variablesReference);
            const mapped: HoverValueChild[] = vars.map(v => ({
                name: v.name,
                value: v.value,
                type: v.type,
                variablesReference: v.variablesReference,
                childrenLoaded: false,
                expanded: false,
            }));
            setChildren(mapped);
        } catch {
            // ignore
        } finally {
            setLoadingChildren(false);
        }
    }, [result.variablesReference, loadingChildren, sessionService]);

    const toggleChildExpand = React.useCallback(async (child: HoverValueChild, ref: number) => {
        if (!child.expanded && (!child.childrenLoaded || !child.children)) {
            if (child.variablesReference && child.variablesReference > 0) {
                child.expanded = true;
                setChildren([...children]);
                setLoadingChildren(true);
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
                } finally {
                    setLoadingChildren(false);
                    setChildren([...children]);
                }
            }
        } else {
            child.expanded = !child.expanded;
            setChildren([...children]);
        }
    }, [children, sessionService]);

    const handleRootToggle = () => {
        if (!hasChildren) return;
        if (!expanded) {
            setExpanded(true);
            if (children.length === 0) {
                loadChildren();
            }
        } else {
            setExpanded(false);
        }
    };

    return (
        <div
            className="kairo-debug-hover-widget"
            style={{
                background: 'var(--theia-editorWidget-background)',
                border: '1px solid var(--theia-editorWidget-border)',
                borderRadius: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                minWidth: 200,
                maxWidth: 400,
                maxHeight: 350,
                overflow: 'auto',
                fontSize: '11px',
                fontFamily: 'var(--theia-monaco-font-family, monospace)',
                zIndex: 10000,
                userSelect: 'text',
            }}
            onMouseDown={e => e.stopPropagation()}
        >
            {/* Header / expression result */}
            <div
                style={{
                    padding: '6px 8px 4px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 4,
                    cursor: hasChildren ? 'pointer' : 'default',
                    borderBottom: hasChildren ? '1px solid var(--theia-panel-border)' : 'none',
                }}
                onClick={handleRootToggle}
            >
                {hasChildren && (
                    <span style={{ fontSize: '8px', marginTop: 3, flexShrink: 0, opacity: 0.6 }}>
                        {expanded ? '▾' : '▸'}
                    </span>
                )}
                {!hasChildren && <span style={{ width: 8, flexShrink: 0 }} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--theia-debugTokenExpression-name)', fontWeight: 600 }}>
                            {result.expression}
                        </span>
                        {result.type && (
                            <span style={{ color: 'var(--theia-debugTokenExpression-type)', fontSize: '10px' }}>
                                : {result.type}
                            </span>
                        )}
                        <span style={{ color: 'var(--theia-debugTokenExpression-type)' }}>=</span>
                        <span className={`kairo-debug-hover-value ${valueClass}`} style={{ wordBreak: 'break-all' }}>
                            {result.result}
                        </span>
                    </div>
                    {result.error && (
                        <div style={{ color: 'var(--theia-errorForeground)', fontSize: '10px', marginTop: 2 }}>
                            {result.error}
                        </div>
                    )}
                </div>
            </div>

            {/* Children */}
            {expanded && hasChildren && (
                <div style={{ padding: '2px 0' }}>
                    {loadingChildren && children.length === 0 && (
                        <div style={{ padding: '4px 8px', color: 'var(--theia-descriptionForeground)', fontStyle: 'italic', fontSize: '10px' }}>
                            Loading...
                        </div>
                    )}
                    {children.map((child, i) => (
                        <HoverChildNode
                            key={`root-${i}`}
                            child={child}
                            depth={0}
                            sessionService={sessionService}
                            variablesRef={result.variablesReference ?? 0}
                            onToggleExpand={toggleChildExpand}
                        />
                    ))}
                </div>
            )}

            {/* Action bar */}
            <div
                style={{
                    padding: '4px 8px',
                    borderTop: '1px solid var(--theia-panel-border)',
                    display: 'flex',
                    gap: 8,
                    background: 'rgba(255,255,255,0.02)',
                }}
            >
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(result.result).catch(() => {});
                    }}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--theia-textLink-foreground)',
                        cursor: 'pointer',
                        fontSize: '10px',
                        padding: '1px 4px',
                    }}
                >
                    Copy Value
                </button>
                {onAddToWatch && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddToWatch(result.expression);
                            onClose();
                        }}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--theia-textLink-foreground)',
                            cursor: 'pointer',
                            fontSize: '10px',
                            padding: '1px 4px',
                        }}
                    >
                        + Add to Watches
                    </button>
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

/* ------------------------------------------------------------------ */
/*  Monaco Content Widget Wrapper                                       */
/* ------------------------------------------------------------------ */

export interface DebugHoverWidgetInstance {
    dispose: () => void;
    show: (position: { lineNumber: number; column: number }, result: HoverValueResult) => void;
    hide: () => void;
}

export function createDebugHoverWidget(
    editor: monaco.editor.ICodeEditor,
    sessionService: KairoDebugSessionService,
    onAddToWatch?: (expr: string) => void,
): DebugHoverWidgetInstance {
    let rootDiv: HTMLDivElement | null = null;
    let root: Root | null = null;
    let isVisible = false;
    let hideTimeout: number | null = null;

    const contentWidget: monaco.editor.IContentWidget = {
        getId: () => 'kairo-debug-hover-widget',
        getDomNode: () => {
            if (!rootDiv) {
                rootDiv = document.createElement('div');
                rootDiv.style.position = 'absolute';
                rootDiv.style.pointerEvents = 'auto';
                rootDiv.addEventListener('mouseenter', () => {
                    if (hideTimeout) {
                        clearTimeout(hideTimeout);
                        hideTimeout = null;
                    }
                });
                rootDiv.addEventListener('mouseleave', () => {
                    scheduleHide(300);
                });
            }
            return rootDiv;
        },
        getPosition: () => {
            if (!currentPosition) return null;
            return {
                position: currentPosition,
                preference: [
                    monaco.editor.ContentWidgetPositionPreference.BELOW,
                    monaco.editor.ContentWidgetPositionPreference.ABOVE,
                ],
            };
        },
    };

    let currentPosition: monaco.Position | null = null;

    function scheduleHide(delay: number) {
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = window.setTimeout(() => {
            hide();
        }, delay);
    }

    function show(position: { lineNumber: number; column: number }, result: HoverValueResult) {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        currentPosition = new monaco.Position(position.lineNumber, position.column);
        if (!isVisible) {
            editor.addContentWidget(contentWidget);
            isVisible = true;
        }
        editor.layoutContentWidget(contentWidget);

        if (!rootDiv) {
            contentWidget.getDomNode();
        }
        if (rootDiv && root) {
            root.unmount();
        }
        if (rootDiv) {
            root = createRoot(rootDiv);
            root.render(
                React.createElement(DebugHoverWidgetContent, {
                    result,
                    sessionService,
                    onAddToWatch,
                    onClose: hide,
                }),
            );
        }
    }

    function hide() {
        if (!isVisible) return;
        isVisible = false;
        editor.removeContentWidget(contentWidget);
        if (root) {
            root.unmount();
            root = null;
        }
        if (rootDiv) {
            rootDiv.remove();
            rootDiv = null;
        }
        currentPosition = null;
    }

    function dispose() {
        hide();
    }

    editor.onDidScrollChange(() => {
        if (isVisible) {
            scheduleHide(100);
        }
    });

    return { show, hide, dispose };
}
