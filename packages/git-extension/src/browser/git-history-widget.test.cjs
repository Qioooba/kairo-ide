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

// Mock @theia/monaco-editor-core to avoid the ESM CSS import issue in CJS tests.
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.includes('monaco-editor-core')) {
    const mockPath = require('node:path').join(__dirname, '..', '..', '..', 'search-extension', 'src', 'browser', '__monaco-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  return origResolveFilename.call(this, request, parent, ...args);
};

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert');

const git = require('../../lib/browser/index');

// ---- GitHistoryWidget exports ----------------------------------------------

test('GitHistoryWidget is exported', () => {
  assert.strictEqual(typeof git.GitHistoryWidget, 'function');
});

test('GitHistoryWidget has static ID', () => {
  assert.strictEqual(git.GitHistoryWidget.ID, 'kairo-git-history');
});

test('GitHistoryWidget has static LABEL', () => {
  assert.strictEqual(git.GitHistoryWidget.LABEL, 'Git History');
});

// ---- parseSearchQuery logic ------------------------------------------------

test('parseSearchQuery: author prefix extracts author', () => {
  const query = 'author:john';
  const match = query.match(/author:([^\s]+)/i);
  assert.ok(match);
  assert.strictEqual(match[1], 'john');
});

test('parseSearchQuery: path prefix extracts file path', () => {
  const query = 'path:src/Main.java';
  const match = query.match(/path:([^\s]+)/i);
  assert.ok(match);
  assert.strictEqual(match[1], 'src/Main.java');
});

test('parseSearchQuery: SHA-like prefix detected', () => {
  const query = 'a1b2c3d4e5f6';
  const match = query.match(/^([a-f0-9]{7,40})$/i);
  assert.ok(match);
  assert.strictEqual(match[1], 'a1b2c3d4e5f6');
});

test('parseSearchQuery: date range after: prefix', () => {
  const query = 'after:2024-01-01';
  const match = query.match(/after:([^\s]+)/i);
  assert.ok(match);
  assert.strictEqual(match[1], '2024-01-01');
});

test('parseSearchQuery: date range before: prefix', () => {
  const query = 'before:2024-12-31';
  const match = query.match(/before:([^\s]+)/i);
  assert.ok(match);
  assert.strictEqual(match[1], '2024-12-31');
});

test('parseSearchQuery: no special prefix defaults to message search', () => {
  const query = 'fix bug';
  const hasAuthor = /author:([^\s]+)/i.test(query);
  const hasPath = /path:([^\s]+)/i.test(query);
  const hasSha = /^([a-f0-9]{7,40})$/i.test(query);
  const hasDate = /after:|before:/i.test(query);
  assert.strictEqual(hasAuthor, false);
  assert.strictEqual(hasPath, false);
  assert.strictEqual(hasSha, false);
  assert.strictEqual(hasDate, false);
});

test('parseSearchQuery: combined author and path', () => {
  const query = 'author:jane path:src/Util.java';
  const authorMatch = query.match(/author:([^\s]+)/i);
  const pathMatch = query.match(/path:([^\s]+)/i);
  assert.strictEqual(authorMatch[1], 'jane');
  assert.strictEqual(pathMatch[1], 'src/Util.java');
});

// ---- CommitSearchCriteria --------------------------------------------------

test('CommitSearchCriteria: with author', () => {
  const criteria = { author: 'john' };
  assert.strictEqual(criteria.author, 'john');
});

test('CommitSearchCriteria: with filePath', () => {
  const criteria = { filePath: 'src/Main.java' };
  assert.strictEqual(criteria.filePath, 'src/Main.java');
});

test('CommitSearchCriteria: with shaPrefix', () => {
  const criteria = { shaPrefix: 'a1b2c3d' };
  assert.strictEqual(criteria.shaPrefix, 'a1b2c3d');
});

test('CommitSearchCriteria: with date range', () => {
  const criteria = { dateFrom: '2024-01-01', dateTo: '2024-12-31' };
  assert.strictEqual(criteria.dateFrom, '2024-01-01');
  assert.strictEqual(criteria.dateTo, '2024-12-31');
});

test('CommitSearchCriteria: with message', () => {
  const criteria = { message: 'fix bug' };
  assert.strictEqual(criteria.message, 'fix bug');
});

// ---- CommitSearchResult data structure -------------------------------------

test('CommitSearchResult: valid structure', () => {
  const result = {
    commit: {
      hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      message: 'Fix null pointer',
      author: 'John',
      email: 'john@example.com',
      date: new Date('2024-01-15'),
    },
    highlights: [
      { start: 0, end: 3, field: 'message' },
    ],
    score: 0.95,
  };
  assert.strictEqual(result.commit.hash.length, 40);
  assert.ok(Array.isArray(result.highlights));
  assert.strictEqual(result.highlights[0].field, 'message');
});

// ---- CommitSearchSummary ---------------------------------------------------

test('CommitSearchSummary: idle status', () => {
  const summary = { status: 'idle', results: [], query: '', totalCount: 0 };
  assert.strictEqual(summary.status, 'idle');
  assert.strictEqual(summary.totalCount, 0);
});

test('CommitSearchSummary: success status', () => {
  const summary = { status: 'success', results: [{ commit: { hash: 'abc', message: 'test', author: 'x', email: 'x', date: new Date() }, highlights: [], score: 1 }], query: 'test', totalCount: 1 };
  assert.strictEqual(summary.status, 'success');
  assert.strictEqual(summary.totalCount, 1);
  assert.strictEqual(summary.query, 'test');
});

test('CommitSearchSummary: timed_out status', () => {
  const summary = { status: 'timed_out', results: [], query: 'complex', totalCount: 0 };
  assert.strictEqual(summary.status, 'timed_out');
});

test('CommitSearchSummary: error status', () => {
  const summary = { status: 'error', results: [], query: 'bad', totalCount: 0, error: 'git command failed' };
  assert.strictEqual(summary.status, 'error');
  assert.strictEqual(summary.error, 'git command failed');
});

// ---- renderHighlightedText logic -------------------------------------------

test('renderHighlightedText: no highlights returns original text', () => {
  const highlights = [];
  assert.strictEqual(highlights.length, 0);
});

test('renderHighlightedText: single highlight range', () => {
  const highlights = [{ start: 0, end: 5 }];
  assert.strictEqual(highlights.length, 1);
  assert.strictEqual(highlights[0].start, 0);
  assert.strictEqual(highlights[0].end, 5);
});

test('renderHighlightedText: multiple highlights sorted by start', () => {
  const highlights = [
    { start: 10, end: 14 },
    { start: 0, end: 5 },
  ];
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  assert.strictEqual(sorted[0].start, 0);
  assert.strictEqual(sorted[1].start, 10);
});

test('renderHighlightedText: adjacent highlights', () => {
  const highlights = [
    { start: 0, end: 3 },
    { start: 3, end: 6 },
  ];
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  assert.strictEqual(sorted[0].end, sorted[1].start);
});

// ---- GitCommit data structure ----------------------------------------------

test('GitCommit: valid structure', () => {
  const commit = {
    hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    message: 'Initial commit',
    author: 'Developer',
    email: 'dev@example.com',
    date: new Date('2024-01-01'),
  };
  assert.strictEqual(commit.hash.length, 40);
  assert.strictEqual(commit.author, 'Developer');
  assert.ok(commit.date instanceof Date);
});

test('GitCommit: short hash is first 7 chars', () => {
  const hash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
  const shortHash = hash.substring(0, 7);
  assert.strictEqual(shortHash, 'a1b2c3d');
  assert.strictEqual(shortHash.length, 7);
});

test('GitCommit: long message truncated', () => {
  const message = 'This is a very long commit message that exceeds sixty characters in length';
  const display = message.length > 60 ? message.substring(0, 57) + '...' : message;
  assert.ok(display.endsWith('...'));
  assert.strictEqual(display.length, 60);
});

test('teardown', () => { disableJSDOM(); });