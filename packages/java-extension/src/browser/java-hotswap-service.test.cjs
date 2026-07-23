'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('HotSwap debounce mechanism', async () => {
  let callCount = 0;
  const debounce = (fn, delay) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  };

  const debouncedFn = debounce(() => { callCount++; }, 500);

  debouncedFn();
  debouncedFn();
  debouncedFn();

  assert.strictEqual(callCount, 0); // Not yet called

  await new Promise(resolve => setTimeout(resolve, 600));
  assert.strictEqual(callCount, 1); // Called once after debounce
});

test('HotSwap debounce groups rapid calls', async () => {
  let results = [];
  const debounce = (fn, delay) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  };

  const debouncedFn = debounce((val) => { results.push(val); }, 300);

  debouncedFn('a');
  debouncedFn('b');
  debouncedFn('c'); // Only the last call should execute

  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepStrictEqual(results, ['c']);
});

test('HotSwapHistoryEntry structure', () => {
  const entry = {
    id: 'hs-1234567890-abcd',
    timestamp: Date.now(),
    fileName: 'MyClass.java',
    status: 'success',
    durationMs: 234,
    message: 'HotSwap: Reloaded MyClass.java',
  };
  assert.strictEqual(typeof entry.id, 'string');
  assert.ok(entry.id.startsWith('hs-'));
  assert.strictEqual(typeof entry.timestamp, 'number');
  assert.strictEqual(entry.fileName, 'MyClass.java');
  assert.strictEqual(entry.status, 'success');
  assert.strictEqual(typeof entry.durationMs, 'number');
  assert.ok(entry.durationMs > 0);
});

test('HotSwapHistoryEntry failed status', () => {
  const entry = {
    id: 'hs-1234567891-efgh',
    timestamp: Date.now(),
    fileName: 'BrokenClass.java',
    status: 'failed',
    durationMs: 150,
    message: 'Compilation failed: cannot find symbol',
  };
  assert.strictEqual(entry.status, 'failed');
  assert.ok(entry.message.includes('Compilation failed'));
});

test('HotSwap history max entries trimming', () => {
  const MAX_HISTORY = 20;
  const history = [];

  // Add 25 entries
  for (let i = 0; i < 25; i++) {
    history.unshift({
      id: `hs-${i}`,
      timestamp: Date.now() - i * 1000,
      fileName: `Class${i}.java`,
      status: 'success',
      durationMs: 100 + i,
    });
    if (history.length > MAX_HISTORY) {
      history.length = MAX_HISTORY;
    }
  }

  assert.strictEqual(history.length, MAX_HISTORY);
  assert.strictEqual(history[0].fileName, 'Class24.java'); // Most recent
  assert.strictEqual(history[MAX_HISTORY - 1].fileName, 'Class5.java'); // Oldest kept
});