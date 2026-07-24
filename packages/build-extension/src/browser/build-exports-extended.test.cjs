'use strict';

// CSS extension hook must be set up BEFORE any @theia/core module is loaded.
const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Set up JSDOM so @lumino/domutils has access to `navigator`.
const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();

// JSDOM does not expose DragEvent as a global; @lumino/dragdrop needs it.
if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {};
}

// Theia requires FrontendApplicationConfigProvider to be set before
// any browser module is loaded.
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const srcDir = __dirname;

// Load mapBuildResult directly from the build-store module (avoids the
// full index.js which transitively requires @lumino/domutils → navigator).
const { mapBuildResult } = require('../../lib/browser/build-store');

describe('Build Extension — Build Service Exports (source check)', () => {
  it('index.ts exports BuildStore and mapBuildResult', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /BuildStore/);
    assert.match(source, /mapBuildResult/);
  });
});

describe('Build Extension — Build View Widget Exports (source check)', () => {
  it('index.ts exports BuildViewWidget', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /BuildViewWidget/);
  });
});

describe('Build Extension — Build Marker Adapter Exports (source check)', () => {
  it('index.ts exports BuildMarkerAdapter, toMarkerSeverity, diagnosticToMarker', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /BuildMarkerAdapter/);
    assert.match(source, /toMarkerSeverity/);
    assert.match(source, /diagnosticToMarker/);
  });
});

describe('Build Extension — mapBuildResult Function', () => {
  it('maps a successful build result', () => {
    const result = mapBuildResult({
      id: 'build-1',
      state: 'success',
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:01:00Z',
      summary: { errors: 0, warnings: 0 },
      diagnostics: [],
    }, 'ws-1');

    assert.equal(result.id, 'build-1');
    assert.equal(result.state, 'succeeded');
    assert.equal(result.workspaceId, 'ws-1');
  });

  it('maps a failed build result with diagnostics', () => {
    const result = mapBuildResult({
      id: 'build-2',
      state: 'failure',
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:01:00Z',
      summary: { errors: 2, warnings: 1 },
      diagnostics: [
        { file: 'A.java', line: 10, column: 5, severity: 'error', message: 'syntax error' },
        { file: 'B.java', line: 20, column: 3, severity: 'warning', message: 'unused var' },
      ],
    }, 'ws-2');

    assert.equal(result.id, 'build-2');
    assert.equal(result.state, 'failed');
    assert.equal(result.summary, '2 errors, 1 warnings');
    assert.equal(result.diagnostics.length, 2);
    assert.equal(result.diagnostics[0].file, 'A.java');
    assert.equal(result.diagnostics[0].severity, 'error');
    assert.equal(result.diagnostics[1].severity, 'warning');
  });

  it('handles null summary and diagnostics gracefully', () => {
    const result = mapBuildResult({
      id: 'build-3',
      state: 'success',
      startedAt: '2026-01-01T00:00:00Z',
      summary: null,
      diagnostics: null,
    }, 'ws-3');

    assert.equal(result.id, 'build-3');
    assert.equal(result.state, 'succeeded');
    assert.equal(result.summary, '');
    assert.deepEqual(result.diagnostics, []);
  });

  it('maps queued state to pending', () => {
    const result = mapBuildResult({
      id: 'build-4',
      state: 'queued',
      startedAt: '2026-01-01T00:00:00Z',
      summary: null,
      diagnostics: null,
    }, 'ws-4');

    assert.equal(result.state, 'pending');
  });

  it('maps hint severity to info', () => {
    const result = mapBuildResult({
      id: 'build-5',
      state: 'success',
      startedAt: '2026-01-01T00:00:00Z',
      diagnostics: [{ file: 'C.java', line: 1, column: 1, severity: 'hint', message: 'tip' }],
    }, 'ws-5');

    assert.equal(result.diagnostics[0].severity, 'info');
  });
});

describe('Build Extension — BuildStore Source Verification', () => {
  it('build-store.ts defines BuildRun, BuildDiagnostic, ConnectionState types', () => {
    const source = fs.readFileSync(path.join(srcDir, 'build-store.ts'), 'utf8');
    assert.match(source, /export interface BuildRun/);
    assert.match(source, /export interface BuildDiagnostic/);
    assert.match(source, /export type ConnectionState/);
  });

  it('build-store.ts exports mapBuildResult function', () => {
    const source = fs.readFileSync(path.join(srcDir, 'build-store.ts'), 'utf8');
    assert.match(source, /export function mapBuildResult/);
  });
});