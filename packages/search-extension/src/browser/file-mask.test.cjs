'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Load compiled output when available; otherwise transpile-free reimplementation mirror.
let parseFileMask;
let mergeGlobs;
let normalizeMaskToken;
try {
  ({ parseFileMask, mergeGlobs, normalizeMaskToken } = require('../../lib/browser/file-mask'));
} catch {
  ({ parseFileMask, mergeGlobs, normalizeMaskToken } = require('../../lib/browser/search-center-widget'));
}

test('normalizeMaskToken expands bare extensions', () => {
  assert.strictEqual(normalizeMaskToken('java'), '*.java');
  assert.strictEqual(normalizeMaskToken('.xml'), '*.xml');
  assert.strictEqual(normalizeMaskToken('*.ts'), '*.ts');
  assert.strictEqual(normalizeMaskToken('src/**/*.java'), 'src/**/*.java');
});

test('parseFileMask supports IDEA ! excludes and comma lists', () => {
  assert.deepStrictEqual(parseFileMask('*.java, !*.min.js, xml'), {
    include: ['*.java', '*.xml'],
    exclude: ['*.min.js'],
  });
  assert.deepStrictEqual(parseFileMask(''), { include: undefined, exclude: undefined });
  assert.deepStrictEqual(parseFileMask('  ,  '), { include: undefined, exclude: undefined });
});

test('parseFileMask expands bare exclude words to filename-substring globs', () => {
  // "!Test" must exclude TestHolder.java — an include-style "*.Test"
  // pseudo-extension would never match a real file name.
  assert.deepStrictEqual(parseFileMask('java, !Test'), {
    include: ['*.java'],
    exclude: ['*Test*'],
  });
  assert.deepStrictEqual(parseFileMask('!Test*.java'), {
    include: undefined,
    exclude: ['Test*.java'], // already a glob — kept verbatim
  });
});

test('mergeGlobs deduplicates', () => {
  assert.deepStrictEqual(mergeGlobs(['*.java'], ['*.java', '*.xml']), ['*.java', '*.xml']);
  assert.strictEqual(mergeGlobs(undefined, undefined), undefined);
});
