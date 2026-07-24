// KairoViewsContribution.registerCommands — contract test
// using a real inversify container with mocked dependencies.
//
// Verifies that every command the Kairo UI relies on is
// registered in the CommandRegistry AND that each command
// executes by calling the expected service methods. This
// catches regressions where a command is removed, renamed,
// or silently broken.
//
// Run with:
//   node --test src/main/browser/kairo-commands.test.cjs

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

if (!global.ResizeObserver) {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

// Mock @theia/monaco-editor-core to avoid the ESM import issue in CJS tests.
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.includes('monaco-editor-core')) {
    const mockPath = require('node:path').join(__dirname, '..', '..', '..', '..', 'search-extension', 'src', 'browser', '__monaco-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  return origResolveFilename.call(this, request, parent, ...args);
};

// Theia requires FrontendApplicationConfigProvider to be set before
// any browser module is loaded.
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert');
const { Container } = require('inversify');

// Theia core symbols and classes
const { ApplicationShell, WidgetManager } = require('@theia/core/lib/browser');
const { CommandRegistry, CommandService, MessageService } = require('@theia/core/lib/common');

// Kairo extension symbols
const { RuntimeConnectionService } = require('@kairo/runtime-extension/lib/browser');
const { KairoServerService } = require('@kairo/tomcat-extension/lib/browser');
const { KairoProjectService, ActiveProjectService } = require('@kairo/project-extension/lib/browser');
const { BuildStore } = require('@kairo/build-extension/lib/browser');
const { KairoJavaDebugService } = require('../../../lib/browser/kairo-java-debug-service');

// The production module under test
const { KairoViewsContribution, KairoCommands } = require('../../../lib/browser/kairo-views-contribution');

// --------------- mock factories ---------------

function createMockApplicationShell() {
  return {
    activateWidget: () => {},
    getDockPanel: () => ({}),
    addWidget: () => {},
  };
}

function createMockWidgetManager() {
  return {
    getOrCreateWidget: () => Promise.resolve({ id: 'mock-widget' }),
    getWidgets: () => [],
  };
}

function createMockCommandService() {
  const calls = [];
  return {
    callLog: calls,
    executeCommand: (id, ...args) => { calls.push({ id, args }); return Promise.resolve(); },
    executeCommandByHandler: () => Promise.resolve(),
  };
}

function createMockRuntimeConnectionService() {
  const calls = [];
  return {
    callLog: calls,
    onStatusChange: () => () => {},
    subscribeEvents: () => () => {},
    request: (endpoint, payload) => {
      calls.push({ endpoint, payload });
      return Promise.resolve({ id: 'mock-result', state: 'success' });
    },
    workspace: () => 'mock-ws',
  };
}

function createMockKairoServerService() {
  const calls = [];
  return {
    callLog: calls,
    start: (projectId, debug) => {
      calls.push({ method: 'start', projectId, debug });
      return Promise.resolve({ id: 'mock-srv', state: 'running', pid: 12345, ports: { http: 18080, debug: 18000 } });
    },
    stop: (serverId, force) => {
      calls.push({ method: 'stop', serverId, force });
      return Promise.resolve({});
    },
    list: () => Promise.resolve([]),
  };
}

function createMockKairoProjectService() {
  return {
    currentWorkspace: () => ({ id: 'mock-ws', rootPath: '/mock' }),
    detectLayout: () => Promise.resolve({}),
  };
}

function createMockActiveProjectService() {
  return {
    requireProject: () => Promise.resolve({ projectId: 'mock-proj', name: 'Mock Project', root: '/mock/project' }),
    getProject: () => Promise.resolve({}),
  };
}

function createMockMessageService() {
  const messages = [];
  return {
    messages,
    info: (msg) => messages.push({ level: 'info', msg }),
    warn: (msg) => messages.push({ level: 'warn', msg }),
    error: (msg) => messages.push({ level: 'error', msg }),
    log: (msg) => messages.push({ level: 'log', msg }),
  };
}

function createMockBuildStore() {
  return {
    setBuilds: () => {},
    getBuilds: () => [],
    onBuildEvent: () => () => {},
  };
}

function createMockJavaDebugService() {
  const calls = [];
  return {
    callLog: calls,
    probeAvailability: async () => ({ state: 'available' }),
    attach: async target => {
      calls.push({ method: 'attach', target });
      return { state: 'connected', sessionId: 'debug-1', serverId: target.serverId };
    },
    stop: async () => { calls.push({ method: 'stop' }); },
  };
}

// --------------- helper: build container ---------------

function buildContainer() {
  const container = new Container();

  container.bind(ApplicationShell).toConstantValue(createMockApplicationShell());
  container.bind(WidgetManager).toConstantValue(createMockWidgetManager());
  container.bind(CommandService).toConstantValue(createMockCommandService());
  container.bind(RuntimeConnectionService).toConstantValue(createMockRuntimeConnectionService());
  container.bind(KairoServerService).toConstantValue(createMockKairoServerService());
  container.bind(KairoProjectService).toConstantValue(createMockKairoProjectService());
  container.bind(ActiveProjectService).toConstantValue(createMockActiveProjectService());
  container.bind(MessageService).toConstantValue(createMockMessageService());
  container.bind(BuildStore).toConstantValue(createMockBuildStore());
  container.bind(KairoJavaDebugService).toConstantValue(createMockJavaDebugService());

  container.bind(KairoViewsContribution).toSelf().inSingletonScope();

  return container;
}

// --------------- tests ---------------

test('KairoCommands namespace declares the expected command ids with non-empty labels', () => {
  const expected = [
    'kairo.project.import',
    'kairo.project.select',
    'kairo.project.scan',
    'kairo.build',
    'kairo.cleanBuild',
    'kairo.buildAndDeploy',
    'kairo.server.start',
    'kairo.server.debug',
    'kairo.debug.checkAdapter',
    'kairo.debug.openView',
    'kairo.debug.openConsole',
    'kairo.server.stop',
    'kairo.server.restart',
    'kairo.app.open',
    'kairo.view.servers',
    'kairo.view.builds',
    'kairo.view.deployments',
    'kairo.view.logs',
    'kairo.view.maven',
    'kairo.runConfigurations.manage',
    'kairo.jdk.switch',
    'kairo.agent.reconnect',
    'kairo.keymap.open',
  ];

  const commandEntries = Object.values(KairoCommands);
  const ids = commandEntries.map(c => c.id).sort();

  for (const id of expected) {
    assert.ok(ids.includes(id), `KairoCommands.${id} is missing from the namespace`);
  }

  for (const cmd of commandEntries) {
    assert.ok(typeof cmd.label === 'string' && cmd.label.length > 0,
      `Command ${cmd.id} should have a non-empty label`);
  }
});

test('KairoViewsContribution.registerCommands registers every command in a real CommandRegistry', () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  const expectedIds = [
    'kairo.project.import',
    'kairo.project.select',
    'kairo.project.scan',
    'kairo.build',
    'kairo.cleanBuild',
    'kairo.buildAndDeploy',
    'kairo.server.start',
    'kairo.server.debug',
    'kairo.debug.checkAdapter',
    'kairo.debug.openView',
    'kairo.debug.openConsole',
    'kairo.server.stop',
    'kairo.server.restart',
    'kairo.app.open',
    'kairo.view.servers',
    'kairo.view.builds',
    'kairo.view.deployments',
    'kairo.view.logs',
    'kairo.view.maven',
    'kairo.view.todo',
    'kairo.view.tests',
    'kairo.view.perf',
    'kairo.view.sqlConsole',
    'kairo.view.remote',
    'kairo.runConfigurations.manage',
    'kairo.jdk.switch',
    'kairo.agent.reconnect',
    'kairo.keymap.open',
    'kairo.terminal.toggle',
  ];

  const registeredIds = registry.commandIds;

  for (const id of expectedIds) {
    assert.ok(registeredIds.includes(id),
      `Command '${id}' should be registered in CommandRegistry`);
  }
});

test('KairoViewsContribution.registerCommands registers exactly 35 commands', () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  assert.strictEqual(registry.commandIds.length, 35,
    `Expected 35 commands, got ${registry.commandIds.length}: ${registry.commandIds.join(', ')}`);
});

// --------------- execution verification ---------------

test('execution: kairo.build calls runtime.request POST /api/v1/builds', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const runtime = container.get(RuntimeConnectionService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  const handler = registry.getCommand('kairo.build');
  assert.ok(handler, 'kairo.build command handler must exist');

  await registry.executeCommand('kairo.build');

  const buildCalls = runtime.callLog.filter(c => c.endpoint === 'POST /api/v1/builds');
  assert.ok(buildCalls.length >= 1, `Expected POST /api/v1/builds call, got ${buildCalls.length}`);
});

test('execution: kairo.cleanBuild posts clean:true (KAIRO-RC-WEB-007)', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const runtime = container.get(RuntimeConnectionService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  const handler = registry.getCommand('kairo.cleanBuild');
  assert.ok(handler, 'kairo.cleanBuild command handler must exist');

  await registry.executeCommand('kairo.cleanBuild');

  const buildCalls = runtime.callLog.filter(c => c.endpoint === 'POST /api/v1/builds');
  assert.ok(buildCalls.length >= 1, `Expected POST /api/v1/builds call, got ${buildCalls.length}`);
  const payload = buildCalls[0].payload || buildCalls[0].body || {};
  assert.strictEqual(payload.clean, true,
    `cleanBuild must post clean:true, got payload ${JSON.stringify(payload)}`);
});

test('execution: kairo.buildAndDeploy calls both build and deploy', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const runtime = container.get(RuntimeConnectionService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  await registry.executeCommand('kairo.buildAndDeploy');

  const buildCalls = runtime.callLog.filter(c => c.endpoint === 'POST /api/v1/builds');
  const deployCalls = runtime.callLog.filter(c => c.endpoint === 'POST /api/v1/deployments');
  assert.ok(buildCalls.length >= 1, 'buildAndDeploy must call POST /api/v1/builds');
  assert.ok(deployCalls.length >= 1, 'buildAndDeploy must call POST /api/v1/deployments');
});

test('execution: kairo.server.start calls serverSvc.start', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const serverSvc = container.get(KairoServerService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  await registry.executeCommand('kairo.server.start');

  const startCalls = serverSvc.callLog.filter(c => c.method === 'start');
  assert.ok(startCalls.length >= 1, `Expected serverSvc.start call, got ${startCalls.length}`);
  assert.strictEqual(startCalls[0].projectId, 'mock-proj');
  assert.strictEqual(startCalls[0].debug, false);
});

test('execution: kairo.server.debug calls serverSvc.start with debug=true', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const serverSvc = container.get(KairoServerService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  await registry.executeCommand('kairo.server.debug');

  const startCalls = serverSvc.callLog.filter(c => c.method === 'start');
  assert.ok(startCalls.length >= 1, `Expected serverSvc.start call, got ${startCalls.length}`);
  assert.strictEqual(startCalls[0].debug, true, 'debug command must pass debug=true');
  const javaDebug = container.get(KairoJavaDebugService);
  assert.equal(javaDebug.callLog.filter(c => c.method === 'attach').length, 1,
    'debug command must attach Theia DAP after JDWP is ready');
});

test('execution: kairo.server.stop calls serverSvc.stop for each running server', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const runtime = container.get(RuntimeConnectionService);
  const serverSvc = container.get(KairoServerService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  // Override the runtime.request for GET /api/v1/servers to return a server
  const origRequest = runtime.request;
  runtime.request = (endpoint, payload) => {
    if (endpoint === 'GET /api/v1/servers') {
      return Promise.resolve([{ id: 'srv-1', state: 'running', ports: {} }]);
    }
    return origRequest(endpoint, payload);
  };

  await registry.executeCommand('kairo.server.stop');

  const stopCalls = serverSvc.callLog.filter(c => c.method === 'stop');
  assert.ok(stopCalls.length >= 1, `Expected serverSvc.stop call, got ${stopCalls.length}`);
  assert.strictEqual(stopCalls[0].serverId, 'srv-1');
});

test('execution: adapter stop failure cannot block Tomcat stop', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const runtime = container.get(RuntimeConnectionService);
  const serverSvc = container.get(KairoServerService);
  const javaDebug = container.get(KairoJavaDebugService);
  javaDebug.stop = async () => { throw new Error('adapter hung'); };
  runtime.request = endpoint => endpoint === 'GET /api/v1/servers'
    ? Promise.resolve([{ id: 'srv-1', state: 'running', ports: { debug: 18000 } }])
    : Promise.resolve({});
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  await registry.executeCommand('kairo.server.stop');

  assert.equal(serverSvc.callLog.filter(c => c.method === 'stop').length, 1);
});

test('execution: kairo.server.restart calls POST /api/v1/servers/{id}/restart', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const runtime = container.get(RuntimeConnectionService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  // Override GET /api/v1/servers to return a server
  const origRequest = runtime.request;
  runtime.request = (endpoint, payload, init) => {
    if (endpoint === 'GET /api/v1/servers') {
      return Promise.resolve([{ id: 'srv-1', state: 'running', ports: {} }]);
    }
    return origRequest(endpoint, payload, init);
  };

  await registry.executeCommand('kairo.server.restart');

  const restartCalls = runtime.callLog.filter(c => c.endpoint === 'POST /api/v1/servers/{serverId}/restart');
  assert.ok(restartCalls.length >= 1, `Expected POST /api/v1/servers/{id}/restart call, got ${restartCalls.length}`);
});

test('execution: kairo.project.scan calls projectSvc.detectLayout', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const projectSvc = container.get(KairoProjectService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  let detectCalled = false;
  projectSvc.detectLayout = () => {
    detectCalled = true;
    return Promise.resolve({});
  };

  await registry.executeCommand('kairo.project.scan');
  assert.ok(detectCalled, 'project.scan must call projectSvc.detectLayout');
});

test('execution: kairo.app.open calls GET /api/v1/servers then opens URL', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const runtime = container.get(RuntimeConnectionService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  // Override GET /api/v1/servers to return a running server with an HTTP port.
  // The override must still record the call — the assertion below
  // inspects callLog.
  const origRequest = runtime.request;
  runtime.request = (endpoint, payload) => {
    if (endpoint === 'GET /api/v1/servers') {
      runtime.callLog.push({ endpoint, payload });
      return Promise.resolve([{ id: 'srv-1', state: 'running', ports: { http: 8080 } }]);
    }
    return origRequest(endpoint, payload);
  };

  await registry.executeCommand('kairo.app.open');

  const serverCalls = runtime.callLog.filter(c => c.endpoint === 'GET /api/v1/servers');
  assert.ok(serverCalls.length >= 1, 'app.open must call GET /api/v1/servers');
});

test('execution: debug navigation delegates to native Theia views', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const commands = container.get(CommandService);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  await registry.executeCommand('kairo.debug.openView');
  await registry.executeCommand('kairo.debug.openConsole');
  assert.deepEqual(commands.callLog.map(call => call.id), ['debug:toggle', 'debug:console:toggle']);
});

test('execution: all 23 commands have executable handlers', async () => {
  const container = buildContainer();
  const contribution = container.get(KairoViewsContribution);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  const cmdIds = [
    'kairo.project.import',
    'kairo.project.select',
    'kairo.project.scan',
    'kairo.build',
    'kairo.cleanBuild',
    'kairo.buildAndDeploy',
    'kairo.server.start',
    'kairo.server.debug',
    'kairo.debug.checkAdapter',
    'kairo.debug.openView',
    'kairo.debug.openConsole',
    'kairo.server.stop',
    'kairo.server.restart',
    'kairo.app.open',
    'kairo.view.servers',
    'kairo.view.builds',
    'kairo.view.deployments',
    'kairo.view.logs',
    'kairo.view.maven',
    'kairo.runConfigurations.manage',
    'kairo.jdk.switch',
    'kairo.agent.reconnect',
    'kairo.keymap.open',
  ];

  for (const id of cmdIds) {
    const handler = registry.getActiveHandler(id);
    assert.ok(handler, `Command '${id}' must have an active handler`);
    assert.ok(typeof handler.execute === 'function',
      `Command '${id}' must have an execute function`);
  }
});
