/**
 * Regression tests for KAIRO-W07, KAIRO-W08, KAIRO-W09.
 */

require.extensions['.css'] = () => {};

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { JspPageModelBuilder } = require('../../packages/jsp-extension/lib/browser/jsp-page-model');
const { JspSourceMap } = require('../../packages/jsp-extension/lib/browser/jsp-sourcemap');

const { JspDiagnosticsEngine } = require('../../packages/jsp-extension/lib/browser/jsp-scriptlet-diagnostics-core');

describe('JSP Diagnostics, Multi-file Includes & SourceMap (W07, W08, W09)', () => {
  describe('W07: JSP Whole-Page Diagnostics Primacy & Mode Gating', () => {
    it('whole-page diagnostics ignores stale block notifications and does not overwrite with isolated block errors', async () => {
      const markersMap = new Map();
      const markerSink = {
        setModelMarkers: (uri, owner, markers) => {
          markersMap.set(uri, markers);
        },
        getOpenModelUris: () => ['file:///test/w07.jsp'],
      };

      const engine = new JspDiagnosticsEngine(markerSink);
      const jspContent = '<% int x = 1; %>\n<% out.println(x); %>';
      const model = {
        uri: 'file:///test/w07.jsp',
        getValue: () => jspContent,
        isDisposed: () => false,
      };

      const state = engine.attachModel(model, 1);
      await engine.runDiagnostics(state, 1);

      assert.equal(state.activeDiagnosticMode, 'page', 'Engine should be in whole-page diagnostic mode');

      // 1. Simulate whole-page diagnostic arriving with 0 errors (valid cross-block variable x)
      engine.handleDiagnosticsNotification({
        uri: 'jsp-scriptlet://file:///test/w07.jsp#page',
        diagnostics: [],
      });

      let markers = markersMap.get(model.uri) || [];
      assert.equal(markers.length, 0, 'Whole page should have 0 markers');

      // 2. Simulate a stale per-block diagnostic arriving (e.g. from block 1 which falsely claimed x is unresolved)
      engine.handleDiagnosticsNotification({
        uri: 'jsp-scriptlet://file:///test/w07.jsp#block1',
        diagnostics: [
          {
            range: { start: { line: 0, character: 12 }, end: { line: 0, character: 13 } },
            message: 'x cannot be resolved to a variable',
            severity: 1,
          },
        ],
      });

      // Assert that the stale per-block diagnostic was DROPPED by mode gating and did not overwrite whole-page!
      markers = markersMap.get(model.uri) || [];
      assert.equal(markers.length, 0, 'Stale per-block diagnostic must not overwrite whole-page diagnostics');
    });

    it('retains multiple real errors across different blocks in whole-page diagnostics', async () => {
      const markersMap = new Map();
      const markerSink = {
        setModelMarkers: (uri, owner, markers) => {
          markersMap.set(uri, markers);
        },
        getOpenModelUris: () => ['file:///test/errors.jsp'],
      };

      const engine = new JspDiagnosticsEngine(markerSink);
      const jspContent = '<% undeclared1(); %>\n<% undeclared2(); %>';
      const model = {
        uri: 'file:///test/errors.jsp',
        getValue: () => jspContent,
        isDisposed: () => false,
      };

      const state = engine.attachModel(model, 1);
      await engine.runDiagnostics(state, 1);

      assert.equal(state.activeDiagnosticMode, 'page');
      assert.ok(state.pageResult, 'Page result must exist');

      // Map positions from virtualJava to check where they land
      const line1 = state.pageResult.virtualJava.indexOf('undeclared1();');
      const line2 = state.pageResult.virtualJava.indexOf('undeclared2();');
      assert.ok(line1 > 0 && line2 > 0);

      const pos1 = state.pageResult.sourceMap.mapJspPositionToVirtual('file:///test/errors.jsp', 0, 3);
      const pos2 = state.pageResult.sourceMap.mapJspPositionToVirtual('file:///test/errors.jsp', 1, 3);

      engine.handleDiagnosticsNotification({
        uri: 'jsp-scriptlet://file:///test/errors.jsp#page',
        diagnostics: [
          {
            range: { start: { line: pos1.line, character: pos1.character }, end: { line: pos1.line, character: pos1.character + 11 } },
            message: 'undeclared1 undefined',
            severity: 1,
          },
          {
            range: { start: { line: pos2.line, character: pos2.character }, end: { line: pos2.line, character: pos2.character + 11 } },
            message: 'undeclared2 undefined',
            severity: 1,
          },
        ],
      });

      const markers = markersMap.get(model.uri) || [];
      assert.equal(markers.length, 2, 'Both errors must be retained');
      assert.equal(markers[0].message, 'undeclared1 undefined');
      assert.equal(markers[1].message, 'undeclared2 undefined');
    });

    it('fallback block mode aggregates diagnostics without one block wiping another', async () => {
      const markersMap = new Map();
      const markerSink = {
        setModelMarkers: (uri, owner, markers) => {
          markersMap.set(uri, markers);
        },
        getOpenModelUris: () => ['file:///test/fallback.jsp'],
      };

      const engine = new JspDiagnosticsEngine(markerSink);
      const jspContent = '<% int a = 1; %>\n<% int b = 2; %>';
      const model = {
        uri: 'file:///test/fallback.jsp',
        getValue: () => jspContent,
        isDisposed: () => false,
      };

      const state = engine.attachModel(model, 1);
      // Force fallback mode
      state.activeDiagnosticMode = 'block';
      state.pageResult = undefined;

      // Diagnostic for block 0 arrives
      engine.handleDiagnosticsNotification({
        uri: 'jsp-scriptlet://file:///test/fallback.jsp#block0',
        diagnostics: [
          {
            range: { start: { line: 11, character: 4 }, end: { line: 11, character: 14 } },
            message: 'error in block 0',
            severity: 1,
          },
        ],
      });

      let markers = markersMap.get(model.uri) || [];
      assert.equal(markers.length, 1);

      // Diagnostic for block 1 arrives — should AGGREGATE, not wipe block 0!
      engine.handleDiagnosticsNotification({
        uri: 'jsp-scriptlet://file:///test/fallback.jsp#block1',
        diagnostics: [
          {
            range: { start: { line: 11, character: 4 }, end: { line: 11, character: 14 } },
            message: 'error in block 1',
            severity: 1,
          },
        ],
      });

      markers = markersMap.get(model.uri) || [];
      assert.equal(markers.length, 2, 'Aggregated diagnostics must contain both block 0 and block 1 errors');
    });
  });

  describe('W08: Static Include Exact Offset In-place Expansion', () => {
    it('expands static include at the exact directive location rather than appending per page', async () => {
      const builder = new JspPageModelBuilder();

      const mainJsp = [
        '<% int pre = 1; %>',
        '<%@ include file="middle.jspf" %>',
        '<% int post = pre + mid; %>',
      ].join('\n');

      const middleJsp = '<% int mid = 100; %>';

      const files = new Map([
        ['middle.jspf', middleJsp],
      ]);

      const resolver = (path) => files.get(path);

      const result = await builder.buildPageVirtualJava('file:///test/main.jsp', mainJsp, resolver);
      const java = result.virtualJava;

      const preIdx = java.indexOf('int pre = 1;');
      const midIdx = java.indexOf('int mid = 100;');
      const postIdx = java.indexOf('int post = pre + mid;');

      assert.ok(preIdx > 0, 'int pre must exist in generated java');
      assert.ok(midIdx > 0, 'int mid must exist in generated java');
      assert.ok(postIdx > 0, 'int post must exist in generated java');

      assert.ok(preIdx < midIdx, 'pre (line 1) must appear before mid (line 2 include)');
      assert.ok(midIdx < postIdx, 'mid (line 2 include) must appear before post (line 3)');
    });

    it('handles nested includes and keeps in-place order at each nesting level', async () => {
      const builder = new JspPageModelBuilder();

      const pageA = '<% int a = 1; %>\n<%@ include file="b.jsp" %>\n<% int aEnd = a + c; %>';
      const pageB = '<% int b = 2; %>\n<%@ include file="c.jsp" %>\n<% int bEnd = b; %>';
      const pageC = '<% int c = 3; %>';

      const files = new Map([
        ['b.jsp', pageB],
        ['c.jsp', pageC],
      ]);

      const resolver = (path) => files.get(path);

      const result = await builder.buildPageVirtualJava('file:///test/a.jsp', pageA, resolver);
      const java = result.virtualJava;

      const idxA = java.indexOf('int a = 1;');
      const idxB = java.indexOf('int b = 2;');
      const idxC = java.indexOf('int c = 3;');
      const idxBEnd = java.indexOf('int bEnd = b;');
      const idxAEnd = java.indexOf('int aEnd = a + c;');

      assert.ok(idxA < idxB, 'a < b');
      assert.ok(idxB < idxC, 'b < c');
      assert.ok(idxC < idxBEnd, 'c < bEnd');
      assert.ok(idxBEnd < idxAEnd, 'bEnd < aEnd');
    });
  });

  describe('W09: SourceMap Exact UTF-16 Offsets & No Semicolon Drift', () => {
    it('calculates exact line offsets for lines of uneven length without average interpolation', () => {
      // Three lines of vastly different lengths:
      // Line 0: "a" (len 1, \n at 1)
      // Line 1: "12345678901234567890" (len 20, \n at 22)
      // Line 2: "z" (len 1)
      const sourceMap = new JspSourceMap();

      // Virtual Java lines:
      // Line 10: "        a" (indent 8, col 8, offset 100)
      // Line 11: "        12345678901234567890" (indent 8, col 8, offset 110)
      // Line 12: "        z" (indent 8, col 8, offset 139)
      sourceMap.addSpan({
        sourceUri: 'file:///test.jsp',
        sourceStartLine: 0,
        sourceStartCol: 0,
        sourceStartOffset: 0,
        sourceEndLine: 2,
        sourceEndCol: 1,
        sourceEndOffset: 24,
        virtualStartLine: 10,
        virtualStartCol: 8,
        virtualStartOffset: 100,
        virtualEndLine: 12,
        virtualEndCol: 9,
        virtualEndOffset: 148,
        kind: 'scriptlet',
        sourceContent: 'a\n12345678901234567890\nz',
        virtualContent: '        a\n        12345678901234567890\n        z',
      });

      // Map line 1, col 0 of source ("1234567890...") to virtual:
      // In source: line 0 is "a\n" (2 chars). So line 1, col 0 is at offset 2!
      const mapped = sourceMap.mapJspPositionToVirtual('file:///test.jsp', 1, 0);
      assert.ok(mapped);
      assert.equal(mapped.line, 11);
      assert.equal(mapped.character, 8);
      // Virtual line 10 has 10 chars ("        a\n").
      // Offset of line 11 col 8 in virtual is 100 + 10 + 8 = 118!
      // With average line interpolation, it calculated wrong offset. With exact lineStarts, it must be 118.
      assert.equal(mapped.offset, 118);
    });

    it('does not drift virtual offsets across multiple expressions followed by scriptlet', async () => {
      const builder = new JspPageModelBuilder();

      const jsp = [
        '<%= 1 + 1 %>',
        '<%= 2 + 2 %>',
        '<% int x = 3; %>',
      ].join('\n');

      const result = await builder.buildPageVirtualJava('file:///test/expr.jsp', jsp);
      const java = result.virtualJava;

      // Find actual offset of "int x = 3;" in virtualJava
      const targetString = 'int x = 3;';
      const actualOffset = java.indexOf(targetString);
      assert.ok(actualOffset > 0, 'int x = 3; must exist in virtualJava');

      // Map JSP line 2 col 3 ("int x = 3;") to virtual
      const mapped = result.sourceMap.mapJspPositionToVirtual('file:///test/expr.jsp', 2, 3);
      assert.ok(mapped);
      assert.equal(mapped.offset, actualOffset, 'mapped offset must match exact indexOf in virtualJava without drift');
    });

    it('marks synthetic prefix Object __expr = as inUserCode: false', async () => {
      const builder = new JspPageModelBuilder();
      const jsp = '<%= myVariable %>';
      const result = await builder.buildPageVirtualJava('file:///test/expr.jsp', jsp);

      const java = result.virtualJava;
      // Find line with _jspService expression
      const lines = java.split('\n');
      const exprLineIdx = lines.findIndex(l => l.includes('Object __expr'));
      assert.ok(exprLineIdx >= 0);

      const line = lines[exprLineIdx];
      // Column in prefix "        Object __expr_1 = "
      const prefixCol = line.indexOf('Object');

      const mappedPrefix = result.sourceMap.mapVirtualPositionToJsp(exprLineIdx, prefixCol);
      assert.ok(mappedPrefix);
      assert.equal(mappedPrefix.inUserCode, false, 'Synthetic expression prefix must not be marked inUserCode: true');

      // Column in user expression "myVariable"
      const userCol = line.indexOf('myVariable');
      const mappedUser = result.sourceMap.mapVirtualPositionToJsp(exprLineIdx, userCol);
      assert.ok(mappedUser);
      assert.equal(mappedUser.inUserCode, true, 'User variable inside expression must be inUserCode: true');
    });
  });
});
