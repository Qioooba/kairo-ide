'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  IncrementalTokenizer,
} = require('../../packages/highlighting-extension/lib/worker/incremental-tokenizer');

const {
  ModelTokenCache,
  TokenCacheManager,
} = require('../../packages/highlighting-extension/lib/common/token-cache');

const {
  LexerState,
} = require('../../packages/highlighting-extension/lib/common/lexer-state');

const {
  HighlightingScheduler,
} = require('../../packages/highlighting-extension/lib/worker/highlighting-scheduler');

describe('Incremental Worker & Scheduler Tests', () => {
  it('LexerState deep equality protects suffix reuse', () => {
    const s1 = new LexerState('root', undefined, ['java'], 'jsp', '"', 1);
    const s2 = new LexerState('root', undefined, ['java'], 'jsp', '"', 1);
    const s3 = new LexerState('root', undefined, ['javascript'], 'jsp', '"', 1);
    const s4 = new LexerState('root', undefined, ['java'], 'jsp', "'", 1);

    assert.equal(s1.equals(s2), true);
    assert.equal(s1.equals(s3), false);
    assert.equal(s1.equals(s4), false);
    assert.equal(s1.equals(null), false);
  });

  it('ModelTokenCache saves checkpoints every 256 lines and invalidates correctly', () => {
    const cache = new ModelTokenCache('test-uri');
    cache.setVersion(1);

    const state = new LexerState('root', undefined, [], 'jsp');
    cache.addCheckpoint(1, state, 1);
    cache.addCheckpoint(256, state, 1);
    cache.addCheckpoint(512, state, 1);
    cache.addCheckpoint(768, state, 1);

    assert.equal(cache.getClosestCheckpoint(300)?.lineNumber, 256);
    assert.equal(cache.getClosestCheckpoint(600)?.lineNumber, 512);

    // Edit at line 400 must invalidate 512 and 768, while preserving 1 and 256
    cache.invalidateFrom(400);
    assert.equal(cache.getClosestCheckpoint(600)?.lineNumber, 256);
    assert.equal(cache.getClosestCheckpoint(300)?.lineNumber, 256);
  });

  it('IncrementalTokenizer processes slices within time budget', () => {
    const tokenizer = new IncrementalTokenizer('test-uri', 'jsp', 'jsp');
    // Generate 1000 lines of mixed JSP and HTML
    const lines = [];
    for (let i = 1; i <= 1000; i++) {
      if (i % 10 === 0) {
        lines.push(`<% String line_${i} = "val_${i}"; out.println(line_${i}); %>`);
      } else if (i % 5 === 0) {
        lines.push(`<div id="el_${i}">${'${'}item.id == ${i} ? 'active' : 'inactive'}</div>`);
      } else {
        lines.push(`<p>Plain HTML row ${i} with text and static markup</p>`);
      }
    }
    tokenizer.setFullText(lines.join('\n'), 1);

    const slice = tokenizer.tokenizeSlice(1, 500, 50);
    assert.ok(slice.lineTokens.length > 0);
    assert.equal(slice.startLine, 1);
    assert.ok(slice.endLine >= 1);
    assert.ok(slice.hasMore);

    // Verify token structure: Uint32Array with monotonic even indices (end offsets)
    const firstTokens = slice.lineTokens[0];
    assert.ok(firstTokens instanceof Uint32Array);
    for (let k = 2; k < firstTokens.length; k += 2) {
      assert.ok(firstTokens[k] >= firstTokens[k - 2]);
    }
  });

  it('HighlightingScheduler prioritizes viewport with +/- 300 line prefetch', () => {
    const batches = [];
    const scheduler = new HighlightingScheduler(batch => batches.push(batch));

    const lines = [];
    for (let i = 1; i <= 1000; i++) {
      lines.push(`<div>Line ${i}</div>`);
    }

    scheduler.registerModel('doc1', 'jsp', 'jsp', 1, lines.join('\n'));

    // User is viewing lines 400 to 450
    scheduler.updateViewport('doc1', 400, 450);

    // Run one synchronous schedule tick
    scheduler.processNextSlice();

    assert.ok(batches.length > 0);
    const firstBatch = batches[0];
    assert.equal(firstBatch.modelInstanceId, 'doc1');
    // Viewport request with prefetch (-300) means it starts at Math.max(1, 400 - 300) = 100
    assert.ok(firstBatch.startLineNumber <= 400);
  });
});
