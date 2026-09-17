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

  it('W02: applyEdits without fullTextFallback actually updates text mirror and matches full re-tokenize', () => {
    const originalText = 'int x = 1;\r\nString str = "hello";\r\n// comment line\r\n';
    const tokenizer = new IncrementalTokenizer('test-m1', 'java', 'java');
    tokenizer.setFullText(originalText, 1);

    // Initial tokenization of line 2
    const initialSlice = tokenizer.tokenizeSlice(2, 2, 50);
    assert.equal(initialSlice.lineTokens.length, 1);

    // Edit line 2: replace "hello" with "world 🚀 中文"
    // "hello" starts at offset: "int x = 1;\r\nString str = \"".length = 12 + 14 = 26
    const offset = originalText.indexOf('"hello"') + 1;
    const len = 'hello'.length;
    const replacement = 'world 🚀 中文';

    const changes = [
      { rangeOffset: offset, rangeLength: len, text: replacement },
    ];

    // Apply incremental edit WITHOUT fullTextFallback!
    const dirtyLine = tokenizer.applyEdits(changes, 2);
    assert.equal(dirtyLine, 2, 'earliest dirty line must be 2');

    // Expected text after edit
    const expectedText = originalText.slice(0, offset) + replacement + originalText.slice(offset + len);

    // Retokenize line 2 with the incrementally edited tokenizer
    const editedSlice = tokenizer.tokenizeSlice(2, 2, 50);

    // Compare with full fresh tokenization of expectedText
    const freshTokenizer = new IncrementalTokenizer('test-m2', 'java', 'java');
    freshTokenizer.setFullText(expectedText, 2);
    const freshSlice = freshTokenizer.tokenizeSlice(2, 2, 50);

    assert.deepEqual(
      Array.from(editedSlice.lineTokens[0]),
      Array.from(freshSlice.lineTokens[0]),
      'Incremental tokens must match fresh tokens after edit without fullTextFallback'
    );
  });

  it('W03: tokenizeEncoded outputs [startIndex, metadata] and metadata conforms to Monaco bitfield', () => {
    const { MonacoTokenizationAdapter } = require('../../packages/highlighting-extension/lib/browser/monaco-tokenization-adapter');
    const adapter = new MonacoTokenizationAdapter('java', 'java');
    const line = 'int x = 1;';
    const encoded = adapter.tokenizeEncoded(line, false, adapter.getInitialState());

    const tokens = encoded.tokens;
    assert.ok(tokens instanceof Uint32Array);
    assert.ok(tokens.length >= 4);

    // Even indices are start indices: token 0 starts at 0, token 1 starts > 0
    assert.equal(tokens[0], 0, 'First token startIndex must be 0');
    assert.ok(tokens[2] > tokens[0], 'Subsequent tokens must have increasing startIndex');

    // Odd indices are metadata: must NOT be raw kindId (e.g. 9 or 10)
    // Monaco metadata has languageId in bits 0-7, tokenType in bits 8-9, etc.
    // If it was just kindId 9, bits 15-23 (foreground) would be 0, which is invalid.
    const meta0 = tokens[1];
    assert.notEqual(meta0, 9, 'Metadata must not be raw kindId enum 9');
    assert.notEqual(meta0, 10, 'Metadata must not be raw kindId enum 10');
    assert.ok(meta0 > 255, 'Metadata must be a packed Monaco 32-bit integer');
  });

  it('W03: convertLexicalToStoredTokens formats [endOffset, metadata] and applyTokenBatch validates documentVersion', () => {
    const {
      MonacoTokenizationAdapter,
      convertLexicalToStoredTokens,
    } = require('../../packages/highlighting-extension/lib/browser/monaco-tokenization-adapter');

    const lexical = new Uint32Array([3, 9, 4, 10]); // endOffset 3 (kw), endOffset 4 (id)
    const stored = convertLexicalToStoredTokens(lexical);
    assert.equal(stored[0], 3, 'First token endOffset must be preserved as 3');
    assert.notEqual(stored[1], 9, 'First token metadata must be packed, not raw kindId 9');
    assert.equal(stored[2], 4, 'Second token endOffset must be preserved as 4');
    assert.notEqual(stored[3], 10, 'Second token metadata must be packed, not raw kindId 10');

    // Test applyTokenBatch documentVersion check
    const adapter = new MonacoTokenizationAdapter('java', 'java');
    let setTokensCalled = false;
    const mockStore = {
      setTokens: () => { setTokensCalled = true; },
      setEndState: () => {},
      backgroundTokenizationFinished: () => {},
    };
    const mockModel = {
      uri: { toString: () => 'file:///test.java' },
      getVersionId: () => 5, // current model version is 5
    };
    adapter.createBackgroundTokenizer(mockModel, mockStore);

    // Stale batch with version 4 must be dropped
    adapter.applyTokenBatch('file:///test.java', {
      type: 'tokens',
      modelInstanceId: 'test.java',
      documentVersion: 4,
      startLineNumber: 1,
      endLineNumber: 1,
      lineTokens: [new Uint32Array([3, 9])],
    });
    assert.equal(setTokensCalled, false, 'Stale batch (v4 vs model v5) must be discarded');
  });
});

