// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for java-completion-adapter — LSP field mapping,
// snippet detection, smart filter, and resolve merge.
//
// Run with: pnpm --filter @kairo/java-extension test

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  adaptLspCompletion,
  adaptIntelliSenseCompletion,
  filterSmartCompletions,
  mergeResolvedCompletion,
  looksLikeSnippet,
  INSERT_AS_SNIPPET,
  INSERT_AS_PLAIN,
  extractTypeHintFromParameterLabel,
} = require('../../lib/browser/java-completion-adapter');

describe('looksLikeSnippet', () => {
  test('detects ${} placeholders', () => {
    assert.equal(looksLikeSnippet('println(${1:x})'), true);
  });
  test('detects $1 tabstops', () => {
    assert.equal(looksLikeSnippet('foo($1)'), true);
  });
  test('plain text is not a snippet', () => {
    assert.equal(looksLikeSnippet('String'), false);
  });
  test('undefined is not a snippet', () => {
    assert.equal(looksLikeSnippet(undefined), false);
  });
});

describe('adaptLspCompletion', () => {
  test('converts basic LSP completion item', () => {
    const item = adaptLspCompletion({
      label: 'String',
      kind: 7,
      detail: 'java.lang.String',
      sortText: '0String',
      filterText: 'String',
      insertText: 'String',
    });
    assert.equal(item.label, 'String');
    assert.equal(item.kind, 7);
    assert.equal(item.detail, 'java.lang.String');
    assert.equal(item.insertText, 'String');
  });

  test('falls back to label for insertText when undefined', () => {
    const item = adaptLspCompletion({ label: 'String', kind: 7 });
    assert.equal(item.insertText, 'String');
  });

  test('prefers textEdit.newText when insertText missing', () => {
    const item = adaptLspCompletion({
      label: 'List',
      textEdit: {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: 'java.util.List',
      },
    });
    assert.equal(item.insertText, 'java.util.List');
    assert.equal(item.textEdit.newText, 'java.util.List');
  });

  test('preserves additionalTextEdits for auto-import', () => {
    const item = adaptLspCompletion({
      label: 'ArrayList',
      insertText: 'ArrayList',
      additionalTextEdits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: 'import java.util.ArrayList;\n',
        },
      ],
    });
    assert.equal(item.additionalTextEdits.length, 1);
    assert.match(item.additionalTextEdits[0].newText, /import java\.util\.ArrayList/);
  });

  test('preserves commitCharacters and data', () => {
    const item = adaptLspCompletion({
      label: 'foo',
      insertText: 'foo',
      commitCharacters: ['.', '('],
      data: { pid: 1 },
    });
    assert.deepEqual(item.commitCharacters, ['.', '(']);
    assert.deepEqual(item.data, { pid: 1 });
  });

  test('preserves insertTextFormat snippet', () => {
    const item = adaptLspCompletion({
      label: 'println',
      insertText: 'println(${1:x})',
      insertTextFormat: 2,
    });
    assert.equal(item.insertTextFormat, INSERT_AS_SNIPPET);
  });

  test('infers snippet format from placeholders when format omitted', () => {
    const item = adaptLspCompletion({
      label: 'println',
      insertText: 'println(${1:x})',
    });
    assert.equal(item.insertTextFormat, INSERT_AS_SNIPPET);
  });

  test('handles string documentation', () => {
    const item = adaptLspCompletion({
      label: 'String',
      documentation: 'Immutable sequence of characters.',
    });
    assert.equal(item.documentation, 'Immutable sequence of characters.');
  });

  test('handles object documentation with value', () => {
    const item = adaptLspCompletion({
      label: 'String',
      documentation: { kind: 'markdown', value: '**String** class' },
    });
    assert.equal(item.documentation, '**String** class');
  });

  test('detects deprecated tag', () => {
    const item = adaptLspCompletion({ label: 'oldMethod', kind: 2, tags: [1] });
    assert.equal(item.isDeprecated, true);
  });

  test('not deprecated when tags is empty', () => {
    const item = adaptLspCompletion({ label: 'newMethod', kind: 2, tags: [] });
    assert.equal(item.isDeprecated, false);
  });
});

describe('adaptIntelliSenseCompletion', () => {
  test('marks snippet kind as InsertAsSnippet', () => {
    const item = adaptIntelliSenseCompletion({
      label: 'sout',
      kind: 15,
      insertText: 'System.out.println(${1});',
    });
    assert.equal(item.insertTextFormat, INSERT_AS_SNIPPET);
  });

  test('marks method insertText with placeholders as snippet', () => {
    const item = adaptIntelliSenseCompletion({
      label: 'equals',
      kind: 2,
      insertText: 'equals(${1:obj})',
    });
    assert.equal(item.insertTextFormat, INSERT_AS_SNIPPET);
  });

  test('plain keyword stays plain', () => {
    const item = adaptIntelliSenseCompletion({
      label: 'public',
      kind: 14,
      insertText: 'public',
    });
    assert.equal(item.insertTextFormat, INSERT_AS_PLAIN);
  });
});

describe('filterSmartCompletions', () => {
  test('drops keywords and snippets', () => {
    const items = [
      { label: 'public', kind: 14, insertText: 'public' },
      { label: 'sout', kind: 15, insertText: 'sout' },
      { label: 'String', kind: 7, insertText: 'String' },
      { label: 'length', kind: 2, insertText: 'length()' },
    ];
    const filtered = filterSmartCompletions(items);
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every(i => i.kind === 7 || i.kind === 2));
    assert.ok(filtered[0].sortText.startsWith('0') || filtered[0].sortText.startsWith('1'));
  });

  test('returns original list when nothing matches smart kinds', () => {
    const items = [{ label: 'public', kind: 14, insertText: 'public' }];
    assert.equal(filterSmartCompletions(items).length, 1);
  });

  test('boosts items matching expected type', () => {
    assert.equal(extractTypeHintFromParameterLabel('String name'), 'String');
    assert.equal(extractTypeHintFromParameterLabel('final List<String> items'), 'List<String>');

    const items = [
      { label: 'count', kind: 6, detail: 'int', insertText: 'count' },
      { label: 'name', kind: 6, detail: 'String', insertText: 'name' },
      { label: 'toString', kind: 2, detail: 'String toString()', insertText: 'toString()' },
    ];
    const filtered = filterSmartCompletions(items, 'String');
    assert.ok(filtered[0].sortText.startsWith('0'));
    assert.ok(['name', 'toString'].includes(filtered[0].label));
  });
});

describe('mergeResolvedCompletion', () => {
  test('merges documentation and additionalTextEdits from resolve', () => {
    const base = adaptLspCompletion({
      label: 'ArrayList',
      insertText: 'ArrayList',
      data: { id: 1 },
    });
    const merged = mergeResolvedCompletion(base, {
      label: 'ArrayList',
      detail: 'java.util.ArrayList',
      documentation: { kind: 'markdown', value: 'Resizable-array' },
      additionalTextEdits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: 'import java.util.ArrayList;\n',
        },
      ],
      data: { id: 1 },
    });
    assert.equal(merged.detail, 'java.util.ArrayList');
    assert.equal(merged.documentation, 'Resizable-array');
    assert.equal(merged.additionalTextEdits.length, 1);
    assert.deepEqual(merged.data, { id: 1 });
  });
});
