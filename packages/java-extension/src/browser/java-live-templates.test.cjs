'use strict';
const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

const { test } = require('node:test');
const assert = require('node:assert');

// Mock @theia/monaco-editor-core so the live-templates module can be loaded
// without pulling in the full Monaco editor.
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core') {
    const key = '/mock-monaco-editor-core';
    Module._cache[key] = {
      id: key,
      exports: {
        languages: {
          registerCompletionItemProvider: (languageId, provider) => {
            return { dispose: () => {}, provider };
          },
          CompletionItemKind: { Snippet: 1 },
          CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
        },
        Range: class Range {
          constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
            this.startLineNumber = startLineNumber;
            this.startColumn = startColumn;
            this.endLineNumber = endLineNumber;
            this.endColumn = endColumn;
          }
        },
      },
      loaded: true,
    };
    return key;
  }
  return originalResolveFilename.apply(this, [request, parent, ...args]);
};

const { registerJavaLiveTemplates } = require('../../lib/browser/java-live-templates');

test('registerJavaLiveTemplates is a function', () => {
  assert.strictEqual(typeof registerJavaLiveTemplates, 'function');
});

test('registerJavaLiveTemplates returns a Disposable', () => {
  const disposable = registerJavaLiveTemplates('java');
  assert.ok(disposable);
  assert.strictEqual(typeof disposable.dispose, 'function');
  disposable.dispose();
});

test('completion provider returns suggestions for matching prefix "sout"', () => {
  const disposable = registerJavaLiveTemplates('java');
  const provider = disposable.provider;

  assert.ok(provider);
  assert.strictEqual(typeof provider.provideCompletionItems, 'function');

  const mockModel = {
    getLanguageId: () => 'java',
    getWordUntilPosition: () => ({ word: 'sout', startColumn: 1, endColumn: 5 }),
  };
  const mockPosition = { lineNumber: 10, column: 5 };

  const result = provider.provideCompletionItems(mockModel, mockPosition, {}, {});
  assert.ok(result);
  assert.ok(Array.isArray(result.suggestions));
  assert.ok(result.suggestions.length >= 1);

  const soutSuggestion = result.suggestions.find(s => s.label === 'sout');
  assert.ok(soutSuggestion);
  assert.strictEqual(soutSuggestion.detail, 'Print to standard output');
  assert.strictEqual(soutSuggestion.insertText, 'System.out.println(${1});');
  assert.strictEqual(soutSuggestion.kind, 1); // CompletionItemKind.Snippet
  assert.strictEqual(soutSuggestion.insertTextRules, 4); // InsertAsSnippet

  disposable.dispose();
});

test('completion provider returns suggestions for matching prefix "psvm"', () => {
  const disposable = registerJavaLiveTemplates('java');
  const provider = disposable.provider;

  const mockModel = {
    getLanguageId: () => 'java',
    getWordUntilPosition: () => ({ word: 'psvm', startColumn: 1, endColumn: 5 }),
  };
  const mockPosition = { lineNumber: 1, column: 5 };

  const result = provider.provideCompletionItems(mockModel, mockPosition, {}, {});
  assert.ok(result.suggestions.length >= 1);

  const psvmSuggestion = result.suggestions.find(s => s.label === 'psvm');
  assert.ok(psvmSuggestion);
  assert.strictEqual(psvmSuggestion.detail, 'Main method declaration');
  assert.ok(psvmSuggestion.insertText.includes('public static void main'));

  disposable.dispose();
});

test('completion provider returns suggestions for matching prefix "fori"', () => {
  const disposable = registerJavaLiveTemplates('java');
  const provider = disposable.provider;

  const mockModel = {
    getLanguageId: () => 'java',
    getWordUntilPosition: () => ({ word: 'fori', startColumn: 1, endColumn: 5 }),
  };
  const mockPosition = { lineNumber: 5, column: 5 };

  const result = provider.provideCompletionItems(mockModel, mockPosition, {}, {});
  assert.ok(result.suggestions.length >= 1);

  const foriSuggestion = result.suggestions.find(s => s.label === 'fori');
  assert.ok(foriSuggestion);
  assert.strictEqual(foriSuggestion.detail, 'Iterate with index');
  assert.ok(foriSuggestion.insertText.includes('for (int'));

  disposable.dispose();
});

test('completion provider returns empty for unknown prefix', () => {
  const disposable = registerJavaLiveTemplates('java');
  const provider = disposable.provider;

  const mockModel = {
    getLanguageId: () => 'java',
    getWordUntilPosition: () => ({ word: 'unknown', startColumn: 1, endColumn: 8 }),
  };
  const mockPosition = { lineNumber: 3, column: 8 };

  const result = provider.provideCompletionItems(mockModel, mockPosition, {}, {});
  assert.ok(Array.isArray(result.suggestions));
  assert.strictEqual(result.suggestions.length, 0);

  disposable.dispose();
});

test('completion provider has correct sortText and filterText', () => {
  const disposable = registerJavaLiveTemplates('java');
  const provider = disposable.provider;

  const mockModel = {
    getLanguageId: () => 'java',
    getWordUntilPosition: () => ({ word: 'soutv', startColumn: 1, endColumn: 6 }),
  };
  const mockPosition = { lineNumber: 7, column: 6 };

  const result = provider.provideCompletionItems(mockModel, mockPosition, {}, {});
  const soutvSuggestion = result.suggestions.find(s => s.label === 'soutv');
  assert.ok(soutvSuggestion);
  assert.strictEqual(soutvSuggestion.filterText, 'soutv');
  assert.strictEqual(soutvSuggestion.sortText, '0soutv');

  disposable.dispose();
});

test('teardown', () => {
  disableJSDOM();
});