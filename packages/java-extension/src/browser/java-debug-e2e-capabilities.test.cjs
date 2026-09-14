'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  BreakpointMigrationCoordinator,
  JavaDebugCapabilitiesPipeline,
  VariablePagingManager,
  DebugStopGenerationManager,
  DebugDisconnectPolicy,
  DEFAULT_VARIABLE_PAGE_SIZE,
  MAX_VARIABLE_PAGE_SIZE,
} = require('../../lib/browser/java-debug-capabilities');

/* ========================================================================== */
/*  T47: Breakpoint Migration & Single-Migration Invariant                    */
/* ========================================================================== */

describe('T47 — Breakpoint Migration & Single-Migration Invariant', () => {
  let coordinator;
  const testUri = 'file:///workspace/src/com/example/HelloServlet.java';

  beforeEach(() => {
    coordinator = new BreakpointMigrationCoordinator();
  });

  it('preserves condition, hitCondition, logMessage, and enabled status across migrations', () => {
    const originalBp = {
      id: 'bp-1',
      uri: testUri,
      line: 25,
      enabled: true,
      condition: 'req.getParameter("action") != null',
      hitCondition: '>= 5',
      logMessage: 'HelloServlet entered with action={action}',
    };

    coordinator.setBreakpoints(testUri, [originalBp]);

    // Insert 5 lines at line 10 (above the breakpoint)
    const result = coordinator.applyLineEdit({
      uri: testUri,
      startLine: 10,
      linesDelta: 5,
      transactionId: 'tx-1',
    });

    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.alreadyProcessed, false);
    assert.strictEqual(result.migrated.length, 1);

    const migrated = result.migrated[0];
    assert.strictEqual(migrated.line, 30, 'Line should shift from 25 to 30 (+5)');
    assert.strictEqual(migrated.condition, originalBp.condition, 'Condition must be preserved');
    assert.strictEqual(migrated.hitCondition, originalBp.hitCondition, 'Hit condition must be preserved');
    assert.strictEqual(migrated.logMessage, originalBp.logMessage, 'Log message must be preserved');
    assert.strictEqual(migrated.enabled, true, 'Enabled state must be preserved');
  });

  it('single-migration invariant: duplicate edit events with same transactionId are not applied twice', () => {
    const originalBp = {
      id: 'bp-1',
      uri: testUri,
      line: 20,
      enabled: true,
      condition: 'x > 0',
    };

    coordinator.setBreakpoints(testUri, [originalBp]);

    // First event application
    const first = coordinator.applyLineEdit({
      uri: testUri,
      startLine: 5,
      linesDelta: 3,
      transactionId: 'tx-shared-edit-42',
    });

    assert.strictEqual(first.applied, true);
    assert.strictEqual(first.alreadyProcessed, false);
    assert.strictEqual(first.migrated[0].line, 23, 'Line shifted +3');

    // Duplicate event fired for the same transaction (e.g. Monaco decoration tracking + document change)
    const duplicate = coordinator.applyLineEdit({
      uri: testUri,
      startLine: 5,
      linesDelta: 3,
      transactionId: 'tx-shared-edit-42',
    });

    assert.strictEqual(duplicate.applied, false, 'Duplicate transaction must not be applied');
    assert.strictEqual(duplicate.alreadyProcessed, true);
    assert.strictEqual(duplicate.migrated[0].line, 23, 'Line must NOT double-shift to 26');
  });

  it('handles line deletions above the breakpoint', () => {
    coordinator.setBreakpoints(testUri, [
      { id: 'bp-1', uri: testUri, line: 35, enabled: true },
    ]);

    // Delete 5 lines starting at line 10
    const result = coordinator.applyLineEdit({
      uri: testUri,
      startLine: 10,
      linesDelta: -5,
      deletedCount: 5,
      transactionId: 'tx-del-1',
    });

    assert.strictEqual(result.migrated[0].line, 30, 'Line should shift up from 35 to 30 (-5)');
  });

  it('smoothly relocates breakpoint when its exact line is deleted without losing metadata', () => {
    const targetBp = {
      id: 'bp-deleted-line',
      uri: testUri,
      line: 15,
      enabled: true,
      condition: 'val == 42',
      hitCondition: '10',
      logMessage: 'Log val={val}',
    };

    coordinator.setBreakpoints(testUri, [targetBp]);

    // Delete lines 14 to 18 (deletedCount = 5, encompassing line 15)
    const result = coordinator.applyLineEdit({
      uri: testUri,
      startLine: 14,
      linesDelta: -5,
      deletedCount: 5,
      transactionId: 'tx-del-encompass',
    });

    assert.strictEqual(result.migrated.length, 1);
    const relocated = result.migrated[0];
    assert.strictEqual(relocated.line, 14, 'Breakpoint snaps to deletion startLine');
    assert.strictEqual(relocated.relocated, true, 'Relocated flag is marked');
    assert.strictEqual(relocated.condition, targetBp.condition, 'Condition preserved');
    assert.strictEqual(relocated.hitCondition, targetBp.hitCondition, 'Hit condition preserved');
    assert.strictEqual(relocated.logMessage, targetBp.logMessage, 'Log message preserved');
    assert.strictEqual(relocated.enabled, true, 'Enabled state preserved');
  });

  it('supports Undo/Redo cycles reversibly', () => {
    const bp = { id: 'bp-undo', uri: testUri, line: 50, enabled: true };
    coordinator.setBreakpoints(testUri, [bp]);

    // Step 1: Insert 10 lines at line 20
    const delta = {
      uri: testUri,
      startLine: 20,
      linesDelta: 10,
      transactionId: 'tx-insert-10',
    };
    coordinator.applyLineEdit(delta);
    assert.strictEqual(coordinator.getBreakpoints(testUri)[0].line, 60);

    // Step 2: Undo the edit
    coordinator.revertLineEdit(delta, 'tx-undo-10');
    assert.strictEqual(coordinator.getBreakpoints(testUri)[0].line, 50, 'Undo restores original line 50');
  });

  it('does not affect breakpoints occurring strictly before insertion or deletion', () => {
    coordinator.setBreakpoints(testUri, [
      { id: 'bp-early', uri: testUri, line: 8, enabled: true },
    ]);

    coordinator.applyLineEdit({
      uri: testUri,
      startLine: 20,
      linesDelta: 15,
      transactionId: 'tx-below',
    });

    assert.strictEqual(coordinator.getBreakpoints(testUri)[0].line, 8, 'Early line unaffected by later edit');
  });
});

/* ========================================================================== */
/*  T48: Conditional, Hit Count, Logpoint, Exception Breakpoints End-to-End  */
/* ========================================================================== */

describe('T48 — Conditional, Hit Count, Logpoint, Exception Breakpoints End-to-End', () => {
  it('validates condition expressions syntax and parenthesis matching', () => {
    assert.deepEqual(JavaDebugCapabilitiesPipeline.validateCondition('x > 10 && y != null'), { valid: true });
    assert.deepEqual(JavaDebugCapabilitiesPipeline.validateCondition('((a + b) * c) == 0'), { valid: true });
    assert.strictEqual(JavaDebugCapabilitiesPipeline.validateCondition('((a + b)').valid, false);
    assert.strictEqual(JavaDebugCapabilitiesPipeline.validateCondition('a + b))').valid, false);
    assert.deepEqual(JavaDebugCapabilitiesPipeline.validateCondition(''), { valid: true });
  });

  it('validates and parses hit count expressions in all standard formats', () => {
    // Plain integer
    const plain = JavaDebugCapabilitiesPipeline.validateHitCondition('5');
    assert.strictEqual(plain.valid, true);
    assert.strictEqual(plain.operator, '>=');
    assert.strictEqual(plain.threshold, 5);

    // Relational operators
    const gte = JavaDebugCapabilitiesPipeline.validateHitCondition('>= 10');
    assert.strictEqual(gte.valid, true);
    assert.strictEqual(gte.operator, '>=');
    assert.strictEqual(gte.threshold, 10);

    const gt = JavaDebugCapabilitiesPipeline.validateHitCondition('> 3');
    assert.strictEqual(gt.valid, true);
    assert.strictEqual(gt.operator, '>');
    assert.strictEqual(gt.threshold, 3);

    const eq = JavaDebugCapabilitiesPipeline.validateHitCondition('== 7');
    assert.strictEqual(eq.valid, true);
    assert.strictEqual(eq.operator, '==');
    assert.strictEqual(eq.threshold, 7);

    // Modulo
    const mod = JavaDebugCapabilitiesPipeline.validateHitCondition('% 2 == 0');
    assert.strictEqual(mod.valid, true);
    assert.strictEqual(mod.operator, '%');
    assert.strictEqual(mod.modulo, 2);
    assert.strictEqual(mod.threshold, 0);

    // Invalid format
    const invalid = JavaDebugCapabilitiesPipeline.validateHitCondition('invalid-format');
    assert.strictEqual(invalid.valid, false);
    assert.ok(invalid.error.includes('Invalid hit count format'));
  });

  it('validates and extracts expressions from logpoint templates', () => {
    const result = JavaDebugCapabilitiesPipeline.validateLogMessage(
      'Servlet request URI={req.getRequestURI()} method={req.getMethod()}',
    );
    assert.strictEqual(result.valid, true);
    assert.deepEqual(result.expressions, ['req.getRequestURI()', 'req.getMethod()']);
  });

  it('toDapPayload converts ManagedBreakpoint to DAP SourceBreakpoint without losing fields', () => {
    const bp = {
      id: 'bp-full',
      uri: 'file:///app/Servlet.java',
      line: 42,
      column: 8,
      enabled: true,
      condition: 'status == 200',
      hitCondition: '>= 3',
      logMessage: 'Hit count message',
    };

    const dap = JavaDebugCapabilitiesPipeline.toDapPayload(bp);
    assert.strictEqual(dap.line, 42);
    assert.strictEqual(dap.column, 8);
    assert.strictEqual(dap.condition, 'status == 200');
    assert.strictEqual(dap.hitCondition, '>= 3');
    assert.strictEqual(dap.logMessage, 'Hit count message');
  });

  it('verifyAdapterSupport checks adapter capabilities against configured breakpoint fields', () => {
    const bp = {
      line: 10,
      condition: 'x > 0',
      hitCondition: '5',
      logMessage: 'msg',
    };

    // Full adapter support
    const fullAdapter = {
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsLogPoints: true,
    };
    assert.deepEqual(JavaDebugCapabilitiesPipeline.verifyAdapterSupport(bp, fullAdapter), {
      supported: true,
      unsupportedFeatures: [],
    });

    // Limited adapter missing logpoints
    const limitedAdapter = {
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsLogPoints: false,
    };
    const check = JavaDebugCapabilitiesPipeline.verifyAdapterSupport(bp, limitedAdapter);
    assert.strictEqual(check.supported, false);
    assert.deepEqual(check.unsupportedFeatures, ['logPoints']);
  });

  it('toDapPayload: transforms condition, hitCondition and logMessage without VM evaluation', () => {
    const bp = {
      id: 'bp-1',
      uri: 'file:///repo/Main.java',
      line: 15,
      enabled: true,
      condition: 'count > 10',
      hitCondition: '>= 3',
      logMessage: 'User logged in: id={userId} role={role}',
    };

    const payload = JavaDebugCapabilitiesPipeline.toDapPayload(bp);
    assert.strictEqual(payload.line, 15);
    assert.strictEqual(payload.condition, 'count > 10');
    assert.strictEqual(payload.hitCondition, '>= 3');
    assert.strictEqual(payload.logMessage, 'User logged in: id={userId} role={role}');

    // Direct passthrough without executing arbitrary code in frontend
    assert.strictEqual(typeof JavaDebugCapabilitiesPipeline.evaluateInVm, 'undefined');
  });

  it('validates syntax and balanced expressions safely', () => {
    assert.strictEqual(JavaDebugCapabilitiesPipeline.validateCondition('foo(bar())').valid, true);
    assert.strictEqual(JavaDebugCapabilitiesPipeline.validateCondition('foo(bar(').valid, false);
    assert.strictEqual(JavaDebugCapabilitiesPipeline.validateHitCondition('>= 5').valid, true);
    assert.strictEqual(JavaDebugCapabilitiesPipeline.validateHitCondition('invalid').valid, false);
    assert.deepStrictEqual(JavaDebugCapabilitiesPipeline.validateLogMessage('val={x} and {y}').expressions, ['x', 'y']);
  });
});

/* ========================================================================== */
/*  T49: Large Array Variable Paging & Stop Generation                        */
/* ========================================================================== */

describe('T49 — Large Array Variable Paging & Stop Generation', () => {
  it('VariablePagingManager creates bounded pages for a 100,000-element array', () => {
    const totalCount = 100000;
    const pageSize = 100;
    const ref = 5001;

    const pages = VariablePagingManager.createPageDescriptors(ref, totalCount, pageSize);

    assert.strictEqual(pages.length, 1000, '100,000 items with pageSize=100 creates 1,000 pages');

    // Check first page
    assert.deepEqual(pages[0], {
      variablesReference: ref,
      start: 0,
      count: 100,
      totalCount: 100000,
      label: '[0..99]',
    });

    // Check second page
    assert.deepEqual(pages[1], {
      variablesReference: ref,
      start: 100,
      count: 100,
      totalCount: 100000,
      label: '[100..199]',
    });

    // Check last page
    assert.deepEqual(pages[999], {
      variablesReference: ref,
      start: 99900,
      count: 100,
      totalCount: 100000,
      label: '[99900..99999]',
    });
  });

  it('VariablePagingManager generates accurate DAP variables request parameters', () => {
    const page = {
      variablesReference: 9001,
      start: 200,
      count: 100,
      totalCount: 10000,
      label: '[200..299]',
    };

    const req = VariablePagingManager.createDapVariablesRequest(page);
    assert.deepEqual(req, {
      variablesReference: 9001,
      filter: 'indexed',
      start: 200,
      count: 100,
    });
  });

  it('VariablePagingManager handles small arrays and edge cases cleanly', () => {
    // Array smaller than page size
    const small = VariablePagingManager.createPageDescriptors(100, 42, 100);
    assert.strictEqual(small.length, 1);
    assert.strictEqual(small[0].label, '[0..41]');

    // Empty array
    assert.deepEqual(VariablePagingManager.createPageDescriptors(100, 0, 100), []);

    // Page size capped at MAX_VARIABLE_PAGE_SIZE
    const hugePage = VariablePagingManager.createPageDescriptors(100, 5000, 50000);
    assert.strictEqual(hugePage[0].count, MAX_VARIABLE_PAGE_SIZE, 'Page size must not exceed MAX_VARIABLE_PAGE_SIZE');
  });

  it('DebugStopGenerationManager prevents stale responses from older pauses from polluting current state', () => {
    const manager = new DebugStopGenerationManager();
    const sessionId = 'dbg-session-test';

    // Step 1: Target pauses at Breakpoint 1
    const pause1 = manager.onSessionPaused(sessionId, 'breakpoint');
    assert.strictEqual(pause1.stopGeneration, 1);
    assert.strictEqual(manager.getGeneration(sessionId), 1);

    // Request initiated in Generation 1
    const req1Generation = pause1.stopGeneration;
    assert.strictEqual(manager.isResponseValid(sessionId, req1Generation), true);

    // Step 2: Target resumes and pauses at Breakpoint 2
    const pause2 = manager.onSessionPaused(sessionId, 'step');
    assert.strictEqual(pause2.stopGeneration, 2);
    assert.strictEqual(manager.getGeneration(sessionId), 2);

    // Delayed response from Generation 1 arrives now
    const stalePayload = [{ name: 'staleVar', value: 'oldValue' }];
    const filteredStale = manager.filterStaleResponse(sessionId, req1Generation, stalePayload);
    assert.strictEqual(filteredStale, null, 'Stale response from generation 1 must be dropped');

    // Fresh response from Generation 2 arrives
    const freshPayload = [{ name: 'currentVar', value: 'newValue' }];
    const filteredFresh = manager.filterStaleResponse(sessionId, pause2.stopGeneration, freshPayload);
    assert.deepEqual(filteredFresh, freshPayload, 'Fresh response from generation 2 must be accepted');

    // Step 3: Session reset
    manager.reset(sessionId);
    assert.strictEqual(manager.getGeneration(sessionId), 0);
  });
});

/* ========================================================================== */
/*  T50: Launch vs Attach Disconnect Semantics                                */
/* ========================================================================== */

describe('T50 — Launch vs Attach Disconnect Semantics', () => {
  it('Attach mode NEVER terminates debuggee, keeping external Tomcat process alive', () => {
    const attachOptions = {
      requestKind: 'attach',
      ownsDebuggee: false,
      adapterSupportsTerminateDebuggee: true,
      restart: false,
    };

    const args = DebugDisconnectPolicy.determineDisconnectArguments(attachOptions);
    assert.strictEqual(
      args.terminateDebuggee,
      false,
      'Must NOT terminate debuggee when attached to external Tomcat',
    );
    assert.strictEqual(args.restart, false);
  });

  it('Attach mode protects debuggee even if ownsDebuggee is accidentally omitted', () => {
    const attachOptions = {
      requestKind: 'attach',
      adapterSupportsTerminateDebuggee: true,
      restart: false,
    };

    const args = DebugDisconnectPolicy.determineDisconnectArguments(attachOptions);
    assert.strictEqual(
      args.terminateDebuggee,
      false,
      'Attach requestKind alone must enforce terminateDebuggee: false',
    );
  });

  it('Launch mode terminates debuggee when process is owned and adapter supports terminateDebuggee', () => {
    const launchOptions = {
      requestKind: 'launch',
      ownsDebuggee: true,
      adapterSupportsTerminateDebuggee: true,
      restart: false,
    };

    const args = DebugDisconnectPolicy.determineDisconnectArguments(launchOptions);
    assert.strictEqual(
      args.terminateDebuggee,
      true,
      'Owned launch process should be terminated on disconnect',
    );
  });

  it('Launch mode does not terminate debuggee when adapter does not support terminateDebuggee', () => {
    const launchOptions = {
      requestKind: 'launch',
      ownsDebuggee: true,
      adapterSupportsTerminateDebuggee: false,
      restart: false,
    };

    const args = DebugDisconnectPolicy.determineDisconnectArguments(launchOptions);
    assert.strictEqual(args.terminateDebuggee, false);
  });

  it('Unowned launch process (e.g. spawned by external script) is not terminated on disconnect', () => {
    const unownedLaunch = {
      requestKind: 'launch',
      ownsDebuggee: false,
      adapterSupportsTerminateDebuggee: true,
      restart: false,
    };

    const args = DebugDisconnectPolicy.determineDisconnectArguments(unownedLaunch);
    assert.strictEqual(args.terminateDebuggee, false, 'Unowned process must not be killed');
  });

  it('safeDisconnect executes sendRequest with exact verified policy arguments', async () => {
    const sentRequests = [];
    const mockSendRequest = async (command, args) => {
      sentRequests.push({ command, args });
      return { success: true };
    };

    await DebugDisconnectPolicy.safeDisconnect(mockSendRequest, {
      requestKind: 'attach',
      ownsDebuggee: false,
      adapterSupportsTerminateDebuggee: true,
    });

    assert.strictEqual(sentRequests.length, 1);
    assert.strictEqual(sentRequests[0].command, 'disconnect');
    assert.deepEqual(sentRequests[0].args, {
      restart: false,
      terminateDebuggee: false,
    });
  });
});
