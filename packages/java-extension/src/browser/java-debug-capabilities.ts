/**
 * Java Debug End-to-End Capabilities & Breakpoint Migration (PR14 / T47 ~ T50).
 *
 * Implements:
 * - T47: BreakpointMigrationCoordinator (single-migration invariant, condition/state preservation).
 * - T48: JavaDebugCapabilitiesPipeline (full UI -> Protocol -> Adapter -> VM validation).
 * - T49: VariablePagingManager & DebugStopGenerationManager (100k array paging, stop generation stale response invalidation).
 * - T50: DebugDisconnectPolicy (launch vs attach disconnect semantics, protecting external Tomcat).
 */

import type {
  BreakpointMigrationDelta,
  VariablePageDescriptor,
  StopGenerationContext,
  DisconnectPolicyOptions,
} from '@kairo/protocol';

/* ========================================================================== */
/*  T47: Breakpoint Migration Coordinator                                     */
/* ========================================================================== */

export interface ManagedBreakpoint {
  id: string;
  uri: string;
  line: number;
  column?: number;
  enabled: boolean;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
  relocated?: boolean;
  [key: string]: unknown;
}

export class BreakpointMigrationCoordinator {
  protected breakpointsByUri: Map<string, ManagedBreakpoint[]> = new Map();
  protected processedTransactions: Set<string> = new Set();
  protected transactionHistoryLimit = 200;

  /**
   * Set the active breakpoints for a URI.
   */
  setBreakpoints(uri: string, breakpoints: ManagedBreakpoint[]): void {
    this.breakpointsByUri.set(uri, breakpoints.map(bp => ({ ...bp })));
  }

  /**
   * Get the current breakpoints for a URI.
   */
  getBreakpoints(uri: string): ManagedBreakpoint[] {
    return (this.breakpointsByUri.get(uri) ?? []).map(bp => ({ ...bp }));
  }

  /**
   * Apply a line edit delta to migrate breakpoints on a URI.
   *
   * Enforces the Single-Migration Invariant:
   * If a transactionId is provided and was already processed, the migration
   * is a no-op, preventing double-shifting when multiple listeners respond
   * to the same edit event.
   */
  applyLineEdit(delta: BreakpointMigrationDelta): {
    migrated: ManagedBreakpoint[];
    applied: boolean;
    alreadyProcessed: boolean;
  } {
    const { uri, startLine, linesDelta, deletedCount = 0, transactionId } = delta;

    // Single-migration invariant check
    if (transactionId) {
      if (this.processedTransactions.has(transactionId)) {
        return {
          migrated: this.getBreakpoints(uri),
          applied: false,
          alreadyProcessed: true,
        };
      }
      this.recordTransaction(transactionId);
    }

    const currentList = this.breakpointsByUri.get(uri) ?? [];
    const migratedList: ManagedBreakpoint[] = [];

    for (const bp of currentList) {
      const copy: ManagedBreakpoint = { ...bp };

      if (linesDelta > 0) {
        // Line Insertion: lines >= startLine shift down by linesDelta
        if (copy.line >= startLine) {
          copy.line += linesDelta;
        }
      } else if (linesDelta < 0 || deletedCount > 0) {
        // Line Deletion:
        const count = deletedCount > 0 ? deletedCount : Math.abs(linesDelta);
        const deletionEndLine = startLine + count - 1;

        if (copy.line < startLine) {
          // Line before deletion: unaffected
        } else if (copy.line > deletionEndLine) {
          // Line after deleted region: shifts up by deleted count
          copy.line = Math.max(startLine, copy.line - count);
        } else {
          // Line was inside the deleted region:
          // Snap to startLine and preserve all properties (condition, hitCondition, logMessage, enabled)
          copy.line = startLine;
          copy.relocated = true;
        }
      }

      // Metadata preservation invariant:
      // Condition, hitCondition, logMessage, enabled must never be cleared by line shifts.
      copy.condition = bp.condition;
      copy.hitCondition = bp.hitCondition;
      copy.logMessage = bp.logMessage;
      copy.enabled = bp.enabled;

      migratedList.push(copy);
    }

    this.breakpointsByUri.set(uri, migratedList);
    return {
      migrated: migratedList.map(b => ({ ...b })),
      applied: true,
      alreadyProcessed: false,
    };
  }

  /**
   * Revert a previously applied edit (Undo).
   */
  revertLineEdit(delta: BreakpointMigrationDelta, undoTransactionId?: string): {
    migrated: ManagedBreakpoint[];
    applied: boolean;
  } {
    // Invert the delta: linesDelta becomes -linesDelta, deletedCount swaps with linesDelta
    const inverseDelta: BreakpointMigrationDelta = {
      uri: delta.uri,
      startLine: delta.startLine,
      linesDelta: -delta.linesDelta,
      deletedCount: delta.linesDelta > 0 ? delta.linesDelta : 0,
      transactionId: undoTransactionId,
    };
    const result = this.applyLineEdit(inverseDelta);
    return { migrated: result.migrated, applied: result.applied };
  }

  protected recordTransaction(transactionId: string): void {
    this.processedTransactions.add(transactionId);
    if (this.processedTransactions.size > this.transactionHistoryLimit) {
      const first = this.processedTransactions.values().next().value;
      if (first !== undefined) {
        this.processedTransactions.delete(first);
      }
    }
  }

  clear(): void {
    this.breakpointsByUri.clear();
    this.processedTransactions.clear();
  }
}

/* ========================================================================== */
/*  T48: Java Debug Capabilities Pipeline                                     */
/* ========================================================================== */

export interface DapSourceBreakpointPayload {
  line: number;
  column?: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export interface AdapterCapabilities {
  supportsConditionalBreakpoints?: boolean;
  supportsHitConditionalBreakpoints?: boolean;
  supportsLogPoints?: boolean;
  supportsExceptionBreakpoints?: boolean;
  supportsExceptionFilterOptions?: boolean;
}

export interface VmEvaluationContext {
  locals: Record<string, unknown>;
  fields?: Record<string, unknown>;
  exception?: { type: string; message: string; caught: boolean };
}

export class JavaDebugCapabilitiesPipeline {
  /**
   * Validate a conditional breakpoint expression.
   */
  static validateCondition(condition?: string): { valid: boolean; error?: string } {
    if (!condition || !condition.trim()) {
      return { valid: true };
    }
    const trimmed = condition.trim();
    // Check balanced parentheses
    let balance = 0;
    for (const char of trimmed) {
      if (char === '(') balance++;
      else if (char === ')') balance--;
      if (balance < 0) return { valid: false, error: 'Mismatched closing parenthesis' };
    }
    if (balance !== 0) {
      return { valid: false, error: 'Unclosed opening parenthesis' };
    }
    return { valid: true };
  }

  /**
   * Validate a hit count condition expression.
   * Accepts: plain integer like "5", or comparison like ">= 10", "> 3", "== 2", "% 2 == 0".
   */
  static validateHitCondition(hitCondition?: string): {
    valid: boolean;
    operator?: string;
    threshold?: number;
    modulo?: number;
    error?: string;
  } {
    if (!hitCondition || !hitCondition.trim()) {
      return { valid: true };
    }
    const trimmed = hitCondition.trim();

    // Plain integer: "5"
    if (/^\d+$/.test(trimmed)) {
      return { valid: true, operator: '>=', threshold: parseInt(trimmed, 10) };
    }

    // Comparison: ">= 10", "> 5", "== 3", "<= 7"
    const compMatch = /^(>=|>|==|<=|=)\s*(\d+)$/.exec(trimmed);
    if (compMatch) {
      const op = compMatch[1] === '=' ? '==' : compMatch[1];
      return { valid: true, operator: op, threshold: parseInt(compMatch[2], 10) };
    }

    // Modulo: "% 2 == 0" or "% 5 = 0"
    const modMatch = /^%\s*(\d+)\s*(?:==|=)\s*(\d+)$/.exec(trimmed);
    if (modMatch) {
      return {
        valid: true,
        operator: '%',
        modulo: parseInt(modMatch[1], 10),
        threshold: parseInt(modMatch[2], 10),
      };
    }

    return {
      valid: false,
      error: `Invalid hit count format: "${hitCondition}". Use e.g. "5", ">= 10", or "% 2 == 0".`,
    };
  }

  /**
   * Validate a logpoint message template.
   * Extracts {expr} placeholders.
   */
  static validateLogMessage(logMessage?: string): {
    valid: boolean;
    expressions: string[];
    error?: string;
  } {
    if (!logMessage || !logMessage.trim()) {
      return { valid: true, expressions: [] };
    }
    const expressions: string[] = [];
    const regex = /\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(logMessage)) !== null) {
      expressions.push(match[1].trim());
    }
    return { valid: true, expressions };
  }

  /**
   * Convert a ManagedBreakpoint into a standard DAP SourceBreakpoint payload.
   */
  static toDapPayload(bp: ManagedBreakpoint): DapSourceBreakpointPayload {
    const payload: DapSourceBreakpointPayload = {
      line: bp.line,
    };
    if (bp.column !== undefined) payload.column = bp.column;
    if (bp.condition?.trim()) payload.condition = bp.condition.trim();
    if (bp.hitCondition?.trim()) payload.hitCondition = bp.hitCondition.trim();
    if (bp.logMessage?.trim()) payload.logMessage = bp.logMessage.trim();
    return payload;
  }

  /**
   * Verify whether the adapter capabilities support all configured breakpoint fields.
   */
  static verifyAdapterSupport(
    bp: DapSourceBreakpointPayload,
    capabilities: AdapterCapabilities,
  ): { supported: boolean; unsupportedFeatures: string[] } {
    const unsupported: string[] = [];
    if (bp.condition && !capabilities.supportsConditionalBreakpoints) {
      unsupported.push('conditionalBreakpoints');
    }
    if (bp.hitCondition && !capabilities.supportsHitConditionalBreakpoints) {
      unsupported.push('hitConditionalBreakpoints');
    }
    if (bp.logMessage && !capabilities.supportsLogPoints) {
      unsupported.push('logPoints');
    }
    return {
      supported: unsupported.length === 0,
      unsupportedFeatures: unsupported,
    };
  }

}

/* ========================================================================== */
/*  T49: Variable Paging & Stop Generation                                    */
/* ========================================================================== */

export const DEFAULT_VARIABLE_PAGE_SIZE = 100;
export const MAX_VARIABLE_PAGE_SIZE = 1000;

export class VariablePagingManager {
  /**
   * Generate virtual range pages for a large array / collection.
   * e.g. For 100,000 items with pageSize=100: [0..99], [100..199], ...
   */
  static createPageDescriptors(
    variablesReference: number,
    totalCount: number,
    pageSize: number = DEFAULT_VARIABLE_PAGE_SIZE,
  ): VariablePageDescriptor[] {
    if (totalCount <= 0) return [];
    const effectivePageSize = Math.min(Math.max(1, pageSize), MAX_VARIABLE_PAGE_SIZE);

    if (totalCount <= effectivePageSize) {
      return [
        {
          variablesReference,
          start: 0,
          count: totalCount,
          totalCount,
          label: `[0..${totalCount - 1}]`,
        },
      ];
    }

    const pages: VariablePageDescriptor[] = [];
    let start = 0;
    while (start < totalCount) {
      const count = Math.min(effectivePageSize, totalCount - start);
      const end = start + count - 1;
      pages.push({
        variablesReference,
        start,
        count,
        totalCount,
        label: `[${start}..${end}]`,
      });
      start += count;
    }
    return pages;
  }

  /**
   * Build DAP variables request parameters for a specific page.
   */
  static createDapVariablesRequest(page: VariablePageDescriptor): {
    variablesReference: number;
    filter: 'indexed';
    start: number;
    count: number;
  } {
    return {
      variablesReference: page.variablesReference,
      filter: 'indexed',
      start: page.start,
      count: page.count,
    };
  }
}

export class DebugStopGenerationManager {
  protected generations: Map<string, number> = new Map();

  /**
   * Get the current stopGeneration for a session.
   */
  getGeneration(sessionId: string): number {
    return this.generations.get(sessionId) ?? 0;
  }

  /**
   * Called when a debug session pauses (hits breakpoint, step, exception).
   * Monotonically increments the generation for the session.
   */
  onSessionPaused(sessionId: string, reason?: string): StopGenerationContext {
    const next = (this.generations.get(sessionId) ?? 0) + 1;
    this.generations.set(sessionId, next);
    return {
      sessionId,
      stopGeneration: next,
      stoppedReason: reason,
      timestamp: Date.now(),
    };
  }

  /**
   * Check whether an asynchronous response with a given generation is still valid.
   * If generation < currentGeneration, the response is STALE and must be dropped.
   */
  isResponseValid(sessionId: string, requestGeneration: number): boolean {
    const current = this.generations.get(sessionId) ?? 0;
    return requestGeneration === current;
  }

  /**
   * Filter and discard stale responses.
   * Returns null if stale, or the payload if valid.
   */
  filterStaleResponse<T>(sessionId: string, requestGeneration: number, payload: T): T | null {
    return this.isResponseValid(sessionId, requestGeneration) ? payload : null;
  }

  /**
   * Reset session generation on disconnect / destroy.
   */
  reset(sessionId: string): void {
    this.generations.delete(sessionId);
  }
}

/* ========================================================================== */
/*  T50: Launch vs Attach Disconnect Semantics                                */
/* ========================================================================== */

export class DebugDisconnectPolicy {
  /**
   * Determine the exact disconnect arguments for DAP `disconnect`.
   *
   * Crucial Safety Invariant (T50):
   * When attaching to external processes (Tomcat, WAS, remote JVM) or when
   * the debuggee process is NOT owned by the IDE (`ownsDebuggee === false`),
   * `terminateDebuggee` MUST BE `false`!
   * This ensures external business processes remain alive when debugging stops.
   */
  static determineDisconnectArguments(options: DisconnectPolicyOptions): {
    restart: boolean;
    terminateDebuggee: boolean;
    suspendDebuggee?: boolean;
  } {
    const isAttach = options.requestKind === 'attach';
    const isUnowned = options.ownsDebuggee === false;

    // Attach or unowned process: never terminate debuggee!
    if (isAttach || isUnowned) {
      return {
        restart: Boolean(options.restart),
        terminateDebuggee: false,
      };
    }

    // Launch with owned process: terminate debuggee only if adapter supports it
    const shouldTerminate = Boolean(
      options.adapterSupportsTerminateDebuggee && (options.ownsDebuggee ?? true),
    );

    return {
      restart: Boolean(options.restart),
      terminateDebuggee: shouldTerminate,
    };
  }

  /**
   * Execute safe disconnect using the determined policy arguments.
   */
  static async safeDisconnect(
    sendRequestFn: (command: string, args: unknown) => Promise<unknown>,
    options: DisconnectPolicyOptions,
  ): Promise<unknown> {
    const disconnectArgs = this.determineDisconnectArguments(options);
    return sendRequestFn('disconnect', disconnectArgs);
  }
}

/* ========================================================================== */
/*  Stepping Filters Manager (Section 12.3 / stepping-filters-v1.json)       */
/* ========================================================================== */

export class SteppingFilterManager {
  protected patterns: Set<string> = new Set([
    'java.*',
    'javax.*',
    'sun.*',
    'com.sun.*',
    'jdk.*',
    'org.apache.catalina.*',
    'org.apache.coyote.*',
    'org.apache.tomcat.*',
  ]);

  constructor(customPatterns?: string[]) {
    if (customPatterns) {
      this.patterns = new Set(customPatterns);
    }
  }

  getPatterns(): string[] {
    return Array.from(this.patterns);
  }

  addPattern(pattern: string): void {
    if (pattern && pattern.trim()) {
      this.patterns.add(pattern.trim());
    }
  }

  removePattern(pattern: string): void {
    this.patterns.delete(pattern.trim());
  }

  /**
   * Test whether a class should be skipped during Step Into.
   */
  shouldSkipStep(className: string): boolean {
    if (!className) return false;
    for (const pattern of this.patterns) {
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        if (className === prefix || className.startsWith(prefix + '.')) {
          return true;
        }
      } else if (pattern === className) {
        return true;
      }
    }
    return false;
  }
}

/* ========================================================================== */
/*  Exception Breakpoint Manager (Section 7.3, 14.2 T48, Section 12.3)        */
/* ========================================================================== */

export interface ExceptionFilterConfig {
  filterId: 'caught' | 'uncaught';
  enabled: boolean;
  condition?: string;
}

export interface ExceptionDetails {
  exceptionId: string;
  description?: string;
  breakMode: 'always' | 'unhandled' | 'userUnhandled' | 'never';
  isCaught: boolean;
}

export class ExceptionBreakpointManager {
  protected activeFilters: Map<string, ExceptionFilterConfig> = new Map();

  setFilter(filterId: 'caught' | 'uncaught', enabled: boolean, condition?: string): void {
    this.activeFilters.set(filterId, { filterId, enabled, condition });
  }

  isFilterActive(filterId: 'caught' | 'uncaught'): boolean {
    return this.activeFilters.get(filterId)?.enabled ?? false;
  }

  /**
   * Formulate standard DAP setExceptionBreakpoints arguments.
   */
  toDapArguments(): { filters: string[]; filterOptions?: Array<{ filterId: string; condition?: string }> } {
    const filters: string[] = [];
    const filterOptions: Array<{ filterId: string; condition?: string }> = [];

    for (const [id, cfg] of this.activeFilters.entries()) {
      if (cfg.enabled) {
        filters.push(id);
        if (cfg.condition) {
          filterOptions.push({ filterId: id, condition: cfg.condition });
        }
      }
    }

    return { filters, ...(filterOptions.length > 0 ? { filterOptions } : {}) };
  }

  /**
   * Determine if an exception event should trigger a pause in the VM.
   */
  shouldBreakOnException(details: ExceptionDetails): boolean {
    if (details.breakMode === 'never') {
      return false;
    }
    if (details.breakMode === 'always') {
      return true;
    }
    if (details.breakMode === 'unhandled') {
      return !details.isCaught;
    }

    // Default to matching active filters
    if (details.isCaught && this.isFilterActive('caught')) {
      return true;
    }
    if (!details.isCaught && this.isFilterActive('uncaught')) {
      return true;
    }
    return false;
  }
}

