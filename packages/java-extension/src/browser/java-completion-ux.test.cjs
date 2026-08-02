// SPDX-License-Identifier: Apache-2.0
//
// Completion UX acceptance — pure-logic checklist that IDEA users
// expect to work out of the box (no Monaco / Electron required).

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { computeCompleteStatement } = require('../../lib/browser/java-complete-statement');
const {
  SURROUND_TEMPLATES,
  computeSurroundEdit,
  findSurroundTemplate,
} = require('../../lib/browser/java-surround-with');
const { computeUnwrapEdit } = require('../../lib/browser/java-unwrap');
const { RecentCompletionStore } = require('../../lib/browser/java-recent-completions');
const { filterSmartCompletions } = require('../../lib/browser/java-completion-adapter');

describe('IDEA completion UX acceptance', () => {
  test('Complete Statement covers if / class / do / lambda', () => {
    assert.match(
      computeCompleteStatement({ lines: ['    if (x'], line: 0, character: 9 }).text,
      /if \(x\) \{/,
    );
    assert.match(
      computeCompleteStatement({ lines: ['public class Foo'], line: 0, character: 16 }).text,
      /Foo \{/,
    );
    assert.match(
      computeCompleteStatement({ lines: ['    do'], line: 0, character: 6 }).text,
      /do \{/,
    );
    assert.match(
      computeCompleteStatement({ lines: ['    xs.forEach(x ->'], line: 0, character: 19 }).text,
      /-> \{/,
    );
  });

  test('Surround With templates include IDEA classics + snippet tabstops', () => {
    const ids = SURROUND_TEMPLATES.map(t => t.id);
    for (const id of ['if', 'ifelse', 'try', 'trywr', 'synchronized', 'optional', 'not', 'runnable']) {
      assert.ok(ids.includes(id), `missing surround ${id}`);
    }
    const edit = computeSurroundEdit(
      { lines: ['    work();'], startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 4 },
      findSurroundTemplate('if'),
    );
    assert.match(edit.text, /\$\{1:condition\}/);
    assert.equal(edit.asSnippet, true);
  });

  test('Unwrap removes if and try/catch wrappers', () => {
    const ifEdit = computeUnwrapEdit({
      lines: ['    if (ok) {', '        go();', '    }'],
      line: 1,
      character: 8,
    });
    assert.ok(ifEdit);
    assert.match(ifEdit.text, /go\(\);/);
    assert.doesNotMatch(ifEdit.text, /\bif\b/);

    const tryEdit = computeUnwrapEdit({
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
    assert.ok(tryEdit);
    assert.match(tryEdit.text, /a\(\);/);
    assert.equal(tryEdit.endLine, 4);
  });

  test('Recent MRU boost beats plain sortText', () => {
    const store = new RecentCompletionStore();
    store.record('getName');
    store.record('getId');
    assert.match(store.boostSortText('getId', 'zzz'), /^0r00/);
    assert.match(store.boostSortText('getName', 'aaa'), /^0r01/);
  });

  test('Smart Completion cycles: type → members → all', () => {
    const items = [
      { label: 'toString', kind: 2, detail: 'String', sortText: 'z' },
      { label: 'if', kind: 14, sortText: 'a' },
      { label: 'value', kind: 5, detail: 'int', sortText: 'm' },
    ];
    const c0 = filterSmartCompletions(items, 'String', 0);
    assert.ok(c0.every(i => i.kind !== 14));
    assert.ok(c0[0].sortText.startsWith('0'));

    const c1 = filterSmartCompletions(items, 'String', 1);
    assert.ok(c1.every(i => i.kind !== 14));

    const c2 = filterSmartCompletions(items, undefined, 2);
    assert.equal(c2.length, 3);
  });
});
