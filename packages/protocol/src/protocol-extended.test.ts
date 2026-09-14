// protocol — extended contract tests for wire protocol types and helpers.
//
// Run with:
//   pnpm --filter @kairo/protocol test
//   (or)  node --require ts-node/register --require source-map-support/register --test src/protocol-extended.test.ts

import { test } from 'node:test';
import assert from 'node:assert';
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_PATH,
  ok,
  err,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ErrorEnvelope,
  type KairoErrorCode,
} from './index';

// ---- ok() helper -----------------------------------------------------------

test('ok() with null payload', () => {
  const env: RequestEnvelope<null> = {
    workspaceId: 'ws-1',
    requestId: 'req-1',
    payload: null,
  };
  const resp = ok(env, null);
  assert.strictEqual(resp.ok, true);
  assert.strictEqual(resp.payload, null);
});

test('ok() with complex nested payload', () => {
  const env: RequestEnvelope<{ nested: { deep: boolean } }> = {
    workspaceId: 'ws-1',
    requestId: 'req-1',
    payload: { nested: { deep: true } },
  };
  const resp = ok(env, { nested: { deep: false } });
  assert.strictEqual(resp.payload.nested.deep, false);
});

test('ok() preserves requestId exactly', () => {
  const ids = ['req-1', 'abc-123', '', '👋'];
  for (const id of ids) {
    const env: RequestEnvelope<undefined> = {
      workspaceId: 'ws-1',
      requestId: id,
      payload: undefined,
    };
    const resp = ok(env, undefined);
    assert.strictEqual(resp.requestId, id);
  }
});

test('ok() without correlationId produces undefined correlationId', () => {
  const env: RequestEnvelope<undefined> = {
    workspaceId: 'ws-1',
    requestId: 'req-1',
    payload: undefined,
  };
  const resp = ok(env, undefined);
  assert.strictEqual(resp.correlationId, undefined);
});

// ---- err() helper ----------------------------------------------------------

test('err() with all options', () => {
  const e = err('req-1', 'timeout', 'Request timed out', {
    correlationId: 'corr-1',
    details: { timeout: 30000 },
    retryable: true,
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.requestId, 'req-1');
  assert.strictEqual(e.correlationId, 'corr-1');
  assert.strictEqual(e.error.code, 'timeout');
  assert.strictEqual(e.error.message, 'Request timed out');
  assert.strictEqual(e.error.retryable, true);
  assert.deepStrictEqual(e.error.details, { timeout: 30000 });
});

test('err() with no options', () => {
  const e = err('req-1', 'internal', 'Something went wrong');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.error.retryable, undefined);
  assert.strictEqual(e.error.details, undefined);
  assert.strictEqual(e.correlationId, undefined);
});

test('err() with retryable false', () => {
  const e = err('req-1', 'forbidden', 'Access denied', { retryable: false });
  assert.strictEqual(e.error.retryable, false);
});

test('err() with all 23 error codes', () => {
  const codes: KairoErrorCode[] = [
    'unauthenticated', 'forbidden', 'not_found', 'conflict', 'rate_limited',
    'invalid_request', 'path_forbidden', 'toolchain_missing', 'runtime_missing',
    'unsupported_jdk_target', 'target_ambiguous', 'target_not_found', 'stale_target',
    'internal', 'io_error', 'process_spawn_failed', 'compile_failed',
    'deploy_failed', 'debug_attach_failed', 'cancelled', 'timeout', 'plugin_crashed', 'unsupported',
  ];
  for (const code of codes) {
    const e = err('req-1', code, `Error: ${code}`);
    assert.strictEqual(e.error.code, code);
    assert.strictEqual(e.ok, false);
  }
});

// ---- PROTOCOL_VERSION constants --------------------------------------------

test('PROTOCOL_VERSION and PROTOCOL_VERSION_PATH are consistent', () => {
  assert.strictEqual(PROTOCOL_VERSION, 'v1');
  assert.strictEqual(PROTOCOL_VERSION_PATH, '/api/v1');
  assert.ok(PROTOCOL_VERSION_PATH.includes(PROTOCOL_VERSION));
});

// ---- Type-checking: Envelope types are compatible ---------------------------

test('ResponseEnvelope and ErrorEnvelope are discriminated by ok field', () => {
  const success: ResponseEnvelope<string> = {
    requestId: 'r1',
    ok: true,
    payload: 'data',
  };
  assert.strictEqual(success.ok, true);

  const failure: ErrorEnvelope = {
    requestId: 'r1',
    ok: false,
    error: { code: 'not_found', message: 'Not found' },
  };
  assert.strictEqual(failure.ok, false);
  assert.strictEqual(failure.error.code, 'not_found');
});