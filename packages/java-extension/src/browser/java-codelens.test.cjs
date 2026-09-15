// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for IDEA-style reference CodeLens helpers (java-codelens.ts).
// Pure logic only: title localization + JDT lens argument parsing.
// Run with: node --test src/browser/java-codelens.test.cjs

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  localizeCodeLensTitle,
  parseLensCommandTarget,
  JDT_SHOW_REFERENCES_COMMAND,
  JDT_SHOW_IMPLEMENTATIONS_COMMAND,
  KAIRO_SHOW_USAGES_AT_LENS_COMMAND,
} = require('../../lib/browser/java-codelens');

test('lens command ids match JDT LS CodeLensHandler', () => {
  assert.equal(JDT_SHOW_REFERENCES_COMMAND, 'java.show.references');
  assert.equal(JDT_SHOW_IMPLEMENTATIONS_COMMAND, 'java.show.implementations');
  assert.equal(KAIRO_SHOW_USAGES_AT_LENS_COMMAND, 'kairo.java.showUsagesAtLens');
});

test('localizeCodeLensTitle: references', () => {
  assert.equal(localizeCodeLensTitle('0 references'), '0 个引用');
  assert.equal(localizeCodeLensTitle('1 reference'), '1 个引用');
  assert.equal(localizeCodeLensTitle('3 references'), '3 个引用');
  assert.equal(localizeCodeLensTitle('12 References'), '12 个引用');
});

test('localizeCodeLensTitle: implementations', () => {
  assert.equal(localizeCodeLensTitle('0 implementations'), '0 个实现');
  assert.equal(localizeCodeLensTitle('1 implementation'), '1 个实现');
  assert.equal(localizeCodeLensTitle('2 implementations'), '2 个实现');
});

test('localizeCodeLensTitle: unknown titles pass through', () => {
  assert.equal(localizeCodeLensTitle('Run'), 'Run');
  assert.equal(localizeCodeLensTitle(''), '');
  assert.equal(localizeCodeLensTitle('  3 references  '), '3 个引用');
});

test('parseLensCommandTarget: parses JDT [uri, position, locations]', () => {
  const target = parseLensCommandTarget([
    'file:///repo/src/A.java',
    { line: 10, character: 4 },
    [
      { uri: 'file:///repo/src/B.java', range: { start: { line: 20, character: 8 }, end: { line: 20, character: 13 } } },
      { uri: 'file:///repo/src/C.java', range: { start: { line: 5, character: 2 }, end: { line: 5, character: 7 } } },
    ],
  ]);
  assert.ok(target);
  assert.equal(target.uri, 'file:///repo/src/A.java');
  assert.equal(target.line, 10);
  assert.equal(target.character, 4);
  assert.equal(target.locations.length, 2);
  assert.equal(target.locations[0].uri, 'file:///repo/src/B.java');
});

test('parseLensCommandTarget: 0 references yields empty locations (still clickable)', () => {
  const target = parseLensCommandTarget([
    'file:///repo/src/A.java',
    { line: 3, character: 10 },
    [],
  ]);
  assert.ok(target);
  assert.deepEqual(target.locations, []);
});

test('parseLensCommandTarget: rejects malformed args', () => {
  assert.equal(parseLensCommandTarget(undefined), undefined);
  assert.equal(parseLensCommandTarget([]), undefined);
  assert.equal(parseLensCommandTarget(['only-uri']), undefined);
  assert.equal(parseLensCommandTarget([123, { line: 0, character: 0 }]), undefined);
  assert.equal(parseLensCommandTarget(['file:///a.java', { line: 'x', character: 0 }]), undefined);
});

test('parseLensCommandTarget: skips malformed locations but keeps good ones', () => {
  const target = parseLensCommandTarget([
    'file:///repo/src/A.java',
    { line: 1, character: 2 },
    [
      { uri: 'file:///repo/src/B.java', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } },
      { nope: true },
      { uri: 123, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
    ],
  ]);
  assert.ok(target);
  assert.equal(target.locations.length, 1);
});
