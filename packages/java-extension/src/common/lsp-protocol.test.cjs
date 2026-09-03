// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the LSP message framing codec. The tests
// drive the parser with realistic JDT LS payloads so the
// byte boundaries (header/body split, multi-message chunks,
// malformed messages) are covered. Runs with Node's
// built-in test runner; no mocha / ts-node required.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { encodeLspMessage, LSPMessageParser } = require('../../lib/common/lsp-protocol');

test('LSP message framing: round-trips a single complete message', () => {
  const original = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { foo: 'bar' } };
  const framed = encodeLspMessage(original);
  const parser = new LSPMessageParser();
  const out = parser.push(framed);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], original);
  assert.equal(parser.pendingBytes(), 0);
});

test('LSP message framing: parses across chunk boundaries (header split)', () => {
  const original = { jsonrpc: '2.0', method: 'initialized', params: {} };
  const framed = encodeLspMessage(original);
  const parser = new LSPMessageParser();
  const splitAt = Math.floor(framed.length / 3);
  const chunk1 = framed.subarray(0, splitAt);
  const chunk2 = framed.subarray(splitAt);
  const out1 = parser.push(chunk1);
  assert.equal(out1.length, 0, 'no message yet after partial header');
  const out2 = parser.push(chunk2);
  assert.equal(out2.length, 1, 'message complete after second chunk');
  assert.deepEqual(out2[0], original);
});

test('LSP message framing: parses multiple messages from one chunk', () => {
  const parser = new LSPMessageParser();
  const combined = Buffer.concat([
    encodeLspMessage({ id: 1, method: 'foo' }),
    encodeLspMessage({ id: 2, method: 'bar' }),
    encodeLspMessage({ id: 3, method: 'baz' }),
  ]);
  const out = parser.push(combined);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.id), [1, 2, 3]);
});

test('LSP message framing: throws on a missing Content-Length header', () => {
  const parser = new LSPMessageParser();
  const bad = Buffer.from('X-Wrong: 5\r\n\r\n{}', 'ascii');
  assert.throws(() => parser.push(bad), /Content-Length/);
});

test('LSP message framing: rejects negative Content-Length', () => {
  const parser = new LSPMessageParser();
  const bad = Buffer.from('Content-Length: -1\r\n\r\n', 'ascii');
  assert.throws(() => parser.push(bad), /invalid Content-Length/);
});

test('LSP message framing: serializes an initialize request the way the LS expects', () => {
  const init = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      processId: 42,
      rootUri: 'file:///workspace',
      capabilities: { textDocument: { completion: { dynamicRegistration: true } } },
    },
  };
  const framed = encodeLspMessage(init);
  assert.match(framed.toString('ascii').slice(0, 30), /^Content-Length: \d+\r\n\r\n/);
  const parser = new LSPMessageParser();
  const out = parser.push(framed);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], init);
});

test('LSP message framing: parses a non-ASCII body (Chinese identifier)', () => {
  const original = { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { text: 'class 你好 { }' } };
  const framed = encodeLspMessage(original);
  const parser = new LSPMessageParser();
  const out = parser.push(framed);
  assert.equal(out.length, 1);
  assert.equal(out[0].params.text, 'class 你好 { }');
});

test('LSPMessageParser: reset() discards partial state', () => {
  const parser = new LSPMessageParser();
  const framed = encodeLspMessage({ id: 1, method: 'a' });
  const headerEnd = framed.indexOf('\r\n\r\n') + 4;
  parser.push(framed.subarray(0, headerEnd));
  assert.ok(parser.pendingBytes() > 0);
  parser.reset();
  assert.equal(parser.pendingBytes(), 0);
});

test('normalizeLspDocumentUri: matches encoded Windows drive letters', () => {
  const { normalizeLspDocumentUri, lspUrisReferToSameDocument, collectLspTextEditsForUri } = require('../../lib/common/lsp-protocol');
  const monacoUri = 'file:///g%3A/spaces/kairo-ide/Caller.java';
  const jdtUri = 'file:///g:/spaces/kairo-ide/Caller.java';
  const jdtUpper = 'file:///G:/spaces/kairo-ide/Caller.java';
  const twoSlash = 'file://G:/spaces/kairo-ide/Caller.java';
  assert.equal(normalizeLspDocumentUri(monacoUri), normalizeLspDocumentUri(jdtUri));
  assert.equal(lspUrisReferToSameDocument(monacoUri, jdtUri), true);
  assert.equal(lspUrisReferToSameDocument(monacoUri, jdtUpper), true);
  assert.equal(lspUrisReferToSameDocument(monacoUri, twoSlash), true);
  assert.equal(lspUrisReferToSameDocument(jdtUri, 'file:///g:/spaces/other/Caller.java'), false);

  const edit = {
    changes: {
      [jdtUri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, newText: 'import java.util.List;\n' }],
    },
  };
  const collected = collectLspTextEditsForUri(edit, monacoUri);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].newText, 'import java.util.List;\n');

  const documentEdit = {
    documentChanges: [
      {
        textDocument: { uri: jdtUpper, version: 3 },
        edits: [{ range: { start: { line: 2, character: 0 }, end: { line: 3, character: 0 } }, newText: '' }],
      },
      { kind: 'create', uri: 'file:///g:/spaces/kairo-ide/New.java' },
    ],
  };
  const fromDocument = collectLspTextEditsForUri(documentEdit, monacoUri);
  assert.equal(fromDocument.length, 1);
  assert.equal(fromDocument[0].newText, '');
});

test('LSP message framing: handles byte-by-byte push', () => {
  const original = { id: 7, method: 'ping' };
  const framed = encodeLspMessage(original);
  const parser = new LSPMessageParser();
  for (let i = 0; i < framed.length; i++) {
    const out = parser.push(framed.subarray(i, i + 1));
    if (i < framed.length - 1) {
      assert.equal(out.length, 0, `no message at byte ${i}`);
    } else {
      assert.equal(out.length, 1, `message at final byte ${i}`);
    }
  }
});
