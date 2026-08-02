// SPDX-License-Identifier: Apache-2.0
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  SURROUND_TEMPLATES,
  computeSurroundEdit,
  findSurroundTemplate,
  resolveSurroundSelection,
} = require('../../lib/browser/java-surround-with');

describe('findSurroundTemplate', () => {
  test('finds by id and label', () => {
    assert.equal(findSurroundTemplate('if')?.id, 'if');
    assert.equal(findSurroundTemplate('try / catch')?.id, 'try');
  });
});

describe('computeSurroundEdit', () => {
  test('wraps current line with if when selection empty', () => {
    const edit = computeSurroundEdit(
      {
        lines: ['    doWork();'],
        startLine: 0,
        startCharacter: 4,
        endLine: 0,
        endCharacter: 4,
      },
      findSurroundTemplate('if'),
    );
    assert.match(edit.text, /if \(\$\{1:condition\}\) \{/);
    assert.match(edit.text, /doWork\(\);/);
    assert.match(edit.text, /\}/);
    assert.equal(edit.asSnippet, true);
  });

  test('wraps multi-line selection with try/catch', () => {
    const edit = computeSurroundEdit(
      {
        lines: ['    a();', '    b();'],
        startLine: 0,
        startCharacter: 0,
        endLine: 1,
        endCharacter: 8,
      },
      findSurroundTemplate('try'),
    );
    assert.match(edit.text, /try \{/);
    assert.match(edit.text, /catch \(\$\{1:Exception\} \$\{2:e\}\)/);
    assert.match(edit.text, /a\(\);/);
    assert.match(edit.text, /b\(\);/);
  });

  test('parens surround trims selection', () => {
    const edit = computeSurroundEdit(
      {
        lines: ['    foo + bar'],
        startLine: 0,
        startCharacter: 4,
        endLine: 0,
        endCharacter: 13,
      },
      findSurroundTemplate('parens'),
    );
    assert.match(edit.text, /\(foo \+ bar\)/);
  });
});

describe('SURROUND_TEMPLATES', () => {
  test('includes IDEA classics', () => {
    const ids = SURROUND_TEMPLATES.map(t => t.id);
    for (const id of ['if', 'ifelse', 'while', 'for', 'try', 'synchronized', 'block', 'not', 'optional']) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
  });
});

describe('resolveSurroundSelection', () => {
  test('expands empty selection to whole line', () => {
    const r = resolveSurroundSelection({
      lines: ['  hello();'],
      startLine: 0,
      startCharacter: 2,
      endLine: 0,
      endCharacter: 2,
    });
    assert.equal(r.text, '  hello();');
    assert.equal(r.indent, '  ');
  });
});
