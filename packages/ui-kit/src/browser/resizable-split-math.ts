/**
 * Pure layout math for ResizableSplit (REPORT UI-06 / §5.4).
 * Kept free of React/DOM so it can be unit-tested directly.
 */

export function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0.5;
    return Math.min(1, Math.max(0, v));
}

/**
 * Primary pane size in px for a ratio, clamped to
 * [primaryMin, available - secondaryMin]. Never NaN/negative.
 */
export function computePrimaryPx(available: number, ratio: number, primaryMin: number, secondaryMin: number): number {
    if (!Number.isFinite(available) || available <= 0) return 0;
    const lo = Math.max(0, primaryMin);
    const hi = Math.max(lo, available - Math.max(0, secondaryMin));
    return Math.min(hi, Math.max(lo, available * clamp01(ratio)));
}

/** Convert a pointer offset inside the container to a 0..1 ratio. */
export function computeRatioFromOffset(offsetPx: number, available: number): number {
    if (!Number.isFinite(available) || available <= 0) return 0.5;
    return clamp01(offsetPx / available);
}
