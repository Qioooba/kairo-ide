// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for java-show-usages pure helpers.
//
// Run with: pnpm --filter @kairo/java-extension test

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  fileNameFromUri,
  relativePathFromUri,
  prepareUsages,
  sortUsages,
  buildUsagePickEntries,
  filterUsages,
  locationKey,
} = require('../../lib/browser/java-show-usages');

function loc(uri, line, character, endCharacter = character + 4) {
  return {
    uri,
    range: {
      start: { line, character },
      end: { line, character: endCharacter },
    },
  };
}

test('fileNameFromUri extracts basename', () => {
  assert.equal(fileNameFromUri('file:///workspace/src/Foo.java'), 'Foo.java');
  assert.equal(fileNameFromUri('file:///C:/proj/Bar.java'), 'Bar.java');
});

test('relativePathFromUri strips workspace root', () => {
  const uri = 'file:///workspace/src/main/Foo.java';
  assert.equal(relativePathFromUri(uri, 'file:///workspace'), 'src/main/Foo.java');
});

test('prepareUsages tags declarations and current file', () => {
  const current = 'file:///ws/A.java';
  const other = 'file:///ws/B.java';
  const refs = [loc(current, 10, 4), loc(other, 3, 2), loc(current, 1, 0)];
  const declarations = [loc(current, 1, 0)];

  const usages = prepareUsages({
    references: refs,
    declarations,
    currentUri: current,
    workspaceRoot: 'file:///ws',
    getPreview: (_uri, line) => `preview-${line}`,
  });

  assert.equal(usages.length, 3);
  const decl = usages.find(u => u.line === 1);
  assert.equal(decl.isDeclaration, true);
  assert.equal(decl.isCurrentFile, true);
  assert.equal(decl.preview, 'preview-1');
  assert.equal(usages.find(u => u.uri === other).isCurrentFile, false);
});

test('sortUsages: current file first, declaration before usages, then line', () => {
  const current = 'file:///ws/A.java';
  const other = 'file:///ws/B.java';
  const usages = prepareUsages({
    references: [loc(other, 1, 0), loc(current, 20, 0), loc(current, 5, 0)],
    declarations: [loc(current, 5, 0)],
    currentUri: current,
    workspaceRoot: 'file:///ws',
    getPreview: () => 'x',
  });

  const sorted = sortUsages(usages);
  assert.equal(sorted[0].uri, current);
  assert.equal(sorted[0].isDeclaration, true);
  assert.equal(sorted[1].uri, current);
  assert.equal(sorted[1].line, 20);
  assert.equal(sorted[2].uri, other);
});

test('buildUsagePickEntries groups by file with separators', () => {
  const current = 'file:///ws/A.java';
  const other = 'file:///ws/B.java';
  const usages = prepareUsages({
    references: [loc(current, 1, 0), loc(current, 8, 0), loc(other, 2, 0)],
    declarations: [loc(current, 1, 0)],
    currentUri: current,
    workspaceRoot: 'file:///ws',
    getPreview: (_u, line) => `line ${line}`,
  });

  const entries = buildUsagePickEntries(usages, {
    declaration: 'declaration',
    usage: 'usage',
    fileGroup: (name, count) => `${name} (${count})`,
  });

  const separators = entries.filter(e => e.type === 'separator');
  const items = entries.filter(e => e.type !== 'separator');
  assert.equal(separators.length, 2);
  assert.equal(separators[0].label, 'A.java (2)');
  assert.equal(separators[1].label, 'B.java (1)');
  assert.equal(items.length, 3);
  assert.equal(items[0].description, 'declaration');
  assert.equal(items[1].description, 'usage');
  assert.equal(items[0].detail, 'line 1');
  assert.ok(items[0].id.includes(locationKey(current, 1, 0)));
});

test('filterUsages matches file name, path, preview, and line', () => {
  const usages = prepareUsages({
    references: [
      loc('file:///ws/FooService.java', 10, 0),
      loc('file:///ws/Bar.java', 3, 0),
    ],
    workspaceRoot: 'file:///ws',
    getPreview: (uri) => (uri.includes('Foo') ? 'foo.doWork()' : 'other.call()'),
  });

  assert.equal(filterUsages(usages, 'Foo').length, 1);
  assert.equal(filterUsages(usages, 'doWork').length, 1);
  assert.equal(filterUsages(usages, '11').length, 1); // line 10 displayed as 11
  assert.equal(filterUsages(usages, '').length, 2);
  assert.equal(filterUsages(usages, 'zzz').length, 0);
});

test('resolveIdentifierOnLine snaps off braces and punctuation', () => {
  const { resolveIdentifierOnLine } = require('../../lib/browser/java-show-usages');
  const line = 'public class HelloServlet extends HttpServlet {';
  const onBrace = resolveIdentifierOnLine(line, line.length - 1); // on `{`
  assert.ok(onBrace);
  assert.equal(onBrace.symbolName, 'HttpServlet');

  const onClass = resolveIdentifierOnLine(line, line.indexOf('HelloServlet') + 3);
  assert.equal(onClass.symbolName, 'HelloServlet');
  assert.equal(onClass.character, line.indexOf('HelloServlet'));
});
