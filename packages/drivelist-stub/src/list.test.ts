// drivelist — contract tests for the pure-JS drive listing implementation.
//
// Run with:
//   pnpm --filter drivelist test

import { test } from 'node:test';
import assert from 'node:assert';
import os from 'os';
import { list, listCallback, default as defaultExport } from './index';

test('list() resolves to an array', async () => {
  const drives = await list();
  assert.ok(Array.isArray(drives), 'list() must return an array');
  assert.ok(drives.length > 0, 'list() must return at least one drive');
});

test('list() always resolves — never rejects', async () => {
  await assert.doesNotReject(list());
});

test('listCallback() invokes the callback with (null, drives)', () => {
  let called = 0;
  let err: Error | null = new Error('sentinel');
  let drives: unknown = 'sentinel';
  listCallback((e, d) => {
    called++;
    err = e;
    drives = d;
  });
  assert.strictEqual(called, 1);
  assert.strictEqual(err, null);
  assert.ok(Array.isArray(drives));
  assert.ok((drives as unknown[]).length > 0);
});

test('listCallback() is synchronous (no Promise leaks)', () => {
  let calledSync = false;
  listCallback(() => { calledSync = true; });
  assert.strictEqual(calledSync, true);
});

test('default export exposes list and listCallback', () => {
  assert.strictEqual(typeof defaultExport.list, 'function');
  assert.strictEqual(typeof defaultExport.listCallback, 'function');
  assert.strictEqual(defaultExport.list, list);
  assert.strictEqual(defaultExport.listCallback, listCallback);
});

test('list() returns a new array on each call (no shared mutable state)', async () => {
  const a = await list();
  const b = await list();
  assert.notStrictEqual(a, b, 'list() must not return a cached array');
});

test('Windows drives use X:\\ mountpoint paths', async () => {
  if (os.platform() !== 'win32') {
    return;
  }
  const drives = await list();
  assert.ok(drives.some(d => d.mountpoints.some(m => /^[A-Z]:\\$/.test(m.path)),
    'expected at least one drive with an X:\\ mountpoint'));
});

test('Unix returns root mount', async () => {
  if (os.platform() === 'win32') {
    return;
  }
  const drives = await list();
  assert.ok(drives.some(d => d.mountpoints.some(m => m.path === '/')));
});
