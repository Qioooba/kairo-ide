'use strict';
const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();
if (!global.DragEvent) global.DragEvent = class DragEvent extends global.MouseEvent {};
const Module = require('module');
Module._extensions['.css'] = function (module, filename) { module._compile('module.exports = {};', filename); };
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({ defaultTheme: 'dark', defaultIconTheme: 'theia-file-icons', applicationName: 'Kairo', validatePreferencesSchema: true });
const { test } = require('node:test');
const assert = require('node:assert');
const { SearchEverywhereModel, fuzzyScore } = require('../../lib/browser/search-everywhere-model');
const { DoubleShiftDetector } = require('../../lib/browser/search-everywhere-contribution');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { SearchEverywhereComponent } = require('../../lib/browser/search-everywhere-widget');
global.IS_REACT_ACT_ENVIRONMENT = true;

function modelWith(providers) { const model = new SearchEverywhereModel(); model.providers = providers; return model; }

test('fuzzyScore rewards exact and boundary matches and rejects missing characters', () => {
  assert.ok(fuzzyScore('Foo', 'FooController.java') > fuzzyScore('Foo', 'myFooController.java'));
  assert.ok(fuzzyScore('FC', 'FooController') > fuzzyScore('FC', 'aFillerController'));
  assert.strictEqual(fuzzyScore('XYZ', 'FooController'), undefined);
});

test('aggregates categories, fuzzy sorts, filters and limits results', async () => {
  const model = modelWith([{ id: 'fake', search: async () => [
    { id: '1', category: 'files', label: 'MyController.java' },
    { id: '2', category: 'types', label: 'Controller' },
    { id: '3', category: 'actions', label: 'Close All' },
  ] }]);
  let result = await model.query('Controller', 'all', 2);
  assert.strictEqual(result.status, 'results');
  assert.strictEqual(result.items.length, 2);
  result = await model.query('Controller', 'types', 10);
  assert.deepStrictEqual(result.items.map(item => item.category), ['types']);
});

test('new query aborts stale providers and stale results cannot overwrite', async () => {
  const calls = [];
  const model = modelWith([{ id: 'delayed', search: (query, signal) => new Promise(resolve => calls.push({ query, signal, resolve })) }]);
  const old = model.query('old');
  const current = model.query('new');
  assert.strictEqual(calls[0].signal.aborted, true);
  calls[1].resolve([{ id: 'new', category: 'files', label: 'new.java' }]);
  await current;
  calls[0].resolve([{ id: 'old', category: 'files', label: 'old.java' }]);
  await old;
  assert.strictEqual(model.snapshot.items[0].id, 'new');
});

test('recent items are deduplicated, bounded and shown for an empty query', async () => {
  const model = modelWith([]);
  for (let i = 0; i < 25; i++) model.remember({ id: String(i), category: 'files', label: String(i) });
  model.remember({ id: '20', category: 'files', label: 'twenty again' });
  assert.strictEqual(model.recentItems.length, 20);
  const result = await model.query('', 'files');
  assert.strictEqual(result.status, 'results');
  assert.strictEqual(result.items[0].label, 'twenty again');
});

test('all provider failures produce an error state', async () => {
  const model = modelWith([{ id: 'bad', search: async () => { throw new Error('provider down'); } }]);
  const result = await model.query('anything');
  assert.strictEqual(result.status, 'error');
  assert.match(result.error.message, /provider down/);
});

test('DoubleShiftDetector is bounded and rejects modified Shift sequences', () => {
  const detector = new DoubleShiftDetector(400);
  const shift = { key: 'Shift', repeat: false, ctrlKey: false, altKey: false, metaKey: false };
  assert.strictEqual(detector.accept(shift, 1000), false);
  assert.strictEqual(detector.accept(shift, 1250), true);
  assert.strictEqual(detector.accept(shift, 2000), false);
  assert.strictEqual(detector.accept(shift, 2500), false);
  assert.strictEqual(detector.accept({ ...shift, ctrlKey: true }, 2600), false);
  assert.strictEqual(detector.accept({ ...shift, repeat: true }, 2700), false);
});

const mockI18n = {
  t: (key) => key,
  onDidChangeLanguage: { event: () => ({ dispose: () => {} }) },
};

test('Search Everywhere renders open failures instead of leaking rejected promises', async () => {
  const model = modelWith([]);
  model.state = { status: 'results', query: 'x', category: 'all', selectedIndex: 0, items: [{ id: 'x', category: 'files', label: 'x', uri: 'file:///x' }] };
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  try {
    React.act(() => root.render(React.createElement(SearchEverywhereComponent, { model, state: model.snapshot, onOpen: async () => { throw new Error('cannot open'); }, i18n: mockI18n })));
    await React.act(async () => container.querySelector('[role="option"]').click());
    assert.match(container.querySelector('[data-testid="everywhere-open-error"]').textContent, /cannot open/);
  } finally { React.act(() => root.unmount()); container.remove(); }
});
