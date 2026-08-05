'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { sameLineContext, multiLineContext, groupMatchesByFile, matchPreviewParts, getSearchFileName, getSearchFileDir } = require('../../lib/browser/search-result-utils');

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

test('matchPreviewParts returns same-line highlight segments', () => {
  const parts = matchPreviewParts({
    file: 'A.java',
    line: 4,
    column: 3,
    matchText: 'needle',
    contextBefore: 'line1\nline2\na ',
    contextAfter: ' b\nline5',
  });
  assert.strictEqual(parts.before, 'a ');
  assert.strictEqual(parts.highlight, 'needle');
  assert.strictEqual(parts.after, ' b');
});

test('getSearchFileName and getSearchFileDir split IDEA-style headers', () => {
  assert.strictEqual(getSearchFileName('src/main/Foo.java'), 'Foo.java');
  assert.strictEqual(getSearchFileDir('src/main/Foo.java'), 'src/main');
  assert.strictEqual(getSearchFileDir('Foo.jsp'), '');
});

test('groupMatchesByFile preserves order', () => {
  const groups = groupMatchesByFile([
    { file: 'A.java', line: 1 },
    { file: 'B.java', line: 2 },
    { file: 'A.java', line: 3 },
  ]);
  assert.deepStrictEqual(groups.map(g => g.file), ['A.java', 'B.java']);
});
