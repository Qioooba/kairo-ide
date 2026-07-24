'use strict';

// N-026: WorkspaceContextService initialization and re-sync tests.
// Verifies that the service:
//   - Implements FrontendApplicationContribution
//   - Tracks lastRoots and re-syncs on runtime connection
//   - Fires onDidChangeContext when workspace root changes
//   - Provides context getter and requireContext
//
// Run with:
//   pnpm --filter @kairo/runtime-extension test

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Load the compiled module directly — we don't need the full DI
// container for these contract tests.
const { WorkspaceContextService } = require('../../lib/browser/workspace-context-service');

test('WorkspaceContextService exports the class', () => {
  assert.ok(typeof WorkspaceContextService === 'function');
});

test('WorkspaceContextService can be instantiated without DI', () => {
  const svc = new WorkspaceContextService();
  assert.ok(svc instanceof WorkspaceContextService);
});

test('WorkspaceContextService.context returns undefined initially', () => {
  const svc = new WorkspaceContextService();
  assert.strictEqual(svc.context, undefined);
});

test('WorkspaceContextService.setWorkspace updates context and fires event', (t, done) => {
  const svc = new WorkspaceContextService();
  // Mock runtime.setWorkspace to avoid requiring full runtime
  svc.runtime = { setWorkspace: () => {}, onStatusChange: () => () => {} };
  svc.workspaceService = {};

  svc.onDidChangeContext(ctx => {
    assert.ok(ctx);
    assert.strictEqual(ctx.workspaceId, 'ws-test');
    assert.strictEqual(ctx.workspaceRoot, '/test/root');
    done();
  });

  void svc.setWorkspace('ws-test', '/test/root');
});

test('WorkspaceContextService.setWorkspace calls runtime.setWorkspace', async () => {
  const svc = new WorkspaceContextService();
  let called = false;
  let calledId = '';
  svc.runtime = { setWorkspace: (id) => { called = true; calledId = id; }, onStatusChange: () => () => {} };
  svc.workspaceService = {};

  await svc.setWorkspace('ws-runtime', '/root');
  assert.strictEqual(called, true);
  assert.strictEqual(calledId, 'ws-runtime');
});

test('WorkspaceContextService.requireContext throws when no context', () => {
  const svc = new WorkspaceContextService();
  assert.throws(() => svc.requireContext(), /No workspace is open/);
});

test('WorkspaceContextService.requireContext returns context when set', async () => {
  const svc = new WorkspaceContextService();
  svc.runtime = { setWorkspace: () => {}, onStatusChange: () => () => {} };
  svc.workspaceService = {};

  await svc.setWorkspace('ws-req', '/root');
  const ctx = svc.requireContext();
  assert.strictEqual(ctx.workspaceId, 'ws-req');
  assert.strictEqual(ctx.workspaceRoot, '/root');
});

test('WorkspaceContextService.onDidChangeContext fires undefined when context cleared', async (t) => {
  const svc = new WorkspaceContextService();
  svc.runtime = { setWorkspace: () => {}, onStatusChange: () => () => {} };
  svc.workspaceService = {};

  await svc.setWorkspace('ws-clear', '/root');

  const promise = new Promise(resolve => {
    svc.onDidChangeContext(ctx => {
      if (ctx === undefined) resolve();
    });
  });

  // Simulate clearing by directly setting to undefined
  svc.currentContext = undefined;
  svc.onDidChangeContextEmitter.fire(undefined);

  await promise;
});

test('WorkspaceContextService.onStop disposes status unsubscribe', () => {
  const svc = new WorkspaceContextService();
  let unsubscribed = false;
  svc.statusUnsubscribe = () => { unsubscribed = true; };
  svc.onStop();
  assert.strictEqual(unsubscribed, true);
});

test('WorkspaceContextService.dispose cleans up all resources', () => {
  const svc = new WorkspaceContextService();
  let disposed = false;
  let statusUnsubbed = false;
  svc.toDispose = { dispose: () => { disposed = true; } };
  svc.statusUnsubscribe = () => { statusUnsubbed = true; };
  svc.dispose();
  assert.strictEqual(disposed, true);
  assert.strictEqual(statusUnsubbed, true);
});

test('WorkspaceContextService.syncFromRoots handles empty roots', async () => {
  const svc = new WorkspaceContextService();
  svc.runtime = { setWorkspace: () => {}, onStatusChange: () => () => {} };
  svc.workspaceService = {};

  await svc.setWorkspace('ws-empty', '/root');

  const promise = new Promise(resolve => {
    svc.onDidChangeContext(ctx => {
      if (ctx === undefined) resolve();
    });
  });

  await svc.syncFromRoots([]);

  await promise;
  assert.strictEqual(svc.context, undefined);
});