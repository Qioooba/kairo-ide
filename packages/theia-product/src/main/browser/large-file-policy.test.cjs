'use strict';

const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
register('data:text/javascript,' + encodeURIComponent(`
export function resolve(specifier, context, nextResolve) {
  if (/\.(css|svg|ttf|woff|woff2|png|jpg|gif)$/.test(specifier)) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  if (specifier === '@theia/monaco-editor-core' || specifier.includes('monaco-editor-core')) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`), pathToFileURL(__filename));

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

// Mock @theia/monaco-editor-core to avoid the ESM import issue in CJS tests.
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.includes('monaco-editor-core')) {
    const mockPath = require('node:path').join(__dirname, '..', '..', '..', '..', 'search-extension', 'src', 'browser', '__monaco-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  return origResolveFilename.call(this, request, parent, ...args);
};

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyLargeFile,
  editorOptionsForLargeFile,
} = require('../../../lib/browser/large-file-policy');

test('classifies files at line and character thresholds', () => {
  assert.equal(classifyLargeFile({ characterCount: 100, lineCount: 100 }), 'normal');
  assert.equal(classifyLargeFile({ characterCount: 2_000_000, lineCount: 100 }), 'large');
  assert.equal(classifyLargeFile({ characterCount: 100, lineCount: 20_000 }), 'large');
  assert.equal(classifyLargeFile({ characterCount: 10_000_000, lineCount: 100 }), 'huge');
  assert.equal(classifyLargeFile({ characterCount: 100, lineCount: 80_000 }), 'huge');
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
  assert.equal(huge.stopRenderingLineAfter, 5_000);
  assert.equal(huge.suggestOnTriggerCharacters, false);
});
