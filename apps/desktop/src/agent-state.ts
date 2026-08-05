/**
 * agent-state.json discovery helpers (S1).
 *
 * The Go runtime writes port/pid/bind metadata here on bind. The session
 * secret is never persisted — it lives in KAIRO_LOCAL_SECRET (agent env)
 * and desktop preload (__kairo.getSecret()).
 */

export interface AgentStateRecord {
  port: number;
  pid: number;
  bindAddress?: string;
  startedAt?: string;
}

/** Session secret from the desktop parent process env (never from state file). */
export function resolveAgentSecretFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env.KAIRO_LOCAL_SECRET || '').trim();
}

/**
 * Parse agent-state.json content. Legacy files may contain a `secret` field;
 * it is ignored and never returned.
 */
export function parseAgentStateJson(raw: string): AgentStateRecord | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const port = obj.port;
    if (typeof port !== 'number' || !Number.isFinite(port) || port <= 0) {
      return null;
    }
    const pid = obj.pid;
    const record: AgentStateRecord = {
      port,
      pid: typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : 0,
    };
    if (typeof obj.bindAddress === 'string') {
      record.bindAddress = obj.bindAddress;
    }
    if (typeof obj.startedAt === 'string') {
      record.startedAt = obj.startedAt;
    }
    return record;
  } catch {
    return null;
  }
}

/** True when JSON would persist a secret field (for tests / guards). */
export function agentStateJsonContainsSecret(raw: string): boolean {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return typeof obj.secret === 'string' && obj.secret.length > 0;
  } catch {
    return false;
  }
}
