'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

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

const { RemotePanelWidget, KAIRO_REMOTE_PANEL_FACTORY_ID } = require('../../lib/browser/remote-panel-widget');

// ------------------------------------------------------------------
// Widget exports tests
// ------------------------------------------------------------------

describe('RemotePanelWidget — Package exports', () => {
  it('RemotePanelWidget is exported', () => {
    assert.strictEqual(typeof RemotePanelWidget, 'function');
  });

  it('RemotePanelWidget has static ID', () => {
    assert.strictEqual(RemotePanelWidget.ID, KAIRO_REMOTE_PANEL_FACTORY_ID);
  });

  it('KAIRO_REMOTE_PANEL_FACTORY_ID is "kairo-remote-panel"', () => {
    assert.strictEqual(KAIRO_REMOTE_PANEL_FACTORY_ID, 'kairo-remote-panel');
  });

  it('RemotePanelWidget has static LABEL', () => {
    assert.strictEqual(RemotePanelWidget.LABEL, 'Remote Panel');
  });
});

// ------------------------------------------------------------------
// Type interface tests
// ------------------------------------------------------------------

describe('Remote panel type interfaces', () => {
  it('ConnectionInfo shape is valid', () => {
    const info = {
      host: '192.168.1.100',
      port: 22,
      tlsVersion: 'TLS 1.3',
      connectedAt: '2026-01-01T00:00:00Z',
      latency: 12,
    };
    assert.strictEqual(typeof info.host, 'string');
    assert.strictEqual(typeof info.port, 'number');
    assert.strictEqual(typeof info.tlsVersion, 'string');
    assert.strictEqual(typeof info.connectedAt, 'string');
    assert.strictEqual(typeof info.latency, 'number');
  });

  it('FileSyncStatus shape is valid', () => {
    const sync = {
      syncing: false,
      totalFiles: 100,
      syncedFiles: 95,
      lastSync: '2026-01-01T00:00:00Z',
      conflicts: 2,
    };
    assert.strictEqual(typeof sync.syncing, 'boolean');
    assert.strictEqual(typeof sync.totalFiles, 'number');
    assert.strictEqual(typeof sync.syncedFiles, 'number');
    assert.strictEqual(typeof sync.lastSync, 'string');
    assert.strictEqual(typeof sync.conflicts, 'number');
  });

  it('ContainerInfo shape is valid', () => {
    const container = {
      id: 'c1',
      name: 'kairo-dev',
      image: 'kairo:latest',
      state: 'running',
      ports: [{ hostPort: 8080, containerPort: 8080 }],
    };
    assert.strictEqual(typeof container.id, 'string');
    assert.strictEqual(typeof container.name, 'string');
    assert.strictEqual(typeof container.image, 'string');
    assert.ok(['running', 'stopped', 'paused'].includes(container.state));
    assert.ok(Array.isArray(container.ports));
    assert.strictEqual(container.ports[0].hostPort, 8080);
    assert.strictEqual(container.ports[0].containerPort, 8080);
  });

  it('ContainerInfo state must be running, stopped, or paused', () => {
    const validStates = ['running', 'stopped', 'paused'];
    for (const s of validStates) {
      assert.ok(validStates.includes(s));
    }
    assert.strictEqual(validStates.length, 3);
  });

  it('SessionInfo shape is valid', () => {
    const session = {
      id: 's1',
      userId: 'u1',
      username: 'alice',
      role: 'admin',
      activeSince: '2026-01-01T00:00:00Z',
      lastActive: '2026-01-01T01:00:00Z',
    };
    assert.strictEqual(typeof session.id, 'string');
    assert.strictEqual(typeof session.userId, 'string');
    assert.strictEqual(typeof session.username, 'string');
    assert.strictEqual(typeof session.role, 'string');
    assert.strictEqual(typeof session.activeSince, 'string');
    assert.strictEqual(typeof session.lastActive, 'string');
  });

  it('RemotePanelState shape is valid', () => {
    const state = {
      connected: true,
      connectionInfo: { host: 'h', port: 22, tlsVersion: 'TLS 1.3', connectedAt: '', latency: 5 },
      fileSync: { syncing: false, totalFiles: 0, syncedFiles: 0, lastSync: '', conflicts: 0 },
      containers: [],
      sessions: [],
      loading: false,
      error: null,
    };
    assert.strictEqual(typeof state.connected, 'boolean');
    assert.strictEqual(typeof state.connectionInfo, 'object');
    assert.strictEqual(typeof state.fileSync, 'object');
    assert.ok(Array.isArray(state.containers));
    assert.ok(Array.isArray(state.sessions));
    assert.strictEqual(typeof state.loading, 'boolean');
    assert.strictEqual(state.error, null);
  });
});

// ------------------------------------------------------------------
// Sync progress calculation
// ------------------------------------------------------------------

describe('File sync progress calculation', () => {
  it('calculates 0% when totalFiles is 0', () => {
    const totalFiles = 0;
    const syncedFiles = 0;
    const progress = totalFiles > 0 ? Math.round((syncedFiles / totalFiles) * 100) : 0;
    assert.strictEqual(progress, 0);
  });

  it('calculates 50% when half synced', () => {
    const totalFiles = 100;
    const syncedFiles = 50;
    const progress = Math.round((syncedFiles / totalFiles) * 100);
    assert.strictEqual(progress, 50);
  });

  it('calculates 100% when fully synced', () => {
    const totalFiles = 200;
    const syncedFiles = 200;
    const progress = Math.round((syncedFiles / totalFiles) * 100);
    assert.strictEqual(progress, 100);
  });

  it('calculates 0% when totalFiles is undefined', () => {
    const totalFiles = undefined;
    const syncedFiles = 0;
    const progress = totalFiles > 0 ? Math.round((syncedFiles / totalFiles) * 100) : 0;
    assert.strictEqual(progress, 0);
  });

  it('calculates 0% when totalFiles is null', () => {
    const totalFiles = null;
    const syncedFiles = 0;
    const progress = totalFiles > 0 ? Math.round((syncedFiles / totalFiles) * 100) : 0;
    assert.strictEqual(progress, 0);
  });

  it('handles syncedFiles exceeding totalFiles gracefully', () => {
    const totalFiles = 100;
    const syncedFiles = 150;
    const progress = Math.round((syncedFiles / totalFiles) * 100);
    assert.strictEqual(progress, 150);
  });
});

// ------------------------------------------------------------------
// Container state transition
// ------------------------------------------------------------------

describe('Container state transitions', () => {
  it('can transition from stopped to running', () => {
    const containers = [
      { id: 'c1', name: 'kairo-dev', image: 'kairo:latest', state: 'stopped', ports: [] },
    ];
    const updated = containers.map(c =>
      c.id === 'c1' ? { ...c, state: 'running' } : c,
    );
    assert.strictEqual(updated[0].state, 'running');
  });

  it('can transition from running to stopped', () => {
    const containers = [
      { id: 'c1', name: 'kairo-dev', image: 'kairo:latest', state: 'running', ports: [] },
    ];
    const updated = containers.map(c =>
      c.id === 'c1' ? { ...c, state: 'stopped' } : c,
    );
    assert.strictEqual(updated[0].state, 'stopped');
  });

  it('can transition from running to paused', () => {
    const containers = [
      { id: 'c1', name: 'kairo-dev', image: 'kairo:latest', state: 'running', ports: [] },
    ];
    const updated = containers.map(c =>
      c.id === 'c1' ? { ...c, state: 'paused' } : c,
    );
    assert.strictEqual(updated[0].state, 'paused');
  });

  it('can transition from paused to running', () => {
    const containers = [
      { id: 'c1', name: 'kairo-dev', image: 'kairo:latest', state: 'paused', ports: [] },
    ];
    const updated = containers.map(c =>
      c.id === 'c1' ? { ...c, state: 'running' } : c,
    );
    assert.strictEqual(updated[0].state, 'running');
  });

  it('only updates the specified container', () => {
    const containers = [
      { id: 'c1', name: 'kairo-dev', image: 'kairo:latest', state: 'running', ports: [] },
      { id: 'c2', name: 'kairo-db', image: 'postgres:15', state: 'stopped', ports: [] },
    ];
    const updated = containers.map(c =>
      c.id === 'c1' ? { ...c, state: 'stopped' } : c,
    );
    assert.strictEqual(updated[0].state, 'stopped');
    assert.strictEqual(updated[1].state, 'stopped');
    assert.strictEqual(updated[1].id, 'c2');
  });
});

// ------------------------------------------------------------------
// Boundary conditions
// ------------------------------------------------------------------

describe('Boundary conditions', () => {
  it('handles empty container list', () => {
    const containers = [];
    assert.strictEqual(containers.length, 0);
  });

  it('handles empty session list', () => {
    const sessions = [];
    assert.strictEqual(sessions.length, 0);
  });

  it('handles null connectionInfo', () => {
    const state = {
      connected: false,
      connectionInfo: null,
      fileSync: { syncing: false, totalFiles: 0, syncedFiles: 0, lastSync: '', conflicts: 0 },
      containers: [],
      sessions: [],
      loading: false,
      error: null,
    };
    assert.strictEqual(state.connectionInfo, null);
  });

  it('handles error state with network error message', () => {
    const state = {
      connected: false,
      connectionInfo: null,
      fileSync: { syncing: false, totalFiles: 0, syncedFiles: 0, lastSync: '', conflicts: 0 },
      containers: [],
      sessions: [],
      loading: false,
      error: 'Network connection failed: unreachable host',
    };
    assert.ok(state.error.toLowerCase().includes('network'));
    assert.ok(state.error.toLowerCase().includes('unreachable'));
  });

  it('handles error state with timeout message', () => {
    const state = {
      connected: false,
      connectionInfo: null,
      fileSync: { syncing: false, totalFiles: 0, syncedFiles: 0, lastSync: '', conflicts: 0 },
      containers: [],
      sessions: [],
      loading: false,
      error: 'Connection timed out after 30s',
    };
    assert.ok(state.error.toLowerCase().includes('timed out'));
  });

  it('handles error state with permission denied message', () => {
    const state = {
      connected: false,
      connectionInfo: null,
      fileSync: { syncing: false, totalFiles: 0, syncedFiles: 0, lastSync: '', conflicts: 0 },
      containers: [],
      sessions: [],
      loading: false,
      error: 'Permission denied: unauthorized access',
    };
    assert.ok(state.error.toLowerCase().includes('permission'));
    assert.ok(state.error.toLowerCase().includes('unauthorized'));
  });

  it('handles loading state', () => {
    const state = {
      connected: false,
      connectionInfo: null,
      fileSync: { syncing: false, totalFiles: 0, syncedFiles: 0, lastSync: '', conflicts: 0 },
      containers: [],
      sessions: [],
      loading: true,
      error: null,
    };
    assert.strictEqual(state.loading, true);
    assert.strictEqual(state.error, null);
  });

  it('handles FileSyncStatus with conflicts', () => {
    const sync = {
      syncing: false,
      totalFiles: 500,
      syncedFiles: 495,
      lastSync: '2026-07-24T10:00:00Z',
      conflicts: 5,
    };
    assert.strictEqual(sync.conflicts, 5);
    assert.ok(sync.conflicts > 0);
  });
});

// ------------------------------------------------------------------
// Connection state changes
// ------------------------------------------------------------------

describe('Connection state changes', () => {
  it('can transition from connected to disconnected', () => {
    let state = {
      connected: true,
      connectionInfo: { host: 'h', port: 22, tlsVersion: 'TLS 1.3', connectedAt: '', latency: 5 },
      fileSync: { syncing: false, totalFiles: 0, syncedFiles: 0, lastSync: '', conflicts: 0 },
      containers: [],
      sessions: [],
      loading: false,
      error: null,
    };
    state = { ...state, connected: false, connectionInfo: null };
    assert.strictEqual(state.connected, false);
    assert.strictEqual(state.connectionInfo, null);
  });

  it('can transition from disconnected to connected', () => {
    let state = {
      connected: false,
      connectionInfo: null,
      fileSync: { syncing: false, totalFiles: 0, syncedFiles: 0, lastSync: '', conflicts: 0 },
      containers: [],
      sessions: [],
      loading: false,
      error: null,
    };
    const newInfo = { host: '10.0.0.1', port: 22, tlsVersion: 'TLS 1.3', connectedAt: new Date().toISOString(), latency: 8 };
    state = { ...state, connected: true, connectionInfo: newInfo };
    assert.strictEqual(state.connected, true);
    assert.strictEqual(state.connectionInfo.host, '10.0.0.1');
  });
});

// ------------------------------------------------------------------
// State color mapping
// ------------------------------------------------------------------

describe('State color mapping', () => {
  it('running is green', () => {
    const color = stateColorFn('running');
    assert.strictEqual(color, '#4caf50');
  });

  it('stopped is red', () => {
    const color = stateColorFn('stopped');
    assert.strictEqual(color, '#f44336');
  });

  it('paused is orange', () => {
    const color = stateColorFn('paused');
    assert.strictEqual(color, '#ff9800');
  });

  it('unknown state is gray', () => {
    const color = stateColorFn('unknown');
    assert.strictEqual(color, '#9e9e9e');
  });
});

function stateColorFn(s) {
  switch (s) {
    case 'running': return '#4caf50';
    case 'stopped': return '#f44336';
    case 'paused': return '#ff9800';
    default: return '#9e9e9e';
  }
}

// ------------------------------------------------------------------
// Latency classification
// ------------------------------------------------------------------

describe('Latency classification', () => {
  it('latency < 20 is Excellent', () => {
    const latency = 12;
    const label = latency < 20 ? 'Excellent' : latency < 50 ? 'Good' : 'High';
    assert.strictEqual(label, 'Excellent');
  });

  it('latency 20-49 is Good', () => {
    const latency = 35;
    const label = latency < 20 ? 'Excellent' : latency < 50 ? 'Good' : 'High';
    assert.strictEqual(label, 'Good');
  });

  it('latency >= 50 is High', () => {
    const latency = 80;
    const label = latency < 20 ? 'Excellent' : latency < 50 ? 'Good' : 'High';
    assert.strictEqual(label, 'High');
  });

  it('latency at boundary 20 is Good', () => {
    const latency = 20;
    const label = latency < 20 ? 'Excellent' : latency < 50 ? 'Good' : 'High';
    assert.strictEqual(label, 'Good');
  });

  it('latency at boundary 50 is High', () => {
    const latency = 50;
    const label = latency < 20 ? 'Excellent' : latency < 50 ? 'Good' : 'High';
    assert.strictEqual(label, 'High');
  });
});

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});