'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BoundedLogBuffer, filterLogLines, HistoryDeltaTracker, mergeLogHistory, normalizeLogEntry, safeLogFilename } = require('../../lib/browser/log-buffer');

const line = (value, stream = 'stdout') => ({ line: value, ts: 't', stream, level: stream === 'stderr' ? 'error' : 'info' });

test('BoundedLogBuffer evicts the oldest lines at its count limit', () => {
  const buffer = new BoundedLogBuffer(2, 1024);
  buffer.append(line('one'), line('two'), line('three'));
  assert.deepEqual(buffer.snapshot.map(entry => entry.line), ['two', 'three']);
});

test('BoundedLogBuffer enforces its UTF-8 byte limit and rejects oversized entries', () => {
  const buffer = new BoundedLogBuffer(10, 14);
  buffer.append(line('one'), line('two'));
  assert.deepEqual(buffer.snapshot.map(entry => entry.line), ['two']);
  const before = buffer.byteLength;
  buffer.append(line('this entry is too large'));
  assert.equal(buffer.byteLength, before);
  assert.deepEqual(buffer.snapshot.map(entry => entry.line), ['two']);
});

test('normalizeLogEntry preserves streams and recognizes structured payloads', () => {
  assert.equal(normalizeLogEntry({ line: 'ready', level: 'stdout', ts: '1' }).stream, 'stdout');
  assert.deepEqual(normalizeLogEntry({ line: 'SEVERE failure', level: 'stderr', ts: '2' }), {
    line: 'SEVERE failure', ts: '2', stream: 'stderr', level: 'error'
  });
  const structured = normalizeLogEntry({ message: { event: 'deployed' }, ts: '3' });
  assert.equal(structured.stream, 'structured');
  assert.equal(structured.line, '{"event":"deployed"}');
});

test('filterLogLines combines case-insensitive text and stream filters', () => {
  const lines = [line('Started TOMCAT'), line('failed deploy', 'stderr')];
  assert.deepEqual(filterLogLines(lines, 'tomcat', 'all').map(entry => entry.line), ['Started TOMCAT']);
  assert.deepEqual(filterLogLines(lines, '', 'stderr').map(entry => entry.line), ['failed deploy']);
});

test('mergeLogHistory preserves live lines received during history loading without duplicates', () => {
  const history = [line('old'), line('overlap')];
  const live = [line('overlap'), line('new')];
  assert.deepEqual(mergeLogHistory(history, live).map(entry => entry.line), ['old', 'overlap', 'new']);
});

test('mergeLogHistory uses ordinal identity when present (WS vs poll)', () => {
  const history = [{ line: 'same', ts: 't1', stream: 'stdout', level: 'info', source: 'catalina', ordinal: 1 }];
  const live = [{ line: 'same', ts: 't2', stream: 'stdout', level: 'info', source: 'catalina', ordinal: 1 }];
  assert.equal(mergeLogHistory(history, live).length, 1, 'same source+ordinal must collapse');
});

test('mergeLogHistory keeps distinct ordinals even with identical ts/line', () => {
  const a = { line: 'tick', ts: 't', stream: 'stdout', level: 'info', source: 'catalina', ordinal: 1 };
  const b = { line: 'tick', ts: 't', stream: 'stdout', level: 'info', source: 'catalina', ordinal: 2 };
  assert.equal(mergeLogHistory([a], [b]).length, 2);
});

test('HistoryDeltaTracker suppresses repeated polls and clear-time history, then handles append and rotation', () => {
  const tracker = new HistoryDeltaTracker();
  const persisted = (value, ordinal) => ({ ...line(value), source: 'kairo.log', ordinal });
  const first = [persisted('one', 0), persisted('two', 4)];
  assert.deepEqual(tracker.next(first).additions.map(entry => entry.line), ['one', 'two']);
  assert.equal(tracker.next(first).additions.length, 0, 'identical poll must not duplicate lines');
  assert.equal(tracker.next(first).additions.length, 0, 'clearing the view does not reset the history watermark');
  assert.deepEqual(tracker.next([...first, persisted('three', 8)]).additions.map(entry => entry.line), ['three']);
  assert.deepEqual(tracker.next([persisted('rotated', 0)]).additions.map(entry => entry.line), ['rotated']);
});

test('safeLogFilename removes path characters and has an empty-id fallback', () => {
  assert.equal(safeLogFilename('../server one'), 'kairo-tomcat-___server_one.log');
  assert.equal(safeLogFilename(''), 'kairo-tomcat-logs.log');
});

test('clear removes only the in-memory view', () => {
  const buffer = new BoundedLogBuffer();
  buffer.append(line('kept on disk'));
  buffer.clear();
  assert.equal(buffer.snapshot.length, 0);
  assert.equal(buffer.byteLength, 0);
});
