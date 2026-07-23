'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JdtLsManager } = require('../../lib/node/jdt-ls-manager');

function readyManager(resultFor) {
  const calls = [];
  const manager = new JdtLsManager();
  manager.state = 'ready';
  manager.connection = {
    sendRequest: async (method, params) => {
      calls.push({ method, params });
      return resultFor(method);
    },
  };
  return { manager, calls };
}

test('semantic requests use standard JDT LS methods and zero-based positions', async () => {
  const { manager, calls } = readyManager(method => {
    if (method === 'textDocument/references') return [];
    return null;
  });
  const position = { uri: 'file:///workspace/A.java', line: 7, character: 11 };

  await manager.hover(position);
  await manager.implementation(position);
  await manager.references({ ...position, includeDeclaration: true });
  await manager.signatureHelp({ ...position, triggerKind: 2, triggerCharacter: ',', isRetrigger: true });
  await manager.rename({ ...position, newName: 'renamed' });
  await manager.documentSymbols(position.uri);
  await manager.workspaceSymbols('Controller');
  await manager.codeActions({
    uri: position.uri,
    range: { start: { line: 7, character: 0 }, end: { line: 7, character: 20 } },
    diagnostics: [],
    only: ['quickfix'],
  });

  assert.deepEqual(calls, [
    {
      method: 'textDocument/hover',
      params: { textDocument: { uri: position.uri }, position: { line: 7, character: 11 } },
    },
    {
      method: 'textDocument/implementation',
      params: { textDocument: { uri: position.uri }, position: { line: 7, character: 11 } },
    },
    {
      method: 'textDocument/references',
      params: {
        textDocument: { uri: position.uri },
        position: { line: 7, character: 11 },
        context: { includeDeclaration: true },
      },
    },
    {
      method: 'textDocument/signatureHelp',
      params: {
        textDocument: { uri: position.uri },
        position: { line: 7, character: 11 },
        context: { triggerKind: 2, triggerCharacter: ',', isRetrigger: true },
      },
    },
    {
      method: 'textDocument/rename',
      params: {
        textDocument: { uri: position.uri },
        position: { line: 7, character: 11 },
        newName: 'renamed',
      },
    },
    {
      method: 'textDocument/documentSymbol',
      params: { textDocument: { uri: position.uri } },
    },
    {
      method: 'workspace/symbol',
      params: { query: 'Controller' },
    },
    {
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri: position.uri },
        range: { start: { line: 7, character: 0 }, end: { line: 7, character: 20 } },
        context: { diagnostics: [], only: ['quickfix'] },
      },
    },
  ]);
  manager.connection = undefined;
  manager.dispose();
});

test('semantic requests fail honestly while JDT LS is not ready', async () => {
  const manager = new JdtLsManager();
  await assert.rejects(
    manager.hover({ uri: 'file:///A.java', line: 0, character: 0 }),
    /not ready/,
  );
  manager.dispose();
});
