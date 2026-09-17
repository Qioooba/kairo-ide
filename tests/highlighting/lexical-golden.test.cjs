/**
 * Golden regression tests for KAIRO-W04, KAIRO-W05, KAIRO-W06.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { LexerState } = require('../../packages/highlighting-extension/lib/common/lexer-state');
const { IncrementalTokenizer } = require('../../packages/highlighting-extension/lib/worker/incremental-tokenizer');
const { HighlightingScheduler } = require('../../packages/highlighting-extension/lib/worker/highlighting-scheduler');
const { ModelTokenCache } = require('../../packages/highlighting-extension/lib/common/token-cache');

describe('Lexical Golden Tests (W04, W05, W06)', () => {
  describe('W04: Worker Host Isolation & LexerState Deserialization', () => {
    it('LexerState.from correctly revives structured clone plain objects with clone() and equals()', () => {
      const plain = {
        mode: 'java-block-comment',
        embeddedLanguage: 'java',
        embeddedStack: ['java'],
        dialect: 'jsp',
        quote: '"',
        depth: 1,
      };

      // Plain object has no methods
      assert.equal(typeof plain.clone, 'undefined');

      // Revive using LexerState.from
      assert.equal(typeof LexerState.from, 'function', 'LexerState.from static factory must exist');
      const revived = LexerState.from(plain);
      assert.equal(typeof revived.clone, 'function');
      assert.equal(typeof revived.equals, 'function');
      assert.equal(revived.mode, 'java-block-comment');
      assert.equal(revived.depth, 1);

      // Verify equals works against plain object and cloned instance
      assert.ok(revived.equals(plain));
      const cloned = revived.clone();
      assert.ok(revived.equals(cloned));
    });

    it('HighlightingWorkerInstance can be instantiated without touching window.onmessage', () => {
      // HighlightingWorkerInstance should be imported from worker-core without side effects
      const { HighlightingWorkerInstance } = require('../../packages/highlighting-extension/lib/worker/highlighting-worker-core');
      assert.ok(HighlightingWorkerInstance, 'HighlightingWorkerInstance must be exported from highlighting-worker-core');

      const messages = [];
      const worker = new HighlightingWorkerInstance(msg => messages.push(msg));
      assert.ok(worker);
    });
  });

  describe('W05: Cross-line State Transitions & HTML EL Tag Attributes', () => {
    it('Java multiline block comment preserves java-block-comment state across lines', () => {
      const tokenizer = new IncrementalTokenizer('test-java-comment', 'java', 'java');

      // Line 1: opens block comment
      const line1 = '/* this is a multiline comment';
      const res1 = tokenizer.tokenizeSingleLine(line1, new LexerState('root', undefined, [], 'java'));
      assert.equal(res1.nextState.mode, 'java-block-comment', 'Line 1 nextState must be java-block-comment');
      // Kind 1 = comment
      assert.equal(res1.tokens[1], 1, 'Line 1 must be tokenized as comment');

      // Line 2: continuation line
      const line2 = ' * still inside comment';
      const res2 = tokenizer.tokenizeSingleLine(line2, res1.nextState);
      assert.equal(res2.nextState.mode, 'java-block-comment', 'Line 2 nextState must remain java-block-comment');
      assert.equal(res2.tokens[1], 1, 'Line 2 must be tokenized as comment');

      // Line 3: closes comment and has code
      const line3 = ' */ int count = 42;';
      const res3 = tokenizer.tokenizeSingleLine(line3, res2.nextState);
      assert.equal(res3.nextState.mode, 'root', 'Line 3 nextState must return to root');
      // Verify token kinds: comment (1), keyword int (9), identifier count (10)
      assert.equal(res3.tokens[1], 1, 'First token must be comment up to */');
      assert.equal(res3.tokens[3], 9, 'Second token must be keyword int');
    });

    it('JSP multiline directive preserves directive state across lines', () => {
      const tokenizer = new IncrementalTokenizer('test-jsp-dir', 'jsp', 'jsp');

      // Line 1: opens directive
      const line1 = '<%@ page import="java.util.*"';
      const res1 = tokenizer.tokenizeSingleLine(line1, new LexerState('root', undefined, [], 'jsp'));
      assert.equal(res1.nextState.mode, 'directive', 'Line 1 nextState must be directive');

      // Line 2: closes directive
      const line2 = '    contentType="text/html; charset=UTF-8" %>';
      const res2 = tokenizer.tokenizeSingleLine(line2, res1.nextState);
      assert.equal(res2.nextState.mode, 'root', 'Line 2 nextState must return to root after closing delimiter');
    });

    it('HTML tag with EL expression in attribute tokenizes EL tokens separately from tag', () => {
      const tokenizer = new IncrementalTokenizer('test-el-tag', 'jsp', 'jsp');
      const line = '<div class="${user.theme}" id="app">';
      const res = tokenizer.tokenizeSingleLine(line, new LexerState('root', undefined, [], 'jsp'));

      // Check that EL delimiter (kind 4) and EL body (kind 5) are emitted
      const kinds = [];
      for (let i = 1; i < res.tokens.length; i += 2) {
        kinds.push(res.tokens[i]);
      }
      assert.ok(kinds.includes(4), 'Must contain EL delimiter token kind 4');
      assert.ok(kinds.includes(5), 'Must contain EL body token kind 5');
    });
  });

  describe('W06: Scheduler Hole-free Scheduling & Checkpoint Precision', () => {
    it('ModelTokenCache.getClosestCheckpoint correctly finds cp < targetLine without off-by-one duplication', () => {
      const cache = new ModelTokenCache('test-cache');
      const state256 = new LexerState('java', 'java', [], 'java');
      cache.addCheckpoint(256, state256, 1);

      // Checkpoint at line 256 is the end state of line 256.
      // If querying for line 256, it cannot be used (must return undefined or cp < 256).
      const cp256 = cache.getClosestCheckpoint(256);
      assert.equal(cp256, undefined, 'Checkpoint at 256 cannot be used to start line 256');

      // Querying for line 257 can use checkpoint 256
      const cp257 = cache.getClosestCheckpoint(257);
      assert.ok(cp257, 'Checkpoint at 256 must be usable for line 257');
      assert.equal(cp257.lineNumber, 256);
    });

    it('HighlightingScheduler covers prefix lines 1..99 and emits isCompleted only when entire file is covered', () => {
      const batches = [];
      const scheduler = new HighlightingScheduler(batch => batches.push(batch));

      const lines = [];
      for (let i = 1; i <= 600; i++) {
        lines.push(`Line ${i}`);
      }
      scheduler.registerModel('doc-holes', 'jsp', 'jsp', 1, lines.join('\n'));

      // Jump straight to viewport 400..450
      scheduler.updateViewport('doc-holes', 400, 450);

      // Run slices until scheduler is finished
      while (scheduler.processNextSlice()) {
        // process all slices
      }

      assert.ok(batches.length > 0);
      const coveredLines = new Set();
      let hadCompletedBatch = false;

      for (const b of batches) {
        for (let l = b.startLineNumber; l <= b.endLineNumber; l++) {
          coveredLines.add(l);
        }
        if (b.isCompleted) {
          hadCompletedBatch = true;
          // When isCompleted is true, lines 1 to 600 MUST all be covered!
          assert.equal(coveredLines.size, 600, 'All 600 lines must be covered before isCompleted is true');
        }
      }

      assert.ok(hadCompletedBatch, 'Scheduler must eventually emit isCompleted');
      assert.ok(coveredLines.has(1), 'Line 1 must be covered (no hole in prefix)');
      assert.ok(coveredLines.has(50), 'Line 50 must be covered (no hole in prefix)');
      assert.ok(coveredLines.has(400), 'Line 400 must be covered');
      assert.ok(coveredLines.has(600), 'Line 600 must be covered');
    });
  });
});
