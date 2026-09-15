'use strict';

// validatePortText contract (REPORT UI-13): raw input preserved while typing,
// validated at submit. Empty/partial/overflow states must not collapse to 0.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePortText } = require('../../lib/browser/form-field');

test('accepts valid ports 1..65535', () => {
  assert.deepStrictEqual(validatePortText('1'), { port: 1 });
  assert.deepStrictEqual(validatePortText('8080'), { port: 8080 });
  assert.deepStrictEqual(validatePortText('65535'), { port: 65535 });
  assert.deepStrictEqual(validatePortText(' 1521 '), { port: 1521 });
});

test('empty input stays empty (never coerced to 0)', () => {
  assert.deepStrictEqual(validatePortText(''), { error: 'empty' });
  assert.deepStrictEqual(validatePortText('   '), { error: 'empty' });
});

test('non-integer input rejected', () => {
  assert.deepStrictEqual(validatePortText('abc'), { error: 'notInteger' });
  assert.deepStrictEqual(validatePortText('80.5'), { error: 'notInteger' });
  assert.deepStrictEqual(validatePortText('-1'), { error: 'notInteger' });
  assert.deepStrictEqual(validatePortText('80a'), { error: 'notInteger' });
});

test('out-of-range rejected', () => {
  assert.deepStrictEqual(validatePortText('0'), { error: 'outOfRange' });
  assert.deepStrictEqual(validatePortText('65536'), { error: 'outOfRange' });
  assert.deepStrictEqual(validatePortText('99999999999999999999'), { error: 'outOfRange' });
});

test('form-field component contract (label association + describedby)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'form-field.tsx'), 'utf8');
  assert.match(source, /htmlFor/);
  assert.match(source, /aria-invalid/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /role="alert"/);
});
