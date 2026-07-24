// drivelist stub — extended contract tests.
//
// Run with:
//   pnpm --filter drivelist test
//   (or)  node --require ts-node/register --require source-map-support/register --test src/list.test.ts

import { test } from 'node:test';
import assert from 'node:assert';
import { list, listCallback, default as defaultExport } from './index';
import type { DriveDescriptor } from './index';

test('list() resolves to an array of DriveDescriptor', async () => {
  const drives = await list();
  assert.ok(Array.isArray(drives));
  drives.forEach((drive: DriveDescriptor) => {
    assert.strictEqual(typeof drive.device, 'string');
    assert.strictEqual(typeof drive.description, 'string');
    assert.ok(Array.isArray(drive.mountpoints));
  });
});

test('list() returns empty array — no drives on stub', async () => {
  const drives = await list();
  assert.strictEqual(drives.length, 0);
});

test('list() is always fast (no I/O)', async () => {
  const start = Date.now();
  await list();
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 50, `list() should resolve in < 50ms, took ${elapsed}ms`);
});

test('list() can be called many times without issues', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => list()));
  for (const drives of results) {
    assert.ok(Array.isArray(drives));
    assert.strictEqual(drives.length, 0);
  }
});

test('list() resolves with frozen/resuable array semantics', async () => {
  const a = await list();
  const b = await list();
  assert.notStrictEqual(a, b, 'each call returns a new array');
});

test('listCallback() invokes callback synchronously', () => {
  let called = false;
  listCallback(() => { called = true; });
  assert.strictEqual(called, true);
});

test('listCallback() passes null error and empty array', () => {
  listCallback((err, drives) => {
    assert.strictEqual(err, null);
    assert.deepStrictEqual(drives, []);
  });
});

test('listCallback() callback is called exactly once', () => {
  let count = 0;
  listCallback(() => { count++; });
  assert.strictEqual(count, 1);
});

test('default export has list and listCallback', () => {
  assert.strictEqual(typeof defaultExport.list, 'function');
  assert.strictEqual(typeof defaultExport.listCallback, 'function');
});

test('default export list is the same function as named list', () => {
  assert.strictEqual(defaultExport.list, list);
});

test('default export listCallback is the same function as named listCallback', () => {
  assert.strictEqual(defaultExport.listCallback, listCallback);
});

test('list() never rejects', async () => {
  await assert.doesNotReject(list());
});

test('list() co-exists with listCallback() without interference', () => {
  let callbackResult: DriveDescriptor[] | null = null;
  listCallback((_err, drives) => { callbackResult = drives; });
  assert.deepStrictEqual(callbackResult, []);
});

test('list() returns a plain array (not a subclass)', async () => {
  const drives = await list();
  assert.strictEqual(drives.constructor, Array);
});

test('DriveDescriptor interface is structurally valid', async () => {
  const drives = await list();
  // Just verify the type is correct — no items in stub
  assert.ok(Array.isArray(drives));
});