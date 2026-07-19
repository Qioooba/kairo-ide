// drivelist stub — contract test.
//
// The real drivelist package is a native binding that does
// not build on Windows in this repo's CI. The stub is a
// drop-in replacement: it returns an empty array. This test
// pins that contract so a future change to the stub (or an
// accidental upgrade to the real native binding) does not
// silently break the workspace picker.
//
// Run with:
//   pnpm --filter drivelist test
//   (or)  node --require ts-node/register --require source-map-support/register --test src/list.test.ts

import { test } from 'node:test';
import assert from 'node:assert';
import { list, listCallback, default as defaultExport } from './index';

test('list() resolves to an empty array', async () => {
  const drives = await list();
  assert.ok(Array.isArray(drives), 'list() must return an array');
  assert.strictEqual(drives.length, 0,
    'drivelist stub must return 0 drives; Kairo asks the user for a workspace path explicitly');
});

test('list() always resolves — never rejects', async () => {
  // The upstream `drivelist.list()` callback API may emit
  // an error on systems where the native binding fails to
  // load. The stub MUST NOT reject — that would crash
  // EnvVariablesServer.getDrives() on startup.
  await assert.doesNotReject(list());
});

test('listCallback() invokes the callback with (null, [])', () => {
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
  assert.deepStrictEqual(drives, []);
});

test('listCallback() is synchronous (no Promise leaks)', () => {
  // The upstream callback API is sync. The stub must also be
  // sync so existing call sites that don't await still work.
  let calledSync = false;
  listCallback(() => { calledSync = true; });
  assert.strictEqual(calledSync, true);
});

test('default export exposes list and listCallback', () => {
  // Theia/theia-filesystem require()'s the package and then
  // calls defaultExport.list(...). Pin the surface.
  assert.strictEqual(typeof defaultExport.list, 'function');
  assert.strictEqual(typeof defaultExport.listCallback, 'function');
  assert.strictEqual(defaultExport.list, list);
  assert.strictEqual(defaultExport.listCallback, listCallback);
});

test('list() returns a new array on each call (no shared mutable state)', async () => {
  // If the stub ever returns a cached array, a downstream
  // caller that mutates it (e.g. drives.push(...)) would
  // poison the next call. Pin that each call is independent.
  const a = await list();
  const b = await list();
  assert.notStrictEqual(a, b, 'list() must not return a cached array');
});
