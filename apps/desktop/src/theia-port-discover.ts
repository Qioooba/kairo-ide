/**
 * Theia listen-port discovery helpers (DK-P2-5).
 *
 * Preference order when waiting for a ready frontend port:
 *   1. THEIA_PORT env — if set and the candidate is a valid port
 *      (honored by `theia start --port`; desktop's direct bundle
 *      spawn historically ignores it, so callers should health-check).
 *   2. theia-state.json in a data dir — `{ "port": N, "pid": N }`
 *      written by desktop after a successful health-checked discovery
 *      (kept separate from agent-state.json).
 *   3. Stdout/stderr log scrape — fallback only.
 *
 * Why log scrape remains a fallback: the desktop Electron shell spawns
 * apps/desktop/lib/backend/main.js under ELECTRON_RUN_AS_NODE. That
 * entry does not parse Theia CLI `--port` / THEIA_PORT and binds an
 * ephemeral port, announcing it only via
 * `Theia app listening on http://127.0.0.1:NNNN.` (see
 * @theia/core BackendApplication). Until Theia itself honors
 * THEIA_PORT, scraping those known log patterns is still needed on
 * first bind; theia-state.json then makes restart/reuse prefer the
 * file without inventing a new IPC handshake.
 */

import * as fs from 'node:fs';

/** Known Theia 1.x / 1.73 listen log shapes (first capture group = port). */
export const THEIA_LISTEN_PORT_PATTERNS: readonly RegExp[] = [
  // Canonical: "Theia app listening on http://127.0.0.1:3000."
  /Theia app listening on (?:https?:\/\/)?(?:\[[^\]]+\]|[^:\s/?#]+):(\d{2,5})\.?/i,
  // Generic: "listening on http://0.0.0.0:3000" / "listening on 127.0.0.1:3000"
  /listening on (?:https?:\/\/)?(?:\[[^\]]+\]|[^:\s/?#]+):(\d{2,5})/i,
  // Alternate: "listening on port 3000" / "Listening on port: 3000"
  /listening on port[:\s]+(\d{2,5})/i,
];

export function isValidTcpPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536;
}

export function parsePortCandidate(raw: unknown): number | undefined {
  if (typeof raw === 'number' && isValidTcpPort(raw)) return raw;
  if (typeof raw === 'string' && /^\d{2,5}$/.test(raw.trim())) {
    const n = Number.parseInt(raw.trim(), 10);
    if (isValidTcpPort(n)) return n;
  }
  return undefined;
}

/** Prefer THEIA_PORT when present and well-formed. */
export function readTheiaPortFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePortCandidate(env.THEIA_PORT);
}

export interface TheiaStateFile {
  port: number;
  pid: number;
}

/**
 * Read `{ "port": number }` from theia-state.json if present.
 */
export function readTheiaPortFromStateFile(
  statePath: string,
  readFileSync: (path: string, encoding: BufferEncoding) => string = (p, enc) =>
    fs.readFileSync(p, enc),
  existsSync: (path: string) => boolean = (p) => fs.existsSync(p),
): number | undefined {
  try {
    if (!existsSync(statePath)) return undefined;
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as { port?: unknown };
    return parsePortCandidate(raw?.port);
  } catch {
    return undefined;
  }
}

/**
 * Write `{ port, pid }` next to agent-state (0600, separate file).
 * Removes any prior file first so mode is applied on create (same
 * pattern as the Go agent's agent-state.json writer).
 */
export function writeTheiaStateFile(
  statePath: string,
  state: TheiaStateFile,
  deps: {
    unlinkSync?: (path: string) => void;
    writeFileSync?: (
      path: string,
      data: string,
      options: { encoding: BufferEncoding; mode: number },
    ) => void;
  } = {},
): void {
  if (!isValidTcpPort(state.port) || !Number.isInteger(state.pid) || state.pid <= 0) {
    throw new Error(`invalid theia state: port=${state.port} pid=${state.pid}`);
  }
  const unlinkSync = deps.unlinkSync ?? ((p) => fs.unlinkSync(p));
  const writeFileSync =
    deps.writeFileSync ??
    ((p, data, options) => fs.writeFileSync(p, data, options));
  try {
    unlinkSync(statePath);
  } catch {
    // missing is fine
  }
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/** Extract the first valid listen port from a log chunk. */
export function parseTheiaListenPort(text: string): number | undefined {
  for (const re of THEIA_LISTEN_PORT_PATTERNS) {
    const m = new RegExp(re.source, re.flags).exec(text);
    if (m) {
      const port = parsePortCandidate(m[1]);
      if (port !== undefined) return port;
    }
  }
  return undefined;
}

export interface ResolveTheiaPortOptions {
  env?: NodeJS.ProcessEnv;
  /** Absolute path to theia-state.json (optional). */
  statePath?: string;
  /** Accumulated stdout/stderr text so far. */
  logText?: string;
  readFileSync?: (path: string, encoding: BufferEncoding) => string;
  existsSync?: (path: string) => boolean;
}

/**
 * Resolve a preferred Theia port from stable signals first, then logs.
 * Returns undefined when nothing usable is available yet.
 */
export function resolvePreferredTheiaPort(
  opts: ResolveTheiaPortOptions = {},
): number | undefined {
  const fromEnv = readTheiaPortFromEnv(opts.env ?? process.env);
  if (fromEnv !== undefined) return fromEnv;

  if (opts.statePath) {
    const fromState = readTheiaPortFromStateFile(
      opts.statePath,
      opts.readFileSync,
      opts.existsSync,
    );
    if (fromState !== undefined) return fromState;
  }

  if (opts.logText) {
    return parseTheiaListenPort(opts.logText);
  }
  return undefined;
}

export function theiaPortDiscoverTimeoutMessage(
  timeoutMs: number,
  lastHint?: string,
): string {
  const hint = lastHint ? `: ${lastHint}` : '';
  return (
    `Theia backend timed out after ${timeoutMs}ms — no listen port from ` +
    `THEIA_PORT, theia-state.json, or known stdout/stderr listen lines` +
    ` (e.g. "Theia app listening on http://127.0.0.1:PORT.")${hint}`
  );
}
