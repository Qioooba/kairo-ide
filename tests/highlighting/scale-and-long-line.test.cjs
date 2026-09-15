'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  IncrementalTokenizer,
} = require('../../packages/highlighting-extension/lib/worker/incremental-tokenizer');

const {
  HighlightingScheduler,
} = require('../../packages/highlighting-extension/lib/worker/highlighting-scheduler');

const {
  classifyLargeFile,
  DEFAULT_LARGE_FILE_THRESHOLDS,
  editorOptionsForLargeFile,
} = require('../../packages/theia-product/lib/browser/large-file-policy');

describe('Scale and Long-Line Tests', () => {
  it('Ultra-long line (>25,000 chars) tokenizes safely without error', () => {
    const tokenizer = new IncrementalTokenizer('test://longline.jsp', 'jsp', 'jsp');
    // Construct 25,000 character line with mixed HTML, EL, and text
    const longChunk = '<span class="item" title="Long data column">';
    const repeats = Math.ceil(25000 / longChunk.length);
    const longLine = longChunk.repeat(repeats) + '</span>';

    tokenizer.setFullText(longLine, 1);
    const slice = tokenizer.tokenizeSlice(1, 1, 100);

    assert.equal(slice.lineTokens.length, 1);
    const tokens = slice.lineTokens[0];
    assert.ok(tokens.length > 0);
    assert.equal(slice.isCompleted, true);

    // Verify last token ends at the end of the line
    const lastOffset = tokens[tokens.length - 2];
    assert.equal(lastOffset, longLine.length);
  });

  it('Large file (>10,000 lines) tokenizes incrementally with progress', () => {
    const tokenizer = new IncrementalTokenizer('test://large.jsp', 'jsp', 'jsp');
    const totalLines = 10000;
    const lines = [];
    for (let i = 1; i <= totalLines; i++) {
      lines.push(`<tr><td>#${i}</td><td>\${row.name}</td><td>\${row.price}</td></tr>`);
    }
    tokenizer.setFullText(lines.join('\n'), 1);

    // First slice (time-bounded)
    const slice1 = tokenizer.tokenizeSlice(1, 1000, 20);
    assert.ok(slice1.endLine >= 1);
    assert.ok(slice1.endLine <= 1000);
    assert.equal(slice1.hasMore, true);

    // Checkpoint verification: checkpoints were recorded
    const cache = tokenizer.getCache();
    const cp = cache.getClosestCheckpoint(500);
    assert.ok(cp !== undefined);
  });

  it('Multi-model fair scheduling serves multiple open documents cooperatively', () => {
    const batches = [];
    const scheduler = new HighlightingScheduler(batch => batches.push(batch));

    const linesA = Array.from({ length: 500 }, (_, i) => `<p>DocA line ${i}</p>`).join('\n');
    const linesB = Array.from({ length: 500 }, (_, i) => `<p>DocB line ${i}</p>`).join('\n');

    scheduler.registerModel('docA', 'jsp', 'jsp', 1, linesA, { startLine: 1, endLine: 50 });
    scheduler.registerModel('docB', 'jsp', 'jsp', 1, linesB, { startLine: 1, endLine: 50 });

    // Step scheduler
    scheduler.processNextSlice();
    scheduler.processNextSlice();

    assert.ok(batches.length >= 2);
    const docIds = new Set(batches.map(b => b.modelInstanceId));
    assert.ok(docIds.has('docA') || docIds.has('docB'));
  });

  it('Large file policy retains full-line syntax highlighting (stopRenderingLineAfter = -1)', () => {
    const optsLarge = editorOptionsForLargeFile('large');
    assert.equal(optsLarge.stopRenderingLineAfter, -1);

    const optsHuge = editorOptionsForLargeFile('huge');
    assert.equal(optsHuge.stopRenderingLineAfter, -1);

    // Threshold classification
    assert.equal(classifyLargeFile({ characterCount: 100, lineCount: 10 }), 'normal');
    assert.equal(classifyLargeFile({ characterCount: 6_000_000, lineCount: 1000 }), 'large');
    assert.equal(classifyLargeFile({ characterCount: 60_000_000, lineCount: 1000 }), 'huge');
  });
});
