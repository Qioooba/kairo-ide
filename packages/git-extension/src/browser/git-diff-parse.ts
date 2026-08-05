export type DiffLineType = 'header' | 'add' | 'remove' | 'context' | 'hunk' | 'meta';

export interface DiffLine {
    type: DiffLineType;
    oldLine?: number;
    newLine?: number;
    content: string;
}

const NO_NEWLINE_RE = /^\\ No newline at end of file\s*$/;

/**
 * Parse a unified git diff into display lines with correct old/new counters.
 * Meta lines (`\ No newline at end of file`) and a trailing empty split artifact
 * do not advance line numbers (VC-P2-5).
 */
export function parseDiff(diff: string): DiffLine[] {
    const lines: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;
    const raw = diff.split('\n');

    for (let i = 0; i < raw.length; i++) {
        const line = raw[i];
        // split('\n') yields a trailing empty string when diff ends with \n
        if (line === '' && i === raw.length - 1) {
            continue;
        }
        if (NO_NEWLINE_RE.test(line)) {
            lines.push({ type: 'meta', content: line });
            continue;
        }
        if (line.startsWith('diff ') || line.startsWith('index ') ||
            line.startsWith('--- ') || line.startsWith('+++ ')) {
            lines.push({ type: 'header', content: line });
        } else if (line.startsWith('@@')) {
            const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            if (match) {
                oldLine = parseInt(match[1], 10);
                newLine = parseInt(match[3], 10);
            }
            lines.push({ type: 'hunk', content: line });
        } else if (line.startsWith('+')) {
            lines.push({ type: 'add', content: line, newLine: newLine++ });
        } else if (line.startsWith('-')) {
            lines.push({ type: 'remove', content: line, oldLine: oldLine++ });
        } else {
            // Context lines typically start with a space; bare lines are treated as context.
            lines.push({ type: 'context', content: line, oldLine: oldLine++, newLine: newLine++ });
        }
    }
    return lines;
}
