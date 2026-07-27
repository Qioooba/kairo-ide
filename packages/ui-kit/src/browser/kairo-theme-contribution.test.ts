// N-034: Kairo theme unification — contract test.
//
// Verifies that the Monaco editor theme and ColorRegistry
// overrides are derived from the single source of truth
// (KAIRO_DARK_VARS in kairo-theme.ts), not from independent
// hex literals that could drift.
//
// These are source-level tests — they read the TypeScript source
// directly to avoid importing the compiled module which transitively
// requires browser globals from @lumino/domutils.
//
// Run with:
//   pnpm --filter @kairo/ui-kit test

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KairoDarkTheme } from './kairo-theme';

// ---------------------------------------------------------------------------
// Source-level: kairo-theme-contribution.ts
// ---------------------------------------------------------------------------

const contributionSource = readFileSync(join(__dirname, 'kairo-theme-contribution.ts'), 'utf8');

test('kairo-theme-contribution.ts exports KAIRO_MONACO_THEME (N-034)', () => {
  assert.match(contributionSource, /export const KAIRO_MONACO_THEME/);
});

test('kairo-theme-contribution.ts exports KAIRO_THEME_COLOR_OVERRIDES (N-034)', () => {
  assert.match(contributionSource, /export const KAIRO_THEME_COLOR_OVERRIDES/);
});

test('KAIRO_MONACO_THEME has base: vs-dark', () => {
  assert.match(contributionSource, /base: 'vs-dark'/);
});

test('KAIRO_MONACO_THEME has inherit: true', () => {
  assert.match(contributionSource, /inherit: true/);
});

test('KAIRO_MONACO_THEME editor.background is #1e1f22 (N-034)', () => {
  assert.match(contributionSource, /'editor\.background': '#1e1f22'/);
});

test('KAIRO_MONACO_THEME editor.foreground is #dfe1e5 (N-034)', () => {
  assert.match(contributionSource, /'editor\.foreground': '#dfe1e5'/);
});

test('KAIRO_MONACO_THEME has syntax token rules', () => {
  assert.match(contributionSource, /token: 'comment'/);
  assert.match(contributionSource, /token: 'keyword'/);
  assert.match(contributionSource, /token: 'string'/);
  assert.match(contributionSource, /token: 'number'/);
  assert.match(contributionSource, /token: 'type'/);
});

test('KAIRO_MONACO_THEME comment token is italic (N-034)', () => {
  assert.match(contributionSource, /foreground: '7a7e85'.*fontStyle: 'italic'/);
});

test('KAIRO_MONACO_THEME keyword token is purple (N-034)', () => {
  assert.match(contributionSource, /token: 'keyword', foreground: 'c586c0'/);
});

test('KAIRO_THEME_COLOR_OVERRIDES includes editor.background (N-034)', () => {
  assert.match(contributionSource, /id: 'editor\.background'.*defaults:.*dark: '#1e1f22'/s);
});

test('KAIRO_THEME_COLOR_OVERRIDES includes editor.foreground (N-034)', () => {
  assert.match(contributionSource, /id: 'editor\.foreground'.*defaults:.*dark: '#dfe1e5'/s);
});

test('KAIRO_THEME_COLOR_OVERRIDES includes statusBar colors (N-034)', () => {
  assert.match(contributionSource, /id: 'statusBar\.background'.*defaults:.*dark: '#1a1b1e'/s);
  assert.match(contributionSource, /id: 'statusBar\.foreground'.*defaults:.*dark: '#c5c8cc'/s);
});

test('KAIRO_THEME_COLOR_OVERRIDES includes button colors (N-034)', () => {
  assert.match(contributionSource, /id: 'button\.background'.*defaults:.*dark: '#7C3AED'/s);
  assert.match(contributionSource, /id: 'button\.foreground'.*defaults:.*dark: '#ffffff'/s);
});

test('KAIRO_THEME_COLOR_OVERRIDES includes input.background (N-034)', () => {
  assert.match(contributionSource, /id: 'input\.background'.*defaults:.*dark: '#1a1b1e'/s);
});

test('KAIRO_THEME_COLOR_OVERRIDES includes editorWidget.background (N-034)', () => {
  assert.match(contributionSource, /id: 'editorWidget\.background'.*defaults:.*dark: '#252629'/s);
});

test('kairo-theme-contribution.ts references the single source of truth comment (N-034)', () => {
  assert.match(contributionSource, /single source of truth/);
});

// ---------------------------------------------------------------------------
// KairoDarkTheme consistency (these pass without DOM)
// ---------------------------------------------------------------------------

test('KairoDarkTheme has the documented id and label', () => {
  assert.strictEqual(KairoDarkTheme.id, 'kairo-dark');
  assert.strictEqual(KairoDarkTheme.label, 'Kairo Dark');
  assert.strictEqual(KairoDarkTheme.type, 'dark');
});

test('KairoDarkTheme.editorTheme is "kairo-dark" (used by monaco)', () => {
  assert.strictEqual(KairoDarkTheme.editorTheme, 'kairo-dark');
});

test('KairoDarkTheme has activate + deactivate methods (Theme contract)', () => {
  assert.strictEqual(typeof KairoDarkTheme.activate, 'function');
  assert.strictEqual(typeof KairoDarkTheme.deactivate, 'function');
});

test('KairoDarkTheme.activate() is a no-op when document is undefined', () => {
  const activate = KairoDarkTheme.activate!;
  assert.doesNotThrow(() => activate());
});

test('KairoDarkTheme.deactivate() is a no-op (static theme)', () => {
  const deactivate = KairoDarkTheme.deactivate!;
  assert.doesNotThrow(() => deactivate());
});

test('KairoDarkTheme.activate() is idempotent (calling twice is safe)', () => {
  const activate = KairoDarkTheme.activate!;
  assert.doesNotThrow(() => {
    activate();
    activate();
  });
});

// ---------------------------------------------------------------------------
// KAIRO_IDEA_MONACO_THEME — IDEA-style syntax highlighting
// ---------------------------------------------------------------------------

test('kairo-theme-contribution.ts exports KAIRO_IDEA_MONACO_THEME', () => {
  assert.match(contributionSource, /export const KAIRO_IDEA_MONACO_THEME/);
});

test('KAIRO_IDEA_MONACO_THEME has base: vs-dark', () => {
  // The IDEA theme block should follow the VS Code dark theme pattern
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME.*base: 'vs-dark'/s);
});

test('KAIRO_IDEA_MONACO_THEME has inherit: true', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME.*inherit: true/s);
});

test('KAIRO_IDEA_MONACO_THEME keyword is orange (#CC7832) — IDEA signature', () => {
  // The most recognizable IDEA trait: keywords are orange, not purple
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'keyword', foreground: 'CC7832'/m);
});

test('KAIRO_IDEA_MONACO_THEME string is green (#6A8759) — IDEA style', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'string', foreground: '6A8759'/m);
});

test('KAIRO_IDEA_MONACO_THEME number is blue (#6897BB) — IDEA style', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'number', foreground: '6897BB'/m);
});

test('KAIRO_IDEA_MONACO_THEME comment is gray (#808080) without italic', () => {
  // IDEA does not use italic for comments
  const ideaSection = contributionSource.split('KAIRO_IDEA_MONACO_THEME')[1];
  // The comment token should be gray and NOT have fontStyle
  assert.match(ideaSection, /token: 'comment', foreground: '808080'/);
  // Verify no italic on the IDEA comment token
  const afterComment = ideaSection.split("token: 'comment'")[1];
  const beforeNextToken = afterComment.split('token:')[0];
  assert.ok(!beforeNextToken.includes('fontStyle'), 'IDEA comment should NOT have italic fontStyle');
});

test('KAIRO_IDEA_MONACO_THEME has annotation token (#BBB529)', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'annotation', foreground: 'BBB529'/m);
});

test('KAIRO_IDEA_MONACO_THEME has constant token (#CC7832) — literals match keywords', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'constant', foreground: 'CC7832'/m);
});

test('KAIRO_IDEA_MONACO_THEME has Javadoc comment token (#629755)', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'comment\.doc', foreground: '629755'/m);
});

test('KAIRO_IDEA_MONACO_THEME has string.escape token (#CC7832)', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'string\.escape', foreground: 'CC7832'/m);
});

test('KAIRO_IDEA_MONACO_THEME type.identifier is default text (#A9B7C6) — no special type color', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'type\.identifier', foreground: 'A9B7C6'/m);
});

test('KAIRO_IDEA_MONACO_THEME HTML tags are gold (#E8BF6A) — IDEA signature for markup', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'tag', foreground: 'E8BF6A'/m);
});

test('KAIRO_IDEA_MONACO_THEME has JSP tag tokens', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'tag\.jsp-directive'/m);
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'tag\.jsp-scriptlet'/m);
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'tag\.jsp-jstl'/m);
});

test('KAIRO_IDEA_MONACO_THEME has EL expression token', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'metatag\.el', foreground: '6897BB'/m);
});

test('KAIRO_IDEA_MONACO_THEME has attribute tokens', () => {
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'attribute\.name', foreground: 'BABABA'/m);
  assert.match(contributionSource, /KAIRO_IDEA_MONACO_THEME[\s\S]*token: 'attribute\.value', foreground: '6A8759'/m);
});

test('kairo-theme-contribution.ts defines kairo-idea-dark Monaco theme', () => {
  assert.match(contributionSource, /defineTheme\('kairo-idea-dark'/);
});

test('kairo-theme-contribution.ts registers KairoIDEATheme', () => {
  assert.match(contributionSource, /import.*KairoIDEATheme/);
  assert.match(contributionSource, /register\(KairoIDEATheme\)/);
});