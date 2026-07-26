// findFreePort — edge-case and error-path tests.
//
// Run with:
//   pnpm --filter @kairo/protocol test

import { test } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'net';
import { findFreePort } from './network';

test('findFreePort returns a port in valid range', async () => {
  const port = await findFreePort();
  assert.ok(port >= 1024 || port === 0, `port should be >= 1024 or 0 for ephemeral, got ${port}`);
  assert.ok(port < 65536, `port should be < 65536, got ${port}`);
});

test('findFreePort port is bindable immediately', async () => {
  const port = await findFreePort();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('findFreePort returns unique ports under high concurrency', async () => {
  const ports = await Promise.all(
    Array.from({ length: 20 }, () => findFreePort()),
  );
  const unique = new Set(ports);
  assert.strictEqual(unique.size, ports.length,
    `expected ${ports.length} unique ports, got ${unique.size}`);
});

test('findFreePort resolves in reasonable time (< 100ms)', async () => {
  const start = Date.now();
  await findFreePort();
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 100, `findFreePort should resolve in < 100ms, took ${elapsed}ms`);
});

test('findFreePort can be called repeatedly without resource leaks', async () => {
  // Call 50 times sequentially — should not leak file descriptors or ports
  for (let i = 0; i < 50; i++) {
    const port = await findFreePort();
    assert.ok(port > 0);
    assert.ok(port < 65536);
  }
});

test('findFreePort returns a number type', async () => {
  const port = await findFreePort();
  assert.strictEqual(typeof port, 'number');
});

test('findFreePort is always a Promise', () => {
  const result = findFreePort();
  assert.ok(result instanceof Promise);
  // Clean up
  result.catch(() => {});
});

test('findFreePort returns listenable port on 127.0.0.1', async () => {
  const port = await findFreePort();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      assert.ok(typeof addr === 'object' && addr !== null);
      assert.strictEqual((addr as any).address, '127.0.0.1');
      resolve();
    });
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});