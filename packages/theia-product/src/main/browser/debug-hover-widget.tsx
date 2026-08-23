import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as monaco from '@theia/monaco-editor-core';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { KairoDebugSessionService } from './kairo-debug-session-service';
import { classifyValue } from './debug-value-classify';

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
    const hasChildren = !!(child.variablesReference && child.variablesReference > 0);

    const valueClass = classifyValue(child.value);

    return (
        <div>
            <div
                className={`kairo-debug-hover-row ${hasChildren ? 'kairo-debug-hover-row--expandable' : 'kairo-debug-hover-row--leaf'}`}
                style={{ '--kairo-debug-depth': depth } as React.CSSProperties}
                onClick={() => hasChildren && onToggleExpand(child, variablesRef)}
            >
                <span
                    className={`kairo-debug-hover-chevron codicon ${hasChildren ? (child.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right') : 'kairo-debug-hover-chevron--hidden'}`}
                    aria-hidden="true"
                />
                <span className="kairo-debug-hover-name">
                    {child.name}
                </span>
                {child.type && (
                    <span className="kairo-debug-hover-type">
                        : {child.type}
                    </span>
                )}
                <span className="kairo-debug-hover-equals">=</span>
                <span className={`kairo-debug-hover-value kairo-debug-hover-value--child ${valueClass}`}>
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
            onMouseDown={e => e.stopPropagation()}
        >
            {/* Header / expression result */}
            <div
                className={`kairo-debug-hover-header ${hasChildren ? 'kairo-debug-hover-header--expandable' : 'kairo-debug-hover-header--leaf'}`}
                onClick={handleRootToggle}
            >
                {hasChildren ? (
                    <span className={`kairo-debug-hover-header-chevron codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                ) : (
                    <span className="kairo-debug-hover-header-chevron--placeholder" aria-hidden="true" />
                )}
                <div className="kairo-debug-hover-header-content">
                    <div className="kairo-debug-hover-header-line">
                        <span className="kairo-debug-hover-expression-name">
                            {result.expression}
                        </span>
                        {result.type && (
                            <span className="kairo-debug-hover-type">
                                : {result.type}
                            </span>
                        )}
                        <span className="kairo-debug-hover-equals">=</span>
                        <span className={`kairo-debug-hover-value kairo-debug-hover-value--root ${valueClass}`}>
                            {result.result}
                        </span>
                    </div>
                    {result.error && (
                        <div className="kairo-debug-hover-error">
                            {result.error}
                        </div>
                    )}
                </div>
            </div>

            {/* Children */}
            {expanded && hasChildren && (
                <div className="kairo-debug-hover-children">
                    {loadingChildren && children.length === 0 && (
                        <div className="kairo-debug-hover-loading">
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
            <div className="kairo-debug-hover-action-bar">
                <button
                    className="kairo-debug-hover-button"
                    onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(result.result).catch(() => {});
                    }}
                >
                    Copy Value
                </button>
                {onAddToWatch && (
                    <button
                        className="kairo-debug-hover-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddToWatch(result.expression);
                            onClose();
                        }}
                    >
                        + Add to Watches
                    </button>
                )}
            </div>
        </div>
    );
};

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
    let currentPosition: monaco.Position | null = null;

    function scheduleHide(delay: number) {
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = window.setTimeout(() => {
            hide();
        }, delay);
    }

    const scrollDisposable = editor.onDidScrollChange(() => {
        if (isVisible) {
            scheduleHide(100);
        }
    });

    const contentWidget: monaco.editor.IContentWidget = {
        getId: () => 'kairo-debug-hover-widget',
        getDomNode: () => {
            if (!rootDiv) {
                rootDiv = document.createElement('div');
                rootDiv.classList.add('kairo-debug-hover-root');
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
        scrollDisposable.dispose();
        hide();
    }

    return { show, hide, dispose };
}
