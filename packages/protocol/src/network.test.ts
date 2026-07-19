// findFreePort — real network behavior, not a stub.
//
// Verifies that the port discovery helper used by both the
// desktop main process and the test agent entry returns a port
// that is actually bindable on 127.0.0.1, and that two
// consecutive calls return two distinct ports (the OS must
// recycle, not cache).
//
// Run with:
//   pnpm --filter @kairo/protocol test
//   (or)  node --require ts-node/register --require source-map-support/register --test src/network.test.ts

import { test } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'net';
import { findFreePort } from './network';

test('findFreePort returns a positive integer', async () => {
  const port = await findFreePort();
  assert.ok(Number.isInteger(port), `port should be an integer, got ${port}`);
  assert.ok(port > 0, `port should be > 0, got ${port}`);
  assert.ok(port < 65536, `port should be < 65536, got ${port}`);
});

test('findFreePort returns a port that is actually free for rebind', async () => {
  const port = await findFreePort();
  // After findFreePort closes its server, the port should be free
  // again — a new server should be able to bind it.
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('findFreePort returns distinct ports on consecutive calls', async () => {
  // The OS should not hand out the same port twice in a row
  // when the previous one was just closed — otherwise two
  // Kairo services launched back-to-back would collide.
  const p1 = await findFreePort();
  const p2 = await findFreePort();
  assert.notStrictEqual(p1, p2, `expected two distinct ports, got ${p1} twice`);
});

test('findFreePort is reentrant under concurrent calls', async () => {
  // Launch 5 calls in parallel — each must get its own port
  // and all ports must be distinct.
  const ports = await Promise.all(
    Array.from({ length: 5 }, () => findFreePort())
  );
  const unique = new Set(ports);
  assert.strictEqual(unique.size, ports.length,
    `expected 5 distinct ports, got ${JSON.stringify(ports)}`);
});
