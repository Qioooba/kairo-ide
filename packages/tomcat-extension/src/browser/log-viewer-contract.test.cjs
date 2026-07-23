'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'log-viewer-widget.tsx'), 'utf8');

test('log viewer cleans up its runtime subscription and batching timer', () => {
  assert.match(source, /return runtime\.subscribeEvents\(/);
  assert.match(source, /clearTimeout\(timer\.current\)/);
  assert.match(source, /loadGeneration\.current\+\+/);
});

test('log viewer revokes temporary download URLs and has no fixed polling loop', () => {
  assert.match(source, /URL\.revokeObjectURL\(url\)/);
  assert.doesNotMatch(source, /setInterval\(/);
});

test('fallback polling is bounded, non-overlapping, visible-only, and cancellable', () => {
  assert.match(source, /const POLL_MS = 2000/);
  assert.match(source, /await loadHistory\(\)/);
  assert.match(source, /documentVisible.*viewerVisible/);
  assert.match(source, /clearTimeout\(pollTimer\)/);
});
