/**
 * Desktop main-process child lifecycle helpers (DK-P2-2 / DK-P2-3).
 *
 * Thin wrapper around ProcessManager for the agent/theia children that
 * main.ts owns. Keeps the agentStartedByUs guard and sync force-kill
 * path testable without loading Electron.
 *
 * DK-P2-1: reused agents are stopped on quit by default (Desktop + Browser
 * may share one kairo-runtime). Set KAIRO_KEEP_REUSED_AGENT=1 to leave a
 * reused agent running after verifying the PID's command line contains
 * "kairo-runtime". There is no /api/v1/runtime/shutdown —
 * only /api/v1/runtime/restart, which respawns and is the wrong tool.
 */

import { spawnSync, ChildProcess } from 'child_process';
import * as fs from 'node:fs';
import {
  ProcessManager,
  ShutdownOptions,
  ShutdownResult,
  killProcessTree,
} from './process-manager';

export type ChildLabel = 'agent' | 'theia';

const DEFAULT_STOP: ShutdownOptions = {
  termTimeoutMs: 5_000,
  killTimeoutMs: 5_000,
  totalTimeoutMs: 12_000,
};

/** True when quit should tear down a reused (not-spawned-by-us) agent. */
export function shouldKillReusedAgent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.KAIRO_KEEP_REUSED_AGENT !== '1';
}

/** Heuristic: process command line belongs to kairo-runtime. */
export function commandLineLooksLikeKairoRuntime(cmdline: string): boolean {
  return /kairo-runtime/i.test(cmdline);
}

/**
 * Best-effort process command-line lookup (Windows: wmic / PowerShell;
 * Unix: /proc/PID/cmdline or ps). Returns undefined when unavailable.
 */
export function readProcessCommandLine(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === 'win32') {
      // Prefer PowerShell CIM — more reliable than wmic on recent Windows.
      const ps = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: 'utf8', timeout: 5_000 },
      );
      const out = (ps.stdout || '').trim();
      if (out) return out;
      const wmic = spawnSync(
        'wmic',
        ['process', 'where', `processid=${pid}`, 'get', 'commandline', '/value'],
        { encoding: 'utf8', timeout: 5_000 },
      );
      const m = /CommandLine=(.+)/i.exec(wmic.stdout || '');
      return m?.[1]?.trim() || undefined;
    }
    const procPath = `/proc/${pid}/cmdline`;
    if (fs.existsSync(procPath)) {
      const raw = fs.readFileSync(procPath, 'utf8');
      return raw.replace(/\0/g, ' ').trim() || undefined;
    }
    const ps = spawnSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    return (ps.stdout || '').trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Read pid from agent-state.json when present and well-formed. */
export function readAgentStatePid(
  statePath: string,
  readFileSync: (path: string, encoding: BufferEncoding) => string = (p, enc) =>
    fs.readFileSync(p, enc),
  existsSync: (path: string) => boolean = (p) => fs.existsSync(p),
): number | undefined {
  try {
    if (!existsSync(statePath)) return undefined;
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as { pid?: unknown };
    if (typeof raw.pid === 'number' && Number.isInteger(raw.pid) && raw.pid > 0) {
      return raw.pid;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Confirm a PID is (still) a kairo-runtime process before killing a
 * reused agent. Refuses when the command line cannot be read — better
 * leave an orphan than kill the wrong process after PID reuse.
 */
export function verifyKairoRuntimePid(
  pid: number,
  readCmdline: (pid: number) => string | undefined = readProcessCommandLine,
): { ok: true; cmdline: string } | { ok: false; reason: string } {
  const cmdline = readCmdline(pid);
  if (!cmdline) {
    return { ok: false, reason: `could not read command line for pid ${pid}` };
  }
  if (!commandLineLooksLikeKairoRuntime(cmdline)) {
    return {
      ok: false,
      reason: `pid ${pid} command line does not contain kairo-runtime`,
    };
  }
  return { ok: true, cmdline };
}

export class ChildLifecycle {
  readonly manager: ProcessManager;
  /** true if this desktop session spawned the agent (vs reused). */
  agentStartedByUs = false;
  /** Absolute path to agent-state.json when known (reuse + spawn). */
  agentStatePath = '';
  /** Overridable for tests — defaults to OS process cmdline lookup. */
  readCmdline: (pid: number) => string | undefined = readProcessCommandLine;
  private readonly log: (message: string) => void;

  constructor(onDiagnostic?: (message: string) => void) {
    this.log = onDiagnostic ?? ((msg) => console.log(msg));
    this.manager = new ProcessManager(onDiagnostic);
  }

  /** Track a freshly spawned agent or theia child. */
  register(label: ChildLabel, proc: ChildProcess): void {
    this.manager.register(label, proc);
  }

  /**
   * Gracefully stop the agent we started, or a reused agent (after
   * verifying the PID command line contains kairo-runtime). Set
   * KAIRO_KEEP_REUSED_AGENT=1 to leave a reused agent running.
   */
  async stopAgent(opts: ShutdownOptions = DEFAULT_STOP): Promise<ShutdownResult | null> {
    if (this.agentStartedByUs) {
      return this.manager.shutdownOne('agent', opts);
    }

    if (!shouldKillReusedAgent()) {
      const tracked = this.manager.get('agent');
      const pidHint =
        tracked?.pid ??
        (this.agentStatePath ? readAgentStatePid(this.agentStatePath) : undefined);
      this.log(
        `[kairo] KAIRO_KEEP_REUSED_AGENT=1 — leaving reused agent running` +
          (pidHint ? ` (pid=${pidHint})` : ''),
      );
      return null;
    }

    const pid = this.resolveReusedAgentPid();
    if (pid === undefined) {
      this.log('[kairo] reused agent PID unavailable — skip stop');
      return null;
    }

    const verified = verifyKairoRuntimePid(pid, this.readCmdline);
    if (!verified.ok) {
      this.log(`[kairo] refusing to kill reused agent: ${verified.reason}`);
      return null;
    }

    this.log(
      `[kairo] stopping reused agent pid=${pid}`,
    );
    this.manager.registerByPid('agent', pid);
    return this.manager.shutdownOne('agent', opts);
  }

  /** Gracefully stop the Theia backend child. */
  async stopTheia(opts: ShutdownOptions = DEFAULT_STOP): Promise<ShutdownResult> {
    return this.manager.shutdownOne('theia', opts);
  }

  /**
   * Stop Theia then the owned (or optionally reused) agent.
   */
  async stopOwned(opts: ShutdownOptions = DEFAULT_STOP): Promise<ShutdownResult[]> {
    const results: ShutdownResult[] = [];
    results.push(await this.stopTheia(opts));
    const agentResult = await this.stopAgent(opts);
    if (agentResult) {
      results.push(agentResult);
    }
    return results;
  }

  /**
   * Best-effort sync tree kill for process.on('exit') / before-quit
   * zombie sweep. Uses PIDs from the registry so cleared ChildProcess
   * refs cannot skip escalation. Reused agents are only force-killed
   * when KAIRO_KEEP_REUSED_AGENT=1 is not set and the PID verifies.
   */
  forceKillOwnedSync(): void {
    this.forceKillLabelSync('theia');
    if (this.agentStartedByUs) {
      this.forceKillLabelSync('agent');
      return;
    }
    if (!shouldKillReusedAgent()) {
      return;
    }
    const pid = this.resolveReusedAgentPid();
    if (pid === undefined) return;
    const verified = verifyKairoRuntimePid(pid, this.readCmdline);
    if (!verified.ok) {
      this.log(`[kairo] forceKill skip reused agent: ${verified.reason}`);
      return;
    }
    this.manager.registerByPid('agent', pid);
    this.forceKillLabelSync('agent');
  }

  private resolveReusedAgentPid(): number | undefined {
    const tracked = this.manager.get('agent');
    if (tracked?.pid !== null && tracked?.pid !== undefined && tracked.pid > 0) {
      return tracked.pid;
    }
    if (this.agentStatePath) {
      return readAgentStatePid(this.agentStatePath);
    }
    return undefined;
  }

  private forceKillLabelSync(label: ChildLabel): void {
    const info = this.manager.get(label);
    if (!info || info.pid === null) return;
    if (info.exitCode !== null || info.exitSignal !== null) return;
    killProcessTree(info.pid, 'SIGKILL');
  }
}
