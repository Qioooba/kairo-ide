/**
 * Kairo ResizableSplit — shared internal split pane for tool windows.
 *
 * Used by the debug tool window (frames/breakpoints, variables/watches)
 * and the SQL console (editor/results). This component only manages the
 * *internal* split of a widget; the outer dock layout stays with
 * Theia/Lumino and must NOT be replaced by this component.
 *
 * Behavior (REPORT UI-06 / §5.4):
 *  - Mouse drag via PointerEvent + pointer capture; DOM writes merged
 *    with requestAnimationFrame; persisted only on drag end.
 *  - Keyboard: separator is focusable (role=separator) with Arrow keys,
 *    Home/End, and a reset entry point.
 *  - Collapsible primary/secondary with previous-ratio restore.
 *  - Ratio persisted per storageKey (workspace + widget + split id);
 *    a clamped ratio caused by a temporarily tiny container never
 *    overwrites the persisted large-screen ratio.
 *  - Bounds are computed from the *container* size minus the separator;
 *    when available < minPrimary + minSecondary the split enters a
 *    controlled overflow/collapse strategy instead of NaN/negative sizes.
 */

import * as React from 'react';
import { clamp01, computePrimaryPx, computeRatioFromOffset } from './resizable-split-math';

export interface SplitLayoutState {
    schemaVersion: 1;
    ratio: number;
    collapsed: 'primary' | 'secondary' | null;
    previousRatio: number;
}

export interface ResizableSplitProps {
    /**
     * Direction of the separator bar itself ('horizontal' = bar runs
     * horizontally, panels stack vertically; 'vertical' = bar runs
     * vertically, panels sit side by side).
     */
    orientation: 'horizontal' | 'vertical';
    primaryMinPx: number;
    secondaryMinPx: number;
    defaultRatio: number;
    /** workspace + widget + logical split id, e.g. 'ws1:debug:frames-breakpoints' */
    storageKey: string;
    primaryLabel: string;
    secondaryLabel: string;
    primary: React.ReactNode;
    secondary: React.ReactNode;
    /** Test id prefix, defaults to 'resizable-split'. */
    testId?: string;
}

const SCHEMA_VERSION = 1 as const;
const STORAGE_PREFIX = 'kairo.split.';
const SEPARATOR_PX = 6;

export { clamp01, computePrimaryPx, computeRatioFromOffset };

function loadState(storageKey: string, defaultRatio: number): SplitLayoutState {
    const fallback: SplitLayoutState = {
        schemaVersion: SCHEMA_VERSION,
        ratio: clamp01(defaultRatio),
        collapsed: null,
        previousRatio: clamp01(defaultRatio),
    };
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as Partial<SplitLayoutState>;
        if (parsed.schemaVersion !== SCHEMA_VERSION) return fallback;
        return {
            schemaVersion: SCHEMA_VERSION,
            ratio: clamp01(parsed.ratio ?? fallback.ratio),
            collapsed: parsed.collapsed === 'primary' || parsed.collapsed === 'secondary' ? parsed.collapsed : null,
            previousRatio: clamp01(parsed.previousRatio ?? parsed.ratio ?? fallback.ratio),
        };
    } catch {
        return fallback;
    }
}

export const ResizableSplit: React.FC<ResizableSplitProps> = ({
    orientation,
    primaryMinPx,
    secondaryMinPx,
    defaultRatio,
    storageKey,
    primaryLabel,
    secondaryLabel,
    primary,
    secondary,
    testId = 'resizable-split',
}) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const separatorRef = React.useRef<HTMLDivElement | null>(null);
    const [layout, setLayout] = React.useState<SplitLayoutState>(() => loadState(storageKey, defaultRatio));
    const [containerPx, setContainerPx] = React.useState(0);
    const layoutRef = React.useRef(layout);
    layoutRef.current = layout;
    const dragRef = React.useRef<{ startOffset: number; startRatio: number; pointerId: number } | null>(null);
    const rafRef = React.useRef<number | undefined>(undefined);
    const persistTimer = React.useRef<number | undefined>(undefined);

    const vertical = orientation === 'vertical';

    // Observe the host container size; pause measurement while hidden (size 0).
    React.useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            const size = vertical ? entry.contentRect.width : entry.contentRect.height;
            if (size > 0) setContainerPx(size);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [vertical]);

    const persist = React.useCallback((next: SplitLayoutState) => {
        // Persist on drag end / discrete actions only, never per-frame.
        if (persistTimer.current !== undefined) window.clearTimeout(persistTimer.current);
        persistTimer.current = window.setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(next));
            } catch {
                // Storage may be unavailable; layout still works in-memory.
            }
        }, 120);
    }, [storageKey]);

    React.useEffect(() => () => {
        if (persistTimer.current !== undefined) window.clearTimeout(persistTimer.current);
        if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    }, []);

    const available = Math.max(0, containerPx - SEPARATOR_PX);
    const canFitBoth = available >= primaryMinPx + secondaryMinPx;
    const effectiveRatio = layout.collapsed === 'primary' ? 0 : layout.collapsed === 'secondary' ? 1 : layout.ratio;
    const primaryPx = layout.collapsed === 'primary'
        ? 0
        : layout.collapsed === 'secondary'
            ? available
            : canFitBoth
                ? computePrimaryPx(available, layout.ratio, primaryMinPx, secondaryMinPx)
                : available * clamp01(layout.ratio);

    const applyRatioLive = React.useCallback((ratio: number) => {
        // Live update without persisting; persistence happens on pointer up.
        setLayout(prev => ({ ...prev, collapsed: null, ratio: clamp01(ratio) }));
    }, []);

    const commitRatio = React.useCallback((ratio: number) => {
        setLayout(prev => {
            const next: SplitLayoutState = { ...prev, collapsed: null, ratio: clamp01(ratio), previousRatio: clamp01(ratio) };
            persist(next);
            return next;
        });
    }, [persist]);

    const offsetOf = React.useCallback((clientX: number, clientY: number): number => {
        const el = containerRef.current;
        if (!el) return 0;
        const rect = el.getBoundingClientRect();
        return vertical ? clientX - rect.left : clientY - rect.top;
    }, [vertical]);

    const onSeparatorPointerDown = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const size = (vertical ? rect.width : rect.height) - SEPARATOR_PX;
        if (size <= 0) return;
        dragRef.current = {
            startOffset: vertical ? e.clientX - rect.left : e.clientY - rect.top,
            startRatio: layoutRef.current.collapsed
                ? layoutRef.current.previousRatio
                : layoutRef.current.ratio,
            pointerId: e.pointerId,
        };
        try {
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        } catch {
            // Pointer capture is best-effort (e.g. synthetic events in tests).
        }
        e.preventDefault();
    }, [vertical]);

    const onSeparatorPointerMove = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const size = (vertical ? rect.width : rect.height) - SEPARATOR_PX;
        if (size <= 0) return;
        const offset = (vertical ? e.clientX - rect.left : e.clientY - rect.top);
        // Compensate grab offset so the panel edge follows the pointer.
        const delta = offset - drag.startOffset;
        const startPx = drag.startRatio * size;
        const ratio = computeRatioFromOffset(startPx + delta, size);
        if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = undefined;
            applyRatioLive(ratio);
        });
    }, [applyRatioLive, vertical]);

    const endDrag = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        dragRef.current = null;
        if (rafRef.current !== undefined) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = undefined;
        }
        // Persist the settled ratio; a clamp caused by a tiny container is
        // stored only as the live ratio — previousRatio keeps the large-screen
        // expectation so restoring space recovers it.
        const settled = layoutRef.current;
        persist({ ...settled, previousRatio: settled.ratio });
        try {
            if (separatorRef.current?.hasPointerCapture(e.pointerId)) {
                separatorRef.current.releasePointerCapture(e.pointerId);
            }
        } catch {
            // ignore
        }
    }, [persist]);

    const onSeparatorKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        const step = 0.05;
        const bigStep = 0.2;
        let next: number | null = null;
        const decrease = vertical ? e.key === 'ArrowLeft' : e.key === 'ArrowUp';
        const increase = vertical ? e.key === 'ArrowRight' : e.key === 'ArrowDown';
        if (decrease) next = effectiveRatio - (e.shiftKey ? bigStep : step);
        else if (increase) next = effectiveRatio + (e.shiftKey ? bigStep : step);
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = 1;
        else return;
        e.preventDefault();
        commitRatio(clamp01(next));
    }, [commitRatio, effectiveRatio, vertical]);

    const toggleCollapse = React.useCallback((which: 'primary' | 'secondary') => {
        setLayout(prev => {
            let next: SplitLayoutState;
            if (prev.collapsed === which) {
                next = { ...prev, collapsed: null, ratio: prev.previousRatio };
            } else {
                next = { ...prev, collapsed: which, previousRatio: prev.collapsed ? prev.previousRatio : prev.ratio };
            }
            persist(next);
            return next;
        });
        separatorRef.current?.focus();
    }, [persist]);

    const resetLayout = React.useCallback(() => {
        const next: SplitLayoutState = {
            schemaVersion: SCHEMA_VERSION,
            ratio: clamp01(defaultRatio),
            collapsed: null,
            previousRatio: clamp01(defaultRatio),
        };
        setLayout(next);
        persist(next);
    }, [defaultRatio, persist]);

    const primaryId = `${testId}-primary`;
    const secondaryId = `${testId}-secondary`;

    return (
        <div
            ref={containerRef}
            className={`kairo-resizable-split kairo-resizable-split-${orientation}`}
            data-testid={testId}
        >
            <div
                id={primaryId}
                className="kairo-resizable-split-pane kairo-resizable-split-primary"
                data-testid={`${testId}-primary`}
                role="group"
                aria-label={primaryLabel}
                style={vertical
                    ? { flex: `0 0 ${primaryPx}px`, minWidth: 0, overflow: canFitBoth || layout.collapsed ? 'hidden' : 'auto' }
                    : { flex: `0 0 ${primaryPx}px`, minHeight: 0, overflow: canFitBoth || layout.collapsed ? 'hidden' : 'auto' }}
            >
                {layout.collapsed !== 'primary' && primary}
            </div>
            <div
                ref={separatorRef}
                className="kairo-resizable-split-separator"
                data-testid={`${testId}-separator`}
                role="separator"
                aria-orientation={vertical ? 'vertical' : 'horizontal'}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(effectiveRatio * 100)}
                aria-label={`${primaryLabel} / ${secondaryLabel} splitter`}
                aria-controls={`${primaryId} ${secondaryId}`}
                tabIndex={0}
                onPointerDown={onSeparatorPointerDown}
                onPointerMove={onSeparatorPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onKeyDown={onSeparatorKeyDown}
                onDoubleClick={resetLayout}
                title={`${primaryLabel} / ${secondaryLabel} — drag or use arrow keys, double-click to reset`}
            >
                <div className="kairo-resizable-split-grip" aria-hidden="true" />
            </div>
            <div
                id={secondaryId}
                className="kairo-resizable-split-pane kairo-resizable-split-secondary"
                data-testid={`${testId}-secondary`}
                role="group"
                aria-label={secondaryLabel}
                style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
            >
                {layout.collapsed !== 'secondary' && secondary}
            </div>
            <div className="kairo-resizable-split-tools" data-testid={`${testId}-tools`}>
                <button
                    type="button"
                    className="kairo-resizable-split-tool"
                    data-testid={`${testId}-collapse-primary`}
                    onClick={() => toggleCollapse('primary')}
                    aria-pressed={layout.collapsed === 'primary'}
                    title={layout.collapsed === 'primary' ? `Expand ${primaryLabel}` : `Collapse ${primaryLabel}`}
                >
                    {layout.collapsed === 'primary' ? '+' : '–'}
                    <span className="kairo-resizable-split-tool-label">{primaryLabel}</span>
                </button>
                <button
                    type="button"
                    className="kairo-resizable-split-tool"
                    data-testid={`${testId}-reset`}
                    onClick={resetLayout}
                    title="Reset split to default"
                >
                    Reset
                </button>
                <button
                    type="button"
                    className="kairo-resizable-split-tool"
                    data-testid={`${testId}-collapse-secondary`}
                    onClick={() => toggleCollapse('secondary')}
                    aria-pressed={layout.collapsed === 'secondary'}
                    title={layout.collapsed === 'secondary' ? `Expand ${secondaryLabel}` : `Collapse ${secondaryLabel}`}
                >
                    {layout.collapsed === 'secondary' ? '+' : '–'}
                    <span className="kairo-resizable-split-tool-label">{secondaryLabel}</span>
                </button>
            </div>
        </div>
    );
};
