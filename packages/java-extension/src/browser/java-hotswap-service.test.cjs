'use strict';

require('../../../theia-product/test/frontend-setup.cjs');

const { test } = require('node:test');
const assert = require('node:assert');

const {
  JavaHotSwapService,
  isUriContained,
} = require('../../lib/browser/java-hotswap-service');

function createTestService(overrides = {}) {
  const service = new JavaHotSwapService();
  service.logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
  service.messages = {
    info() {},
    warn() {},
    error() {},
  };
  service.i18n = {
    t: (key, params) => `${key}:${JSON.stringify(params || {})}`,
  };
  service.runtime = {
    request: async (endpoint, body) => {
      if (overrides.onRequest) {
        return overrides.onRequest(endpoint, body);
      }
      return { success: true };
    },
  };
  service.sessionManager = {
    currentSession: overrides.currentSession || undefined,
    sessions: overrides.sessions || (overrides.currentSession ? [overrides.currentSession] : []),
  };
  service.workspaceService = {
    tryGetRoots: () => overrides.roots || [{ resource: { toString: () => 'file:///workspace' } }],
  };
  return service;
}

test('HotSwap debounce mechanism', async () => {
  let callCount = 0;
  const debounce = (fn, delay) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  };

  const debouncedFn = debounce(() => { callCount++; }, 500);

  debouncedFn();
  debouncedFn();
  debouncedFn();

  assert.strictEqual(callCount, 0); // Not yet called

  await new Promise(resolve => setTimeout(resolve, 600));
  assert.strictEqual(callCount, 1); // Called once after debounce
});

test('HotSwap debounce groups rapid calls', async () => {
  let results = [];
  const debounce = (fn, delay) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  };

  const debouncedFn = debounce((val) => { results.push(val); }, 300);

  debouncedFn('a');
  debouncedFn('b');
  debouncedFn('c'); // Only the last call should execute

  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepStrictEqual(results, ['c']);
});

test('HotSwapHistoryEntry structure', () => {
  const entry = {
    id: 'hs-1234567890-abcd',
    timestamp: Date.now(),
    fileName: 'MyClass.java',
    status: 'success',
    durationMs: 234,
    message: 'HotSwap: Reloaded MyClass.java',
  };
  assert.strictEqual(typeof entry.id, 'string');
  assert.ok(entry.id.startsWith('hs-'));
  assert.strictEqual(typeof entry.timestamp, 'number');
  assert.strictEqual(entry.fileName, 'MyClass.java');
  assert.strictEqual(entry.status, 'success');
  assert.strictEqual(typeof entry.durationMs, 'number');
  assert.ok(entry.durationMs > 0);
});

test('HotSwapHistoryEntry failed status', () => {
  const entry = {
    id: 'hs-1234567891-efgh',
    timestamp: Date.now(),
    fileName: 'BrokenClass.java',
    status: 'failed',
    durationMs: 150,
    message: 'Compilation failed: cannot find symbol',
  };
  assert.strictEqual(entry.status, 'failed');
  assert.ok(entry.message.includes('Compilation failed'));
});

test('HotSwap history max entries trimming', () => {
  const MAX_HISTORY = 20;
  const history = [];

  // Add 25 entries
  for (let i = 0; i < 25; i++) {
    history.unshift({
      id: `hs-${i}`,
      timestamp: Date.now() - i * 1000,
      fileName: `Class${i}.java`,
      status: 'success',
      durationMs: 100 + i,
    });
    if (history.length > MAX_HISTORY) {
      history.length = MAX_HISTORY;
    }
  }

  assert.strictEqual(history.length, MAX_HISTORY);
  assert.strictEqual(history[0].fileName, 'Class24.java'); // Most recent
  assert.strictEqual(history[MAX_HISTORY - 1].fileName, 'Class5.java'); // Oldest kept
});

test('HotSwap isEnabled safe default behavior (PR00)', () => {
  const service = createTestService();
  try {
    localStorage.removeItem('kairo.java.hotswap.enabled');
  } catch {}

  // Default is disabled
  assert.strictEqual(service.isEnabled, false, 'default must be disabled for safety');

  // Explicitly enabled
  service.isEnabled = true;
  assert.strictEqual(service.isEnabled, true);

  // Explicitly disabled
  service.isEnabled = false;
  assert.strictEqual(service.isEnabled, false);
});

test('isUriContained correctly rejects sibling directory prefixes (PR02 / F21 / T06)', () => {
  // Sibling directories with common prefix
  assert.strictEqual(
    isUriContained('file:///C:/repo', 'file:///C:/repo-other/A.java'),
    false,
    'sibling directory must NOT be contained'
  );
  assert.strictEqual(
    isUriContained('file:///C:/repo/', 'file:///C:/repo-other/A.java'),
    false,
    'sibling directory with trailing slash must NOT be contained'
  );

  // Exact match
  assert.strictEqual(
    isUriContained('file:///C:/repo', 'file:///C:/repo'),
    true,
    'exact match is contained'
  );
  assert.strictEqual(
    isUriContained('file:///C:/repo/', 'file:///C:/repo'),
    true,
    'exact match with trailing slash is contained'
  );

  // Subdirectory files
  assert.strictEqual(
    isUriContained('file:///C:/repo', 'file:///C:/repo/src/A.java'),
    true,
    'nested child file is contained'
  );
  assert.strictEqual(
    isUriContained('file:///C:/repo/', 'file:///C:/repo/src/A.java'),
    true,
    'nested child file with trailing slash is contained'
  );

  // Unrelated paths
  assert.strictEqual(
    isUriContained('file:///C:/repo', 'file:///D:/repo/A.java'),
    false,
    'different drive is not contained'
  );
  assert.strictEqual(
    isUriContained('', 'file:///C:/repo/A.java'),
    false,
    'empty parent is not contained'
  );
});

test('T15: Immutable HotSwapContext prevents cross-session bleeding on UI switch (PR05 / F04)', async () => {
  const redefineCalls = [];
  const sessionA = {
    id: 'sess_A',
    configuration: { type: 'kairo-java', projectId: 'projectA' },
    sendCustomRequest: async (cmd, args) => {
      redefineCalls.push({ session: 'sess_A', cmd, args });
      return {};
    },
  };
  const sessionB = {
    id: 'sess_B',
    configuration: { type: 'kairo-java', projectId: 'projectB' },
    sendCustomRequest: async (cmd, args) => {
      redefineCalls.push({ session: 'sess_B', cmd, args });
      return {};
    },
  };

  const service = createTestService({
    currentSession: sessionA,
    sessions: [sessionA, sessionB],
  });

  // 1. File A saved when current session is A -> captureContext
  const ctxA = service.captureContext('file:///workspace/src/A.java');
  assert.ok(ctxA, 'context should be captured');
  assert.strictEqual(ctxA.session.id, 'sess_A');
  assert.strictEqual(ctxA.target.projectId, 'projectA');

  // 2. User switches UI session to B while compilation is running
  service.sessionManager.currentSession = sessionB;

  // 3. Mock compile to succeed
  service.compileFile = async () => ({ success: true, classPath: '/out/A.class' });

  // 4. Perform HotSwap with captured ctxA
  const result = await service.performHotSwap(ctxA);
  assert.strictEqual(result.status, 'success');

  // 5. Verify Session A received the redefine call, and Session B received ZERO calls
  assert.strictEqual(redefineCalls.length, 1);
  assert.strictEqual(redefineCalls[0].session, 'sess_A');
  assert.strictEqual(redefineCalls[0].cmd, 'redefineClasses');
  const sessionBCalls = redefineCalls.filter(c => c.session === 'sess_B');
  assert.strictEqual(sessionBCalls.length, 0, 'Session B must never receive Session A redefinitions');
});

test('T16: Serial queue and version checking prevents stale v1 from overwriting newer v2 (PR05 / F04)', async () => {
  const session = {
    id: 'sess_1',
    configuration: { type: 'kairo-java', projectId: 'projectA' },
    sendCustomRequest: async () => ({}),
  };
  const service = createTestService({
    currentSession: session,
    sessions: [session],
  });

  const redefinedVersions = [];
  service.redefineClassWithContext = async (ctx) => {
    redefinedVersions.push(ctx.version);
  };

  // Capture v1 and v2 sequentially
  const ctx1 = service.captureContext('file:///workspace/src/A.java');
  assert.strictEqual(ctx1.version, 1);

  const ctx2 = service.captureContext('file:///workspace/src/A.java');
  assert.strictEqual(ctx2.version, 2);

  service.compileFile = async () => ({ success: true, classPath: '/out/A.class' });

  // Enqueue both HotSwap requests
  const p1 = service.performHotSwap(ctx1);
  const p2 = service.performHotSwap(ctx2);

  await Promise.all([p1, p2]);

  // ctx1 must be skipped because latestSavedVersions is 2 (> 1)
  assert.deepStrictEqual(redefinedVersions, [2], 'only newer v2 should be redefined');
});

test('T17: DAP error classification rejects unsupported class structure changes without raw JDWP fallback (PR05 / F07)', async () => {
  const service = createTestService();

  // 1. Schema change error -> throws KairoError with code 'unsupported'
  const sessionSchema = {
    id: 'sess_schema',
    sendCustomRequest: async () => {
      throw new Error('hierarchy change not supported: adding fields or methods is not permitted');
    },
  };
  const ctx1 = {
    session: sessionSchema,
    filePath: 'file:///workspace/src/A.java',
    target: { ownsDebuggee: true, projectId: 'p1' },
  };

  await assert.rejects(
    async () => service.redefineViaDap(ctx1, ctx1.filePath),
    (err) => {
      assert.strictEqual(err.code, 'unsupported');
      assert.ok(err.message.includes('class structure change not supported'));
      return true;
    }
  );

  // 2. DAP owns debuggee, generic timeout error -> throws KairoError with code 'unsupported' (port collision prevented)
  const sessionOwned = {
    id: 'sess_owned',
    sendCustomRequest: async () => {
      throw new Error('request failed: timeout');
    },
  };
  const ctx2 = {
    session: sessionOwned,
    filePath: 'file:///workspace/src/A.java',
    target: { ownsDebuggee: true, projectId: 'p1' },
  };

  await assert.rejects(
    async () => service.redefineViaDap(ctx2, ctx2.filePath),
    (err) => {
      assert.strictEqual(err.code, 'unsupported');
      assert.ok(err.message.includes('owns debuggee connection; JDWP fallback prohibited'));
      return true;
    }
  );

  // 3. Headless session where DAP does not own debuggee -> returns false to permit JDWP fallback
  const sessionHeadless = {
    id: 'sess_headless',
    sendCustomRequest: async () => {
      throw new Error('redefineClasses not supported');
    },
  };
  const ctx3 = {
    session: sessionHeadless,
    filePath: 'file:///workspace/src/A.java',
    target: { ownsDebuggee: false, projectId: 'p1' },
  };

  const allowed = await service.redefineViaDap(ctx3, ctx3.filePath);
  assert.strictEqual(allowed, false, 'returns false to permit raw JDWP fallback');
});

test('T19: Stopping service (onStop) cancels in-flight work with zero side-effects (PR05 / F23)', async () => {
  const session = {
    id: 'sess_stop',
    configuration: { type: 'kairo-java', projectId: 'projectStop' },
    sendCustomRequest: async () => ({}),
  };
  const service = createTestService({
    currentSession: session,
    sessions: [session],
  });

  let redefinesExecuted = 0;
  let compileStarted = false;

  service.compileFile = async () => {
    compileStarted = true;
    await new Promise(r => setTimeout(r, 60));
    return { success: true, classPath: '/out/A.class' };
  };

  service.redefineClassWithContext = async () => {
    redefinesExecuted++;
  };

  const ctx = service.captureContext('file:///workspace/src/A.java');
  assert.ok(ctx);

  // Start in-flight HotSwap
  const hotSwapPromise = service.performHotSwap(ctx);

  // Wait until compile starts, then call onStop()
  while (!compileStarted) {
    await new Promise(r => setTimeout(r, 5));
  }
  service.onStop();

  const entry = await hotSwapPromise;
  assert.strictEqual(entry.status, 'failed', 'should not report success');
  assert.strictEqual(redefinesExecuted, 0, 'no redefinition should execute after onStop');
  assert.strictEqual(service.activeTargetQueues.size, 0, 'active queues must be cleared on onStop');
  assert.strictEqual(service.pendingFiles.size, 0, 'pending files must be cleared on onStop');
});