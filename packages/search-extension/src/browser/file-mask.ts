/**
 * IDEA-style file mask helpers.
 *
 * Examples:
 *   "*.java, *.xml"     → include
 *   "java, xml"         → include as *.java, *.xml
 *   "!*.min.js, *.js"   → exclude *.min.js, include *.js
 *   path globs (e.g. src folder + ** + *.java) → include with path
 */

export interface ParsedFileMask {
  include?: string[];
  exclude?: string[];
}

/** Normalize a single mask token into a glob. */
export function normalizeMaskToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return '';
  }
  // Already a glob or path pattern.
  if (trimmed.includes('*') || trimmed.includes('?') || trimmed.includes('/') || trimmed.includes('\\')) {
    return trimmed.replace(/\\/g, '/');
  }
  // Bare extension: "java" → "*.java"
  if (trimmed.startsWith('.')) {
    return `*${trimmed}`;
  }
  // Bare word without dot: treat as extension when it looks like one.
  if (/^[A-Za-z0-9_+-]+$/.test(trimmed)) {
    return `*.${trimmed}`;
  }
  return trimmed;
}

/**
 * Parse an IDEA-style file mask string into include/exclude globs.
 * Tokens starting with `!` are excludes.
 */
export function parseFileMask(mask: string): ParsedFileMask {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of mask.split(',')) {
    let token = raw.trim();
    if (!token) {
      continue;
    }
    let isExclude = false;
    if (token.startsWith('!')) {
      isExclude = true;
      token = token.slice(1).trim();
    }
    const normalized = normalizeMaskToken(token);
    if (!normalized) {
      continue;
    }
    if (isExclude) {
      exclude.push(normalized);
    } else {
      include.push(normalized);
    }
  }
  return {
    include: include.length ? [...new Set(include)] : undefined,
    exclude: exclude.length ? [...new Set(exclude)] : undefined,
  };
}

/** Merge two glob lists, deduplicating. */
export function mergeGlobs(a?: string[], b?: string[]): string[] | undefined {
  const merged = [...new Set([...(a ?? []), ...(b ?? [])].map(g => g.trim()).filter(Boolean))];
  return merged.length ? merged : undefined;
}
