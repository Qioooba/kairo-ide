/**
 * Kairo IDE — Desktop Process Manager.
 *
 * Manages child process lifecycle for the desktop app:
 *   - Go Runtime Agent
 *   - Theia Backend
 *   - JDT LS (spawned by agent, tracked by PID)
 *   - Tomcat 6 (spawned by agent, tracked by PID)
 *
 * Features:
 *   - Child process tracking with PID-based registry
 *   - Graceful shutdown: SIGTERM → SIGKILL escalation (Windows: taskkill /T)
 *   - Windows process tree cleanup via taskkill /T
 *   - Zombie process detection (process still alive after kill attempt)
 *   - Exit code reporting and diagnostics
 */

import { ChildProcess, exec } from 'child_process';

// ─── Types ────────────────────────────────────────────────────

export interface ProcessInfo {
  /** Unique label for this process (e.g. 'agent', 'theia', 'jdtls', 'tomcat6'). */
  label: string;
  /** The ChildProcess instance, or null if not yet started / already exited. */
  process: ChildProcess | null;
  /** PID at spawn time. Used for process tree cleanup on Windows. */
  pid: number | null;
  /** When the process was started (Date.now()). */
  startedAt: number;
  /** Exit code, if the process has exited. */
  exitCode: number | null;
  /** Exit signal, if the process was killed by a signal. */
  exitSignal: string | null;
  /** Whether a graceful shutdown was initiated. */
  shutdownRequested: boolean;
  /** How many times SIGTERM was sent. */
  termCount: number;
  /** Whether a SIGKILL / taskkill /F was sent. */
  killSent: boolean;
}

export interface ShutdownOptions {
  /** Time to wait after SIGTERM before escalating to SIGKILL (ms). Default: 5_000. */
  termTimeoutMs?: number;
  /** Time to wait after SIGKILL before giving up (ms). Default: 10_000. */
  killTimeoutMs?: number;
  /** Total shutdown timeout (ms). Default: 15_000. */
  totalTimeoutMs?: number;
}

export interface ShutdownResult {
  label: string;
  success: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  wasZombie: boolean;
  error?: string;
}

// ─── Constants ─────────────────────────────────────────────────

const DEFAULT_SHUTDOWN: Required<ShutdownOptions> = {
  termTimeoutMs: 5_000,
  killTimeoutMs: 10_000,
  totalTimeoutMs: 15_000,
};

// ─── Process Registry ──────────────────────────────────────────

export class ProcessManager {
  private processes: Map<string, ProcessInfo> = new Map();
  private onDiagnostic?: (message: string) => void;

  constructor(onDiagnostic?: (message: string) => void) {
    this.onDiagnostic = onDiagnostic;
  }

  private log(message: string): void {
    if (this.onDiagnostic) {
      this.onDiagnostic(`[process-manager] ${message}`);
    }
  }

  // ── Registration ──────────────────────────────────────────

  /**
   * Register a spawned child process for lifecycle tracking.
   * Call this immediately after spawn().
   */
  register(label: string, proc: ChildProcess): void {
    const info: ProcessInfo = {
      label,
      process: proc,
      pid: proc.pid ?? null,
      startedAt: Date.now(),
      exitCode: null,
      exitSignal: null,
      shutdownRequested: false,
      termCount: 0,
      killSent: false,
    };

    // Listen for exit to capture exit code/signal.
    proc.on('exit', (code, signal) => {
      const existing = this.processes.get(label);
      if (existing) {
        existing.exitCode = code;
        existing.exitSignal = signal;
        existing.process = null;
        this.log(`${label} exited: code=${code} signal=${signal}`);
      }
    });

    proc.on('error', (err) => {
      this.log(`${label} error: ${err.message}`);
    });

    this.processes.set(label, info);
    this.log(`registered ${label} pid=${proc.pid ?? '?'}`);
  }

  /**
   * Register a process by PID only (for processes spawned externally,
   * e.g. JDT LS or Tomcat started by the Go agent).
   */
  registerByPid(label: string, pid: number): void {
    // If already registered, update PID.
    const existing = this.processes.get(label);
    if (existing) {
      existing.pid = pid;
      this.log(`${label} PID updated to ${pid}`);
      return;
    }

    const info: ProcessInfo = {
      label,
      process: null,
      pid,
      startedAt: Date.now(),
      exitCode: null,
      exitSignal: null,
      shutdownRequested: false,
      termCount: 0,
      killSent: false,
    };
    this.processes.set(label, info);
    this.log(`registered ${label} by PID=${pid}`);
  }

  /** Remove a process from the registry. */
  unregister(label: string): void {
    this.processes.delete(label);
    this.log(`unregistered ${label}`);
  }

  /** Get info for a tracked process. */
  get(label: string): ProcessInfo | undefined {
    return this.processes.get(label);
  }

  /** Get all tracked processes. */
  getAll(): ProcessInfo[] {
    return [...this.processes.values()];
  }

  /** Get all tracked PIDs (for process tree cleanup). */
  getAllPids(): number[] {
    const pids: number[] = [];
    for (const info of this.processes.values()) {
      if (info.pid !== null) {
        pids.push(info.pid);
      }
    }
    return pids;
  }

  // ── Zombie Detection ───────────────────────────────────────

  /**
   * Check if a process is a zombie: it was asked to shut down but
   * is still alive (process not killed and no exit code yet).
   */
  isZombie(label: string): boolean {
    const info = this.processes.get(label);
    if (!info) return false;
    return info.shutdownRequested && info.process !== null && !info.process.killed && info.exitCode === null;
  }

  /** Get all zombie processes. */
  getZombies(): ProcessInfo[] {
    return this.getAll().filter((info) => this.isZombie(info.label));
  }

  // ── Shutdown ───────────────────────────────────────────────

  /**
   * Gracefully shut down a single tracked process.
   *
   * Strategy:
   *   1. Send SIGTERM (or taskkill without /F on Windows)
   *   2. Wait `termTimeoutMs` for graceful exit
   *   3. If still alive, send SIGKILL (or taskkill /T /F on Windows)
   *   4. Wait `killTimeoutMs` for forced exit
   *   5. If still alive, report as zombie
   */
  async shutdownOne(label: string, opts: ShutdownOptions = {}): Promise<ShutdownResult> {
    const options = { ...DEFAULT_SHUTDOWN, ...opts };
    const info = this.processes.get(label);

    if (!info) {
      return { label, success: true, exitCode: null, exitSignal: null, wasZombie: false };
    }

    info.shutdownRequested = true;

    // Already exited — nothing to do.
    if (info.exitCode !== null || !info.process || info.process.killed) {
      return {
        label,
        success: true,
        exitCode: info.exitCode,
        exitSignal: info.exitSignal,
        wasZombie: false,
      };
    }

    const proc = info.process;
    const pid = info.pid;

    // Phase 1: SIGTERM (graceful)
    this.log(`${label}: sending SIGTERM (pid=${pid})`);
    info.termCount++;

    try {
      if (process.platform === 'win32' && pid !== null) {
        // Windows: taskkill without /F first (graceful)
        await this.taskkill(pid, false);
      } else {
        proc.kill('SIGTERM');
      }
    } catch (err: any) {
      this.log(`${label}: SIGTERM failed: ${err.message}`);
    }

    // Wait for graceful exit.
    const termExited = await this.waitForExit(label, options.termTimeoutMs);
    if (termExited) {
      return {
        label,
        success: true,
        exitCode: info.exitCode,
        exitSignal: info.exitSignal,
        wasZombie: false,
      };
    }

    // Phase 2: SIGKILL (forced)
    this.log(`${label}: SIGTERM timeout — escalating to SIGKILL (pid=${pid})`);
    info.killSent = true;

    try {
      if (process.platform === 'win32' && pid !== null) {
        // Windows: taskkill /T /F (force kill process tree)
        await this.taskkill(pid, true);
      } else {
        // Unix: kill process group
        try {
          if (pid !== null) {
            process.kill(-pid, 'SIGKILL');
          }
        } catch {
          proc.kill('SIGKILL');
        }
      }
    } catch (err: any) {
      this.log(`${label}: SIGKILL failed: ${err.message}`);
    }

    // Wait for forced exit.
    const killExited = await this.waitForExit(label, options.killTimeoutMs);
    if (killExited) {
      return {
        label,
        success: true,
        exitCode: info.exitCode,
        exitSignal: info.exitSignal,
        wasZombie: false,
      };
    }

    // Phase 3: Process is a zombie — still alive after SIGKILL.
    this.log(`${label}: ZOMBIE detected — process still alive after SIGKILL`);
    return {
      label,
      success: false,
      exitCode: info.exitCode,
      exitSignal: info.exitSignal,
      wasZombie: true,
      error: `Process ${label} (pid=${pid}) did not exit after SIGTERM + SIGKILL`,
    };
  }

  /**
   * Shut down all tracked processes in reverse order (Theia → Agent →
   * JDT LS → Tomcat), then cleanup any remaining PIDs.
   */
  async shutdownAll(opts: ShutdownOptions = {}): Promise<ShutdownResult[]> {
    const results: ShutdownResult[] = [];
    const shutdownOrder = ['theia', 'agent', 'jdtls', 'tomcat6'];

    // Shut down in priority order.
    for (const label of shutdownOrder) {
      if (this.processes.has(label)) {
        const result = await this.shutdownOne(label, opts);
        results.push(result);
      }
    }

    // Shut down any remaining processes not in the priority list.
    for (const label of this.processes.keys()) {
      if (!shutdownOrder.includes(label)) {
        const result = await this.shutdownOne(label, opts);
        results.push(result);
      }
    }

    // Clean up any remaining PIDs on Windows.
    if (process.platform === 'win32') {
      await this.cleanupRemainingPids();
    }

    return results;
  }

  // ── Helpers ────────────────────────────────────────────────

  /** Wait for a process to exit, polling every 200ms. */
  private waitForExit(label: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        const info = this.processes.get(label);
        if (!info || info.exitCode !== null) {
          resolve(true);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  /** Execute taskkill on Windows. */
  private taskkill(pid: number, force: boolean): Promise<void> {
    return new Promise((resolve) => {
      const args = force
        ? ['/T', '/PID', String(pid), '/F']
        : ['/PID', String(pid)];
      exec(`taskkill ${args.join(' ')}`, { timeout: 10_000 }, (err) => {
        if (err) {
          // taskkill returns non-zero if the process doesn't exist,
          // which is fine — it means the process already exited.
          this.log(`taskkill ${force ? '/F ' : ''}pid=${pid}: ${err.message}`);
        }
        resolve();
      });
    });
  }

  /** Clean up any remaining PIDs on the system. */
  private async cleanupRemainingPids(): Promise<void> {
    if (process.platform !== 'win32') return;

    const pids = this.getAllPids();
    for (const pid of pids) {
      try {
        await this.taskkill(pid, true);
      } catch {
        // Already gone.
      }
    }
  }

  // ── Diagnostics ────────────────────────────────────────────

  /** Return a diagnostic summary of all tracked processes. */
  getDiagnostics(): string {
    const lines: string[] = [];
    for (const info of this.processes.values()) {
      const status = info.exitCode !== null
        ? `exited(code=${info.exitCode})`
        : info.process && !info.process.killed
          ? 'running'
          : 'killed';
      const zombie = this.isZombie(info.label) ? ' [ZOMBIE]' : '';
      const uptime = info.exitCode !== null
        ? 'N/A'
        : `${Math.round((Date.now() - info.startedAt) / 1000)}s`;
      lines.push(
        `  ${info.label}: pid=${info.pid ?? '?'} status=${status} uptime=${uptime} termCount=${info.termCount} killSent=${info.killSent}${zombie}`
      );
    }
    return lines.join('\n');
  }
}

// ─── Utility: check if a PID is alive ─────────────────────────

/**
 * Check if a process with the given PID is still running.
 * On Windows this uses `tasklist`, on Unix it sends signal 0.
 */
export function isPidAlive(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      // tasklist /FI "PID eq N" returns the process if it exists.
      const result = require('child_process').execSync(
        `tasklist /FI "PID eq ${pid}" /NH`,
        { encoding: 'utf8', timeout: 5_000 }
      );
      return result.includes(String(pid));
    } else {
      // Signal 0 does nothing but checks if the process exists.
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

// ─── Utility: kill a process tree by root PID ─────────────────

/**
 * Kill a process and all its children. On Windows uses taskkill /T,
 * on Unix uses negative PID to target the process group.
 */
export function killProcessTree(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  try {
    if (process.platform === 'win32') {
      const force = signal === 'SIGKILL' ? ' /F' : '';
      exec(`taskkill /T /PID ${pid}${force}`, { timeout: 10_000 }, (err) => {
        if (err) {
          // Non-zero exit is expected if the process already exited.
        }
      });
    } else {
      process.kill(-pid, signal);
    }
  } catch (err: any) {
    // Process may already be gone.
  }
}