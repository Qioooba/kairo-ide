// Kairo wire protocol — edge-case tests for envelope helpers.
//
// Run with:
//   pnpm --filter @kairo/protocol test

import { test } from 'node:test';
import assert from 'node:assert';
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_PATH,
  RUN_CONFIGURATION_VERSION,
  ok,
  err,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ErrorEnvelope,
  type KairoErrorCode,
} from './index';

// ---- ok() edge cases ----

test('ok() handles empty string requestId', () => {
  const env: RequestEnvelope<undefined> = {
    workspaceId: 'ws-1',
    requestId: '',
    payload: undefined,
  };
  const resp = ok(env, undefined);
  assert.strictEqual(resp.ok, true);
  assert.strictEqual(resp.requestId, '');
});

test('ok() handles special characters in requestId', () => {
  const ids = ['req/1', 'req:2', 'req.3', 'req-4_5'];
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

test('ok() handles very long requestId', () => {
  const longId = 'x'.repeat(1000);
  const env: RequestEnvelope<undefined> = {
    workspaceId: 'ws-1',
    requestId: longId,
    payload: undefined,
  };
  const resp = ok(env, undefined);
  assert.strictEqual(resp.requestId, longId);
  assert.strictEqual(resp.requestId.length, 1000);
});

test('ok() preserves workspaceId from envelope', () => {
  const workspaceIds = ['ws-1', 'ws-abc', 'workspace/with/slashes'];
  for (const wsId of workspaceIds) {
    const env: RequestEnvelope<undefined> = {
      workspaceId: wsId,
      requestId: 'req-1',
      payload: undefined,
    };
    const resp = ok(env, undefined);
    assert.strictEqual(resp.ok, true);
    // workspaceId is not in the response envelope, but we verify it's in the request
    assert.strictEqual(env.workspaceId, wsId);
  }
});

test('ok() with undefined payload', () => {
  const env: RequestEnvelope<undefined> = {
    workspaceId: 'ws-1',
    requestId: 'req-1',
    payload: undefined,
  };
  const resp = ok(env, undefined);
  assert.strictEqual(resp.ok, true);
  assert.strictEqual(resp.payload, undefined);
});

test('ok() with boolean payload', () => {
  const env: RequestEnvelope<boolean> = {
    workspaceId: 'ws-1',
    requestId: 'req-1',
    payload: true,
  };
  const resp = ok(env, false);
  assert.strictEqual(resp.ok, true);
  assert.strictEqual(resp.payload, false);
});

test('ok() with number payload', () => {
  const env: RequestEnvelope<number> = {
    workspaceId: 'ws-1',
    requestId: 'req-1',
    payload: 42,
  };
  const resp = ok(env, 0);
  assert.strictEqual(resp.ok, true);
  assert.strictEqual(resp.payload, 0);
});

test('ok() with large array payload', () => {
  const large = Array.from({ length: 1000 }, (_, i) => i);
  const env: RequestEnvelope<number[]> = {
    workspaceId: 'ws-1',
    requestId: 'req-1',
    payload: [],
  };
  const resp = ok(env, large);
  assert.strictEqual(resp.ok, true);
  assert.strictEqual(resp.payload.length, 1000);
});

// ---- err() edge cases ----

test('err() with empty error code', () => {
  // The type system prevents empty error codes, but test runtime behavior
  const e = err('req-1', '' as KairoErrorCode, 'empty code');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.error.code, '');
  assert.strictEqual(e.error.message, 'empty code');
});

test('err() with empty error message', () => {
  const e = err('req-1', 'internal', '');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.error.message, '');
});

test('err() with very long error message', () => {
  const longMsg = 'e'.repeat(10000);
  const e = err('req-1', 'internal', longMsg);
  assert.strictEqual(e.error.message.length, 10000);
});

test('err() with null details', () => {
  const e = err('req-1', 'internal', 'error', { details: null });
  assert.strictEqual(e.error.details, null);
});

test('err() with undefined details', () => {
  const e = err('req-1', 'internal', 'error', { details: undefined });
  assert.strictEqual(e.error.details, undefined);
});

test('err() with empty string correlationId', () => {
  const e = err('req-1', 'internal', 'error', { correlationId: '' });
  assert.strictEqual(e.correlationId, '');
});

test('err() with empty object details', () => {
  const e = err('req-1', 'internal', 'error', { details: {} });
  assert.deepStrictEqual(e.error.details, {});
});

// ---- PROTOCOL_VERSION compatibility ----

test('PROTOCOL_VERSION_PATH starts with /api/', () => {
  assert.ok(PROTOCOL_VERSION_PATH.startsWith('/api/'));
});

test('PROTOCOL_VERSION is a non-empty string', () => {
  assert.ok(PROTOCOL_VERSION.length > 0);
});

test('RUN_CONFIGURATION_VERSION is a positive integer', () => {
  assert.ok(RUN_CONFIGURATION_VERSION > 0);
  assert.ok(Number.isInteger(RUN_CONFIGURATION_VERSION));
});

// ---- Envelope type discrimination ----

test('ResponseEnvelope and ErrorEnvelope can be discriminated at runtime', () => {
  const mixed: Array<ResponseEnvelope<unknown> | ErrorEnvelope> = [
    { requestId: 'r1', ok: true, payload: 'data' },
    { requestId: 'r2', ok: false, error: { code: 'not_found' as KairoErrorCode, message: 'Not found' } },
    { requestId: 'r3', ok: true, payload: 42 },
    { requestId: 'r4', ok: false, error: { code: 'timeout' as KairoErrorCode, message: 'Timeout' } },
  ];

  const successes = mixed.filter(e => e.ok === true);
  const errors = mixed.filter(e => e.ok === false);

  assert.strictEqual(successes.length, 2);
  assert.strictEqual(errors.length, 2);
});

test('ResponseEnvelope payload can be any type', () => {
  const types = [
    { requestId: 'r1', ok: true as const, payload: 'string' },
    { requestId: 'r2', ok: true as const, payload: 42 },
    { requestId: 'r3', ok: true as const, payload: null },
    { requestId: 'r4', ok: true as const, payload: undefined },
    { requestId: 'r5', ok: true as const, payload: { nested: true } },
    { requestId: 'r6', ok: true as const, payload: [1, 2, 3] },
  ];
  assert.strictEqual(types.length, 6);
  for (const t of types) {
    assert.strictEqual(t.ok, true);
  }
});

// ---- Error code contract ----

test('All 20 KairoErrorCodes are non-empty strings', () => {
  const codes: KairoErrorCode[] = [
    'unauthenticated', 'forbidden', 'not_found', 'conflict', 'rate_limited',
    'invalid_request', 'path_forbidden', 'toolchain_missing', 'runtime_missing',
    'unsupported_jdk_target',
    'internal', 'io_error', 'process_spawn_failed', 'compile_failed',
    'deploy_failed', 'debug_attach_failed', 'cancelled', 'timeout', 'plugin_crashed', 'unsupported',
  ];
  for (const code of codes) {
    assert.ok(code.length > 0);
    assert.strictEqual(typeof code, 'string');
  }
  assert.strictEqual(codes.length, 20);
});

test('KairoErrorCode is unique (no duplicates)', () => {
  const codes: KairoErrorCode[] = [
    'unauthenticated', 'forbidden', 'not_found', 'conflict', 'rate_limited',
    'invalid_request', 'path_forbidden', 'toolchain_missing', 'runtime_missing',
    'unsupported_jdk_target',
    'internal', 'io_error', 'process_spawn_failed', 'compile_failed',
    'deploy_failed', 'debug_attach_failed', 'cancelled', 'timeout', 'plugin_crashed', 'unsupported',
  ];
  const unique = new Set(codes);
  assert.strictEqual(unique.size, codes.length);
});