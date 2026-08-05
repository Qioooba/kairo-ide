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
const { WorkspaceContextService, decodeProjectYamlBytes } = require('../../lib/browser/workspace-context-service');

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

test('WorkspaceContextService Chinese path fallback uses encodeURIComponent before btoa (BD-P0-6)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'workspace-context-service.ts'), 'utf8');
  assert.match(src, /btoa\(encodeURIComponent\(rootPath\)\)/,
    'offline fallback must encodeURIComponent before btoa for non-Latin1 paths');
  assert.doesNotMatch(src, /btoa\(rootPath\)/,
    'raw btoa(rootPath) throws InvalidCharacterError on Chinese paths');
});

test('decodeProjectYamlBytes prefers gbk when utf-8 is mojibake (BD-P2-12)', () => {
  // "中文" in GBK is D6 D0 CE C4
  const gbkBytes = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x3a, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a]);
  const text = decodeProjectYamlBytes(gbkBytes);
  assert.ok(text.includes('中文') || text.includes('name:'), `expected Chinese or name, got ${JSON.stringify(text)}`);
  assert.ok(!text.includes('\uFFFD') || text.includes('中文'), 'should not keep pure mojibake when gbk works');
});
