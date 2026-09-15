'use strict';

// Split bound math (REPORT UI-06 §5.4): pure function contract.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computePrimaryPx,
  computeRatioFromOffset,
} = require('../../lib/browser/resizable-split-math');

test('ratio maps inside [minPrimary, available - minSecondary]', () => {
  assert.strictEqual(computePrimaryPx(500, 0.5, 60, 60), 250);
  assert.strictEqual(computePrimaryPx(500, 0, 60, 60), 60);
  assert.strictEqual(computePrimaryPx(500, 1, 60, 60), 440);
});

test('tiny container never yields negative or NaN', () => {
  for (const available of [0, -10, 50, 100]) {
    const px = computePrimaryPx(available, 0.5, 60, 60);
    assert.ok(Number.isFinite(px) && px >= 0, `available=${available} -> ${px}`);
  }
});

test('available below min sum clamps to a non-negative range', () => {
  const px = computePrimaryPx(100, 0.9, 60, 60);
  assert.ok(px >= 0 && px <= 100, `px=${px}`);
});

test('pointer offset converts to a 0..1 ratio', () => {
  assert.strictEqual(computeRatioFromOffset(250, 500), 0.5);
  assert.strictEqual(computeRatioFromOffset(-10, 500), 0);
  assert.strictEqual(computeRatioFromOffset(9999, 500), 1);
  assert.strictEqual(computeRatioFromOffset(10, 0), 0.5);
});

test('resizable-split component contract (structure, keyboard, persistence)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'resizable-split.tsx'), 'utf8');
  // Pointer capture + rAF coalescing, cleanup on unmount.
  assert.match(source, /setPointerCapture/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /releasePointerCapture/);
  // Keyboard support per W3C APG window-splitter pattern.
  assert.match(source, /role="separator"/);
  assert.match(source, /aria-valuenow/);
  assert.match(source, /ArrowLeft|ArrowUp/);
  assert.match(source, /Home/);
  // Ratio persisted per storageKey, never per-frame.
  assert.match(source, /storageKey/);
  assert.match(source, /localStorage/);
});
