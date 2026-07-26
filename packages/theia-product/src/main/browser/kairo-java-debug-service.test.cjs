'use strict';

const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
register('data:text/javascript,' + encodeURIComponent(`
export function resolve(specifier, context, nextResolve) {
  if (/\.(css|svg|ttf|woff|woff2|png|jpg|gif)$/.test(specifier)) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  if (specifier === '@theia/monaco-editor-core' || specifier.includes('monaco-editor-core')) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`), pathToFileURL(__filename));

// Stub CommonJS .css requires that the ESM hook above cannot see.
// @theia/core's CommonJS modules sometimes `require('./foo.css')`,
// which Node's default CJS loader tries to compile as JavaScript and
// throws "SyntaxError: Unexpected token ':'". We install a no-op
// extension so .css requires resolve to an empty module.
const _Module = require('module');
_Module._extensions['.css'] = function (mod, filename) {
  mod._compile('module.exports = {};', filename);
};

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

// Theia stores a frontend config singleton that throws when
// `FrontendApplicationConfigProvider.get()` is called before
// `FrontendApplicationConfigProvider.set(...)` has been called once.
// The WindowTitleService reads the config at module-load time, so we
// must set the config before the first `require()` that pulls in
// the Theia window-title module.
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  applicationName: 'Kairo IDE',
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createKairoJavaAttachConfiguration,
} = require('../../../lib/common/kairo-java-debug');
const { debugStatusBarPresentation, KairoJavaDebugService } = require('../../../lib/browser/kairo-java-debug-service');

function createEvent() {
  const listeners = new Set();
  return {
    event: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    fire: value => { for (const listener of [...listeners]) listener(value); },
  };
}

function createService({ available = true, startError, destroyBeforeStart = false, noStartEvent = false } = {}) {
  const service = new KairoJavaDebugService();
  const sessions = new Map();
  const started = createEvent();
  const destroyed = createEvent();
  const stopped = createEvent();
  const changed = createEvent();
  service.debugService = {
    provideDebugConfigurations: async () => available
      ? [{ type: 'kairo-java', name: 'configured', request: 'attach' }]
      : [],
  };
  service.sessions = {
    onDidStartDebugSession: started.event,
    onDidStopDebugSession: stopped.event,
    onDidChange: changed.event,
    onDidDestroyDebugSession: destroyed.event,
    state: 2,
    async start(options) {
      if (startError) throw startError;
      const session = { id: 'debug-1', configuration: options.configuration };
      sessions.set(session.id, session);
      queueMicrotask(() => {
        if (destroyBeforeStart) destroyed.fire(session);
        else if (!noStartEvent) started.fire(session);
      });
      return session;
    },
    getSession: id => sessions.get(id),
    async terminateSession(session) { sessions.delete(session.id); },
  };
  service.init();
  service.testEvents = { started, stopped, changed, destroyed };
  return service;
}

const target = {
  serverId: 'srv-1', projectId: 'project-1', projectName: 'Legacy App',
  projectRoot: '/workspace/legacy', port: 5005,
};

test('attach configuration is local, standard, and does not claim attachment', () => {
  const config = createKairoJavaAttachConfiguration(target);
  assert.equal(config.type, 'kairo-java');
  assert.equal(config.request, 'attach');
  assert.equal(config.hostName, '127.0.0.1');
  assert.equal(config.port, 5005);
  assert.deepEqual(config.sourcePaths, ['/workspace/legacy']);
  assert.equal(Object.hasOwn(config, 'attached'), false);
  assert.throws(() => createKairoJavaAttachConfiguration({ ...target, port: 0 }), /Invalid JDWP port/);
});

test('unavailable adapter fails before a Theia session is started', async () => {
  const service = createService({ available: false });
  await assert.rejects(service.attach(target), /No Java Debug Adapter is configured/);
  assert.equal(service.currentStatus.state, 'unavailable');
  assert.equal(service.currentStatus.sessionId, undefined);
});

test('attach exposes connecting/connected boundaries and stop terminates the owned session', async () => {
  const service = createService();
  const states = [];
  service.onDidChangeStatus(status => states.push(status.state));
  const connected = await service.attach(target);
  assert.equal(connected.state, 'connected');
  assert.equal(connected.sessionId, 'debug-1');
  assert.deepEqual(states, ['available', 'connecting', 'connecting', 'connected']);
  await service.stop();
  assert.equal(service.currentStatus.state, 'terminated');
});

test('adapter startup failure is visible and never becomes connected', async () => {
  const service = createService({ startError: new Error('adapter exited') });
  await assert.rejects(service.attach(target), /adapter exited/);
  assert.equal(service.currentStatus.state, 'error');
  assert.match(service.currentStatus.message, /adapter exited/);
  assert.equal(service.currentStatus.sessionId, undefined);
});

test('session destruction before DAP attach never becomes connected', async () => {
  const service = createService({ destroyBeforeStart: true });
  await assert.rejects(service.attach(target), /ended before attach completed/);
  assert.equal(service.currentStatus.state, 'error');
  assert.equal(service.currentStatus.sessionId, undefined);
});

test('hung DAP attach times out, terminates the created session, and fails closed', async () => {
  const service = createService({ noStartEvent: true });
  service.attachTimeoutMs = () => 5;
  await assert.rejects(service.attach(target), /timed out/);
  assert.equal(service.currentStatus.state, 'error');
  assert.equal(service.currentStatus.sessionId, undefined);
});

test('native DAP stop/resume events map to paused/connected without fabricating a hit', async () => {
  const service = createService();
  await service.attach(target);
  const session = { id: 'debug-1', configuration: { type: 'kairo-java', __kairoServerId: 'srv-1' } };
  service.testEvents.stopped.fire(session);
  assert.equal(service.currentStatus.state, 'paused');
  service.testEvents.changed.fire(session);
  assert.equal(service.currentStatus.state, 'connected');
});

test('unexpected adapter destruction is error; user-requested stop is terminated', async () => {
  const crashed = createService();
  await crashed.attach(target);
  crashed.testEvents.destroyed.fire({ id: 'debug-1', configuration: {} });
  assert.equal(crashed.currentStatus.state, 'error');
  assert.match(crashed.currentStatus.message, /unexpectedly/);

  const stopped = createService();
  await stopped.attach(target);
  await stopped.stop();
  stopped.testEvents.destroyed.fire({ id: 'debug-1', configuration: {} });
  assert.equal(stopped.currentStatus.state, 'terminated');
});

test('debug status bar presentation distinguishes connected, paused and error', () => {
  assert.match(debugStatusBarPresentation({ state: 'connected', sessionId: 'd1' }).text, /connected.*d1/);
  assert.match(debugStatusBarPresentation({ state: 'paused' }).text, /paused/);
  assert.match(debugStatusBarPresentation({ state: 'error', message: 'adapter died' }).tooltip, /adapter died/);
});
