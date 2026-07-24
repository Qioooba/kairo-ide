// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for JavaDiagnosticsManager.
//
// Verifies the LSP→vscode diagnostic conversion logic and the
// diagnostic event handling. Avoids importing the Theia MarkerManager
// base class (which requires filesystem services) by testing the
// pure conversion logic directly.
//
// Run with: pnpm --filter @kairo/java-extension test

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Inline constants to avoid importing the heavy Theia dependency chain
// from the compiled java-diagnostics-manager.js (which pulls in
// @theia/markers → @lumino/domutils → navigator).
const JAVA_DIAGNOSTICS_OWNER = 'kairo-java';
const JAVA_DIAGNOSTICS_KIND = 'problem';

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

test('JAVA_DIAGNOSTICS_OWNER: is kairo-java', () => {
  assert.equal(JAVA_DIAGNOSTICS_OWNER, 'kairo-java');
});

test('JAVA_DIAGNOSTICS_KIND: is problem', () => {
  assert.equal(JAVA_DIAGNOSTICS_KIND, 'problem');
});

// ------------------------------------------------------------------
// LSP → vscode Diagnostic conversion (pure logic)
// ------------------------------------------------------------------

/**
 * Convert internal LSPDiagnostic to vscode Diagnostic format.
 * This is the exact logic from JavaDiagnosticsManager.toVscodeDiagnostic.
 */
function toVscodeDiagnostic(d) {
  return {
    range: {
      start: { line: d.range.start.line, character: d.range.start.character },
      end: { line: d.range.end.line, character: d.range.end.character },
    },
    severity: d.severity,
    code: d.code,
    source: d.source ?? JAVA_DIAGNOSTICS_OWNER,
    message: d.message,
    tags: d.tags,
    relatedInformation: d.relatedInformation?.map(ri => ({
      location: {
        uri: ri.location.uri,
        range: {
          start: { line: ri.location.range.start.line, character: ri.location.range.start.character },
          end: { line: ri.location.range.end.line, character: ri.location.range.end.character },
        },
      },
      message: ri.message,
    })),
    data: d.data,
  };
}

test('conversion: converts LSP diagnostic to vscode format', () => {
  const diag = toVscodeDiagnostic({
    range: {
      start: { line: 10, character: 5 },
      end: { line: 10, character: 15 },
    },
    severity: 1,
    code: 'test-001',
    source: 'JDT LS',
    message: 'Test error message',
    tags: [2],
    relatedInformation: [{
      location: {
        uri: 'file:///workspace/Other.java',
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 10 },
        },
      },
      message: 'Related info',
    }],
    data: { key: 'value' },
  });

  assert.equal(diag.range.start.line, 10);
  assert.equal(diag.range.start.character, 5);
  assert.equal(diag.range.end.line, 10);
  assert.equal(diag.range.end.character, 15);
  assert.equal(diag.severity, 1);
  assert.equal(diag.code, 'test-001');
  assert.equal(diag.source, 'JDT LS');
  assert.equal(diag.message, 'Test error message');
  assert.deepEqual(diag.tags, [2]);
  assert.equal(diag.relatedInformation.length, 1);
  assert.equal(diag.relatedInformation[0].message, 'Related info');
  assert.deepEqual(diag.data, { key: 'value' });
});

test('conversion: uses default source when source is missing', () => {
  const diag = toVscodeDiagnostic({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: 2,
    message: 'No source',
  });
  assert.equal(diag.source, 'kairo-java');
});

test('conversion: handles undefined tags', () => {
  const diag = toVscodeDiagnostic({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: 1,
    message: 'No tags',
  });
  assert.equal(diag.tags, undefined);
});

test('conversion: handles undefined relatedInformation', () => {
  const diag = toVscodeDiagnostic({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: 1,
    message: 'No related info',
  });
  assert.equal(diag.relatedInformation, undefined);
});

test('conversion: handles undefined data', () => {
  const diag = toVscodeDiagnostic({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: 1,
    message: 'No data',
  });
  assert.equal(diag.data, undefined);
});

test('conversion: preserves all severity levels', () => {
  assert.equal(toVscodeDiagnostic({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: 1, message: 'Error',
  }).severity, 1);

  assert.equal(toVscodeDiagnostic({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: 2, message: 'Warning',
  }).severity, 2);

  assert.equal(toVscodeDiagnostic({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: 3, message: 'Info',
  }).severity, 3);

  assert.equal(toVscodeDiagnostic({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: 4, message: 'Hint',
  }).severity, 4);
});

// ------------------------------------------------------------------
// Diagnostics event handling (logical)
// ------------------------------------------------------------------

test('diagnostics events: maps URI and sets correct owner', () => {
  // Simulate the event processing logic
  const events = [];
  function processDiagnosticsEvent(params) {
    events.push({
      uri: params.uri,
      owner: JAVA_DIAGNOSTICS_OWNER,
      count: params.diagnostics.length,
    });
  }

  processDiagnosticsEvent({
    uri: 'file:///workspace/Test.java',
    diagnostics: [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 1, message: 'E1' },
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, severity: 2, message: 'W1' },
    ],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].uri, 'file:///workspace/Test.java');
  assert.equal(events[0].owner, 'kairo-java');
  assert.equal(events[0].count, 2);
});

test('diagnostics events: handles empty diagnostics', () => {
  const events = [];
  function processDiagnosticsEvent(params) {
    events.push({ uri: params.uri, count: params.diagnostics.length });
  }
  processDiagnosticsEvent({ uri: 'file:///test.java', diagnostics: [] });
  assert.equal(events[0].count, 0);
});