'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  KairoError,
  FALLBACK_ERROR_CODE,
  unwrapResponse,
  normaliseThrown,
} = require('../../lib/browser/runtime-errors');

// ---- KairoError ------------------------------------------------------------

test('KairoError constructor sets all properties', () => {
  const err = new KairoError({
    code: 'timeout',
    message: 'Request timed out',
    httpStatus: 408,
    details: { timeout: 30000 },
    retryable: true,
    cause: new Error('original'),
  });
  assert.strictEqual(err.name, 'KairoError');
  assert.strictEqual(err.code, 'timeout');
  assert.strictEqual(err.message, 'Request timed out');
  assert.strictEqual(err.httpStatus, 408);
  assert.deepStrictEqual(err.details, { timeout: 30000 });
  assert.strictEqual(err.retryable, true);
  assert.ok(err.observedAt);
  assert.ok(err.cause instanceof Error);
});

test('KairoError defaults retryable to false', () => {
  const err = new KairoError({
    code: 'internal',
    message: 'Something went wrong',
  });
  assert.strictEqual(err.retryable, false);
});

test('KairoError.isTransient: retryable errors are transient', () => {
  const err = new KairoError({
    code: 'internal',
    message: 'x',
    retryable: true,
  });
  assert.strictEqual(err.isTransient(), true);
});

test('KairoError.isTransient: timeout is transient', () => {
  const err = new KairoError({ code: 'timeout', message: 'x' });
  assert.strictEqual(err.isTransient(), true);
});

test('KairoError.isTransient: io_error is transient', () => {
  const err = new KairoError({ code: 'io_error', message: 'x' });
  assert.strictEqual(err.isTransient(), true);
});

test('KairoError.isTransient: process_spawn_failed is transient', () => {
  const err = new KairoError({ code: 'process_spawn_failed', message: 'x' });
  assert.strictEqual(err.isTransient(), true);
});

test('KairoError.isTransient: 5xx httpStatus is transient', () => {
  const err = new KairoError({ code: 'invalid_request', message: 'x', httpStatus: 500 });
  assert.strictEqual(err.isTransient(), true);
});

test('KairoError.isTransient: 4xx httpStatus is not transient', () => {
  const err = new KairoError({ code: 'invalid_request', message: 'x', httpStatus: 400 });
  assert.strictEqual(err.isTransient(), false);
});

test('KairoError.format(): includes code and message', () => {
  const err = new KairoError({ code: 'not_found', message: 'Project not found' });
  assert.ok(err.format().includes('[not_found]'));
  assert.ok(err.format().includes('Project not found'));
});

test('KairoError.format(): includes HTTP status when present', () => {
  const err = new KairoError({ code: 'not_found', message: 'x', httpStatus: 404 });
  assert.ok(err.format().includes('HTTP 404'));
});

test('KairoError.format(): includes cause message when present', () => {
  const err = new KairoError({ code: 'internal', message: 'Failed', cause: new Error('disk full') });
  assert.ok(err.format().includes('disk full'));
});

// ---- FALLBACK_ERROR_CODE ---------------------------------------------------

test('FALLBACK_ERROR_CODE is "internal"', () => {
  assert.strictEqual(FALLBACK_ERROR_CODE, 'internal');
});