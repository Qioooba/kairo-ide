'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { sameLineContext, multiLineContext, groupMatchesByFile } = require('../../lib/browser/search-result-utils');

test('sameLineContext strips multi-line prefixes/suffixes', () => {
  const { before, after } = sameLineContext({
    contextBefore: 'line1\nline2\nprefix ',
    contextAfter: ' suffix\nline4\nline5',
  });
  assert.strictEqual(before, 'prefix ');
  assert.strictEqual(after, ' suffix');
});

test('multiLineContext splits preview lines', () => {
  const ctx = multiLineContext({
    contextBefore: 'a\nb\npre',
    contextAfter: 'post\nc\nd',
    matchText: 'X',
  });
  assert.deepStrictEqual(ctx.beforeLines, ['a', 'b']);
  assert.deepStrictEqual(ctx.afterLines, ['c', 'd']);
  assert.strictEqual(ctx.sameBefore, 'pre');
  assert.strictEqual(ctx.sameAfter, 'post');
});

test('groupMatchesByFile preserves order', () => {
  const groups = groupMatchesByFile([
    { file: 'A.java', line: 1 },
    { file: 'B.java', line: 2 },
    { file: 'A.java', line: 3 },
  ]);
  assert.deepStrictEqual(groups.map(g => g.file), ['A.java', 'B.java']);
});
