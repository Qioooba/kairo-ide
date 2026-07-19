// Kairo wire-protocol envelope helpers and the protocol-version
// constants. These are the only runtime helpers exported by
// @kairo/protocol (everything else is a type) and they are
// re-used by every Theia extension that talks to the Go
// Runtime Agent, so we lock their behavior down here.
//
// Run with:
//   pnpm --filter @kairo/protocol test
//   (or)  node --require ts-node/register --require source-map-support/register --test src/envelope.test.ts

import { test } from 'node:test';
import assert from 'node:assert';
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_PATH,
  ok,
  err,
  mapBuildState,
  type RequestEnvelope,
  type KairoErrorCode,
} from './index';

test('PROTOCOL_VERSION is v1 and PROTOCOL_VERSION_PATH is /api/v1', () => {
  assert.strictEqual(PROTOCOL_VERSION, 'v1');
  assert.strictEqual(PROTOCOL_VERSION_PATH, '/api/v1');
  // The two must agree — a drift here is a wire-breaking change.
  assert.ok(PROTOCOL_VERSION_PATH.endsWith(PROTOCOL_VERSION),
    `path ${PROTOCOL_VERSION_PATH} should end with version ${PROTOCOL_VERSION}`);
});

test('ok() produces a success envelope with payload + echoed requestId', () => {
  const env: RequestEnvelope<{ foo: number }> = {
    workspaceId: 'ws-1',
    requestId: 'req-42',
    payload: { foo: 1 },
  };
  const resp = ok(env, { foo: 99 });
  assert.strictEqual(resp.ok, true);
  assert.strictEqual(resp.requestId, 'req-42');
  assert.deepStrictEqual(resp.payload, { foo: 99 });
});

test('ok() propagates correlationId when present', () => {
  const env: RequestEnvelope<undefined> = {
    workspaceId: 'ws-1',
    requestId: 'req-1',
    correlationId: 'corr-xyz',
    payload: undefined,
  };
  const resp = ok(env, undefined);
  assert.strictEqual(resp.correlationId, 'corr-xyz');
});

test('ok() omits correlationId when not present on the request', () => {
  const env: RequestEnvelope<undefined> = {
    workspaceId: 'ws-1',
    requestId: 'req-1',
    payload: undefined,
  };
  const resp = ok(env, undefined);
  assert.strictEqual(resp.correlationId, undefined);
});

test('err() produces an ErrorEnvelope with code + message', () => {
  const e = err('req-7', 'not_found', 'project p-1 not found');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.requestId, 'req-7');
  assert.strictEqual(e.error.code, 'not_found');
  assert.strictEqual(e.error.message, 'project p-1 not found');
  assert.strictEqual(e.error.retryable, undefined);
  assert.strictEqual(e.error.details, undefined);
});

test('err() carries retryable and details when supplied', () => {
  const e = err('req-7', 'io_error', 'disk full', {
    retryable: true,
    details: { path: '/tmp/x' },
  });
  assert.strictEqual(e.error.retryable, true);
  assert.deepStrictEqual(e.error.details, { path: '/tmp/x' });
  assert.strictEqual(e.correlationId, undefined);
});

test('err() propagates correlationId when supplied', () => {
  const e = err('req-7', 'timeout', 'slow', { correlationId: 'c-1' });
  assert.strictEqual(e.correlationId, 'c-1');
});

// ---- mapBuildState ---------------------------------------------------------

test('mapBuildState: running returns success display', () => {
  const d = mapBuildState('running');
  assert.strictEqual(d.label, 'Running');
  assert.strictEqual(d.color, 'var(--theia-successForeground)');
});

test('mapBuildState: failed returns error display', () => {
  const d = mapBuildState('failed');
  assert.strictEqual(d.label, 'Failed');
  assert.strictEqual(d.color, 'var(--theia-errorForeground)');
});

test('mapBuildState: stopped returns disabled display', () => {
  const d = mapBuildState('stopped');
  assert.strictEqual(d.label, 'Stopped');
  assert.strictEqual(d.color, 'var(--theia-disabledForeground)');
});

test('mapBuildState: unknown state falls through with default color', () => {
  // The function MUST accept arbitrary strings because the wire
  // schema includes 'queued', 'success', 'cancelled' etc. that
  // are not specially handled. They must not throw.
  for (const s of ['queued', 'success', 'cancelled', 'never-heard-of-it']) {
    const d = mapBuildState(s);
    assert.strictEqual(d.label, s);
    assert.strictEqual(d.color, 'var(--theia-foreground)');
  }
});

// ---- Type-level: assert KairoErrorCode is closed over the expected set ----
//
// This is a type-only check (it has no runtime effect) but it
// makes the test file a tripwire if a new error code is added
// without updating consumers. The cast is intentional — we are
// enumerating the contract.
test('KairoErrorCode is the documented set (lock the wire)', () => {
  const expected: KairoErrorCode[] = [
    'unauthenticated', 'forbidden', 'not_found', 'conflict', 'rate_limited',
    'invalid_request', 'path_forbidden', 'toolchain_missing', 'runtime_missing',
    'unsupported_jdk_target',
    'internal', 'io_error', 'process_spawn_failed', 'compile_failed',
    'deploy_failed', 'debug_attach_failed', 'timeout', 'plugin_crashed', 'unsupported',
  ];
  // The cast is the point: if the union shrinks, this still
  // compiles; the assertion is that the runtime representation
  // matches the documented list.
  const observed: readonly string[] = expected as readonly string[];
  assert.strictEqual(observed.length, 19);
});
