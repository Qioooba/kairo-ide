'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SearchScopeModel } = require('../../lib/browser/search-scope-model');

function makeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function entry(query, timestamp = Date.now()) {
  return { query, isRegex: false, caseSensitive: false, wholeWord: false, scope: 'project', timestamp };
}

test('history trims, deduplicates and removes a single entry', () => {
  global.localStorage = makeStorage();
  const model = new SearchScopeModel();
  model.addToHistory(entry('  needle  ', 1));
  model.addToHistory(entry('needle', 2));
  model.addToHistory(entry('other', 3));

  assert.deepStrictEqual(model.getHistory().map(item => item.query), ['other', 'needle']);
  model.removeFromHistory(model.getHistory()[1]);
  assert.deepStrictEqual(model.getHistory().map(item => item.query), ['other']);
});

test('malformed persisted history is ignored and caps are enforced', () => {
  global.localStorage = makeStorage({
    'kairo-search-history': JSON.stringify({ query: 'not-an-array' }),
    'kairo-search-pinned': JSON.stringify(['not-an-entry']),
  });
  const model = new SearchScopeModel();
  assert.deepStrictEqual(model.getHistory(), []);
  assert.deepStrictEqual(model.getPinned(), []);

  for (let i = 0; i < 12; i++) model.pinQuery(entry(`q-${i}`, i));
  assert.equal(model.getPinned().length, 10);
});

test('result limits persist and parse helpers handle empty/zero/garbage', () => {
  global.localStorage = makeStorage();
  const limits = require('../../lib/browser/search-scope-model');
  assert.strictEqual(limits.parseMaxResultsInput(''), undefined);
  assert.strictEqual(limits.parseMaxResultsInput('0'), -1);
  assert.strictEqual(limits.parseMaxResultsInput('5000'), 5000);
  assert.strictEqual(limits.parseMaxResultsInput('abc'), undefined);
  assert.strictEqual(limits.parseDisplayLimitInput(''), undefined);
  assert.strictEqual(limits.parseDisplayLimitInput('0'), undefined);
  assert.strictEqual(limits.parseDisplayLimitInput('100'), 100);
  assert.strictEqual(limits.limitToInput(undefined), '');
  assert.strictEqual(limits.limitToInput(-1), '0');
  assert.strictEqual(limits.limitToInput(200), '200');

  const model = new SearchScopeModel();
  model.setMaxResults(-1);
  model.setDisplayLimit(100);
  assert.deepStrictEqual(model.getLimits(), { maxResults: -1, displayLimit: 100 });

  const reloaded = new SearchScopeModel();
  assert.deepStrictEqual(reloaded.getLimits(), { maxResults: -1, displayLimit: 100 });

  reloaded.setMaxResults(undefined);
  assert.deepStrictEqual(reloaded.getLimits(), { displayLimit: 100 });
});
