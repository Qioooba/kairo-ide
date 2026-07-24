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
    constructor(type, init) { super(type, init); this.dataTransfer = (init && init.dataTransfer) || null; }
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

require('@theia/core/lib/browser/frontend-application-config-provider').FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark', defaultIconTheme: 'theia-file-icons', applicationName: 'Kairo', validatePreferencesSchema: true,
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  copiedConfiguration,
  createTomcatRunConfiguration,
  emptyRunConfigurationDocument,
  KairoRunConfigurationService,
  parseEnvironmentReferences,
  runConfigurationExecutionBlockReason,
} = require('../../../lib/browser/kairo-run-configuration-service');

function createService(handler) {
  const service = new KairoRunConfigurationService();
  const calls = [];
  service.runtime = {
    workspace: () => 'ws-1',
    request: async (endpoint, payload, init) => {
      calls.push({ endpoint, payload, init });
      return handler(endpoint, payload, init);
    },
  };
  service.calls = calls;
  return service;
}

test('environment parser preserves references and rejects malformed or duplicate lines', () => {
  assert.deepEqual(parseEnvironmentReferences('TOKEN=${env:HOST_TOKEN}\nMODE=dev'), {
    TOKEN: '${env:HOST_TOKEN}', MODE: 'dev',
  });
  assert.throws(() => parseEnvironmentReferences('BROKEN'), /NAME=value/);
  assert.throws(() => parseEnvironmentReferences('A=1\nA=2'), /duplicated/);
});

test('copy generates unique id/name and deep copies mutable fields', () => {
  const source = createTomcatRunConfiguration('local', 'project-1');
  const document = { version: 1, configurations: [source, { ...source, id: 'local-copy', name: 'Tomcat Local Copy' }], selectedConfigurationId: 'local' };
  const copy = copiedConfiguration(source, document);
  assert.equal(copy.id, 'local-copy-2');
  assert.equal(copy.name, 'Tomcat Local Copy 2');
  copy.env.NEW = 'value';
  assert.equal(source.env.NEW, undefined);
});

test('client uses typed workspace CRUD paths, validates response, and disables retries for writes', async () => {
  let document = emptyRunConfigurationDocument();
  const service = createService((endpoint, payload) => {
    if (endpoint.startsWith('POST ')) document = { version: 1, configurations: [payload], selectedConfigurationId: payload.id };
    if (endpoint.startsWith('PUT ') && endpoint.includes('{configurationId}')) document = { ...document, configurations: [payload], selectedConfigurationId: payload.id };
    return document;
  });
  await service.load();
  const configuration = createTomcatRunConfiguration('local', 'project-1');
  await service.create(configuration);
  await service.update('local', { ...configuration, name: 'Local Updated' });
  assert.equal(service.calls[0].endpoint, 'GET /api/v1/workspaces/{workspaceId}/run-configurations');
  assert.deepEqual(service.calls[0].init.pathParams, { workspaceId: 'ws-1' });
  assert.equal(service.calls[1].init.noRetry, true);
  assert.equal(service.calls[2].init.pathParams.configurationId, 'local');
});

test('strict schema rejects plaintext sensitive env before any write', async () => {
  const service = createService(() => { throw new Error('must not be called'); });
  const invalid = createTomcatRunConfiguration('local', 'project-1');
  invalid.env.API_TOKEN = 'plaintext';
  await assert.rejects(service.create(invalid), /sensitive values must use/);
  assert.equal(service.calls.length, 0);
  assert.equal(service.current.validationIssues.length, 1);
});

test('editing cannot rename the persisted configuration id', async () => {
  const service = createService(() => { throw new Error('must not be called'); });
  const configuration = createTomcatRunConfiguration('renamed', 'project-1');
  await assert.rejects(service.update('original', configuration), /ID cannot be changed/);
  assert.equal(service.calls.length, 0);
});

test('execution subset allows all configurations including orchestration and war', () => {
  const executable = createTomcatRunConfiguration('local', 'project-1');
  executable.beforeLaunchTasks = [];
  assert.equal(runConfigurationExecutionBlockReason(executable), undefined);
  assert.equal(runConfigurationExecutionBlockReason({ ...executable, beforeLaunchTasks: ['build'] }), undefined);
  assert.equal(runConfigurationExecutionBlockReason({ ...executable, deploy: { mode: 'war', artifact: 'app.war' } }), undefined);
  assert.equal(runConfigurationExecutionBlockReason({ ...executable, build: { type: 'custom', command: 'x', clean: false } }), undefined);
});

test('launch sends only id path and expected mode; debug attach failure stops Tomcat', async () => {
  const configuration = createTomcatRunConfiguration('debug-local', 'project-1');
  configuration.mode = 'debug';
  configuration.beforeLaunchTasks = [];
  const service = createService(() => ({ id: 'server-1', projectId: 'project-1', state: 'running', ports: { http: 18080, debug: 8000 } }));
  service.state = { document: { version: 1, configurations: [configuration], selectedConfigurationId: configuration.id }, loading: false, submitting: false, validationIssues: [] };
  service.activeProject = { requireProject: async () => ({ workspaceId: 'ws-1', projectId: 'project-1', name: 'Legacy', root: '/workspace/project' }) };
  let attachTarget;
  service.javaDebug = { probeAvailability: async () => ({ state: 'available' }), attach: async target => { attachTarget = target; throw new Error('attach failed'); } };
  const stopped = [];
  const adopted = [];
  service.servers = { adopt: server => { adopted.push(server.id); return server; }, stop: async id => { stopped.push(id); } };
  await assert.rejects(service.launch(configuration), /attach failed/);
  assert.deepEqual(service.calls[0].payload, { mode: 'debug' });
  assert.deepEqual(service.calls[0].init.pathParams, { workspaceId: 'ws-1', configurationId: 'debug-local' });
  assert.equal(service.calls[0].init.noRetry, true);
  assert.equal(attachTarget.port, 8000);
  assert.equal(attachTarget.serverId, 'server-1');
  assert.deepEqual(stopped, ['server-1']);
  assert.deepEqual(adopted, ['server-1']);
});

test('launch locks before async preflight so double click issues one endpoint request', async () => {
  const configuration = createTomcatRunConfiguration('run-local', 'project-1');
  configuration.beforeLaunchTasks = [];
  const service = createService(() => ({ id: 'server-1', projectId: 'project-1', state: 'running', ports: { http: 18080 } }));
  service.state = { document: { version: 1, configurations: [configuration], selectedConfigurationId: configuration.id }, loading: false, submitting: false, validationIssues: [] };
  let release;
  const project = new Promise(resolve => { release = resolve; });
  service.activeProject = { requireProject: () => project };
  service.servers = { adopt: server => server };
  const first = service.launch(configuration);
  await assert.rejects(service.launch(configuration), /already in progress/);
  release({ workspaceId: 'ws-1', projectId: 'project-1', name: 'Legacy', root: '/workspace/project' });
  await first;
  assert.equal(service.calls.length, 1);
});

test('duplicate submissions fail while an operation is pending', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const service = createService(() => pending);
  const first = service.load();
  await assert.rejects(service.load(), /already in progress/);
  release(emptyRunConfigurationDocument());
  await first;
});

test('missing persisted document is represented as an empty list', async () => {
  const service = createService(() => { const error = new Error('missing'); error.code = 'not_found'; throw error; });
  assert.deepEqual(await service.load(), emptyRunConfigurationDocument());
  assert.equal(service.current.error, undefined);
});

test('UI contract blocks unsafe execution and exposes accessibility/error states', () => {
  const source = fs.readFileSync(path.join(__dirname, 'kairo-run-configurations-widget.tsx'), 'utf8');
  assert.match(source, /aria-busy=\{busy\}/);
  assert.match(source, /role="alert"/);
  assert.match(source, /Stored only; this version never executes custom commands/);
  assert.match(source, /idReadOnly=\{Boolean\(editing\.originalId\)\}/);
  assert.match(source, /Launch progress/);
  assert.match(source, /service\.launch\(configuration\)/);
  assert.doesNotMatch(source, /executeCommand\(configuration\.mode/);
});

test('teardown', () => disableJSDOM());
