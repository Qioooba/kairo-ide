/**
 * Exception breakpoints for Kairo Java Debug.
 *
 * Reuses Theia's BreakpointManager exception breakpoint
 * infrastructure. Adds commands to toggle caught/uncaught
 * exception breakpoints and delegates to DAP
 * setExceptionBreakpoints via the active debug session.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { BreakpointManager } from '@theia/debug/lib/browser/breakpoint/breakpoint-manager';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import type { DebugProtocol } from '@vscode/debugprotocol';

/** Filters that a Java DAP adapter typically exposes. */
export const JAVA_EXCEPTION_FILTERS = {
  UNCAUGHT: 'uncaught',
  CAUGHT: 'caught',
} as const;

export interface ExceptionBreakpointState {
  uncaught: boolean;
  caught: boolean;
}

@injectable()
export class JavaExceptionBreakpointService {
  @inject(BreakpointManager) protected readonly breakpointManager!: BreakpointManager;
  @inject(DebugSessionManager) protected readonly sessionManager!: DebugSessionManager;

  get exceptionBreakpoints(): readonly DebugProtocol.ExceptionBreakpointsFilter[] {
    const session = this.sessionManager.currentSession;
    if (!session || !session.capabilities.exceptionBreakpointFilters) {
      return [];
    }
    return session.capabilities.exceptionBreakpointFilters;
  }

  getState(): ExceptionBreakpointState {
    const existing = this.breakpointManager.getExceptionBreakpoints();
    return {
      uncaught: existing.some(
        bp => bp.origin.raw.filter === JAVA_EXCEPTION_FILTERS.UNCAUGHT && bp.enabled,
      ),
      caught: existing.some(
        bp => bp.origin.raw.filter === JAVA_EXCEPTION_FILTERS.CAUGHT && bp.enabled,
      ),
    };
  }

  async toggleUncaught(): Promise<void> {
    await this.toggleFilter(JAVA_EXCEPTION_FILTERS.UNCAUGHT, 'Uncaught Exceptions');
  }

  async toggleCaught(): Promise<void> {
    await this.toggleFilter(JAVA_EXCEPTION_FILTERS.CAUGHT, 'Caught Exceptions');
  }

  async toggleAll(): Promise<void> {
    const state = this.getState();
    const allEnabled = state.uncaught && state.caught;
    if (allEnabled) {
      this.breakpointManager.clearExceptionSessionEnablement(
        this.sessionManager.currentSession?.id ?? '',
      );
    } else {
      await this.enableBoth();
    }
  }

  protected async enableBoth(): Promise<void> {
    const session = this.sessionManager.currentSession;
    const filters = session?.capabilities.exceptionBreakpointFilters;
    if (!filters || filters.length === 0) {
      // No active session: register the default filters so they are
      // sent when a session starts.
      const defaultFilters: DebugProtocol.ExceptionBreakpointsFilter[] = [
        { filter: JAVA_EXCEPTION_FILTERS.UNCAUGHT, label: 'Uncaught Exceptions', default: true },
        { filter: JAVA_EXCEPTION_FILTERS.CAUGHT, label: 'Caught Exceptions', default: false },
      ];
      this.breakpointManager.addExceptionBreakpoints(defaultFilters, '');
      return;
    }
    this.breakpointManager.addExceptionBreakpoints(
      filters.filter(
        f => f.filter === JAVA_EXCEPTION_FILTERS.UNCAUGHT ||
             f.filter === JAVA_EXCEPTION_FILTERS.CAUGHT,
      ),
      session.id,
    );
  }

  protected async toggleFilter(
    filter: string,
    label: string,
  ): Promise<void> {
    const session = this.sessionManager.currentSession;
    const existing = this.breakpointManager
      .getExceptionBreakpoints()
      .find(bp => bp.origin.raw.filter === filter);

    if (existing && existing.enabled) {
      existing.setEnabled(false);
      this.breakpointManager.fireBreakpointChanged(existing);
    } else {
      const bpFilter: DebugProtocol.ExceptionBreakpointsFilter = {
        filter,
        label,
        default: filter === JAVA_EXCEPTION_FILTERS.UNCAUGHT,
      };
      this.breakpointManager.addExceptionBreakpoints(
        [bpFilter],
        session?.id ?? '',
      );
    }
  }
}