// Kairo Widget Interactions — integration tests.
//
// Verifies widget state management, lifecycle, and interaction
// patterns for key Kairo views. Tests loading, error, empty,
// and normal state rendering for the Deployments widget and
// verifies that widgets exported from the views contribution
// module have the expected structure.
//
// Run with:
//   node --test src/main/browser/kairo-widget-interactions.test.cjs

'use strict';

const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
register('data:text/javascript,' + encodeURIComponent(`
export function resolve(specifier, context, nextResolve) {
  if (/\\.(css|svg|ttf|woff|woff2|png|jpg|gif)$/.test(specifier)) {
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

const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.includes('monaco-editor-core')) {
    const mockPath = require('node:path').join(__dirname, '..', '..', '..', '..', 'search-extension', 'src', 'browser', '__monaco-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  if (request === 'p-queue') {
    const mockPath = require('node:path').join(__dirname, '__p-queue-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  if (request === 'xterm' || request === 'xterm-addon-webgl' || request === 'xterm-addon-fit') {
    const mockPath = require('node:path').join(__dirname, '__xterm-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  return origResolveFilename.call(this, request, parent, ...args);
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
const { Container } = require('inversify');

// ------------------------------------------------------------------
// KairoDeploymentsWidget — five-state rendering tests
// ------------------------------------------------------------------

const { KairoDeploymentsWidget } = require('../../../lib/browser/kairo-views-contribution');

test('KairoDeploymentsWidget is a class with expected ID', () => {
  assert.equal(typeof KairoDeploymentsWidget, 'function');
  assert.equal(KairoDeploymentsWidget.ID, 'kairo-deployments');
});

test('KairoDeploymentsWidget has state management methods', () => {
  const proto = KairoDeploymentsWidget.prototype;
  assert.equal(typeof proto.setLoading, 'function');
  assert.equal(typeof proto.setError, 'function');
  assert.equal(typeof proto.setDeployments, 'function');
});

test('KairoDeploymentsWidget constructor sets title and ID', () => {
  const widget = new KairoDeploymentsWidget();
  assert.equal(widget.id, 'kairo-deployments');
  assert.equal(widget.title.label, 'Kairo Deployments');
  assert.equal(widget.title.caption, 'Kairo Deployments');
});

test('KairoDeploymentsWidget renders empty state by default', () => {
  const widget = new KairoDeploymentsWidget();
  const html = widget.node.innerHTML;
  assert.ok(html.includes('No deployments yet.'));
  assert.ok(html.includes('kairo-widget-body'));
});

test('KairoDeploymentsWidget renders loading state', () => {
  const widget = new KairoDeploymentsWidget();
  widget.setLoading(true);
  const html = widget.node.innerHTML;
  assert.ok(html.includes('Loading deployments...'));
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('aria-label="Loading deployments"'));
  assert.ok(html.includes('kairo-spinner'));
  assert.ok(html.includes('kairo-spin'));
});

test('KairoDeploymentsWidget renders error state', () => {
  const widget = new KairoDeploymentsWidget();
  widget.setError('Connection refused');
  const html = widget.node.innerHTML;
  assert.ok(html.includes('Error loading deployments'));
  assert.ok(html.includes('Connection refused'));
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('aria-live="assertive"'));
});

test('KairoDeploymentsWidget renders normal state with deployments', () => {
  const widget = new KairoDeploymentsWidget();
  const deployments = [
    { id: 'deploy-1', state: 'success', filesTouched: 5, bytes: 1024, trigger: 'manual', hotReloadMode: 'incremental' },
    { id: 'deploy-2', state: 'failed', filesTouched: 0, bytes: 0, trigger: 'auto', hotReloadMode: 'full' },
  ];
  widget.setDeployments(deployments);
  const html = widget.node.innerHTML;
  assert.ok(html.includes('deploy-1'));
  assert.ok(html.includes('deploy-2'));
  assert.ok(html.includes('success'));
  assert.ok(html.includes('failed'));
  assert.ok(html.includes('5 files / 1024 bytes'));
  assert.ok(html.includes('manual'));
  assert.ok(html.includes('incremental'));
  assert.ok(html.includes('kairo-deployments-table'));
  assert.ok(html.includes('aria-label="Deployments list"'));
});

test('KairoDeploymentsWidget clears loading after setDeployments', () => {
  const widget = new KairoDeploymentsWidget();
  widget.setLoading(true);
  assert.ok(widget.node.innerHTML.includes('Loading deployments...'));
  widget.setDeployments([{ id: 'd1', state: 'ok', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'none' }]);
  assert.ok(!widget.node.innerHTML.includes('Loading deployments...'));
  assert.ok(widget.node.innerHTML.includes('d1'));
});

test('KairoDeploymentsWidget clears error after setDeployments', () => {
  const widget = new KairoDeploymentsWidget();
  widget.setError('Some error');
  assert.ok(widget.node.innerHTML.includes('Some error'));
  widget.setDeployments([{ id: 'd1', state: 'ok', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'none' }]);
  assert.ok(!widget.node.innerHTML.includes('Some error'));
  assert.ok(widget.node.innerHTML.includes('d1'));
});

test('KairoDeploymentsWidget empty state re-renders when deployments cleared', () => {
  const widget = new KairoDeploymentsWidget();
  widget.setDeployments([{ id: 'd1', state: 'ok', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'none' }]);
  assert.ok(widget.node.innerHTML.includes('d1'));
  widget.setDeployments([]);
  assert.ok(widget.node.innerHTML.includes('No deployments yet.'));
});

test('KairoDeploymentsWidget transitions loading -> error -> normal cleanly', () => {
  const widget = new KairoDeploymentsWidget();

  // Loading
  widget.setLoading(true);
  assert.ok(widget.node.innerHTML.includes('Loading deployments...'));

  // Error
  widget.setError('Network timeout');
  assert.ok(!widget.node.innerHTML.includes('Loading deployments...'));
  assert.ok(widget.node.innerHTML.includes('Network timeout'));

  // Normal
  widget.setDeployments([{ id: 'd1', state: 'ok', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'none' }]);
  assert.ok(!widget.node.innerHTML.includes('Network timeout'));
  assert.ok(widget.node.innerHTML.includes('d1'));
});

test('KairoDeploymentsWidget transitions error -> loading -> normal cleanly', () => {
  const widget = new KairoDeploymentsWidget();

  widget.setError('Error');
  assert.ok(widget.node.innerHTML.includes('Error'));

  widget.setLoading(true);
  assert.ok(!widget.node.innerHTML.includes('Error'));
  assert.ok(widget.node.innerHTML.includes('Loading deployments...'));

  widget.setDeployments([{ id: 'd1', state: 'ok', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'none' }]);
  assert.ok(!widget.node.innerHTML.includes('Loading deployments...'));
  assert.ok(widget.node.innerHTML.includes('d1'));
});

test('KairoDeploymentsWidget renders empty when error is null', () => {
  const widget = new KairoDeploymentsWidget();
  widget.setError('err');
  widget.setError(null);
  // Setting error to null should render empty state
  assert.ok(widget.node.innerHTML.includes('No deployments yet.'));
});

test('KairoDeploymentsWidget HTML escaping prevents XSS', () => {
  const widget = new KairoDeploymentsWidget();
  const deployments = [
    { id: '<script>alert("xss")</script>', state: 'success', filesTouched: 0, bytes: 0, trigger: 'manual', hotReloadMode: 'none' },
  ];
  widget.setDeployments(deployments);
  const html = widget.node.innerHTML;
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// ------------------------------------------------------------------
// KairoViewsContribution — module structure tests
// ------------------------------------------------------------------

const { KairoViewsContribution, KairoCommands } = require('../../../lib/browser/kairo-views-contribution');

test('KairoViewsContribution is a class', () => {
  assert.equal(typeof KairoViewsContribution, 'function');
});

test('KairoViewsContribution has expected lifecycle methods', () => {
  const proto = KairoViewsContribution.prototype;
  assert.equal(typeof proto.onStart, 'function');
  assert.equal(typeof proto.onStop, 'function');
  assert.equal(typeof proto.registerCommands, 'function');
});

test('KairoCommands namespace includes view reveal commands', () => {
  const expectedViews = [
    'kairo.view.servers',
    'kairo.view.builds',
    'kairo.view.deployments',
    'kairo.view.logs',
    'kairo.view.maven',
    'kairo.view.todo',
    'kairo.view.tests',
    'kairo.view.sqlConsole',
    'kairo.view.remote',
    'kairo.view.perf',
  ];
  const ids = Object.values(KairoCommands).map(c => c.id);
  for (const id of expectedViews) {
    assert.ok(ids.includes(id), `KairoCommands.${id} is missing`);
  }
});

test('KairoCommands namespace includes debug view commands', () => {
  const debugIds = [
    'kairo.debug.view.variables',
    'kairo.debug.view.callstack',
    'kairo.debug.view.breakpoints',
    'kairo.debug.view.toolbar',
    'kairo.debug.view.console',
    'kairo.debug.view.watch',
  ];
  const ids = Object.values(KairoCommands).map(c => c.id);
  for (const id of debugIds) {
    assert.ok(ids.includes(id), `KairoCommands.${id} is missing`);
  }
});

test('KairoCommands namespace includes server lifecycle commands', () => {
  const lifecycleIds = [
    'kairo.server.start',
    'kairo.server.debug',
    'kairo.server.stop',
    'kairo.server.restart',
  ];
  const ids = Object.values(KairoCommands).map(c => c.id);
  for (const id of lifecycleIds) {
    assert.ok(ids.includes(id), `KairoCommands.${id} is missing`);
  }
});

test('KairoCommands namespace includes build commands', () => {
  const buildIds = [
    'kairo.build',
    'kairo.cleanBuild',
    'kairo.buildAndDeploy',
  ];
  const ids = Object.values(KairoCommands).map(c => c.id);
  for (const id of buildIds) {
    assert.ok(ids.includes(id), `KairoCommands.${id} is missing`);
  }
});

test('KairoCommands namespace includes project management commands', () => {
  const projectIds = [
    'kairo.project.import',
    'kairo.project.select',
    'kairo.project.scan',
  ];
  const ids = Object.values(KairoCommands).map(c => c.id);
  for (const id of projectIds) {
    assert.ok(ids.includes(id), `KairoCommands.${id} is missing`);
  }
});

// ------------------------------------------------------------------
// KairoProblemsWidget — five-state rendering tests
// ------------------------------------------------------------------

test('teardown', () => {
  disableJSDOM();
});