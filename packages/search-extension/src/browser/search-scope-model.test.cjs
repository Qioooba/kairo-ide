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
