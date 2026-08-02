// SPDX-License-Identifier: Apache-2.0
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { computeUnwrapEdit } = require('../../lib/browser/java-unwrap');

describe('computeUnwrapEdit', () => {
  test('unwraps if block keeping body', () => {
    const edit = computeUnwrapEdit({
      lines: [
        '    if (x) {',
        '        doWork();',
        '    }',
      ],
      line: 1,
      character: 8,
    });
    assert.ok(edit);
    assert.match(edit.text, /doWork\(\);/);
    assert.doesNotMatch(edit.text, /\bif\b/);
  });

  test('unwraps try/catch keeping try body', () => {
    const edit = computeUnwrapEdit({
      lines: [
        '    try {',
        '        a();',
        '    } catch (Exception e) {',
        '        e.printStackTrace();',
        '    }',
      ],
      line: 1,
      character: 8,
    });
    assert.ok(edit);
    assert.match(edit.text, /a\(\);/);
    assert.doesNotMatch(edit.text, /\btry\b/);
  });

  test('returns null when nothing to unwrap', () => {
    const edit = computeUnwrapEdit({
      lines: ['    int x = 1;'],
      line: 0,
      character: 8,
    });
    assert.equal(edit, null);
  });
});
