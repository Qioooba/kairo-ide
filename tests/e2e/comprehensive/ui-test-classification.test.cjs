'use strict';

// UI-07 gate: UI tests must not degenerate into source-string checks.
//  - No comprehensive spec may import `expectFile` (use `expectContract`
//    for static checks, real locators for UI acceptance).
//  - campaign.ts `uiOrFile` must assert the live page and never fall back
//    to reading repository sources.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;

test('no comprehensive spec imports expectFile', () => {
  const offenders = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.spec.ts')) continue;
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    if (/\bexpectFile\b/.test(source)) offenders.push(file);
  }
  assert.deepStrictEqual(offenders, [], `specs using expectFile: ${offenders.join(', ')}`);
});

test('uiOrFile asserts the live page without a source fallback', () => {
  const source = fs.readFileSync(path.join(dir, 'campaign.ts'), 'utf8');
  const body = source.slice(source.indexOf('export async function uiOrFile'));
  assert.match(body, /toMatch\(ui\)/);
  assert.doesNotMatch(body, /expectContract\(/);
  assert.doesNotMatch(body, /readFileSync/);
});

test('contract helper is explicitly classified', () => {
  const source = fs.readFileSync(path.join(dir, 'campaign.ts'), 'utf8');
  assert.match(source, /export function expectContract/);
  assert.match(source, /@contract/);
});
