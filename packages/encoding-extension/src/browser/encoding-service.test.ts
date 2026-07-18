// Encoding service unit tests — covers the encoding contract
// that the user relies on in the "Reopen with Encoding" and
// "Save with Encoding" commands.
//
// Imports the production source directly — no copy-paste of
// business logic. If the production code changes, this test
// verifies the contract against the real implementation.
//
// Run with:
//   pnpm --filter @kairo/encoding-extension test

import { test } from 'node:test';
import assert from 'node:assert';
import {
  KAIRO_ENCODING_OPTIONS,
  SUPPORTS_ENCODER,
  normalizeEncodingLabel,
} from './encoding-utils';

test('KAIRO_ENCODING_OPTIONS includes UTF-8 and GBK', () => {
  assert.ok(KAIRO_ENCODING_OPTIONS.includes('utf-8'));
  assert.ok(KAIRO_ENCODING_OPTIONS.includes('gbk'));
  assert.ok(KAIRO_ENCODING_OPTIONS.includes('gb18030'));
  assert.ok(KAIRO_ENCODING_OPTIONS.includes('iso-8859-1'));
});

test('KAIRO_ENCODING_OPTIONS includes UTF-16 variants', () => {
  assert.ok(KAIRO_ENCODING_OPTIONS.includes('utf-16le'));
  assert.ok(KAIRO_ENCODING_OPTIONS.includes('utf-16be'));
});

test('KAIRO_ENCODING_OPTIONS includes us-ascii', () => {
  assert.ok(KAIRO_ENCODING_OPTIONS.includes('us-ascii'));
});

test('KAIRO_ENCODING_OPTIONS includes utf-8-bom', () => {
  assert.ok(KAIRO_ENCODING_OPTIONS.includes('utf-8-bom'));
});

test('KAIRO_ENCODING_OPTIONS has expected length (8 entries)', () => {
  assert.strictEqual(KAIRO_ENCODING_OPTIONS.length, 8);
});

test('SUPPORTS_ENCODER contains utf-8, utf-16le, utf-16be', () => {
  assert.ok(SUPPORTS_ENCODER.has('utf-8'));
  assert.ok(SUPPORTS_ENCODER.has('utf-16le'));
  assert.ok(SUPPORTS_ENCODER.has('utf-16be'));
});

test('SUPPORTS_ENCODER does not contain gbk or other non-UTF encodings', () => {
  // The browser TextEncoder only produces UTF-8, so only UTF
  // variants are in the fast-path set. Non-UTF encodings go
  // through the Go agent's validate endpoint.
  assert.strictEqual(SUPPORTS_ENCODER.has('gbk'), false);
  assert.strictEqual(SUPPORTS_ENCODER.has('gb18030'), false);
  assert.strictEqual(SUPPORTS_ENCODER.has('iso-8859-1'), false);
});

test('normalizeEncodingLabel: utf-8-bom -> utf-8', () => {
  assert.strictEqual(normalizeEncodingLabel('utf-8-bom'), 'utf-8');
});

test('normalizeEncodingLabel: passthrough for known labels', () => {
  assert.strictEqual(normalizeEncodingLabel('gbk'), 'gbk');
  assert.strictEqual(normalizeEncodingLabel('utf-16le'), 'utf-16le');
  assert.strictEqual(normalizeEncodingLabel('utf-8'), 'utf-8');
  assert.strictEqual(normalizeEncodingLabel('iso-8859-1'), 'iso-8859-1');
  assert.strictEqual(normalizeEncodingLabel('us-ascii'), 'us-ascii');
});

test('normalizeEncodingLabel: unknown labels pass through unchanged', () => {
  assert.strictEqual(normalizeEncodingLabel('shift-jis'), 'shift-jis');
  assert.strictEqual(normalizeEncodingLabel('big5'), 'big5');
});