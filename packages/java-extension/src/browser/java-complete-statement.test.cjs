// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for Complete Statement heuristics.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeCompleteStatement,
  unmatchedClosers,
} = require('../../lib/browser/java-complete-statement');

describe('unmatchedClosers', () => {
  test('counts open parens', () => {
    assert.deepEqual(unmatchedClosers('if (x'), { parens: 1, brackets: 0, angles: 0 });
  });
  test('ignores string contents', () => {
    assert.deepEqual(unmatchedClosers('foo(")")'), { parens: 0, brackets: 0, angles: 0 });
  });
});

describe('computeCompleteStatement', () => {
  test('closes if and opens block', () => {
    const edit = computeCompleteStatement({
      lines: ['    if (x'],
      line: 0,
      character: 9,
    });
    assert.ok(edit);
    assert.equal(edit.text, '    if (x) {');
    assert.deepEqual(edit.insertAfter, ['    \t', '    }']);
    assert.equal(edit.cursorLine, 1);
  });

  test('adds semicolon to statement', () => {
    const edit = computeCompleteStatement({
      lines: ['    int x = 1'],
      line: 0,
      character: 13,
    });
    assert.ok(edit);
    assert.equal(edit.text, '    int x = 1;');
    assert.equal(edit.cursorLine, 1);
  });

  test('closes method call parens then semicolon', () => {
    const edit = computeCompleteStatement({
      lines: ['    foo(bar'],
      line: 0,
      character: 11,
    });
    assert.ok(edit);
    assert.equal(edit.text, '    foo(bar);');
  });

  test('advances when already complete', () => {
    const edit = computeCompleteStatement({
      lines: ['    return 1;'],
      line: 0,
      character: 13,
    });
    assert.ok(edit);
    assert.equal(edit.text, '    return 1;');
    assert.deepEqual(edit.insertAfter, ['    ']);
  });

  test('completes do into do-while', () => {
    const edit = computeCompleteStatement({
      lines: ['    do'],
      line: 0,
      character: 6,
    });
    assert.ok(edit);
    assert.match(edit.text, /do \{/);
    assert.ok(edit.insertAfter?.some(l => /while/.test(l)));
  });

  test('completes class declaration with body', () => {
    const edit = computeCompleteStatement({
      lines: ['public class Foo'],
      line: 0,
      character: 16,
    });
    assert.ok(edit);
    assert.match(edit.text, /public class Foo \{/);
  });

  test('completes lambda arrow into block', () => {
    const edit = computeCompleteStatement({
      lines: ['    xs.forEach(x ->'],
      line: 0,
      character: 19,
    });
    assert.ok(edit);
    assert.match(edit.text, /-> \{/);
  });
});
