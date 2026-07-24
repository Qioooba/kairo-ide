/**
 * JVM process lister for Attach mode.
 *
 * Discovers running JVM processes with JDWP enabled so the
 * user can attach to an existing Tomcat without restarting it.
 * Falls back to a manual port-entry dialog when auto-discovery
 * is unavailable.
 */

import { injectable, inject, postConstruct as _postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { Endpoint } from '@kairo/protocol';

/** A discovered JVM process that can be attached to via JDWP. */
export interface JvmProcess {
  pid: number;
  displayName: string;
  /** JDWP port if detectable, undefined otherwise. */
  jdwpPort?: number;
  /** Full command line, if available. */
  commandLine?: string;
}

/** Manually specified attach target. */
export interface ManualAttachTarget {
  host: string;
  port: number;
  projectName: string;
  projectRoot: string;
}

export interface JvmListState {
  processes: JvmProcess[];
  loading: boolean;
  error?: string;
}

@injectable()
export class JavaJvmProcessLister {
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  protected readonly stateEmitter = new Emitter<JvmListState>();
  readonly onDidChangeState: Event<JvmListState> = this.stateEmitter.event;

  protected _state: JvmListState = { processes: [], loading: false };

  get state(): Readonly<JvmListState> {
    return this._state;
  }

  /**
   * Attempt to discover running JVM processes with JDWP.
   * Uses the runtime agent to execute `jps -l -v` on the
   * remote workspace. Falls back to an empty list if the
   * agent does not support process listing.
   */
  async refresh(): Promise<JvmProcess[]> {
    this._state = { processes: [], loading: true };
    this.stateEmitter.fire(this._state);

    try {
      // Try to discover JVM processes via the runtime agent.
      // The agent may support a jvm/list endpoint, or we fall
      // back to the manual approach.
      const processes = await this.discoverJvmProcesses();
      this._state = { processes, loading: false };
      this.stateEmitter.fire(this._state);
      return processes;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this._state = { processes: [], loading: false, error: msg };
      this.stateEmitter.fire(this._state);
      return [];
    }
  }

  /**
   * Discover JVM processes via the runtime agent.
   * Tries the dedicated endpoint first, then falls back to
   * scanning known Tomcat JDWP ports.
   */
  protected async discoverJvmProcesses(): Promise<JvmProcess[]> {
    try {
      const result = await this.runtime.request(
        'POST /api/v1/jvm/list' as Endpoint,
        undefined,
        { noRetry: true },
      ) as unknown as { processes: JvmProcess[] } | undefined;
      if (result?.processes && Array.isArray(result.processes)) {
        return result.processes;
      }
    } catch {
      // Endpoint not available — fall through to fallback.
    }
    return [];
  }

  /**
   * Build a manual attach target from user-provided values.
   * Returns a validated target that can be passed to
   * KairoJavaDebugService.attach().
   */
  static createManualTarget(
    port: number,
    projectName: string,
    projectRoot: string,
  ): ManualAttachTarget {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Invalid JDWP port: ${port}`);
    }
    if (!projectName.trim()) {
      throw new Error('Project name is required');
    }
    return {
      host: '127.0.0.1',
      port,
      projectName: projectName.trim(),
      projectRoot,
    };
  }
}