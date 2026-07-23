export type LogStream = 'stdout' | 'stderr' | 'structured';
export type LogLevel = 'error' | 'warning' | 'info';
export interface KairoLogLine { line: string; ts: string; stream: LogStream; level: LogLevel; source?: string; ordinal?: number; }

export class BoundedLogBuffer {
    protected lines: KairoLogLine[] = [];
    protected bytes = 0;
    constructor(readonly maxLines = 5000, readonly maxBytes = 2 * 1024 * 1024) {}
    get snapshot(): readonly KairoLogLine[] { return this.lines; }
    get byteLength(): number { return this.bytes; }
    append(...entries: KairoLogLine[]): void {
        for (const entry of entries) {
            const size = byteLength(entry);
            if (size > this.maxBytes) continue;
            this.lines.push(entry); this.bytes += size;
            while (this.lines.length > this.maxLines || this.bytes > this.maxBytes) this.bytes -= byteLength(this.lines.shift()!);
        }
    }
    replace(entries: readonly KairoLogLine[]): void { this.clear(); this.append(...entries); }
    clear(): void { this.lines = []; this.bytes = 0; }
}

export function normalizeLogEntry(entry: any): KairoLogLine {
    const raw = entry?.line ?? entry?.message ?? entry;
    const line = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const stream: LogStream = entry?.stream === 'stderr' || entry?.level === 'stderr' ? 'stderr' : (typeof raw === 'object' ? 'structured' : 'stdout');
    const lower = line.toLowerCase();
    const level: LogLevel = stream === 'stderr' || /error|exception|fatal|severe|fail/.test(lower) ? 'error' : (/warn|warning/.test(lower) ? 'warning' : 'info');
    const normalized: KairoLogLine = { line, ts: String(entry?.ts ?? new Date().toISOString()), stream, level };
    if (typeof entry?.source === 'string') normalized.source = entry.source;
    if (typeof entry?.ordinal === 'number') normalized.ordinal = entry.ordinal;
    return normalized;
}

export class HistoryDeltaTracker {
    protected initialized = false;
    protected seen = new Set<string>();
    protected maxOrdinal = new Map<string, number>();
    reset(): void { this.initialized = false; this.seen.clear(); this.maxOrdinal.clear(); }
    next(history: readonly KairoLogLine[]): { initial: boolean; additions: readonly KairoLogLine[] } {
        const initial = !this.initialized;
        const currentMax = new Map<string, number>();
        for (const entry of history) {
            if (entry.source && entry.ordinal !== undefined) currentMax.set(entry.source, Math.max(currentMax.get(entry.source) ?? -1, entry.ordinal));
        }
        for (const [source, max] of currentMax) {
            const previous = this.maxOrdinal.get(source);
            if (previous !== undefined && max < previous) {
                for (const key of this.seen) if (key.startsWith(`${source}\u0000`)) this.seen.delete(key);
            }
        }
        const additions = initial ? [...history] : history.filter(entry => !this.seen.has(logIdentity(entry)));
        for (const entry of history) this.seen.add(logIdentity(entry));
        this.maxOrdinal = currentMax;
        this.initialized = true;
        if (this.seen.size > 10000) this.seen = new Set(history.map(logIdentity));
        return { initial, additions };
    }
}

export function logIdentity(entry: KairoLogLine): string {
    return entry.source && entry.ordinal !== undefined
        ? `${entry.source}\u0000${entry.ordinal}\u0000${entry.stream}\u0000${entry.line}`
        : `${entry.ts}\u0000${entry.stream}\u0000${entry.line}`;
}

export function filterLogLines(lines: readonly KairoLogLine[], text: string, stream: 'all' | LogStream): readonly KairoLogLine[] {
    const needle = text.trim().toLocaleLowerCase();
    return lines.filter(line =>
        (stream === 'all' || line.stream === stream)
        && (!needle || line.line.toLocaleLowerCase().includes(needle))
    );
}

export function mergeLogHistory(history: readonly KairoLogLine[], live: readonly KairoLogLine[]): readonly KairoLogLine[] {
    const merged: KairoLogLine[] = [];
    const seen = new Set<string>();
    for (const entry of [...history, ...live]) {
        const key = `${entry.ts}\u0000${entry.stream}\u0000${entry.line}`;
        if (!seen.has(key)) { seen.add(key); merged.push(entry); }
    }
    return merged;
}

export function safeLogFilename(serverId: string): string {
    const safeServerId = serverId.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'logs';
    return `kairo-tomcat-${safeServerId}.log`;
}

function byteLength(entry: KairoLogLine): number { return new TextEncoder().encode(`${entry.ts}\t${entry.stream}\t${entry.line}\n`).byteLength; }
