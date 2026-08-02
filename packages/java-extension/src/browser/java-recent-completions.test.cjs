// SPDX-License-Identifier: Apache-2.0
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { RecentCompletionStore } = require('../../lib/browser/java-recent-completions');

describe('RecentCompletionStore', () => {
  /** @type {import('../../lib/browser/java-recent-completions').RecentCompletionStore} */
  let store;

  beforeEach(() => {
    store = new RecentCompletionStore();
  });

  test('boosts most recent first', () => {
    store.record('foo');
    store.record('bar');
    assert.equal(store.rank('bar'), 0);
    assert.equal(store.rank('foo'), 1);
    assert.match(store.boostSortText('bar', 'z'), /^0r00/);
    assert.match(store.boostSortText('foo', 'z'), /^0r01/);
    assert.equal(store.boostSortText('other', 'z'), 'z');
  });

  test('re-record moves to front', () => {
    store.record('a');
    store.record('b');
    store.record('a');
    assert.equal(store.rank('a'), 0);
    assert.equal(store.rank('b'), 1);
  });
});
