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

const { disableJSDOM } = require('../../../test/frontend-setup.cjs');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Container } = require('inversify');

// ------------------------------------------------------------------
// KairoDeploymentsWidget — five-state rendering tests
// ------------------------------------------------------------------

const { KairoDeploymentsWidget } = require('../../../lib/browser/kairo-views-contribution');

async function flush() {
  return new Promise(resolve => setTimeout(resolve, 50));
}

async function renderWidget(widget) {
  widget.onUpdateRequest({});
  await flush();
}

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
  assert.equal(widget.title.label, '');
  assert.equal(widget.title.caption, '');
});

test('KairoDeploymentsWidget renders empty state by default', async () => {
  const widget = new KairoDeploymentsWidget();
  await renderWidget(widget);
  const html = widget.node.innerHTML;
  assert.ok(html.includes('No deployments yet.'));
  assert.ok(html.includes('kairo-widget-body'));
  assert.ok(html.includes('kairo-empty-state'));
  assert.ok(html.includes('codicon-rocket'));
});

test('KairoDeploymentsWidget renders loading state', async () => {
  const widget = new KairoDeploymentsWidget();
  widget.setLoading(true);
  await renderWidget(widget);
  const html = widget.node.innerHTML;
  assert.ok(html.includes('Loading deployments...'));
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('kairo-empty-state'));
  assert.ok(html.includes('codicon-loading'));
});

test('KairoDeploymentsWidget renders error state', async () => {
  const widget = new KairoDeploymentsWidget();
  widget.setError('Connection refused');
  await renderWidget(widget);
  const html = widget.node.innerHTML;
  assert.ok(html.includes('Error loading deployments'));
  assert.ok(html.includes('Connection refused'));
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('kairo-error-banner'));
});

test('KairoDeploymentsWidget renders normal state with deployments', async () => {
  const widget = new KairoDeploymentsWidget();
  const deployments = [
    { id: 'deploy-1', state: 'success', filesTouched: 5, bytes: 1024, trigger: 'manual', hotReloadMode: 'staticSync' },
    { id: 'deploy-2', state: 'failure', filesTouched: 0, bytes: 0, trigger: 'auto', hotReloadMode: 'contextReload' },
  ];
  widget.setDeployments(deployments);
  await renderWidget(widget);
  const html = widget.node.innerHTML;
  assert.ok(html.includes('deploy-1'));
  assert.ok(html.includes('deploy-2'));
  assert.ok(html.includes('Succeeded'));
  assert.ok(html.includes('Failed'));
  assert.ok(html.includes('5 files / 1024 bytes'));
  assert.ok(html.includes('Manual'));
  assert.ok(html.includes('Auto'));
  assert.ok(html.includes('Synced'));
  assert.ok(html.includes('Restart Required'));
  assert.ok(html.includes('kairo-deployments-table'));
  assert.ok(html.includes('aria-label="Deployments list"'));
});

test('KairoDeploymentsWidget clears loading after setDeployments', async () => {
  const widget = new KairoDeploymentsWidget();
  widget.setLoading(true);
  await renderWidget(widget);
  assert.ok(widget.node.innerHTML.includes('Loading deployments...'));
  widget.setDeployments([{ id: 'd1', state: 'success', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'staticSync' }]);
  await renderWidget(widget);
  assert.ok(!widget.node.innerHTML.includes('Loading deployments...'));
  assert.ok(widget.node.innerHTML.includes('d1'));
});

test('KairoDeploymentsWidget clears error after setDeployments', async () => {
  const widget = new KairoDeploymentsWidget();
  widget.setError('Some error');
  await renderWidget(widget);
  assert.ok(widget.node.innerHTML.includes('Some error'));
  widget.setDeployments([{ id: 'd1', state: 'success', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'staticSync' }]);
  await renderWidget(widget);
  assert.ok(!widget.node.innerHTML.includes('Some error'));
  assert.ok(widget.node.innerHTML.includes('d1'));
});

test('KairoDeploymentsWidget empty state re-renders when deployments cleared', async () => {
  const widget = new KairoDeploymentsWidget();
  widget.setDeployments([{ id: 'd1', state: 'success', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'staticSync' }]);
  await renderWidget(widget);
  assert.ok(widget.node.innerHTML.includes('d1'));
  widget.setDeployments([]);
  await renderWidget(widget);
  assert.ok(widget.node.innerHTML.includes('No deployments yet.'));
});

test('KairoDeploymentsWidget transitions loading -> error -> normal cleanly', async () => {
  const widget = new KairoDeploymentsWidget();

  // Loading
  widget.setLoading(true);
  await renderWidget(widget);
  assert.ok(widget.node.innerHTML.includes('Loading deployments...'));

  // Error
  widget.setError('Network timeout');
  await renderWidget(widget);
  assert.ok(!widget.node.innerHTML.includes('Loading deployments...'));
  assert.ok(widget.node.innerHTML.includes('Network timeout'));

  // Normal
  widget.setDeployments([{ id: 'd1', state: 'success', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'staticSync' }]);
  await renderWidget(widget);
  assert.ok(!widget.node.innerHTML.includes('Network timeout'));
  assert.ok(widget.node.innerHTML.includes('d1'));
});

test('KairoDeploymentsWidget transitions error -> loading -> normal cleanly', async () => {
  const widget = new KairoDeploymentsWidget();

  widget.setError('Error');
  await renderWidget(widget);
  assert.ok(widget.node.innerHTML.includes('Error'));

  widget.setLoading(true);
  await renderWidget(widget);
  assert.ok(!widget.node.innerHTML.includes('Error'));
  assert.ok(widget.node.innerHTML.includes('Loading deployments...'));

  widget.setDeployments([{ id: 'd1', state: 'success', filesTouched: 1, bytes: 100, trigger: 'manual', hotReloadMode: 'staticSync' }]);
  await renderWidget(widget);
  assert.ok(!widget.node.innerHTML.includes('Loading deployments...'));
  assert.ok(widget.node.innerHTML.includes('d1'));
});

test('KairoDeploymentsWidget renders empty when error is null', async () => {
  const widget = new KairoDeploymentsWidget();
  widget.setError('err');
  await renderWidget(widget);
  widget.setError(null);
  await renderWidget(widget);
  // Setting error to null should render empty state
  assert.ok(widget.node.innerHTML.includes('No deployments yet.'));
});

test('KairoDeploymentsWidget HTML escaping prevents XSS', async () => {
  const widget = new KairoDeploymentsWidget();
  const deployments = [
    { id: '<script>alert("xss")</script>', state: 'success', filesTouched: 0, bytes: 0, trigger: 'manual', hotReloadMode: 'staticSync' },
  ];
  widget.setDeployments(deployments);
  await renderWidget(widget);
  const cell = widget.node.querySelector('td');
  assert.ok(cell, 'Expected a table cell');
  assert.equal(cell.textContent, '<script>alert("xss")</script>');
  assert.ok(cell.innerHTML.includes('&lt;script&gt;'), 'Expected <script> to be escaped in cell HTML');
  assert.ok(!cell.innerHTML.includes('<script>'), 'Expected no literal script tag in cell HTML');
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
