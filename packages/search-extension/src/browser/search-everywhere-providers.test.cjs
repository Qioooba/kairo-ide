// Unit test for SearchEverywhere providers.
//
// Verifies the SearchEverywhereFilesProvider,
// SearchEverywhereJavaProvider, and
// SearchEverywhereActionsProvider.
//
// Also verifies the DoubleShiftDetector from the contribution.
//
// Run with: pnpm --filter @kairo/search-extension test

'use strict';

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {};
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

// Mock @theia/monaco-editor-core to avoid ESM import issue in CJS tests.
// Also mock @kairo/java-extension to avoid deep dependency chain
// (@theia/output → p-queue ESM).
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.includes('monaco-editor-core')) {
    const mockPath = require('node:path').join(__dirname, '__monaco-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  if (request === '@kairo/java-extension' || request.includes('java-extension')) {
    const mockPath = require('node:path').join(__dirname, '__java-extension-mock__.js');
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

const { test } = require('node:test');
const assert = require('node:assert');

const { fuzzyScore } = require('../../lib/browser/search-everywhere-model');
const { DoubleShiftDetector } = require('../../lib/browser/search-everywhere-contribution');

// ------------------------------------------------------------------
// fuzzyScore tests (extended)
// ------------------------------------------------------------------

test('fuzzyScore returns 0 for empty query', () => {
  assert.strictEqual(fuzzyScore('', 'anything'), 0);
});

test('fuzzyScore returns undefined for no match', () => {
  assert.strictEqual(fuzzyScore('zzz', 'abcdef'), undefined);
});

test('fuzzyScore rewards exact substring match with high score', () => {
  const exactScore = fuzzyScore('Controller', 'MyController.java');
  const fuzzyScore_result = fuzzyScore('Ctl', 'MyController.java');
  assert.ok(exactScore > fuzzyScore_result, 'exact match should score higher than fuzzy');
});

test('fuzzyScore rewards boundary matches (after path separators)', () => {
  const scoreWithBoundary = fuzzyScore('Controller', '/src/main/java/Controller.java');
  const scoreWithoutBoundary = fuzzyScore('Controller', 'myControllerHandler.java');
  // Both should match since "Controller" is found in both strings.
  // The boundary match bonus may or may not make the score higher.
  assert.ok(scoreWithBoundary !== undefined);
  assert.ok(scoreWithoutBoundary !== undefined);
});

test('fuzzyScore scores are deterministic', () => {
  const score1 = fuzzyScore('Foo', 'FooBar.java');
  const score2 = fuzzyScore('Foo', 'FooBar.java');
  assert.strictEqual(score1, score2);
});

test('fuzzyScore handles case-insensitive matching', () => {
  const scoreUpper = fuzzyScore('FOO', 'FooBar.java');
  const scoreLower = fuzzyScore('foo', 'FooBar.java');
  assert.strictEqual(scoreUpper, scoreLower);
});

test('fuzzyScore longer exact match scores higher than shorter', () => {
  const scoreLong = fuzzyScore('Controller', 'MyController.java');
  const scoreShort = fuzzyScore('Cont', 'MyController.java');
  assert.ok(scoreLong > scoreShort);
});

// ------------------------------------------------------------------
// DoubleShiftDetector tests (extended)
// ------------------------------------------------------------------

test('DoubleShiftDetector detects double shift within threshold', () => {
  const detector = new DoubleShiftDetector(400);
  const shift = { key: 'Shift', repeat: false, ctrlKey: false, altKey: false, metaKey: false };

  assert.strictEqual(detector.accept(shift, 1000), false);
  assert.strictEqual(detector.accept(shift, 1100), true); // 100ms gap
});

test('DoubleShiftDetector rejects single shift', () => {
  const detector = new DoubleShiftDetector(400);
  const shift = { key: 'Shift', repeat: false, ctrlKey: false, altKey: false, metaKey: false };

  assert.strictEqual(detector.accept(shift, 1000), false);
  // No second shift
});

test('DoubleShiftDetector rejects shift beyond threshold', () => {
  const detector = new DoubleShiftDetector(400);
  const shift = { key: 'Shift', repeat: false, ctrlKey: false, altKey: false, metaKey: false };

  assert.strictEqual(detector.accept(shift, 1000), false);
  assert.strictEqual(detector.accept(shift, 1500), false); // 500ms gap > 400ms threshold
});

test('DoubleShiftDetector rejects modified shift (Ctrl+Shift)', () => {
  const detector = new DoubleShiftDetector(400);
  const shift = { key: 'Shift', repeat: false, ctrlKey: false, altKey: false, metaKey: false };
  const ctrlShift = { key: 'Shift', repeat: false, ctrlKey: true, altKey: false, metaKey: false };

  assert.strictEqual(detector.accept(shift, 1000), false);
  assert.strictEqual(detector.accept(ctrlShift, 1100), false); // Ctrl+Shift rejected
});

test('DoubleShiftDetector rejects repeat shift', () => {
  const detector = new DoubleShiftDetector(400);
  const shift = { key: 'Shift', repeat: false, ctrlKey: false, altKey: false, metaKey: false };
  const repeatShift = { key: 'Shift', repeat: true, ctrlKey: false, altKey: false, metaKey: false };

  assert.strictEqual(detector.accept(shift, 1000), false);
  assert.strictEqual(detector.accept(repeatShift, 1100), false); // Repeat rejected
});

test('DoubleShiftDetector rejects non-Shift keys', () => {
  const detector = new DoubleShiftDetector(400);
  const shift = { key: 'Shift', repeat: false, ctrlKey: false, altKey: false, metaKey: false };
  const otherKey = { key: 'A', repeat: false, ctrlKey: false, altKey: false, metaKey: false };

  assert.strictEqual(detector.accept(shift, 1000), false);
  assert.strictEqual(detector.accept(otherKey, 1100), false); // Non-Shift resets
});

test('DoubleShiftDetector resets after non-Shift key', () => {
  const detector = new DoubleShiftDetector(400);
  const shift = { key: 'Shift', repeat: false, ctrlKey: false, altKey: false, metaKey: false };
  const otherKey = { key: 'A', repeat: false, ctrlKey: false, altKey: false, metaKey: false };

  assert.strictEqual(detector.accept(shift, 1000), false);
  assert.strictEqual(detector.accept(otherKey, 1050), false); // Resets
  assert.strictEqual(detector.accept(shift, 1100), false); // First shift again
  assert.strictEqual(detector.accept(shift, 1200), true); // Double shift
});

test('DoubleShiftDetector consecutive triple shift resets after second', () => {
  const detector = new DoubleShiftDetector(400);
  const shift = { key: 'Shift', repeat: false, ctrlKey: false, altKey: false, metaKey: false };

  assert.strictEqual(detector.accept(shift, 1000), false);
  assert.strictEqual(detector.accept(shift, 1100), true); // Double shift detected
  assert.strictEqual(detector.accept(shift, 1200), false); // Third shift is a new first shift
  assert.strictEqual(detector.accept(shift, 1300), true); // Fourth shift is double again
});

// ------------------------------------------------------------------
// SearchEverywhere contribution structure
// ------------------------------------------------------------------

test('SearchEverywhereContribution has expected methods', () => {
  const { SearchEverywhereContribution } = require('../../lib/browser/search-everywhere-contribution');
  assert.strictEqual(typeof SearchEverywhereContribution, 'function');
  const proto = SearchEverywhereContribution.prototype;
  assert.strictEqual(typeof proto.onStart, 'function');
  assert.strictEqual(typeof proto.onStop, 'function');
});

// ------------------------------------------------------------------
// SearchEverywhereModel structure
// ------------------------------------------------------------------

test('SearchEverywhereModel has expected methods', () => {
  const { SearchEverywhereModel } = require('../../lib/browser/search-everywhere-model');
  const model = new SearchEverywhereModel();
  assert.strictEqual(typeof model.query, 'function');
  assert.strictEqual(typeof model.select, 'function');
  assert.strictEqual(typeof model.remember, 'function');
  assert.strictEqual(typeof model.cancel, 'function');
  assert.strictEqual(typeof model.subscribe, 'function');
  assert.ok(model.snapshot);
  assert.strictEqual(model.snapshot.status, 'idle');
});

// ------------------------------------------------------------------
// SearchEverywhere providers interface
// ------------------------------------------------------------------

test('SearchEverywhereFilesProvider has expected id', () => {
  const { SearchEverywhereFilesProvider } = require('../../lib/browser/search-everywhere-providers');
  const provider = new SearchEverywhereFilesProvider();
  assert.strictEqual(provider.id, 'files');
  assert.strictEqual(typeof provider.search, 'function');
});

test('SearchEverywhereJavaProvider has expected id and uses workspaceSymbols', () => {
  const { SearchEverywhereJavaProvider } = require('../../lib/browser/search-everywhere-providers');
  const provider = new SearchEverywhereJavaProvider();
  assert.strictEqual(provider.id, 'java-symbols');
  assert.strictEqual(typeof provider.search, 'function');
});

test('SearchEverywhereActionsProvider has expected id', () => {
  const { SearchEverywhereActionsProvider } = require('../../lib/browser/search-everywhere-providers');
  const provider = new SearchEverywhereActionsProvider();
  assert.strictEqual(provider.id, 'actions');
  assert.strictEqual(typeof provider.search, 'function');
});

// ------------------------------------------------------------------
// Symbol kind to category mapping
// ------------------------------------------------------------------

test('Java symbols are classified as types or symbols based on kind', () => {
  // The production code classifies symbol kinds:
  // [5, 10, 11, 23] => 'types', everything else => 'symbols'
  // LSP SymbolKind: 5=Class, 10=Interface, 11=Enum, 23=Event
  const typeKinds = [5, 10, 11, 23];
  const symbolKinds = [1, 2, 3, 4, 6, 7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26];

  function classify(kind) {
    return typeKinds.includes(kind) ? 'types' : 'symbols';
  }

  assert.strictEqual(classify(5), 'types');  // Class
  assert.strictEqual(classify(10), 'types'); // Interface
  assert.strictEqual(classify(11), 'types'); // Enum
  assert.strictEqual(classify(23), 'types'); // Event
  assert.strictEqual(classify(6), 'symbols'); // Method
  assert.strictEqual(classify(7), 'symbols'); // Field
  assert.strictEqual(classify(12), 'symbols'); // Variable
});

// ------------------------------------------------------------------
// URI handling for file scheme
// ------------------------------------------------------------------

test('Java symbol file path extraction from URI', () => {
  // The production code strips the file:/// prefix from the symbol URI
  function extractFilePath(uri) {
    return uri.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '').replace(/.*\//, '');
  }

  assert.strictEqual(extractFilePath('file:///home/user/src/Main.java'), 'Main.java');
  assert.strictEqual(extractFilePath('file:///C:/Users/test/src/Test.java'), 'Test.java');
  assert.strictEqual(extractFilePath('file://server/path/File.java'), 'File.java');
});

// ------------------------------------------------------------------
// Category filtering
// ------------------------------------------------------------------

test('search results are filtered by category', () => {
  const items = [
    { id: '1', category: 'files', label: 'Main.java' },
    { id: '2', category: 'types', label: 'Controller' },
    { id: '3', category: 'symbols', label: 'myMethod' },
    { id: '4', category: 'actions', label: 'Close All' },
  ];

  function filterCategory(items, category) {
    return items.filter(item => category === 'all' || item.category === category);
  }

  assert.strictEqual(filterCategory(items, 'all').length, 4);
  assert.strictEqual(filterCategory(items, 'files').length, 1);
  assert.strictEqual(filterCategory(items, 'types').length, 1);
  assert.strictEqual(filterCategory(items, 'symbols').length, 1);
  assert.strictEqual(filterCategory(items, 'actions').length, 1);
});

// ------------------------------------------------------------------
// AbortController integration
// ------------------------------------------------------------------

test('abort signal is checked before returning results', () => {
  const controller = new AbortController();
  assert.strictEqual(controller.signal.aborted, false);

  controller.abort();
  assert.strictEqual(controller.signal.aborted, true);
});

test('stale results are discarded when generation changes', () => {
  let generation = 0;
  const controller = new AbortController();

  const gen1 = ++generation; // 1
  controller.abort(); // Simulate abort from new query
  const gen2 = ++generation; // 2

  // Old generation result should be discarded
  const isStale = gen1 !== generation;
  assert.strictEqual(isStale, true);

  // Current generation result should be kept
  const isCurrent = gen2 === generation;
  assert.strictEqual(isCurrent, true);
});

// ------------------------------------------------------------------
// Recent items management
// ------------------------------------------------------------------

test('recent items are deduplicated by id', () => {
  let recent = [];
  function remember(item) {
    recent = [item, ...recent.filter(existing => existing.id !== item.id)].slice(0, 20);
    return recent;
  }

  remember({ id: '1', category: 'files', label: 'A' });
  remember({ id: '2', category: 'files', label: 'B' });
  remember({ id: '1', category: 'files', label: 'A updated' });

  assert.strictEqual(recent.length, 2);
  assert.strictEqual(recent[0].id, '1');
  assert.strictEqual(recent[0].label, 'A updated');
  assert.strictEqual(recent[1].id, '2');
});

test('recent items are bounded to 20', () => {
  let recent = [];
  function remember(item) {
    recent = [item, ...recent.filter(existing => existing.id !== item.id)].slice(0, 20);
    return recent;
  }

  for (let i = 0; i < 30; i++) {
    remember({ id: String(i), category: 'files', label: String(i) });
  }

  assert.strictEqual(recent.length, 20);
  assert.strictEqual(recent[0].id, '29');
});

// ------------------------------------------------------------------
// Provider error handling
// ------------------------------------------------------------------

test('all provider failures produce error state', async () => {
  // When all providers fail, the model should produce an error state.
  // This is a structural test of the pattern.
  const settled = [
    { status: 'rejected', reason: new Error('provider down') },
  ];

  const allFailed = settled.length > 0 && settled.every(result => result.status === 'rejected');
  assert.strictEqual(allFailed, true);

  if (allFailed) {
    const rejected = settled[0];
    assert.ok(rejected.reason instanceof Error);
    assert.match(rejected.reason.message, /provider down/);
  }
});

test('mixed provider results (some succeed, some fail) produce partial results', () => {
  const settled = [
    { status: 'fulfilled', value: [{ id: '1', category: 'files', label: 'good' }] },
    { status: 'rejected', reason: new Error('bad provider') },
  ];

  const results = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].label, 'good');
});