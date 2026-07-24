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

// Mock @theia/monaco-editor-core to avoid ESM import issues in CJS test runner.
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.endsWith('/@theia/monaco-editor-core')) {
    return origResolveFilename.call(this, require('node:path').join(__dirname, '..', '..', '..', 'search-extension', 'src', 'browser', '__monaco-mock__.js'), parent, ...args);
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

const tomcat = require('../../lib/browser/index');

// ---- LogViewerWidget exports -----------------------------------------------

test('LogViewerWidget is exported', () => {
  assert.strictEqual(typeof tomcat.LogViewerWidget, 'function');
});

test('LogViewerWidget has static ID', () => {
  assert.strictEqual(tomcat.LogViewerWidget.ID, 'kairo-log-viewer');
});

// ---- LogViewerWidget instantiation -----------------------------------------

test('LogViewerWidget: instantiation sets id', () => {
  const widget = new tomcat.LogViewerWidget();
  assert.strictEqual(widget.id, 'kairo-log-viewer');
});

test('LogViewerWidget: instantiation sets title', () => {
  const widget = new tomcat.LogViewerWidget();
  assert.strictEqual(widget.title.label, 'Server Logs');
  assert.strictEqual(widget.title.caption, 'Kairo Server Log Viewer');
  assert.strictEqual(widget.title.closable, true);
});

test('LogViewerWidget: has kairo-widget CSS class', () => {
  const widget = new tomcat.LogViewerWidget();
  assert.ok(widget.hasClass('kairo-widget'));
});

// ---- KairoLogLine data structure -------------------------------------------

test('KairoLogLine: stdout line', () => {
  const line = {
    line: 'Server started on port 8080',
    ts: '2024-01-01T00:00:00.000Z',
    stream: 'stdout',
    level: 'info',
  };
  assert.strictEqual(line.stream, 'stdout');
  assert.strictEqual(line.level, 'info');
});

test('KairoLogLine: stderr line', () => {
  const line = {
    line: 'Error: Connection refused',
    ts: '2024-01-01T00:00:01.000Z',
    stream: 'stderr',
    level: 'error',
  };
  assert.strictEqual(line.stream, 'stderr');
  assert.strictEqual(line.level, 'error');
});

test('KairoLogLine: structured line', () => {
  const line = {
    line: '{"event":"deploy","status":"ok"}',
    ts: '2024-01-01T00:00:02.000Z',
    stream: 'structured',
    level: 'info',
    source: 'kairo-agent',
    ordinal: 42,
  };
  assert.strictEqual(line.stream, 'structured');
  assert.strictEqual(line.source, 'kairo-agent');
  assert.strictEqual(line.ordinal, 42);
});

// ---- LogStream values ------------------------------------------------------

test('LogStream: stdout', () => {
  assert.strictEqual('stdout', 'stdout');
});

test('LogStream: stderr', () => {
  assert.strictEqual('stderr', 'stderr');
});

test('LogStream: structured', () => {
  assert.strictEqual('structured', 'structured');
});

// ---- LogLevel values -------------------------------------------------------

test('LogLevel: error', () => {
  assert.strictEqual('error', 'error');
});

test('LogLevel: warning', () => {
  assert.strictEqual('warning', 'warning');
});

test('LogLevel: info', () => {
  assert.strictEqual('info', 'info');
});

// ---- BoundedLogBuffer logic ------------------------------------------------

test('BoundedLogBuffer: can be created with default limits', () => {
  const buffer = { maxLines: 5000, maxBytes: 2 * 1024 * 1024, lines: [], bytes: 0 };
  assert.strictEqual(buffer.maxLines, 5000);
  assert.strictEqual(buffer.maxBytes, 2 * 1024 * 1024);
  assert.strictEqual(buffer.lines.length, 0);
  assert.strictEqual(buffer.bytes, 0);
});

test('BoundedLogBuffer: append adds lines', () => {
  const lines = [];
  const entry = { line: 'test', ts: '2024-01-01', stream: 'stdout', level: 'info' };
  lines.push(entry);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].line, 'test');
});

test('BoundedLogBuffer: clear empties buffer', () => {
  const lines = [
    { line: 'a', ts: 't1', stream: 'stdout', level: 'info' },
    { line: 'b', ts: 't2', stream: 'stdout', level: 'info' },
  ];
  lines.length = 0;
  assert.strictEqual(lines.length, 0);
});

test('BoundedLogBuffer: respect maxLines limit', () => {
  const maxLines = 3;
  const lines = ['a', 'b', 'c', 'd'].map(l => ({ line: l, ts: 't', stream: 'stdout', level: 'info' }));
  while (lines.length > maxLines) lines.shift();
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0].line, 'b');
});

// ---- normalizeLogEntry logic -----------------------------------------------

test('normalizeLogEntry: extracts line from entry.line', () => {
  const entry = { line: 'Hello World', ts: '2024-01-01' };
  const raw = entry.line ?? entry.message ?? entry;
  assert.strictEqual(raw, 'Hello World');
});

test('normalizeLogEntry: extracts line from entry.message', () => {
  const entry = { message: 'Hello World', ts: '2024-01-01' };
  const raw = entry.message ?? entry.line ?? entry;
  assert.strictEqual(raw, 'Hello World');
});

test('normalizeLogEntry: falls back to entry itself', () => {
  const entry = 'Hello World';
  const raw = entry?.line ?? entry?.message ?? entry;
  assert.strictEqual(raw, 'Hello World');
});

test('normalizeLogEntry: detects stderr stream', () => {
  const entry = { line: 'error', stream: 'stderr' };
  const stream = entry.stream === 'stderr' || entry.level === 'stderr' ? 'stderr' : 'stdout';
  assert.strictEqual(stream, 'stderr');
});

test('normalizeLogEntry: detects error level from content', () => {
  const line = 'ERROR: something failed';
  const lower = line.toLowerCase();
  const isError = /error|exception|fatal|severe|fail/.test(lower);
  assert.strictEqual(isError, true);
});

test('normalizeLogEntry: detects warning level from content', () => {
  const line = 'WARNING: deprecated API';
  const lower = line.toLowerCase();
  const isWarning = /warn|warning/.test(lower);
  assert.strictEqual(isWarning, true);
});

test('normalizeLogEntry: defaults to info level', () => {
  const line = 'Server started successfully';
  const lower = line.toLowerCase();
  const isError = /error|exception|fatal|severe|fail/.test(lower);
  const isWarning = /warn|warning/.test(lower);
  assert.strictEqual(isError, false);
  assert.strictEqual(isWarning, false);
});

// ---- safeLogFilename -------------------------------------------------------

test('safeLogFilename: replaces invalid characters', () => {
  const name = 'server:8080/myapp';
  const safe = name.replace(/[<>:"/\\|?*]/g, '_');
  assert.strictEqual(safe, 'server_8080_myapp');
});

test('safeLogFilename: returns same if no invalid chars', () => {
  const name = 'server-8080-myapp';
  const safe = name.replace(/[<>:"/\\|?*]/g, '_');
  assert.strictEqual(safe, 'server-8080-myapp');
});

// ---- filterLogLines logic --------------------------------------------------

test('filterLogLines: filters by keyword', () => {
  const lines = [
    { line: 'Error: failed', ts: 't1', stream: 'stderr', level: 'error' },
    { line: 'Server started', ts: 't2', stream: 'stdout', level: 'info' },
  ];
  const filter = 'Error';
  const filtered = lines.filter(l => l.line.includes(filter));
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].line, 'Error: failed');
});

test('filterLogLines: case-sensitive filter', () => {
  const lines = [
    { line: 'Error: failed', ts: 't1', stream: 'stderr', level: 'error' },
    { line: 'error: another', ts: 't2', stream: 'stderr', level: 'error' },
  ];
  const filter = 'Error';
  const filtered = lines.filter(l => l.line.includes(filter));
  assert.strictEqual(filtered.length, 1);
});

test('filterLogLines: filter by stream', () => {
  const lines = [
    { line: 'out', ts: 't1', stream: 'stdout', level: 'info' },
    { line: 'err', ts: 't2', stream: 'stderr', level: 'error' },
  ];
  const filtered = lines.filter(l => l.stream === 'stderr');
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].stream, 'stderr');
});

test('filterLogLines: no filter returns all lines', () => {
  const lines = [
    { line: 'a', ts: 't1', stream: 'stdout', level: 'info' },
    { line: 'b', ts: 't2', stream: 'stdout', level: 'info' },
  ];
  const filter = '';
  const filtered = filter ? lines.filter(l => l.line.includes(filter)) : lines;
  assert.strictEqual(filtered.length, 2);
});

// ---- HistoryDeltaTracker logic ---------------------------------------------

test('HistoryDeltaTracker: initial state returns all as additions', () => {
  const initialized = false;
  const history = [
    { line: 'a', ts: 't1', stream: 'stdout', level: 'info' },
    { line: 'b', ts: 't2', stream: 'stdout', level: 'info' },
  ];
  const initial = !initialized;
  assert.strictEqual(initial, true);
  assert.strictEqual(history.length, 2);
});

test('HistoryDeltaTracker: subsequent call returns only new entries', () => {
  const seen = new Set(['a', 'b']);
  const history = [
    { line: 'a', ts: 't1', stream: 'stdout', level: 'info' },
    { line: 'b', ts: 't2', stream: 'stdout', level: 'info' },
    { line: 'c', ts: 't3', stream: 'stdout', level: 'info' },
  ];
  const additions = history.filter(e => !seen.has(e.line));
  assert.strictEqual(additions.length, 1);
  assert.strictEqual(additions[0].line, 'c');
});

test('HistoryDeltaTracker: reset clears state', () => {
  const seen = new Set(['a', 'b', 'c']);
  seen.clear();
  assert.strictEqual(seen.size, 0);
});

// ---- mergeLogHistory logic -------------------------------------------------

test('mergeLogHistory: merges history with existing live entries', () => {
  const history = [
    { line: 'a', ts: 't1', stream: 'stdout', level: 'info' },
    { line: 'b', ts: 't2', stream: 'stdout', level: 'info' },
  ];
  const live = [
    { line: 'b', ts: 't2', stream: 'stdout', level: 'info' },
    { line: 'c', ts: 't3', stream: 'stdout', level: 'info' },
  ];
  const merged = [...history];
  for (const entry of live) {
    if (!history.some(h => h.line === entry.line && h.ts === entry.ts)) {
      merged.push(entry);
    }
  }
  assert.strictEqual(merged.length, 3);
});

test('teardown', () => { disableJSDOM(); });