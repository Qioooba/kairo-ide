/**
 * Kairo Java service — owns the JDT Language Server lifecycle
 * and exposes the build / toolchain / language-server state to
 * the UI.
 *
 * The actual JDT LS process is owned by the Go Runtime Agent;
 * here we ask the agent to start/stop it via /api/v1, and
 * register a Monaco LSP client that talks to the JDT LS through
 * the agent's WebSocket /api/v1/events?type=jdtls.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { Toolchain } from '@kairo/protocol';
import { KairoRuntime } from '@kairo/runtime-extension/lib/browser';

export const KairoJavaService = Symbol('KairoJavaService');

export type JdtState = 'uninitialized' | 'starting' | 'ready' | 'crashed' | 'disabled';

@injectable()
export class KairoJavaService {
  @inject(KairoRuntime) protected runtime: KairoRuntime;

  protected state: JdtState = 'uninitialized';
  protected listeners = new Set<(s: JdtState) => void>();

  state$(): JdtState {
    return this.state;
  }

  onState(fn: (s: JdtState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected setState(s: JdtState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  async listToolchains(): Promise<Toolchain[]> {
    const raw = await this.runtime.request('GET /api/v1/toolchains', undefined) as any[];
    return raw as Toolchain[];
  }

  async importToolchain(path: string, label?: string): Promise<Toolchain> {
    return this.runtime.request('POST /api/v1/toolchains/import', { path, label });
  }

  /**
   * Note: this is a stub. The real implementation will:
   *   1. POST to the agent to spawn JDT LS (with the registered
   *      languageServerJavaHome).
   *   2. Open a WebSocket to the agent's LSP bridge.
   *   3. Register a Monaco LSP client on `java` URIs.
   * The agent does the heavy lifting because process supervision,
   * memory caps, and crash recovery all live there.
   *
   * v1 ships the wire path; the full LSP bridge is on the M2
   * track in MILESTONES.md.
   */
  async ensureStarted(): Promise<void> {
    if (this.state === 'ready' || this.state === 'starting') return;
    this.setState('starting');
    try {
      // In a real implementation, we'd send a signal via the
      // EventBus and wait for 'jdtls.ready'. For now, the
      // agent owns the lifecycle.
      this.setState('ready');
    } catch (err) {
      this.setState('crashed');
      throw err;
    }
  }
}

export function bindJavaExtension(bind: any): void {
  bind(KairoJavaService).to(KairoJavaService).inSingletonScope();
}
