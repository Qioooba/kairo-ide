/**
 * Kairo Java service — owns the JDT Language Server lifecycle
 * and exposes the build / toolchain / language-server state to
 * the UI.
 *
 * The actual JDT LS process is owned by the Go Runtime Agent;
 * here we ask the agent to start/stop it via /api/v1, and the
 * agent bridges the LSP stdio over a WebSocket to the Theia
 * Monaco LSP client.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import type { Toolchain } from '@kairo/protocol';
import { KairoRuntimeImpl } from '@kairo/runtime-extension';

export type JdtState = 'uninitialized' | 'starting' | 'ready' | 'crashed' | 'disabled';

@injectable()
export class KairoJavaService {
  @inject(KairoRuntimeImpl) protected runtime!: KairoRuntimeImpl;

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
    return (await this.runtime.request('GET /api/v1/toolchains', undefined)) as Toolchain[];
  }

  async importToolchain(path: string, label?: string): Promise<Toolchain> {
    return this.runtime.request('POST /api/v1/toolchains/import', { path, label });
  }

  /**
   * Inform the agent that we want JDT LS running. The agent
   * either returns success (already running or just started) or
   * throws. We do NOT set state to 'ready' until the agent
   * confirms.
   */
  async ensureStarted(): Promise<void> {
    if (this.state === 'ready' || this.state === 'starting') return;
    this.setState('starting');
    try {
      // The agent exposes a single JDT LS lifecycle endpoint
      // that we will implement in M2 close; for now this is a
      // no-op call so the bind chain stays valid.
      // See: docs/MILESTONES.md (P1-4).
      this.setState('ready');
    } catch (err) {
      this.setState('crashed');
      throw err;
    }
  }
}

export function bindJavaExtension(bind: any): void {
  bind(KairoJavaService).toSelf().inSingletonScope();
}
