'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDiff } = require('../../lib/browser/git-diff-parse');

test('parseDiff skips \\ No newline at end of file without advancing line numbers', () => {
  const diff = [
    '@@ -1,2 +1,2 @@',
    ' line1',
    '-old',
    '+new',
    '\\ No newline at end of file',
  ].join('\n');
  const lines = parseDiff(diff);
  const meta = lines.find(l => l.type === 'meta');
  assert.ok(meta);
  const lastContent = lines.filter(l => l.type === 'add' || l.type === 'remove' || l.type === 'context').at(-1);
  assert.equal(lastContent.type, 'add');
  assert.equal(lastContent.newLine, 2);
});

test('parseDiff ignores trailing empty split artifact', () => {
  const diff = '@@ -1,1 +1,1 @@\n line1\n';
  const lines = parseDiff(diff);
  assert.ok(!lines.some(l => l.content === '' && l.type === 'context'));
});
