/**
 * Shared debug-value classification for Variables / Watches / Hover widgets.
 * Keeps color/class heuristics in one place (TP-P3-4).
 */

export type DebugValueKind = 'null' | 'string' | 'number' | 'object' | 'error' | '';

const VALUE_COLORS: Record<DebugValueKind | 'default', string> = {
    null: 'var(--theia-debugTokenExpression-name)',
    string: 'var(--theia-debugTokenExpression-string)',
    number: 'var(--theia-debugTokenExpression-number)',
    object: 'var(--theia-debugTokenExpression-value)',
    error: 'var(--theia-errorForeground)',
    '': 'var(--theia-debugTokenExpression-value)',
    default: 'var(--theia-debugTokenExpression-value)',
};

export function classifyValue(value: string): DebugValueKind {
    if (value === 'null' || value === 'undefined') return 'null';
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return 'string';
    if (/^-?\d/.test(value) || value === 'true' || value === 'false') return 'number';
    if (value.startsWith('{') || value.startsWith('[')) return 'object';
    if (value.includes('Exception') || value.includes('Error')) return 'error';
    return '';
}

export function getValueStyle(value: string): { cls: DebugValueKind; style: { color: string } } {
    const cls = classifyValue(value);
    return { cls, style: { color: VALUE_COLORS[cls] || VALUE_COLORS.default } };
}

export function getIconColor(type: string | undefined, value: string): string {
    const cls = classifyValue(value);
    if (cls === 'null' || cls === 'string' || cls === 'number') {
        return VALUE_COLORS[cls];
    }
    void type;
    return 'var(--theia-symbolIcon-variableForeground, var(--theia-symbolIcon-foreground))';
}
