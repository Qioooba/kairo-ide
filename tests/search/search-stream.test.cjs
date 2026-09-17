const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {};
}

require.extensions['.css'] = () => {};

const { FrontendApplicationConfigProvider } =
  require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { SearchStreamService } = require('../../packages/search-extension/lib/browser/search-stream-service');
const { KairoSearchCancelledError } = require('../../packages/search-extension/lib/browser/search-service');
const { KairoSearchSessionModel } = require('../../packages/search-extension/lib/browser/search-session-model');

class MockWebSocket {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.listeners = new Map();
    this.readyState = 0; // CONNECTING
    this.sentMessages = [];
  }

  addEventListener(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
  }

  removeEventListener(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event, data) {
    const handlers = Array.from(this.listeners.get(event) || []);
    for (const h of handlers) {
      h(data);
    }
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.emit('close', {});
  }
}

class TestableSearchStreamService extends SearchStreamService {
  constructor() {
    super();
    this.runtime = {
      baseUrl: () => 'http://127.0.0.1:8080',
      getAgentSecret: () => 'test-secret',
    };
    this.createdSockets = [];
  }

  createWebSocket(url, protocols) {
    const ws = new MockWebSocket(url, protocols);
    this.createdSockets.push(ws);
    return ws;
  }
}

describe('KAIRO-W10: Search Stream Interruption & Socket Reference Isolation', () => {
  it('received batch then close before done is treated as interrupted/error, preserving partial matches', async () => {
    const service = new TestableSearchStreamService();
    const searchPromise = service.searchStream({ workspaceId: 'ws-1', query: 'foo' });

    const ws = service.createdSockets[0];
    assert.ok(ws, 'WebSocket should be created');

    // Simulate open
    ws.emit('open', {});

    // Simulate partial batch arriving
    const match1 = { file: 'A.java', line: 10, column: 5, matchText: 'foo', contextBefore: '', contextAfter: '' };
    ws.emit('message', {
      data: JSON.stringify({
        kind: 'searchStream',
        batchIndex: 0,
        total: 100, // Total estimated 100
        batch: [match1],
      }),
    });

    assert.equal(service.snapshot.matches.length, 1);

    // Premature close (server drops connection or crash without sending event.done)
    ws.emit('close', {});

    await assert.rejects(
      async () => await searchPromise,
      (err) => {
        assert.match(err.message, /搜索中断，结果不完整/);
        return true;
      },
      'Should reject with interruption error when closed before done'
    );

    const snapshot = service.snapshot;
    assert.equal(snapshot.status, 'error', 'Status must be error, not done');
    assert.equal(snapshot.interrupted, true, 'interrupted must be true');
    assert.equal(snapshot.truncated, true, 'truncated must be true');
    assert.equal(snapshot.matches.length, 1, 'Partial results must be preserved');
    assert.equal(snapshot.matches[0].matchText, 'foo');
  });

  it('A cancel -> B start -> A close: does not wipe B socket reference or cancel B', async () => {
    const service = new TestableSearchStreamService();

    // Query A starts
    const searchPromiseA = service.searchStream({ workspaceId: 'ws-1', query: 'queryA' });
    const wsA = service.createdSockets[0];
    wsA.emit('open', {});

    // User cancels Query A
    service.cancel();
    await assert.rejects(
      async () => await searchPromiseA,
      (err) => err instanceof KairoSearchCancelledError
    );

    // Immediately start Query B
    const searchPromiseB = service.searchStream({ workspaceId: 'ws-1', query: 'queryB' });
    const wsB = service.createdSockets[1];
    assert.ok(wsB && wsB !== wsA, 'Query B should have its own socket');

    // Verify service.ws points to wsB
    assert.equal(service['ws'], wsB, 'Current ws must be wsB');

    // Late close event arrives asynchronously from wsA
    wsA.emit('close', {});

    // Assert that wsA close did NOT clear service.ws!
    assert.equal(service['ws'], wsB, 'Query A close must NOT wipe Query B socket reference');

    // Now Query B can receive its results normally and complete
    wsB.emit('open', {});
    wsB.emit('message', {
      data: JSON.stringify({
        kind: 'searchStream',
        batchIndex: 0,
        batch: [{ file: 'B.java', line: 1, column: 1, matchText: 'queryB', contextBefore: '', contextAfter: '' }],
      }),
    });
    wsB.emit('message', {
      data: JSON.stringify({
        kind: 'searchStream',
        done: true,
        total: 1,
      }),
    });

    await searchPromiseB;
    assert.equal(service.snapshot.status, 'done');
    assert.equal(service.snapshot.matches.length, 1);
    assert.equal(service.snapshot.matches[0].file, 'B.java');
  });

  it('done followed by close does not duplicate settle or overwrite done status', async () => {
    const service = new TestableSearchStreamService();
    const searchPromise = service.searchStream({ workspaceId: 'ws-1', query: 'test' });
    const ws = service.createdSockets[0];

    ws.emit('open', {});
    ws.emit('message', {
      data: JSON.stringify({
        kind: 'searchStream',
        done: true,
        total: 0,
      }),
    });

    await searchPromise;
    assert.equal(service.snapshot.status, 'done');

    // Socket closes after done
    ws.emit('close', {});

    // State must still be done, not error/interrupted!
    assert.equal(service.snapshot.status, 'done');
    assert.equal(service.snapshot.interrupted, undefined);
  });

  it('handles explicit truncation from backend', async () => {
    const service = new TestableSearchStreamService();
    const searchPromise = service.searchStream({ workspaceId: 'ws-1', query: 'test' });
    const ws = service.createdSockets[0];

    ws.emit('open', {});
    ws.emit('message', {
      data: JSON.stringify({
        kind: 'searchStream',
        done: true,
        truncated: true,
        total: 1000,
      }),
    });

    await searchPromise;
    assert.equal(service.snapshot.status, 'done');
    assert.equal(service.snapshot.truncated, true);
  });

  it('handles backend event.error properly', async () => {
    const service = new TestableSearchStreamService();
    const searchPromise = service.searchStream({ workspaceId: 'ws-1', query: 'test' });
    const ws = service.createdSockets[0];

    ws.emit('open', {});
    ws.emit('message', {
      data: JSON.stringify({
        kind: 'searchStream',
        error: 'Backend search engine failure',
      }),
    });

    await assert.rejects(
      async () => await searchPromise,
      /Backend search engine failure/
    );

    assert.equal(service.snapshot.status, 'error');
    assert.equal(service.snapshot.error, 'Backend search engine failure');
  });

  it('integrates with KairoSearchSessionModel: premature close transitions model to error with partial matches', async () => {
    const service = new TestableSearchStreamService();
    const model = new KairoSearchSessionModel();
    model['streamService'] = service;

    const streamPromise = model.searchStream({ workspaceId: 'ws-1', query: 'foo' });
    assert.equal(model.snapshot.status, 'loading');

    const ws = service.createdSockets[0];
    ws.emit('open', {});
    ws.emit('message', {
      data: JSON.stringify({
        kind: 'searchStream',
        batchIndex: 0,
        batch: [{ file: 'Partial.java', line: 1, column: 1, matchText: 'foo', contextBefore: '', contextAfter: '' }],
      }),
    });

    // Premature drop
    ws.emit('close', {});

    await streamPromise;

    // Session model should transition to error, not results, but preserve partial matches!
    const sessionSnapshot = model.snapshot;
    assert.equal(sessionSnapshot.status, 'error', 'Session model must reflect error on premature drop');
    assert.equal(sessionSnapshot.matches.length, 1, 'Must retain partial results');
    assert.equal(sessionSnapshot.truncated, true, 'Must indicate incomplete result set');
    assert.match(sessionSnapshot.error.message, /搜索中断，结果不完整/);
  });
});
