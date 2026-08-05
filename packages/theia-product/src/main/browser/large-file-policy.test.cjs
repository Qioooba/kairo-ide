'use strict';

require('../../../test/frontend-setup.cjs');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyLargeFile,
  editorOptionsForLargeFile,
} = require('../../../lib/browser/large-file-policy');

test('classifies files at line and character thresholds', () => {
  assert.equal(classifyLargeFile({ characterCount: 100, lineCount: 100 }), 'normal');
  assert.equal(classifyLargeFile({ characterCount: 5_000_000, lineCount: 100 }), 'large');
  assert.equal(classifyLargeFile({ characterCount: 100, lineCount: 100_000 }), 'large');
  assert.equal(classifyLargeFile({ characterCount: 50_000_000, lineCount: 100 }), 'huge');
  assert.equal(classifyLargeFile({ characterCount: 100, lineCount: 500_000 }), 'huge');
});

test('large-file options remove expensive editor features', () => {
  const large = editorOptionsForLargeFile('large');
  assert.equal(large.codeLens, false);
  assert.equal(large.folding, false);
  assert.equal(large.minimap.enabled, false);
  assert.equal(large.occurrencesHighlight, 'off');
  assert.equal(large.wordWrap, 'off');
});

test('huge-file options additionally suppress providers and diagnostics', () => {
  const huge = editorOptionsForLargeFile('huge');
  assert.equal(huge.hover.enabled, 'off');
  assert.equal(huge.quickSuggestions, false);
  assert.equal(huge.renderValidationDecorations, 'off');
  assert.equal(huge.stopRenderingLineAfter, -1);
  assert.equal(huge.suggestOnTriggerCharacters, false);
});
