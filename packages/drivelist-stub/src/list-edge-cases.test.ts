// drivelist stub — edge-case and error-path tests.
//
// Run with:
//   pnpm --filter drivelist test

import { test } from 'node:test';
import assert from 'node:assert';
import { list, listCallback, default as defaultExport } from './index';
import type { DriveDescriptor } from './index';

// ---- Concurrent calls ----

test('list() handles 100 concurrent calls without errors', async () => {
  const results = await Promise.all(
    Array.from({ length: 100 }, () => list()),
  );
  for (const drives of results) {
    assert.ok(Array.isArray(drives));
    assert.strictEqual(drives.length, 0);
  }
});

test('list() concurrent calls all return distinct arrays', async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, () => list()),
  );
  // Every result should be a different array instance
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      assert.notStrictEqual(results[i], results[j],
        `concurrent calls ${i} and ${j} returned the same array`);
    }
  }
});

// ---- Error path: listCallback never calls with error ----

test('listCallback() never passes a non-null error', () => {
  let errValue: Error | null = new Error('sentinel');
  listCallback((e) => { errValue = e; });
  assert.strictEqual(errValue, null);
});

test('listCallback() callback is invoked exactly once per call', () => {
  let count = 0;
  listCallback(() => { count++; });
  assert.strictEqual(count, 1);
  // Call again, should still be exactly once per invocation
  let count2 = 0;
  listCallback(() => { count2++; });
  assert.strictEqual(count2, 1);
});

// ---- Error path: list() never rejects ----

test('list() never rejects even when called in rapid succession', async () => {
  for (let i = 0; i < 100; i++) {
    await assert.doesNotReject(list());
  }
});

test('list() and listCallback() can be interleaved without issues', async () => {
  const promises: Promise<DriveDescriptor[]>[] = [];
  const callbackResults: DriveDescriptor[][] = [];

  // Mix Promise-based and callback-based calls
  promises.push(list());
  listCallback((_e, drives) => callbackResults.push(drives));
  promises.push(list());
  listCallback((_e, drives) => callbackResults.push(drives));
  promises.push(list());

  const promiseResults = await Promise.all(promises);
  for (const drives of promiseResults) {
    assert.strictEqual(drives.length, 0);
  }
  for (const drives of callbackResults) {
    assert.strictEqual(drives.length, 0);
  }
});

// ---- Edge case: return value immutability ----

test('list() result is not affected by mutating a previous result', async () => {
  const a = await list();
  // Mutate the previous result
  a.push({ device: 'fake', description: 'fake', mountpoints: [] } as any);
  const b = await list();
  assert.strictEqual(b.length, 0, 'mutating previous result should not affect new calls');
});

// ---- Default export edge cases ----

test('default export is a plain object', () => {
  assert.strictEqual(typeof defaultExport, 'object');
  assert.notStrictEqual(defaultExport, null);
});

test('default export has exactly list and listCallback', () => {
  const keys = Object.keys(defaultExport);
  assert.deepStrictEqual(keys.sort(), ['list', 'listCallback']);
});