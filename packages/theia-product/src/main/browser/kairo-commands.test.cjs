// KairoViewsContribution.registerCommands — contract test
// using a real inversify container with mocked dependencies.
//
// Verifies that every command the Kairo UI relies on is
// registered in the CommandRegistry. This catches regressions
// where a command is removed or renamed.
//
// Run with:
//   node --test src/main/browser/kairo-commands.test.cjs

'use strict';

// Use Theia's jsdom helper to set up a proper DOM environment
// before any Lumino/Theia browser code is loaded.
const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

// jsdom doesn't include DragEvent — patch it so Lumino's dragdrop loads
if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}

// Theia browser modules require CSS files — stub them out
const Module = require('module');
const origLoad = Module._extensions['.css'] || Module._extensions['.js'];
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
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
const { KairoRuntimeImpl } = require('@kairo/runtime-extension/lib/browser');
const { KairoServerService } = require('@kairo/tomcat-extension/lib/browser');
const { KairoProjectService, ActiveProjectService } = require('@kairo/project-extension/lib/browser');

// The production module under test
const { KairoViewsContribution, KairoCommands } = require('../../../lib/browser/kairo-views-contribution');

// --------------- mock factories ---------------

function createMock(obj, overrides) {
  const mock = {};
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (typeof obj[key] === 'function') {
      mock[key] = overrides[key] || (() => {});
    }
  }
  return mock;
}

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
  return {
    executeCommand: () => Promise.resolve(),
    executeCommandByHandler: () => Promise.resolve(),
  };
}

function createMockKairoRuntimeImpl() {
  return {
    openEvents: () => ({
      on: () => () => {},
      onStatus: () => () => {},
      close: () => {},
    }),
    request: () => Promise.resolve({}),
  };
}

function createMockKairoServerService() {
  return {
    start: () => Promise.resolve({ id: 'mock-srv', state: 'running' }),
    stop: () => Promise.resolve({}),
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
    requireProject: () => Promise.resolve({ projectId: 'mock-proj' }),
    getProject: () => Promise.resolve({}),
  };
}

function createMockMessageService() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => {},
  };
}

// --------------- tests ---------------

test('KairoCommands namespace declares the expected command ids with non-empty labels', () => {
  const expected = [
    'kairo.project.scan',
    'kairo.build',
    'kairo.buildAndDeploy',
    'kairo.server.start',
    'kairo.server.debug',
    'kairo.server.stop',
    'kairo.server.restart',
    'kairo.app.open',
    'kairo.view.servers',
    'kairo.view.builds',
    'kairo.view.deployments',
    'kairo.view.logs',
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
  // Build a minimal inversify container
  const container = new Container();

  container.bind(ApplicationShell).toConstantValue(createMockApplicationShell());
  container.bind(WidgetManager).toConstantValue(createMockWidgetManager());
  container.bind(CommandService).toConstantValue(createMockCommandService());
  container.bind(KairoRuntimeImpl).toConstantValue(createMockKairoRuntimeImpl());
  container.bind(KairoServerService).toConstantValue(createMockKairoServerService());
  container.bind(KairoProjectService).toConstantValue(createMockKairoProjectService());
  container.bind(ActiveProjectService).toConstantValue(createMockActiveProjectService());
  container.bind(MessageService).toConstantValue(createMockMessageService());

  // Bind the contribution under test
  container.bind(KairoViewsContribution).toSelf().inSingletonScope();

  // Resolve the contribution
  const contribution = container.get(KairoViewsContribution);

  // Create a real CommandRegistry to capture registrations
  const registry = new CommandRegistry();

  // Call the production registerCommands method
  contribution.registerCommands(registry);

  // Verify all 12 expected command IDs are registered
  const expectedIds = [
    'kairo.project.scan',
    'kairo.build',
    'kairo.buildAndDeploy',
    'kairo.server.start',
    'kairo.server.debug',
    'kairo.server.stop',
    'kairo.server.restart',
    'kairo.app.open',
    'kairo.view.servers',
    'kairo.view.builds',
    'kairo.view.deployments',
    'kairo.view.logs',
  ];

  const registeredIds = registry.commandIds;

  for (const id of expectedIds) {
    assert.ok(registeredIds.includes(id),
      `Command '${id}' should be registered in CommandRegistry`);
  }
});

test('KairoViewsContribution.registerCommands registers exactly 12 commands', () => {
  const container = new Container();

  container.bind(ApplicationShell).toConstantValue(createMockApplicationShell());
  container.bind(WidgetManager).toConstantValue(createMockWidgetManager());
  container.bind(CommandService).toConstantValue(createMockCommandService());
  container.bind(KairoRuntimeImpl).toConstantValue(createMockKairoRuntimeImpl());
  container.bind(KairoServerService).toConstantValue(createMockKairoServerService());
  container.bind(KairoProjectService).toConstantValue(createMockKairoProjectService());
  container.bind(ActiveProjectService).toConstantValue(createMockActiveProjectService());
  container.bind(MessageService).toConstantValue(createMockMessageService());

  container.bind(KairoViewsContribution).toSelf().inSingletonScope();

  const contribution = container.get(KairoViewsContribution);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  // We expect exactly 12 commands
  assert.strictEqual(registry.commandIds.length, 12,
    `Expected 12 commands, got ${registry.commandIds.length}: ${registry.commandIds.join(', ')}`);
});