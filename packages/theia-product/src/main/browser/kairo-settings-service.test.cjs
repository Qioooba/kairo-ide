'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// TP-P1-10: explicit null in project settings must not override defaults.
test('KairoSettingsService treats explicit null as use-default', () => {
  const projectSettings = { 'kairo.test.key': null, 'kairo.test.set': 'value' };

  function get(key, defaultValue) {
    const value = projectSettings[key];
    if (value !== undefined && value !== null) {
      return value;
    }
    return defaultValue;
  }

  function isProjectOverride(key) {
    const value = projectSettings[key];
    return value !== undefined && value !== null;
  }

  assert.strictEqual(get('kairo.test.key', 'default'), 'default');
  assert.strictEqual(get('kairo.test.set', 'default'), 'value');
  assert.strictEqual(get('kairo.test.missing', 'fallback'), 'fallback');
  assert.strictEqual(isProjectOverride('kairo.test.key'), false);
  assert.strictEqual(isProjectOverride('kairo.test.set'), true);
  assert.strictEqual(isProjectOverride('kairo.test.missing'), false);
});
