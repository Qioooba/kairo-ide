// Unit test for JavaLanguageServerLifecycle wiring (KAIRO QA:
// "JDT LS never starts from the UI").
//
// Verifies the full chain on a project change:
//   POST /java/prepare  ->  GET /java/launch-descriptor  ->  JavaLanguageClient.start
// and that "already running" is treated as success (no second
// start) and failures are logged, not thrown.
//
// Uses the compiled lib output; run via `pnpm --filter
// @kairo/java-extension test`. Preamble (jsdom, DragEvent
// shim, css hook, FrontendApplicationConfigProvider) follows
// the repo convention from encoding-uri-coercion.test.cjs.

'use strict';

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  JavaLanguageServerLifecycle,
  extractWorkspaceDataDir,
  extractJdtLsHome,
  extractJavaHome,
  isFatalJdtLsFailure,
  pathToFileUri,
} = require('../../lib/browser/java-ls-lifecycle');

const DISPOSABLE = { dispose() {} };

function makeMocks(descriptor) {
  const calls = [];
  let started = false;
  const listeners = { project: undefined, context: undefined, state: undefined };
  const logs = { info: [], warn: [], error: [] };
  const mocks = {
    calls,
    listeners,
    logs,
    runtime: {
      async request(endpoint, body, opts) {
        calls.push({ kind: 'http', endpoint: String(endpoint), body, opts });
        if (String(endpoint).startsWith('POST')) {
          return {};
        }
        return descriptor;
      },
    },
    workspaceContext: {
      requireContext: () => ({ workspaceId: 'ws1' }),
      onDidChangeContext: l => {
        listeners.context = l;
        return DISPOSABLE;
      },
    },
    activeProject: {
      project: { workspaceId: 'ws1', projectId: 'p1' },
      onDidChangeProject: l => {
        listeners.project = l;
        return DISPOSABLE;
      },
    },
    javaClient: {
      state: () => (started ? 'ready' : 'uninitialized'),
      async fetchState() {
        return started ? 'ready' : 'uninitialized';
      },
      async start(opts) {
        calls.push({ kind: 'start', opts });
        started = true;
        return { ok: true };
      },
      async stop() {
        calls.push({ kind: 'stop' });
        started = false;
      },
      onState(listener) {
        listeners.state = listener;
        return DISPOSABLE;
      },
      onLog(listener) {
        listeners.log = listener;
        return DISPOSABLE;
      },
    },
    logger: {
      info: m => logs.info.push(String(m)),
      warn: m => logs.warn.push(String(m)),
      error: m => logs.error.push(String(m)),
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      setLogLevel: () => Promise.resolve(),
      getLogLevel: () => Promise.resolve(0),
      log: () => {},
      child: () => mocks.logger,
    },
  };
  mocks.crash = () => {
    started = false;
    listeners.state('crashed');
  };
  return mocks;
}

function makeLifecycle(mocks) {
  const svc = Object.create(JavaLanguageServerLifecycle.prototype);
  svc.runtime = mocks.runtime;
  svc.workspaceContext = mocks.workspaceContext;
  svc.activeProject = mocks.activeProject;
  svc.javaClient = mocks.javaClient;
  svc.logger = mocks.logger;
  svc.launchDescriptor = undefined;
  svc.lastStartKey = undefined;
  svc.toDispose = [];
  svc.desiredProject = undefined;
  svc.activationToken = 0;
  svc.restartAttempts = 0;
  svc.restartTimer = undefined;
  svc.restartInFlight = false;
  svc.disposed = false;
  svc.transitionChain = Promise.resolve();
  svc.initialDelayMs = () => 0;
  svc.init();
  return svc;
}

async function flush() {
  // Let the async onProjectChanged chain settle.
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout: predicate never became true');
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

const DESCRIPTOR = {
  command: '/jre17/bin/java',
  args: [
    '-jar', '/jdtls-home/plugins/org.eclipse.equinox.launcher_1.6.900.v20240613-2009.jar',
    '-configuration', '/jdtls-home/config_mac',
    '-data', '/data/ws1_p1',
  ],
  workingDir: '/repo/proj',
  envAllowlist: ['PATH=/usr/bin', 'JAVA_HOME=/jre17', 'JDTLS_WORKSPACE=/data/ws1_p1'],
};

test('project change runs prepare -> descriptor -> client.start in order', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  const svc = makeLifecycle(mocks);

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();

  const kinds = mocks.calls.map(c => c.kind);
  assert.deepEqual(kinds, ['http', 'http', 'start']);
  assert.match(mocks.calls[0].endpoint, /^POST \/api\/v1\/workspaces\/ws1\/java\/prepare$/);
  assert.deepEqual(mocks.calls[0].body, { projectId: 'p1' });
  assert.match(mocks.calls[1].endpoint, /^GET \/api\/v1\/workspaces\/ws1\/java\/launch-descriptor$/);
  assert.deepEqual(mocks.calls[1].opts, { query: { projectId: 'p1' } });
  assert.deepEqual(mocks.calls[2].opts, {
    rootUri: 'file:///repo/proj',
    workspaceDataDir: '/data/ws1_p1',
    home: '/jdtls-home',
    jreHome: '/jre17',
  });
  assert.deepEqual(mocks.logs.error, []);
  svc.dispose();
});

test('already running is success: no second start for same project', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  const svc = makeLifecycle(mocks);

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();
  // Second project/context change while the client reports ready.
  mocks.listeners.context({ workspaceId: 'ws1' });
  await flush();

  const starts = mocks.calls.filter(c => c.kind === 'start');
  assert.equal(starts.length, 1);
  assert.deepEqual(mocks.logs.error, []);
  svc.dispose();
});

test('crash schedules one non-reentrant automatic restart', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  const svc = makeLifecycle(mocks);
  svc.restartDelayMs = () => 0;

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();
  mocks.crash();
  mocks.listeners.state('crashed');
  await new Promise(resolve => setTimeout(resolve, 5));
  await flush();

  assert.equal(mocks.calls.filter(c => c.kind === 'start').length, 2);
  assert.match(mocks.logs.warn[0], /automatic restart 1\/3/);
  mocks.listeners.context({ workspaceId: 'ws1' });
  await flush();
  assert.equal(svc.restartAttempts, 1, 'duplicate context events must not reset the crash-loop budget');
  svc.dispose();
});

test('automatic restart stops after the configured limit', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  const svc = makeLifecycle(mocks);
  svc.restartDelayMs = () => 0;

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();
  for (let i = 0; i < 4; i++) {
    mocks.crash();
    await new Promise(resolve => setTimeout(resolve, 5));
    await flush();
  }

  assert.equal(mocks.calls.filter(c => c.kind === 'start').length, 4, 'initial start plus at most three restarts');
  assert.ok(mocks.logs.error.some(line => /restart limit reached/.test(line)));
  svc.dispose();
});

test('clearing the active project cancels restart and stops the backend', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  const svc = makeLifecycle(mocks);
  svc.restartDelayMs = () => 20;

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();
  mocks.crash();
  mocks.listeners.project(undefined);
  await new Promise(resolve => setTimeout(resolve, 30));
  await flush();

  assert.equal(mocks.calls.filter(c => c.kind === 'start').length, 1);
  assert.equal(mocks.calls.filter(c => c.kind === 'stop').length, 1);
  svc.dispose();
});

test('workspace close cancels an in-flight prepare before it can start JDT LS', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  let releasePrepare;
  let resolveStarted;
  const startedPrepare = new Promise(resolve => { resolveStarted = resolve; });
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  mocks.runtime.request = async (endpoint, body, opts) => {
    mocks.calls.push({ kind: 'http', endpoint: String(endpoint), body, opts });
    if (String(endpoint).startsWith('POST')) {
      resolveStarted();
      await prepare;
      return {};
    }
    return DESCRIPTOR;
  };
  const svc = makeLifecycle(mocks);

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await startedPrepare;
  mocks.listeners.context(undefined);
  releasePrepare();
  await flush();

  assert.equal(mocks.calls.filter(c => c.kind === 'start').length, 0);
  assert.equal(mocks.calls.filter(c => c.kind === 'stop').length, 1);
  assert.equal(mocks.calls.filter(c => c.kind === 'http').length, 1, 'descriptor request must be cancelled logically');
  svc.dispose();
});

test('switching project stops the old ready process before starting the new root', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  mocks.runtime.request = async (endpoint, body, opts) => {
    mocks.calls.push({ kind: 'http', endpoint: String(endpoint), body, opts });
    if (String(endpoint).startsWith('POST')) return {};
    const projectId = opts.query.projectId;
    return {
      ...DESCRIPTOR,
      workingDir: `/repo/${projectId}`,
      envAllowlist: [`JDTLS_WORKSPACE=/data/${projectId}`],
    };
  };
  const svc = makeLifecycle(mocks);

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();
  await waitFor(() => mocks.calls.some(c => c.kind === 'start'));
  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p2' });
  await waitFor(() => mocks.calls.filter(c => c.kind === 'start').length === 2);

  assert.deepEqual(
    mocks.calls.filter(c => c.kind === 'start' || c.kind === 'stop').map(c => c.kind),
    ['start', 'stop', 'start'],
  );
  assert.equal(mocks.calls.filter(c => c.kind === 'start')[1].opts.rootUri, 'file:///repo/p2');
  svc.dispose();
});

test('overlapping project switches serialize stop and only start the latest project', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  let state = 'uninitialized';
  let releaseStop;
  const stopGate = new Promise(resolve => { releaseStop = resolve; });
  mocks.runtime.request = async (endpoint, body, opts) => {
    mocks.calls.push({ kind: 'http', endpoint: String(endpoint), body, opts });
    if (String(endpoint).startsWith('POST')) return {};
    const projectId = opts.query.projectId;
    return {
      ...DESCRIPTOR,
      workingDir: `/repo/${projectId}`,
      envAllowlist: [`JDTLS_WORKSPACE=/data/${projectId}`],
    };
  };
  mocks.javaClient.fetchState = async () => state;
  mocks.javaClient.start = async opts => {
    mocks.calls.push({ kind: 'start', opts });
    state = 'ready';
    return { ok: true };
  };
  mocks.javaClient.stop = async () => {
    mocks.calls.push({ kind: 'stop' });
    await stopGate;
    state = 'stopped';
  };
  const svc = makeLifecycle(mocks);

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();
  // p1's descriptor fetch and client.start are async; wait deterministically
  // until the first start landed so that `state` is 'ready' before p2 fires.
  await waitFor(() => mocks.calls.some(c => c.kind === 'start'));
  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p2' });
  // `delay(0)` uses setTimeout with a ~1ms timer; a bounded setImmediate
  // flush can finish before it fires, so wait for the stop call itself.
  await waitFor(() => mocks.calls.filter(c => c.kind === 'stop').length === 1);
  assert.equal(mocks.calls.filter(c => c.kind === 'stop').length, 1, 'p2 transition must be waiting for stop');
  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p3' });
  await flush();
  releaseStop();
  await waitFor(() => mocks.calls.filter(c => c.kind === 'start').length === 2);
  await flush();

  const starts = mocks.calls.filter(c => c.kind === 'start');
  assert.deepEqual(starts.map(call => call.opts.rootUri), ['file:///repo/p1', 'file:///repo/p3']);
  assert.equal(mocks.calls.filter(c => c.kind === 'stop').length, 1);
  svc.dispose();
});

test('dispose cancels recovery and requests bounded backend stop', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  const svc = makeLifecycle(mocks);
  svc.restartDelayMs = () => 20;

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();
  mocks.crash();
  svc.dispose();
  await new Promise(resolve => setTimeout(resolve, 30));
  await flush();

  assert.equal(mocks.calls.filter(c => c.kind === 'start').length, 1);
  assert.equal(mocks.calls.filter(c => c.kind === 'stop').length, 1);
});

test('exit code 13 is treated as fatal and does not restart-spam', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  const svc = makeLifecycle(mocks);
  svc.restartDelayMs = () => 0;

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();
  mocks.listeners.log({ level: 'stdout', line: '[exit] code=13 signal=' });
  mocks.crash();
  await new Promise(resolve => setTimeout(resolve, 5));
  await flush();
  // Duplicate crash/context must not spawn more starts or spam the limit log.
  mocks.crash();
  mocks.listeners.context({ workspaceId: 'ws1' });
  await flush();

  assert.equal(mocks.calls.filter(c => c.kind === 'start').length, 1);
  assert.ok(mocks.logs.error.some(line => /fatal failure/i.test(line)));
  assert.equal(mocks.logs.error.filter(line => /restart limit reached/.test(line)).length, 0);
  svc.dispose();
});

test('extractJavaHome prefers envAllowlist JAVA_HOME then command path', () => {
  assert.equal(extractJavaHome(DESCRIPTOR), '/jre17');
  assert.equal(
    extractJavaHome({ command: '/opt/jdk21/bin/java', args: [], workingDir: '/r', envAllowlist: [] }),
    '/opt/jdk21',
  );
  assert.equal(isFatalJdtLsFailure('', 13), true);
  assert.equal(isFatalJdtLsFailure('requires a JDK/JRE 21+ host runtime'), true);
  assert.equal(isFatalJdtLsFailure('connection got disposed', null), false);
});

test('start failure is logged, not thrown', async () => {
  const mocks = makeMocks(DESCRIPTOR);
  mocks.javaClient.start = async () => ({ ok: false, reason: 'no JRE 17' });
  const svc = makeLifecycle(mocks);

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();

  assert.equal(mocks.logs.error.length, 1);
  assert.match(mocks.logs.error[0], /no JRE 17/);
  svc.dispose();
});

test('missing workspace data dir in descriptor is logged, start skipped', async () => {
  const mocks = makeMocks({ command: 'java', args: [], workingDir: '/repo/proj', envAllowlist: [] });
  const svc = makeLifecycle(mocks);

  mocks.listeners.project({ workspaceId: 'ws1', projectId: 'p1' });
  await flush();

  assert.equal(mocks.calls.filter(c => c.kind === 'start').length, 0);
  assert.equal(mocks.logs.error.length, 1);
  svc.dispose();
});

test('extractWorkspaceDataDir prefers envAllowlist, falls back to -data arg', () => {
  assert.equal(extractWorkspaceDataDir(DESCRIPTOR), '/data/ws1_p1');
  assert.equal(
    extractWorkspaceDataDir({ command: 'java', args: ['-data', '/other'], workingDir: '/r', envAllowlist: [] }),
    '/other',
  );
  assert.equal(
    extractWorkspaceDataDir({ command: 'java', args: [], workingDir: '/r', envAllowlist: [] }),
    undefined,
  );
});

test('pathToFileUri handles posix and windows paths', () => {
  assert.equal(pathToFileUri('/repo/proj'), 'file:///repo/proj');
  assert.equal(pathToFileUri('C:\\repo\\proj'), 'file:///C:/repo/proj');
});

test('extractJdtLsHome finds the install home from the -jar launcher path', () => {
  assert.equal(extractJdtLsHome(DESCRIPTOR), '/jdtls-home');
  // Windows-style separators are normalized.
  assert.equal(
    extractJdtLsHome({
      command: 'java',
      args: ['-jar', 'C:\\tools\\jdtls\\plugins\\org.eclipse.equinox.launcher_1.6.9.jar'],
      workingDir: 'C:\\repo',
      envAllowlist: [],
    }),
    'C:/tools/jdtls',
  );
  // No launcher path -> undefined (backend falls back to KAIRO_JDT_LS_HOME).
  assert.equal(
    extractJdtLsHome({ command: 'java', args: ['-data', '/x'], workingDir: '/r', envAllowlist: [] }),
    undefined,
  );
});
