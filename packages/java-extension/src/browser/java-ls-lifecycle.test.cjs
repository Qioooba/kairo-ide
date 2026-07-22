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
  pathToFileUri,
} = require('../../lib/browser/java-ls-lifecycle');

const DISPOSABLE = { dispose() {} };

function makeMocks(descriptor) {
  const calls = [];
  let started = false;
  const listeners = { project: undefined, context: undefined };
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
  svc.init();
  return svc;
}

async function flush() {
  // Let the async onProjectChanged chain settle.
  for (let i = 0; i < 20; i++) {
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
