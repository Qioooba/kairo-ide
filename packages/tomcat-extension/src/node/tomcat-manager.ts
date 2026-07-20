// SPDX-License-Identifier: Apache-2.0
//
// Tomcat 6 process manager — owns the catalina.bat/catalina.sh
// child process, parses its startup banner to detect
// "running", and connects to the configured shutdown port
// to issue a graceful stop.
//
// Wire model (real production):
//
//   catalina.bat run
//      → stdout streams the "Server startup in N ms" banner
//      → after 8005 (default shutdown port) is open, the
//        manager POSTs "SHUTDOWN" to it to stop
//      → catalina.bat stop  (alternative graceful path)
//
// State machine:
//
//   stopped  --start()--------> starting
//   starting --banner seen---> running
//   starting --exit before-->  failed
//   running  --stop()--------> stopping
//   stopping --exit seen---->  stopped
//   any      --crash--------->  crashed
//
// The manager exposes its events through an EventEmitter so
// the ServerStore (browser side) and the Agent can both
// subscribe. The Agent calls the manager through HTTP, but
// the manager itself lives in the Theia backend node
// process so the actual catalina.bat PID is owned by us
// and not the agent's user-credentials boundary.

import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { createConnection, Socket } from 'net';
import { Readable } from 'stream';
import { EventEmitter } from 'events';

export type TomcatState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'crashed';

export interface TomcatInstance {
  id: string;
  projectId: string;
  home: string;
  httpPort: number;
  shutdownPort: number;
  catalinaBase: string;
  webappsDir: string;
  startedAt: string;
  env: Record<string, string>;
}

export interface TomcatStartOptions {
  /** The instance id; used as the log viewer id. */
  id: string;
  projectId: string;
  /** Resolved CATALINA_HOME (where the bin/ lives). */
  catalinaHome: string;
  /** CATALINA_BASE — instance-private conf/webapps dir. */
  catalinaBase?: string;
  httpPort: number;
  shutdownPort: number;
  /** Java options to forward. */
  javaOpts?: string[];
  /** Java executable to use. */
  javaBin?: string;
  /** Jvm memory options. */
  jvm?: { maxHeapMb?: number; permGenMb?: number; extraArgs?: string[] };
}

export interface TomcatEvent {
  kind: 'state' | 'log' | 'port' | 'ready' | 'error';
  state?: TomcatState;
  log?: { level: 'stdout' | 'stderr'; line: string };
  httpPort?: number;
  shutdownPort?: number;
  readyMs?: number;
  error?: string;
  ts: string;
}

const DEFAULT_STARTUP_DEADLINE_MS = 90_000;
const DEFAULT_STOP_DEADLINE_MS = 15_000;

/**
 * Manager for one Tomcat 6 instance. Each instance has its
 * own Manager; the owner wires them into a Map<id,Manager>
 * and lets the ServerStore / the Agent drive them.
 */
export class TomcatManager extends EventEmitter {
  protected process: ChildProcess | undefined;
  protected state: TomcatState = 'stopped';
  protected _instance: TomcatInstance | undefined;
  protected startedAt: number | undefined;
  protected startupDeadline: NodeJS.Timeout | undefined;

  constructor() {
    super();
  }

  getState(): TomcatState {
    return this.state;
  }

  getInstance(): TomcatInstance | undefined {
    return this._instance;
  }

  /** Where catalina.bat / catalina.sh lives, derived from
   *  `catalinaHome`. */
  static catalinaScript(home: string): string {
    const isWin = process.platform === 'win32';
    return join(home, 'bin', isWin ? 'catalina.bat' : 'catalina.sh');
  }

  /** Resolve the Tomcat 6 install. We accept either an
   *  explicit home, the `KAIRO_TOMCAT6_HOME` env var, or
   *  fall back to the bundled `bundled/tomcat6/`. */
  static resolveHome(opts: { home?: string }): { ok: true; home: string } | { ok: false; reason: string } {
    const home = opts.home ?? process.env.KAIRO_TOMCAT6_HOME;
    if (!home) {
      return {
        ok: false,
        reason:
          'Tomcat 6 home not set. Set KAIRO_TOMCAT6_HOME to the Tomcat 6 install root (the directory that contains `bin/catalina.bat` and `lib/`) and restart the IDE.',
      };
    }
    const abs = resolve(home);
    if (!existsSync(abs)) {
      return { ok: false, reason: `Tomcat 6 home does not exist: ${abs}` };
    }
    const script = TomcatManager.catalinaScript(abs);
    if (!existsSync(script)) {
      return { ok: false, reason: `Tomcat 6 home is missing the catalina script: ${script}` };
    }
    return { ok: true, home: abs };
  }

  /**
   * Spawn the catalina script in the foreground ("run"
   * mode). Stdout is parsed line-by-line for the
   * "Server startup in N ms" banner; once seen, the
   * manager moves to `running`. The process is owned by
   * this manager and terminated on `stop()`.
   */
  async start(opts: TomcatStartOptions): Promise<TomcatInstance> {
    if (this.state !== 'stopped' && this.state !== 'crashed' && this.state !== 'failed') {
      throw new Error(`Tomcat already in state ${this.state}`);
    }
    const homeRes = TomcatManager.resolveHome({ home: opts.catalinaHome });
    if (!homeRes.ok) {
      this.setState('failed');
      throw new Error(homeRes.reason);
    }
    const home = homeRes.home;
    const base = opts.catalinaBase ? resolve(opts.catalinaBase) : home;
    const script = TomcatManager.catalinaScript(home);
    const args: string[] = ['run'];
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      CATALINA_HOME: home,
      CATALINA_BASE: base,
      CATALINA_PID: join(base, 'logs', 'catalina.pid'),
      JAVA_OPTS: [
        opts.jvm?.maxHeapMb ? `-Xmx${opts.jvm.maxHeapMb}m` : '-Xmx512m',
        opts.jvm?.permGenMb ? `-XX:MaxPermSize=${opts.jvm.permGenMb}m` : '-XX:MaxPermSize=128m',
        ...(opts.jvm?.extraArgs ?? []),
        ...(opts.javaOpts ?? []),
      ].join(' '),
      // Force English locale so the parser is deterministic.
      LANG: 'en_US.UTF-8',
    };

    const spawnOpts: SpawnOptions = {
      cwd: home,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    };

    this.setState('starting');
    this.startedAt = Date.now();
    this._instance = {
      id: opts.id,
      projectId: opts.projectId,
      home,
      httpPort: opts.httpPort,
      shutdownPort: opts.shutdownPort,
      catalinaBase: base,
      webappsDir: join(base, 'webapps'),
      startedAt: new Date().toISOString(),
      env,
    };

    // Helpful: emit the configured ports immediately so the
    // UI can display them even before catalina binds.
    this.fire({ kind: 'port', httpPort: opts.httpPort, shutdownPort: opts.shutdownPort, ts: new Date().toISOString() });

    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : script;
    const cmdArgs = isWin ? ['/c', script, ...args] : args;

    this.process = spawn(cmd, cmdArgs, spawnOpts);

    // Buffer stdout / stderr line by line. The startup
    // banner line looks like:
    //   "INFO: Server startup in 1234 ms"
    // but Tomcat 6 prints it on its own line, often with a
    // date prefix on the wrapped stream. We use a regex.
    let bannerSeen = false;
    let bannerTime: number | undefined;
    let pendingOut = '';
    let pendingErr = '';
    const handleLine = (line: string, level: 'stdout' | 'stderr') => {
      if (line.length === 0) return;
      this.fire({ kind: 'log', log: { level, line }, ts: new Date().toISOString() });
      if (!bannerSeen) {
        const m = /Server startup in (\d+) ms/i.exec(line);
        if (m) {
          bannerSeen = true;
          bannerTime = Date.now();
          this.setState('running');
          this.fire({
            kind: 'ready',
            httpPort: opts.httpPort,
            shutdownPort: opts.shutdownPort,
            readyMs: bannerTime - (this.startedAt ?? bannerTime),
            ts: new Date().toISOString(),
          });
          if (this.startupDeadline) {
            clearTimeout(this.startupDeadline);
            this.startupDeadline = undefined;
          }
        }
      }
    };
    const wireStream = (s: Readable | null, level: 'stdout' | 'stderr') => {
      if (!s) return;
      s.setEncoding('utf-8');
      s.on('data', (chunk: string) => {
        const pending = level === 'stdout' ? pendingOut : pendingErr;
        const merged = pending + chunk;
        const idx = merged.lastIndexOf('\n');
        if (idx < 0) {
          if (level === 'stdout') pendingOut = merged; else pendingErr = merged;
          return;
        }
        const ready = merged.slice(0, idx);
        const rest = merged.slice(idx + 1);
        for (const line of ready.split('\n')) {
          handleLine(line, level);
        }
        if (level === 'stdout') pendingOut = rest; else pendingErr = rest;
      });
      s.on('end', () => {
        const pending = level === 'stdout' ? pendingOut : pendingErr;
        if (pending.length > 0) {
          handleLine(pending, level);
          if (level === 'stdout') pendingOut = ''; else pendingErr = '';
        }
      });
    };
    wireStream(this.process.stdout, 'stdout');
    wireStream(this.process.stderr, 'stderr');

    this.process.on('error', err => {
      this.fire({ kind: 'error', error: err.message, ts: new Date().toISOString() });
      this.setState('failed');
    });
    this.process.on('exit', (code, signal) => {
      const wasStopping = this.state === 'stopping';
      const lastLine = `Tomcat exited code=${code} signal=${signal ?? ''}`;
      this.fire({ kind: 'log', log: { level: 'stdout', line: lastLine }, ts: new Date().toISOString() });
      this.process = undefined;
      this.setState(wasStopping ? 'stopped' : (code === 0 ? 'stopped' : 'crashed'));
    });

    // Startup deadline: if we never see the banner, the
    // process is hung and we should kill it.
    this.startupDeadline = setTimeout(() => {
      if (this.state === 'starting' && this.process) {
        this.fire({ kind: 'error', error: 'startup deadline exceeded', ts: new Date().toISOString() });
        this.process.kill('SIGKILL');
        this.setState('failed');
      }
    }, DEFAULT_STARTUP_DEADLINE_MS);

    // Wait for the startup banner before declaring success.
    // This gives callers a deterministic API: when start()
    // resolves, Tomcat is actually accepting traffic (or we
    // have already rejected because it failed/crashed).
    return new Promise<TomcatInstance>((resolve, reject) => {
      const onEvent = (e: TomcatEvent) => {
        if (e.kind === 'state' && e.state === 'running') {
          this.off('event', onEvent);
          resolve(this._instance!);
          return;
        }
        if (e.kind === 'state' && (e.state === 'failed' || e.state === 'crashed' || e.state === 'stopped')) {
          this.off('event', onEvent);
          reject(new Error(`Tomcat failed to start (state: ${e.state})`));
        }
      };
      this.on('event', onEvent);
    });
  }

  /**
   * Stop a running instance. We try, in order:
   *   1. Connect to the shutdown port and send "SHUTDOWN\r\n".
   *   2. If the deadline elapses, send SIGTERM to the child.
   *   3. If SIGTERM is ignored, send SIGKILL.
   */
  async stop(opts: { deadlineMs?: number } = {}): Promise<void> {
    const deadlineMs = opts.deadlineMs ?? DEFAULT_STOP_DEADLINE_MS;
    if (this.state !== 'running' && this.state !== 'starting') {
      return;
    }
    this.setState('stopping');

    const shutdownPort = this._instance?.shutdownPort ?? 8005;
    const shutdownHost = '127.0.0.1';

    const tryShutdownPort = (): Promise<boolean> => {
      return new Promise(resolve => {
        const sock = createConnection({ host: shutdownHost, port: shutdownPort });
        const timer = setTimeout(() => {
          sock.destroy();
          resolve(false);
        }, 2_000);
        sock.on('connect', () => {
          clearTimeout(timer);
          sock.write('SHUTDOWN\r\n');
          // Tomcat 6 immediately closes the connection
          // after the command. We resolve on the first
          // success event.
          setTimeout(() => {
            sock.destroy();
            resolve(true);
          }, 200);
        });
        sock.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
    };

    // First try the shutdown port. If it works, the catalina
    // child will exit on its own within a few seconds.
    const ok = await tryShutdownPort();
    if (ok) {
      this.fire({ kind: 'log', log: { level: 'stdout', line: 'SHUTDOWN command sent to Tomcat 6' }, ts: new Date().toISOString() });
    } else {
      this.fire({ kind: 'error', error: 'shutdown port unreachable; falling back to SIGTERM', ts: new Date().toISOString() });
    }

    // Wait for exit with a deadline, then escalate.
    await new Promise<void>(resolve => {
      const t = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGTERM');
          setTimeout(() => {
            if (this.process && !this.process.killed) {
              this.process.kill('SIGKILL');
            }
            resolve();
          }, 1_500);
        } else {
          resolve();
        }
      }, deadlineMs);
      this.process?.on('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /**
   * Restart: stop, then start with the same options.
   * Returns when the new banner has been seen.
   */
  async restart(opts: TomcatStartOptions): Promise<TomcatInstance> {
    await this.stop();
    // Wait for the port to release — on Windows, the
    // listener lingers in TIME_WAIT for ~30s. We sleep 1s
    // which is enough for the agent to issue a new listen
    // on the same port.
    await sleep(1_000);
    return this.start(opts);
  }

  protected setState(state: TomcatState): void {
    if (this.state === state) return;
    this.state = state;
    this.fire({ kind: 'state', state, ts: new Date().toISOString() });
  }

  protected fire(event: TomcatEvent): void {
    this.emit('event', event);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Re-export the Socket type for tests that want to mock the
 *  shutdown port. */
export type { Socket };
