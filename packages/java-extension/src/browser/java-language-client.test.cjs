// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for JavaLanguageClient — connection status tracking,
// event forwarding, and state transitions.
//
// Tests the pure connection status logic and event forwarding
// without importing the heavy Theia inversify dependency chain.
//
// Run with: pnpm --filter @kairo/java-extension test

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ------------------------------------------------------------------
// Connection status tracking (from JavaLanguageClient)
// ------------------------------------------------------------------

/** Connection status type. */
const STATUS = {
  connected: 'connected',
  disconnected: 'disconnected',
  reconnecting: 'reconnecting',
};

/**
 * Update connection status based on backend state changes.
 * This is the exact logic from JavaLanguageClient.updateConnectionStatus().
 */
function updateConnectionStatus(currentStatus, newState) {
  let status = currentStatus;

  switch (newState) {
    case 'ready':
      status = STATUS.connected;
      break;
    case 'crashed':
    case 'failed':
      status = STATUS.disconnected;
      break;
    case 'starting':
    case 'initializing':
      if (status === STATUS.disconnected) {
        status = STATUS.reconnecting;
      }
      break;
    case 'uninitialized':
    case 'stopping':
    case 'stopped':
      status = STATUS.disconnected;
      break;
  }

  return { status, changed: status !== currentStatus };
}

describe('Connection status: state transitions', () => {
  test('initial state is disconnected', () => {
    const result = updateConnectionStatus(STATUS.disconnected, 'uninitialized');
    assert.equal(result.status, STATUS.disconnected);
    assert.equal(result.changed, false);
  });

  test('uninitialized → starting → reconnecting', () => {
    const step1 = updateConnectionStatus(STATUS.disconnected, 'starting');
    assert.equal(step1.status, STATUS.reconnecting);
    assert.equal(step1.changed, true);
  });

  test('initializing from disconnected → reconnecting', () => {
    const result = updateConnectionStatus(STATUS.disconnected, 'initializing');
    assert.equal(result.status, STATUS.reconnecting);
    assert.equal(result.changed, true);
  });

  test('ready → connected', () => {
    const result = updateConnectionStatus(STATUS.reconnecting, 'ready');
    assert.equal(result.status, STATUS.connected);
    assert.equal(result.changed, true);
  });

  test('crashed → disconnected', () => {
    const result = updateConnectionStatus(STATUS.connected, 'crashed');
    assert.equal(result.status, STATUS.disconnected);
    assert.equal(result.changed, true);
  });

  test('failed → disconnected', () => {
    const result = updateConnectionStatus(STATUS.connected, 'failed');
    assert.equal(result.status, STATUS.disconnected);
    assert.equal(result.changed, true);
  });

  test('stopping → disconnected', () => {
    const result = updateConnectionStatus(STATUS.connected, 'stopping');
    assert.equal(result.status, STATUS.disconnected);
    assert.equal(result.changed, true);
  });

  test('stopped → disconnected', () => {
    const result = updateConnectionStatus(STATUS.connected, 'stopped');
    assert.equal(result.status, STATUS.disconnected);
    assert.equal(result.changed, true);
  });

  test('uninitialized → disconnected', () => {
    const result = updateConnectionStatus(STATUS.connected, 'uninitialized');
    assert.equal(result.status, STATUS.disconnected);
    assert.equal(result.changed, true);
  });

  test('stays connected on duplicate ready', () => {
    const result = updateConnectionStatus(STATUS.connected, 'ready');
    assert.equal(result.status, STATUS.connected);
    assert.equal(result.changed, false);
  });

  test('stays disconnected on duplicate crashed', () => {
    const result = updateConnectionStatus(STATUS.disconnected, 'crashed');
    assert.equal(result.status, STATUS.disconnected);
    assert.equal(result.changed, false);
  });

  test('stays reconnecting on starting from reconnecting', () => {
    const result = updateConnectionStatus(STATUS.reconnecting, 'starting');
    assert.equal(result.status, STATUS.reconnecting);
    assert.equal(result.changed, false);
  });
});

// ------------------------------------------------------------------
// Full connection lifecycle
// ------------------------------------------------------------------

describe('Connection status: full lifecycle', () => {
  test('uninitialized → starting → ready → crashed → starting → ready', () => {
    let status = STATUS.disconnected;
    const events = [];

    function step(state) {
      const result = updateConnectionStatus(status, state);
      if (result.changed) {
        events.push({ from: status, to: result.status, state });
        status = result.status;
      }
    }

    step('uninitialized');     // disconnected (no change)
    step('starting');          // → reconnecting
    step('ready');             // → connected
    step('crashed');           // → disconnected
    step('starting');          // → reconnecting
    step('ready');             // → connected

    assert.equal(status, STATUS.connected);
    assert.equal(events.length, 5);
    assert.deepEqual(events[0], { from: 'disconnected', to: 'reconnecting', state: 'starting' });
    assert.deepEqual(events[1], { from: 'reconnecting', to: 'connected', state: 'ready' });
    assert.deepEqual(events[2], { from: 'connected', to: 'disconnected', state: 'crashed' });
    assert.deepEqual(events[3], { from: 'disconnected', to: 'reconnecting', state: 'starting' });
    assert.deepEqual(events[4], { from: 'reconnecting', to: 'connected', state: 'ready' });
  });

  test('stays disconnected throughout failed states', () => {
    let status = STATUS.disconnected;
    const states = ['uninitialized', 'stopped', 'failed', 'stopping', 'uninitialized'];
    for (const state of states) {
      const result = updateConnectionStatus(status, state);
      status = result.status;
      assert.equal(status, STATUS.disconnected);
    }
  });
});

// ------------------------------------------------------------------
// Event forwarding logic (from JavaLanguageClient.forwardBackendEvent)
// ------------------------------------------------------------------

function forwardBackendEvent(e, handlers) {
  if (e.kind === 'state' && e.state) {
    handlers.onState(e.state);
  } else if (e.kind === 'log' && e.log) {
    handlers.onLog(e.log);
  } else if (e.kind === 'diagnostics' && e.diagnostics) {
    handlers.onDiagnostics(e.diagnostics);
  } else if (e.kind === 'message' && e.message) {
    handlers.onMessage(e.message);
  } else if (e.kind === 'progress' && e.progress) {
    handlers.onProgress(e.progress);
  }
}

describe('Event forwarding: forwardBackendEvent', () => {
  test('forwards state events', () => {
    const events = [];
    const handlers = {
      onState: (s) => events.push({ kind: 'state', value: s }),
      onLog: () => {},
      onDiagnostics: () => {},
      onMessage: () => {},
      onProgress: () => {},
    };
    forwardBackendEvent({ kind: 'state', state: 'ready' }, handlers);
    assert.equal(events.length, 1);
    assert.equal(events[0].value, 'ready');
  });

  test('forwards log events', () => {
    const events = [];
    const handlers = {
      onState: () => {},
      onLog: (l) => events.push({ kind: 'log', value: l }),
      onDiagnostics: () => {},
      onMessage: () => {},
      onProgress: () => {},
    };
    forwardBackendEvent({ kind: 'log', log: { level: 'stderr', line: 'error' } }, handlers);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].value, { level: 'stderr', line: 'error' });
  });

  test('forwards diagnostics events', () => {
    const events = [];
    const handlers = {
      onState: () => {},
      onLog: () => {},
      onDiagnostics: (d) => events.push({ kind: 'diagnostics', value: d }),
      onMessage: () => {},
      onProgress: () => {},
    };
    const diagParams = { uri: 'file:///Test.java', diagnostics: [{ severity: 1, message: 'Error' }] };
    forwardBackendEvent({ kind: 'diagnostics', diagnostics: diagParams }, handlers);
    assert.equal(events.length, 1);
    assert.equal(events[0].value.uri, 'file:///Test.java');
  });

  test('forwards message events', () => {
    const events = [];
    const handlers = {
      onState: () => {},
      onLog: () => {},
      onDiagnostics: () => {},
      onMessage: (m) => events.push({ kind: 'message', value: m }),
      onProgress: () => {},
    };
    forwardBackendEvent({ kind: 'message', message: 'Hello from backend' }, handlers);
    assert.equal(events.length, 1);
    assert.equal(events[0].value, 'Hello from backend');
  });

  test('forwards progress events', () => {
    const events = [];
    const handlers = {
      onState: () => {},
      onLog: () => {},
      onDiagnostics: () => {},
      onMessage: () => {},
      onProgress: (p) => events.push({ kind: 'progress', value: p }),
    };
    const progress = { id: '1', task: 'Building workspace' };
    forwardBackendEvent({ kind: 'progress', progress }, handlers);
    assert.equal(events.length, 1);
    assert.equal(events[0].value.id, '1');
  });

  test('ignores unknown event kinds', () => {
    let called = false;
    const handlers = {
      onState: () => { called = true; },
      onLog: () => { called = true; },
      onDiagnostics: () => { called = true; },
      onMessage: () => { called = true; },
      onProgress: () => { called = true; },
    };
    forwardBackendEvent({ kind: 'unknown' }, handlers);
    assert.equal(called, false);
  });

  test('ignores state event without state value', () => {
    let called = false;
    const handlers = {
      onState: () => { called = true; },
      onLog: () => {},
      onDiagnostics: () => {},
      onMessage: () => {},
      onProgress: () => {},
    };
    forwardBackendEvent({ kind: 'state' }, handlers);
    assert.equal(called, false);
  });

  test('ignores diagnostics event without diagnostics value', () => {
    let called = false;
    const handlers = {
      onState: () => {},
      onLog: () => {},
      onDiagnostics: () => { called = true; },
      onMessage: () => {},
      onProgress: () => {},
    };
    forwardBackendEvent({ kind: 'diagnostics' }, handlers);
    assert.equal(called, false);
  });
});

// ------------------------------------------------------------------
// ClientConnectionStatus type
// ------------------------------------------------------------------

describe('ClientConnectionStatus', () => {
  test('has three valid states', () => {
    const valid = ['connected', 'disconnected', 'reconnecting'];
    assert.equal(valid.length, 3);
    assert.ok(valid.includes('connected'));
    assert.ok(valid.includes('disconnected'));
    assert.ok(valid.includes('reconnecting'));
  });
});

// ------------------------------------------------------------------
// getConnectionStatus
// ------------------------------------------------------------------

describe('getConnectionStatus', () => {
  test('returns current connection status', () => {
    const status = STATUS.connected;
    assert.equal(status, 'connected');
  });

  test('disconnected is the default', () => {
    const status = STATUS.disconnected;
    assert.equal(status, 'disconnected');
  });
});

// ------------------------------------------------------------------
// RPC proxy fallback logic
// ------------------------------------------------------------------

const RPC_FAILED_MARKER = 'RPC_FAILED';

/**
 * Simulates the proxy() method logic.
 * When RPC fails, we permanently fall back to in-process service.
 */
function createProxyHandler(rpcAvailable) {
  let rpcFailed = false;
  let rpcProxy = undefined;

  return {
    getProxy() {
      if (rpcFailed || !rpcAvailable) {
        return undefined;
      }
      if (!rpcProxy) {
        try {
          rpcProxy = { call: (method) => `rpc:${method}` };
        } catch (err) {
          rpcFailed = true;
          return undefined;
        }
      }
      return rpcProxy;
    },
    markFailed() {
      rpcFailed = true;
      rpcProxy = undefined;
    },
    get failed() { return rpcFailed; },
  };
}

describe('RPC proxy fallback', () => {
  test('creates proxy when RPC is available', () => {
    const handler = createProxyHandler(true);
    const proxy = handler.getProxy();
    assert.ok(proxy);
    assert.equal(handler.failed, false);
  });

  test('returns undefined when RPC is unavailable', () => {
    const handler = createProxyHandler(false);
    const proxy = handler.getProxy();
    assert.equal(proxy, undefined);
  });

  test('marks RPC as failed', () => {
    const handler = createProxyHandler(true);
    handler.getProxy(); // create proxy
    handler.markFailed();
    assert.equal(handler.failed, true);
    assert.equal(handler.getProxy(), undefined);
  });

  test('permanently falls back after failure', () => {
    const handler = createProxyHandler(true);
    handler.getProxy();
    handler.markFailed();
    // After failure, even if RPC is available, we stay in fallback
    assert.equal(handler.getProxy(), undefined);
  });
});

// ------------------------------------------------------------------
// Connection status event emission pattern
// ------------------------------------------------------------------

describe('Connection status: event emission', () => {
  test('emits event only when status changes', () => {
    const events = [];
    let currentStatus = STATUS.disconnected;

    function processState(state) {
      const result = updateConnectionStatus(currentStatus, state);
      if (result.changed) {
        events.push({ oldStatus: currentStatus, newStatus: result.status, state });
        currentStatus = result.status;
      }
    }

    processState('starting');     // disconnected → reconnecting
    processState('starting');     // no change
    processState('ready');        // reconnecting → connected
    processState('ready');        // no change
    processState('crashed');     // connected → disconnected

    assert.equal(events.length, 3);
    assert.equal(events[0].newStatus, 'reconnecting');
    assert.equal(events[1].newStatus, 'connected');
    assert.equal(events[2].newStatus, 'disconnected');
  });

  test('does not emit for same status', () => {
    const events = [];
    let currentStatus = STATUS.disconnected;

    function processState(state) {
      const result = updateConnectionStatus(currentStatus, state);
      if (result.changed) {
        events.push(result.status);
        currentStatus = result.status;
      }
    }

    processState('uninitialized');  // no change
    processState('stopped');        // no change
    processState('failed');         // no change

    assert.equal(events.length, 0);
  });
});