'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JavaCompletionProvider } = require('../../lib/browser/java-completion-provider');

function providerWith(client) {
  const provider = new JavaCompletionProvider();
  provider.client = client;
  provider.logger = { info() {}, warn() {} };
  return provider;
}

test('semantic provider forwards ready-state requests without fabricating results', async () => {
  const calls = [];
  const location = {
    uri: 'file:///workspace/A.java',
    range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
  };
  const client = {
    fetchState: async () => 'ready',
    hover: async p => (calls.push(['hover', p]), { contents: 'A' }),
    implementation: async p => (calls.push(['implementation', p]), [location]),
    references: async p => (calls.push(['references', p]), [location]),
    signatureHelp: async p => (calls.push(['signatureHelp', p]), { signatures: [{ label: 'm(int)' }] }),
    documentSymbols: async uri => (calls.push(['documentSymbols', uri]), [{
      name: 'A', kind: 5, range: location.range, selectionRange: location.range,
    }]),
    workspaceSymbols: async query => (calls.push(['workspaceSymbols', query]), [{ name: query, kind: 5, location }]),
    codeActions: async p => (calls.push(['codeActions', p]), [{ title: 'Add import', kind: 'quickfix', edit: { changes: {} } }]),
    rename: async p => (calls.push(['rename', p]), { changes: { [location.uri]: [{ range: location.range, newText: p.newName }] } }),
  };
  const provider = providerWith(client);

  assert.deepEqual(await provider.provideHover(location.uri, 1, 2), { contents: 'A' });
  assert.deepEqual(await provider.provideImplementation(location.uri, 1, 2), [location]);
  assert.deepEqual(await provider.provideReferences(location.uri, 1, 2, true), [location]);
  assert.equal((await provider.provideSignatureHelp({ uri: location.uri, line: 1, character: 2 })).signatures[0].label, 'm(int)');
  assert.equal((await provider.provideDocumentSymbols(location.uri))[0].name, 'A');
  assert.equal((await provider.provideWorkspaceSymbols('Controller'))[0].name, 'Controller');
  assert.equal((await provider.provideCodeActions(location.uri, location.range, [], ['quickfix']))[0].title, 'Add import');
  assert.equal(Object.keys((await provider.provideRename(location.uri, 1, 2, 'B')).changes)[0], location.uri);
  assert.deepEqual(calls.map(call => call[0]), ['hover', 'implementation', 'references', 'signatureHelp', 'documentSymbols', 'workspaceSymbols', 'codeActions', 'rename']);
});

test('semantic provider does not call JDT LS before ready', async () => {
  let called = false;
  const provider = providerWith({
    fetchState: async () => 'initializing',
    hover: async () => { called = true; return { contents: 'wrong' }; },
  });

  assert.equal(await provider.provideHover('file:///A.java', 0, 0), null);
  assert.equal(called, false);
});
