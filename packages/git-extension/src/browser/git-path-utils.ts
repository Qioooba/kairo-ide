import { FileUri } from '@theia/core/lib/common/file-uri';

/** Normalize separators and strip trailing slashes for stable comparisons. */
export function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Convert a file URI or bare path to a forward-slash filesystem path.
 * Uses FileUri so Windows `file:///G:/...` does not leave a leading `/G:`.
 */
export function uriToFsPath(uriOrPath: string): string {
  if (!uriOrPath) return '';
  if (uriOrPath.startsWith('file:')) {
    let p = normalizeFsPath(FileUri.fsPath(uriOrPath));
    // On non-Windows hosts FileUri may still yield `/G:/...` for drive URIs.
    if (/^\/[a-zA-Z]:\//.test(p)) {
      p = p.substring(1);
    }
    return p;
  }
  return normalizeFsPath(uriOrPath);
}

/**
 * Resolve a URI/path to a repo-relative forward-slash path, or undefined
 * when the path is outside the repository.
 */
export function toRepoRelativePath(uriOrPath: string, repoRoot: string): string | undefined {
  if (!repoRoot) return undefined;
  const fsPath = uriToFsPath(uriOrPath);
  const normRoot = normalizeFsPath(repoRoot);
  const lowerPath = fsPath.toLowerCase();
  const lowerRoot = normRoot.toLowerCase();

  if (lowerPath === lowerRoot) return '';
  if (lowerPath.startsWith(lowerRoot + '/')) {
    return fsPath.substring(normRoot.length + 1);
  }

  // Already relative (no drive / absolute root)
  if (!/^[a-zA-Z]:\//.test(fsPath) && !fsPath.startsWith('/') && !uriOrPath.startsWith('file:')) {
    return fsPath;
  }
  return undefined;
}

/**
 * Decode a git path that may be core.quotepath-quoted with octal escapes
 * (e.g. `"\346\226\207.txt"` for a UTF-8 Chinese filename).
 */
export function decodeGitQuotedPath(raw: string): string {
  if (!raw) return '';
  let s = raw;
  // Porcelain paths are not trimmed — leading spaces are part of the XY+space layout,
  // but callers pass the path portion only.
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') {
    return s;
  }
  s = s.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next >= '0' && next <= '7') {
        let oct = next;
        let j = i + 2;
        while (j < s.length && j < i + 4 && s[j] >= '0' && s[j] <= '7') {
          oct += s[j++];
        }
        bytes.push(parseInt(oct, 8));
        i = j - 1;
        continue;
      }
      const escapes: Record<string, number> = {
        '\\': 0x5c,
        '"': 0x22,
        n: 0x0a,
        t: 0x09,
        r: 0x0d,
        b: 0x08,
        f: 0x0c,
        a: 0x07,
        v: 0x0b,
      };
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      i++;
      continue;
    }
    bytes.push(s.charCodeAt(i));
  }
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
  }
  // Node fallback
  return Buffer.from(bytes).toString('utf8');
}

export interface ParsedPorcelainFile {
  path: string;
  status: string;
  staged: boolean;
  origPath?: string;
}

export interface ParsedPorcelainStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: ParsedPorcelainFile[];
}

function statusFromXy(xy: string): { status: string; staged: boolean } {
  const staged = xy[0] !== ' ' && xy[0] !== '?';
  // Untracked is `??` in porcelain; UI maps use a single `?`.
  if (xy === '??') return { status: '?', staged: false };
  const statusChar = xy.trim() || ' ';
  return { status: statusChar, staged };
}

function parseBranchHeader(line: string): { branch: string; ahead: number; behind: number } {
  const branchLine = line.startsWith('## ') ? line.substring(3) : line;
  let branch = '';
  let ahead = 0;
  let behind = 0;
  const spaceIdx = branchLine.indexOf(' ');
  if (spaceIdx > 0) {
    branch = branchLine.substring(0, spaceIdx).split('...')[0];
    const info = branchLine.substring(spaceIdx + 1);
    const aheadMatch = info.match(/ahead\s+(\d+)/);
    const behindMatch = info.match(/behind\s+(\d+)/);
    if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
    if (behindMatch) behind = parseInt(behindMatch[1], 10);
  } else {
    branch = branchLine.split('...')[0];
  }
  return { branch, ahead, behind };
}

/**
 * Parse `git status --porcelain[=v1] -b -z` output (NUL-separated, unquoted paths).
 */
export function parsePorcelainStatusZ(stdout: string): ParsedPorcelainStatus {
  const parts = stdout.split('\0');
  let branch = '';
  let ahead = 0;
  let behind = 0;
  const files: ParsedPorcelainFile[] = [];

  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (!part) {
      i++;
      continue;
    }
    if (part.startsWith('## ')) {
      const parsed = parseBranchHeader(part);
      branch = parsed.branch;
      ahead = parsed.ahead;
      behind = parsed.behind;
      i++;
      continue;
    }
    if (part.length >= 3) {
      const xy = part.substring(0, 2);
      const pathPart = part.substring(3);
      const { status, staged } = statusFromXy(xy);
      if (xy.includes('R') || xy.includes('C')) {
        const newPath = parts[i + 1] || '';
        files.push({
          status,
          path: newPath,
          origPath: pathPart,
          staged,
        });
        i += 2;
        continue;
      }
      files.push({
        status,
        path: pathPart,
        staged,
      });
    }
    i++;
  }

  return { branch, ahead, behind, files };
}

/**
 * Parse classic (newline) porcelain output, decoding core.quotepath escapes.
 */
export function parsePorcelainStatusLines(stdout: string): ParsedPorcelainStatus {
  const lines = stdout.trim() ? stdout.trim().split('\n') : [];
  let branch = '';
  let ahead = 0;
  let behind = 0;
  const files: ParsedPorcelainFile[] = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const parsed = parseBranchHeader(line);
      branch = parsed.branch;
      ahead = parsed.ahead;
      behind = parsed.behind;
      continue;
    }
    if (line.length >= 3) {
      const xy = line.substring(0, 2);
      const rest = line.substring(3);
      const { status, staged } = statusFromXy(xy);
      if (xy.includes('R') || xy.includes('C')) {
        const arrowIdx = rest.indexOf(' -> ');
        if (arrowIdx > 0) {
          files.push({
            status,
            path: decodeGitQuotedPath(rest.substring(arrowIdx + 4)),
            origPath: decodeGitQuotedPath(rest.substring(0, arrowIdx)),
            staged,
          });
          continue;
        }
      }
      files.push({
        status,
        path: decodeGitQuotedPath(rest),
        staged,
      });
    }
  }

  return { branch, ahead, behind, files };
}
