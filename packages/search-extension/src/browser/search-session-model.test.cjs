'use strict';

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {};
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { FrontendApplicationConfigProvider } =
  require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

const { test } = require('node:test');
const assert = require('node:assert');
const { KairoSearchSessionModel } = require('../../lib/browser/search-session-model');
const { KairoSearchCancelledError } = require('../../lib/browser/search-service');

const emptyResponse = {
  query: 'needle', totalMatches: 0, truncated: false, matches: [],
  elapsedMs: 4, erroredFiles: [],
};

class StubSearchService {
  constructor() {
    this.calls = [];
    this.cancelCount = 0;
  }

  search(options) {
    return new Promise((resolve, reject) => this.calls.push({ options, resolve, reject }));
  }

  cancel() {
    this.cancelCount++;
    const call = this.calls[this.calls.length - 1];
    if (call) call.reject(new KairoSearchCancelledError());
  }
}

function makeModel() {
  const service = new StubSearchService();
  const model = new KairoSearchSessionModel();
  model.searchService = service;
  return { model, service };
}

test('publishes loading then result state and normalizes filter globs', async () => {
  const { model, service } = makeModel();
  const states = [];
  const unsubscribe = model.subscribe(state => states.push(state.status));
  const pending = model.search({
    workspaceId: 'ws-1', query: 'needle', include: [' **/*.java ', '', '**/*.java'],
    exclude: ['target/**'], caseSensitive: true,
  });

  assert.strictEqual(model.snapshot.status, 'loading');
  assert.deepStrictEqual(service.calls[0].options.include, ['**/*.java']);
  assert.deepStrictEqual(service.calls[0].options.exclude, ['target/**']);
  assert.strictEqual(service.calls[0].options.isRegex, false);
  service.calls[0].resolve({
    ...emptyResponse,
    totalMatches: 1,
    matches: [{
      file: 'src/A.java', line: 7, column: 3, matchText: 'needle',
      contextBefore: '', contextAfter: '',
    }],
  });
  const state = await pending;

  assert.strictEqual(state.status, 'results');
  assert.strictEqual(state.totalMatches, 1);
  assert.deepStrictEqual(states, ['idle', 'loading', 'results']);
  unsubscribe();
});

test('publishes an explicit empty state', async () => {
  const { model, service } = makeModel();
  const pending = model.search({ workspaceId: 'ws-1', query: 'missing' });
  service.calls[0].resolve({ ...emptyResponse, query: 'missing' });

  const state = await pending;
  assert.strictEqual(state.status, 'empty');
  assert.strictEqual(state.elapsedMs, 4);
});

test('publishes errors without throwing them into UI event handlers', async () => {
  const { model, service } = makeModel();
  const pending = model.search({ workspaceId: 'ws-1', query: 'needle' });
  service.calls[0].reject(new Error('runtime unavailable'));

  const state = await pending;
  assert.strictEqual(state.status, 'error');
  assert.strictEqual(state.error.message, 'runtime unavailable');
});

test('cancel immediately publishes cancelled and invalidates the running request', async () => {
  const { model, service } = makeModel();
  const pending = model.search({ workspaceId: 'ws-1', query: 'needle' });
  model.cancel();

  assert.strictEqual(model.snapshot.status, 'cancelled');
  assert.strictEqual(service.cancelCount, 1);
  const state = await pending;
  assert.strictEqual(state.status, 'cancelled');
});

test('a superseded response cannot overwrite the latest query state', async () => {
  const { model, service } = makeModel();
  const first = model.search({ workspaceId: 'ws-1', query: 'old' });
  const second = model.search({ workspaceId: 'ws-1', query: 'new' });

  // Resolve the latest request first, then simulate a late response from the old request.
  service.calls[1].resolve({ ...emptyResponse, query: 'new' });
  await second;
  service.calls[0].resolve({
    ...emptyResponse, query: 'old', totalMatches: 1,
    matches: [{ file: 'Old.java', line: 1, column: 1, matchText: 'old', contextBefore: '', contextAfter: '' }],
  });
  await first;

  assert.strictEqual(model.snapshot.status, 'empty');
  assert.strictEqual(model.snapshot.options.query, 'new');
});

test('reset returns to idle and unsubscribe stops notifications', () => {
  const { model, service } = makeModel();
  const states = [];
  const unsubscribe = model.subscribe(state => states.push(state.status));
  unsubscribe();
  model.reset();

  assert.strictEqual(model.snapshot.status, 'idle');
  assert.strictEqual(service.cancelCount, 1);
  assert.deepStrictEqual(states, ['idle']);
});

test('a throwing listener cannot block other listeners or change the search outcome', async () => {
  const { model, service } = makeModel();
  const goodStates = [];
  const reported = [];
  const originalConsoleError = console.error;
  console.error = (...args) => reported.push(args);
  try {
    // subscribe() immediately publishes idle; that initial callback must be
    // isolated just like loading and terminal state callbacks.
    model.subscribe(() => { throw new Error('broken view'); });
    model.subscribe(state => goodStates.push(state.status));

    const pending = model.search({ workspaceId: 'ws-1', query: 'needle' });
    service.calls[0].resolve({
      ...emptyResponse,
      totalMatches: 1,
      matches: [{
        file: 'src/A.java', line: 7, column: 3, matchText: 'needle',
        contextBefore: '', contextAfter: '',
      }],
    });

    const state = await pending;
    assert.strictEqual(state.status, 'results');
    assert.strictEqual(model.snapshot.status, 'results');
    assert.deepStrictEqual(goodStates, ['idle', 'loading', 'results']);
    assert.strictEqual(reported.length, 3);
    assert.match(reported[0][1].message, /broken view/);
  } finally {
    console.error = originalConsoleError;
  }
});
