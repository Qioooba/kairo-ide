'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const srcDir = __dirname;

test('browser index.ts exports KairoUiContribution', () => {
  const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
  assert.match(source, /KairoUiContribution/);
});

test('browser index.ts exports KairoThemeContribution', () => {
  const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
  assert.match(source, /KairoThemeContribution/);
});

test('browser index.ts exports kairo-theme', () => {
  const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
  assert.match(source, /kairo-theme/);
});

test('browser index.ts exports virtual-list', () => {
  const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
  assert.match(source, /virtual-list/);
});

test('browser index.ts exports default ContainerModule', () => {
  const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
  assert.match(source, /export default new ContainerModule/);
});

test('ui-kit/src/index.ts re-exports browser module', () => {
  const source = fs.readFileSync(path.join(srcDir, '..', 'index.ts'), 'utf8');
  assert.match(source, /export \* from '\.\/browser'/);
});

test('kairo-theme.ts exports KairoDarkTheme', () => {
  const source = fs.readFileSync(path.join(srcDir, 'kairo-theme.ts'), 'utf8');
  assert.ok(source.includes('KairoDarkTheme'), 'source should contain KairoDarkTheme');
});

test('kairo-theme.ts exports KairoDarkTheme theme activation', () => {
  const source = fs.readFileSync(path.join(srcDir, 'kairo-theme.ts'), 'utf8');
  assert.ok(source.includes('activate'), 'theme should have activate method');
  assert.ok(source.includes('KAIRO_DARK_VARS'), 'theme should define dark CSS variables');
});

test('tokens.ts defines Kairo color tokens', () => {
  const source = fs.readFileSync(path.join(srcDir, '..', 'tokens.ts'), 'utf8');
  assert.match(source, /export const /);
});