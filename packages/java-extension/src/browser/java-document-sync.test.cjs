// Unit test for the JDT LS document-sync core
// (java-document-sync-core.ts) and the LSP notification
// framing in JdtLsManager (didOpen/didChange must send the
// textDocument/contentChanges envelope, not raw params).
//
// The core is monaco-free by design (monaco cannot be
// require()'d in plain node); the monaco-facing contribution
// (java-document-sync.ts) is thin wiring over this class.
//
// Preamble follows the repo convention from
// java-ls-lifecycle.test.cjs.

'use strict';

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  JavaDocumentSync,
  toMonacoMarkerSeverity,
  lspDiagnosticsToMarkers,
} = require('../../lib/browser/java-document-sync-core');
const { JdtLsManager } = require('../../lib/node/jdt-ls-manager');

const URI = 'file:///repo/src/Main.java';

function makeClient(initialState) {
  let state = initialState;
  const calls = [];
  return {
    calls,
    setState: s => {
      state = s;
    },
    state: () => state,
    didOpen: p => calls.push({ kind: 'didOpen', p }),
    didChange: p => calls.push({ kind: 'didChange', p }),
    didClose: uri => calls.push({ kind: 'didClose', uri }),
  };
}

const LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function snapshot(text) {
  return { uri: URI, languageId: 'java', version: 1, text };
}

test('openDocument sends didOpen immediately when client is ready', () => {
  const client = makeClient('ready');
  const sync = new JavaDocumentSync(client, LOGGER, 10);
  sync.openDocument(snapshot('class Main {}'));
  assert.deepEqual(client.calls, [
    { kind: 'didOpen', p: { uri: URI, languageId: 'java', version: 1, text: 'class Main {}' } },
  ]);
  sync.dispose();
});

test('openDocument buffers while not ready, flushes on ready state change', () => {
  const client = makeClient('initializing');
  const sync = new JavaDocumentSync(client, LOGGER, 10);
  sync.openDocument(snapshot('class Main {}'));
  assert.deepEqual(client.calls, []);

  client.setState('ready');
  sync.handleStateChange('ready');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].kind, 'didOpen');
  sync.dispose();
});

test('changeDocument debounces and sends full-text didChange', async () => {
  const client = makeClient('ready');
  const sync = new JavaDocumentSync(client, LOGGER, 10);
  sync.openDocument(snapshot('class Main {}'));
  sync.changeDocument(URI, 2, 'class Main { int a; }');
  sync.changeDocument(URI, 3, 'class Main { int ab; }');
  await new Promise(resolve => setTimeout(resolve, 50));

  const changes = client.calls.filter(c => c.kind === 'didChange');
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].p, {
    uri: URI,
    version: 3,
    changes: [{ text: 'class Main { int ab; }' }],
  });
  sync.dispose();
});

test('closeDocument sends didClose only when didOpen was delivered', () => {
  const client = makeClient('ready');
  const sync = new JavaDocumentSync(client, LOGGER, 10);
  sync.openDocument(snapshot('class Main {}'));
  sync.closeDocument(URI);
  assert.deepEqual(client.calls.map(c => c.kind), ['didOpen', 'didClose']);
  assert.equal(client.calls[1].uri, URI);
  sync.dispose();
});

test('closeDocument does not send didClose for a never-opened document', () => {
  const client = makeClient('initializing');
  const sync = new JavaDocumentSync(client, LOGGER, 10);
  sync.openDocument(snapshot('class Main {}'));
  sync.closeDocument(URI);
  assert.deepEqual(client.calls, []);
  sync.dispose();
});

test('server restart re-sends didOpen on the next ready transition', () => {
  const client = makeClient('ready');
  const sync = new JavaDocumentSync(client, LOGGER, 10);
  sync.openDocument(snapshot('class Main {}'));
  assert.equal(client.calls.filter(c => c.kind === 'didOpen').length, 1);

  // Server crashes and comes back.
  sync.handleStateChange('crashed');
  client.setState('crashed');
  client.setState('ready');
  sync.handleStateChange('ready');
  assert.equal(client.calls.filter(c => c.kind === 'didOpen').length, 2);
  sync.dispose();
});

test('client errors are swallowed (logged), never thrown', () => {
  const client = makeClient('ready');
  client.didOpen = () => {
    throw new Error('boom');
  };
  const warnings = [];
  const logger = { ...LOGGER, warn: m => warnings.push(String(m)) };
  const sync = new JavaDocumentSync(client, logger, 10);
  sync.openDocument(snapshot('class Main {}'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /boom/);
  sync.dispose();
});

test('toMonacoMarkerSeverity maps LSP 1..4 to Error/Warning/Info/Hint', () => {
  assert.equal(toMonacoMarkerSeverity(1), 8); // Error
  assert.equal(toMonacoMarkerSeverity(2), 4); // Warning
  assert.equal(toMonacoMarkerSeverity(3), 2); // Information
  assert.equal(toMonacoMarkerSeverity(4), 1); // Hint
  assert.equal(toMonacoMarkerSeverity(undefined), 8); // default: error
});

test('lspDiagnosticsToMarkers converts 0-based LSP ranges to 1-based markers', () => {
  const markers = lspDiagnosticsToMarkers([
    {
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } },
      severity: 2,
      source: 'javac',
      code: 42,
      message: 'cannot find symbol',
    },
  ]);
  assert.deepEqual(markers, [
    {
      severity: 4,
      message: 'cannot find symbol',
      source: 'javac',
      code: '42',
      startLineNumber: 1,
      startColumn: 5,
      endLineNumber: 1,
      endColumn: 10,
    },
  ]);
});

test('JdtLsManager.didOpen sends the LSP textDocument envelope', () => {
  const mgr = new JdtLsManager(LOGGER);
  const sent = [];
  mgr.state = 'ready';
  mgr.connection = { sendNotification: (method, params) => sent.push({ method, params }) };
  mgr.didOpen({ uri: URI, languageId: 'java', version: 7, text: 'class Main {}' });
  assert.deepEqual(sent, [
    {
      method: 'textDocument/didOpen',
      params: {
        textDocument: { uri: URI, languageId: 'java', version: 7, text: 'class Main {}' },
      },
    },
  ]);
});

test('JdtLsManager.didChange sends textDocument + contentChanges envelope', () => {
  const mgr = new JdtLsManager(LOGGER);
  const sent = [];
  mgr.state = 'ready';
  mgr.connection = { sendNotification: (method, params) => sent.push({ method, params }) };
  mgr.didChange({ uri: URI, version: 8, changes: [{ text: 'class Main { }' }] });
  assert.deepEqual(sent, [
    {
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: URI, version: 8 },
        contentChanges: [{ text: 'class Main { }' }],
      },
    },
  ]);
});

test('JdtLsManager.didOpen throws while not ready (caller must gate)', () => {
  const mgr = new JdtLsManager(LOGGER);
  assert.throws(() => mgr.didOpen({ uri: URI, languageId: 'java', version: 1, text: '' }), /not ready/);
});
