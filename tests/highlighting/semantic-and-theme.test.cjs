'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  TokenizerOwnerRegistry,
} = require('../../packages/highlighting-extension/lib/browser/tokenizer-owner-registry');

const {
  detectLanguageAndDialect,
  isJspFamily,
} = require('../../packages/highlighting-extension/lib/common/language-coverage');

const {
  JdtLsManager,
} = require('../../packages/java-extension/lib/node/jdt-ls-manager');

describe('Semantic Tokens, Ownership, and Diagnostics Tests', () => {
  it('TokenizerOwnerRegistry enforces single ownership and allows deregistration', () => {
    const registry = new TokenizerOwnerRegistry();

    let disposed = false;
    const reg = registry.registerOwner('jsp', 'kairo-worker', 'Kairo Worker Tokenizer', () => {
      disposed = true;
    });

    assert.equal(registry.hasOwner('jsp'), true);
    assert.equal(registry.getOwner('jsp')?.ownerId, 'kairo-worker');

    // Registering another owner cleanly disposes the previous one
    let secondDisposed = false;
    const reg2 = registry.registerOwner('jsp', 'new-worker', 'New Worker Tokenizer', () => {
      secondDisposed = true;
    });
    assert.equal(disposed, true);
    assert.equal(registry.getOwner('jsp')?.ownerId, 'new-worker');

    // Release owner via dispose
    reg2.dispose();
    assert.equal(registry.hasOwner('jsp'), false);
    assert.equal(secondDisposed, true);
  });

  it('detectLanguageAndDialect accurately classifies JSP dialects and Java', () => {
    const infoJsp = detectLanguageAndDialect('file:///src/main/webapp/index.jsp');
    assert.equal(infoJsp.languageId, 'jsp');
    assert.equal(infoJsp.dialect, 'jsp');

    const infoJspf = detectLanguageAndDialect('file:///src/main/webapp/header.jspf');
    assert.equal(infoJspf.languageId, 'jsp');
    assert.equal(infoJspf.dialect, 'jspf');

    const infoJspx = detectLanguageAndDialect('file:///src/main/webapp/view.jspx');
    assert.equal(infoJspx.languageId, 'jsp');
    assert.equal(infoJspx.dialect, 'jspx');
    assert.equal(infoJspx.isXmlSyntax, true);

    const infoTag = detectLanguageAndDialect('file:///src/main/webapp/tags/button.tag');
    assert.equal(infoTag.languageId, 'jsp');
    assert.equal(infoTag.dialect, 'tag');

    const infoTagx = detectLanguageAndDialect('file:///src/main/webapp/tags/menu.tagx');
    assert.equal(infoTagx.languageId, 'jsp');
    assert.equal(infoTagx.dialect, 'tagx');
    assert.equal(infoTagx.isXmlSyntax, true);

    const infoJava = detectLanguageAndDialect('file:///src/main/java/com/example/User.java');
    assert.equal(infoJava.languageId, 'java');
    assert.equal(infoJava.dialect, 'java');

    assert.equal(isJspFamily('jsp'), true);
    assert.equal(isJspFamily('java'), false);
  });

  it('JdtLsManager sends textDocument/semanticTokens/full and range', async () => {
    const calls = [];
    const manager = new JdtLsManager();
    manager.state = 'ready';
    manager.connection = {
      sendRequest: async (method, params) => {
        calls.push({ method, params });
        if (method === 'textDocument/semanticTokens/full') {
          return { resultId: 'r1', data: [1, 2, 3, 4, 5] };
        }
        if (method === 'textDocument/semanticTokens/range') {
          return { resultId: 'r2', data: [6, 7, 8, 9, 10] };
        }
        return null;
      },
    };

    const fullResult = await manager.semanticTokensFull('file:///workspace/Test.java');
    assert.deepEqual(fullResult, { resultId: 'r1', data: [1, 2, 3, 4, 5] });

    const rangeResult = await manager.semanticTokensRange('file:///workspace/Test.java', {
      start: { line: 0, character: 0 },
      end: { line: 10, character: 0 },
    });
    assert.deepEqual(rangeResult, { resultId: 'r2', data: [6, 7, 8, 9, 10] });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'textDocument/semanticTokens/full');
    assert.equal(calls[1].method, 'textDocument/semanticTokens/range');
  });
});
