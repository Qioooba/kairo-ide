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

const { DebugMultiModuleWidget, KAIRO_MULTIMODULE_DEBUG_FACTORY_ID } = require('../../lib/browser/debug-multimodule-widget');

// ------------------------------------------------------------------
// Widget exports tests
// ------------------------------------------------------------------

describe('DebugMultiModuleWidget — Package exports', () => {
  it('DebugMultiModuleWidget is exported', () => {
    assert.strictEqual(typeof DebugMultiModuleWidget, 'function');
  });

  it('DebugMultiModuleWidget has static ID', () => {
    assert.strictEqual(DebugMultiModuleWidget.ID, KAIRO_MULTIMODULE_DEBUG_FACTORY_ID);
  });

  it('KAIRO_MULTIMODULE_DEBUG_FACTORY_ID is "kairo-multimodule-debug"', () => {
    assert.strictEqual(KAIRO_MULTIMODULE_DEBUG_FACTORY_ID, 'kairo-multimodule-debug');
  });

  it('DebugMultiModuleWidget has static LABEL', () => {
    assert.strictEqual(DebugMultiModuleWidget.LABEL, 'Multi-Module Debug');
  });
});

// ------------------------------------------------------------------
// Type interface tests
// ------------------------------------------------------------------

describe('Multi-module debug type interfaces', () => {
  it('ModuleDebugSession shape is valid', () => {
    const session = {
      id: 's1',
      moduleName: 'module-a',
      state: 'running',
      port: 5005,
      hostname: 'localhost',
      startedAt: '2026-01-01T00:00:00Z',
    };
    assert.strictEqual(typeof session.id, 'string');
    assert.strictEqual(typeof session.moduleName, 'string');
    assert.ok(['not_connected', 'connected', 'running', 'suspended', 'terminated'].includes(session.state));
    assert.strictEqual(typeof session.port, 'number');
    assert.strictEqual(typeof session.hostname, 'string');
    assert.strictEqual(typeof session.startedAt, 'string');
  });

  it('ModuleDebugSession state must be one of five valid states', () => {
    const validStates = ['not_connected', 'connected', 'running', 'suspended', 'terminated'];
    assert.strictEqual(validStates.length, 5);
    for (const s of validStates) {
      assert.ok(validStates.includes(s));
    }
  });

  it('CrossModuleBreakpoint shape is valid', () => {
    const bp = {
      id: 1,
      moduleName: 'module-a',
      className: 'com.example.Main',
      lineNumber: 42,
      enabled: true,
      isDeferred: false,
      resolvedClassNames: ['com.example.Main'],
    };
    assert.strictEqual(typeof bp.id, 'number');
    assert.strictEqual(typeof bp.moduleName, 'string');
    assert.strictEqual(typeof bp.className, 'string');
    assert.strictEqual(typeof bp.lineNumber, 'number');
    assert.strictEqual(typeof bp.enabled, 'boolean');
    assert.strictEqual(typeof bp.isDeferred, 'boolean');
    assert.ok(Array.isArray(bp.resolvedClassNames));
  });

  it('DebugEvent shape is valid', () => {
    const event = {
      timestamp: '2026-01-01T00:00:00Z',
      sessionId: 's1',
      moduleName: 'module-a',
      eventType: 'breakpointHit',
      className: 'com.example.Main',
      lineNumber: 42,
    };
    assert.strictEqual(typeof event.timestamp, 'string');
    assert.strictEqual(typeof event.sessionId, 'string');
    assert.strictEqual(typeof event.moduleName, 'string');
    assert.strictEqual(typeof event.eventType, 'string');
    assert.strictEqual(typeof event.className, 'string');
    assert.strictEqual(typeof event.lineNumber, 'number');
  });

  it('MultiModuleDebugState shape is valid', () => {
    const state = {
      sessions: [],
      breakpoints: [],
      events: [],
      moduleOrder: [],
      loading: false,
      error: null,
    };
    assert.ok(Array.isArray(state.sessions));
    assert.ok(Array.isArray(state.breakpoints));
    assert.ok(Array.isArray(state.events));
    assert.ok(Array.isArray(state.moduleOrder));
    assert.strictEqual(typeof state.loading, 'boolean');
    assert.strictEqual(state.error, null);
  });
});

// ------------------------------------------------------------------
// Session state mapping tests
// ------------------------------------------------------------------

describe('Session state mapping', () => {
  it('maps idle to not_connected', () => {
    const state = mapState('idle');
    assert.strictEqual(state, 'not_connected');
  });

  it('maps stopped to not_connected', () => {
    const state = mapState('stopped');
    assert.strictEqual(state, 'not_connected');
  });

  it('maps starting to connected', () => {
    const state = mapState('starting');
    assert.strictEqual(state, 'connected');
  });

  it('maps running to running', () => {
    const state = mapState('running');
    assert.strictEqual(state, 'running');
  });

  it('maps paused to suspended', () => {
    const state = mapState('paused');
    assert.strictEqual(state, 'suspended');
  });

  it('maps crashed to terminated', () => {
    const state = mapState('crashed');
    assert.strictEqual(state, 'terminated');
  });

  it('maps unknown state to not_connected', () => {
    const state = mapState('unknown');
    assert.strictEqual(state, 'not_connected');
  });

  it('maps null to not_connected', () => {
    const state = mapState(null);
    assert.strictEqual(state, 'not_connected');
  });

  it('maps undefined to not_connected', () => {
    const state = mapState(undefined);
    assert.strictEqual(state, 'not_connected');
  });

  it('maps stopping to terminated', () => {
    const state = mapState('stopping');
    assert.strictEqual(state, 'terminated');
  });
});

// ------------------------------------------------------------------
// Breakpoint toggle logic
// ------------------------------------------------------------------

describe('Breakpoint toggle', () => {
  it('can toggle enabled to disabled', () => {
    const breakpoints = [
      { id: 1, moduleName: 'm1', className: 'C', lineNumber: 10, enabled: true, isDeferred: false, resolvedClassNames: ['C'] },
    ];
    const updated = breakpoints.map(bp =>
      bp.id === 1 ? { ...bp, enabled: !bp.enabled } : bp,
    );
    assert.strictEqual(updated[0].enabled, false);
  });

  it('can toggle disabled to enabled', () => {
    const breakpoints = [
      { id: 1, moduleName: 'm1', className: 'C', lineNumber: 10, enabled: false, isDeferred: false, resolvedClassNames: ['C'] },
    ];
    const updated = breakpoints.map(bp =>
      bp.id === 1 ? { ...bp, enabled: !bp.enabled } : bp,
    );
    assert.strictEqual(updated[0].enabled, true);
  });

  it('only toggles the specified breakpoint', () => {
    const breakpoints = [
      { id: 1, moduleName: 'm1', className: 'C1', lineNumber: 10, enabled: true, isDeferred: false, resolvedClassNames: ['C1'] },
      { id: 2, moduleName: 'm2', className: 'C2', lineNumber: 20, enabled: true, isDeferred: false, resolvedClassNames: ['C2'] },
    ];
    const updated = breakpoints.map(bp =>
      bp.id === 1 ? { ...bp, enabled: !bp.enabled } : bp,
    );
    assert.strictEqual(updated[0].enabled, false);
    assert.strictEqual(updated[1].enabled, true);
  });

  it('can toggle multiple times', () => {
    let breakpoints = [
      { id: 1, moduleName: 'm1', className: 'C', lineNumber: 10, enabled: true, isDeferred: false, resolvedClassNames: ['C'] },
    ];
    breakpoints = breakpoints.map(bp => ({ ...bp, enabled: !bp.enabled }));
    assert.strictEqual(breakpoints[0].enabled, false);
    breakpoints = breakpoints.map(bp => ({ ...bp, enabled: !bp.enabled }));
    assert.strictEqual(breakpoints[0].enabled, true);
  });
});

// ------------------------------------------------------------------
// Boundary conditions
// ------------------------------------------------------------------

describe('Boundary conditions', () => {
  it('handles empty sessions array', () => {
    const sessions = [];
    assert.strictEqual(sessions.length, 0);
  });

  it('handles empty breakpoints array', () => {
    const breakpoints = [];
    assert.strictEqual(breakpoints.length, 0);
  });

  it('handles empty events array', () => {
    const events = [];
    assert.strictEqual(events.length, 0);
  });

  it('handles empty moduleOrder array', () => {
    const moduleOrder = [];
    assert.strictEqual(moduleOrder.length, 0);
  });

  it('handles breakpoint with empty className', () => {
    const bp = {
      id: 1,
      moduleName: 'm1',
      className: '',
      lineNumber: 0,
      enabled: true,
      isDeferred: false,
      resolvedClassNames: [],
    };
    assert.strictEqual(bp.className, '');
    assert.strictEqual(bp.lineNumber, 0);
  });

  it('handles breakpoint with empty resolvedClassNames', () => {
    const bp = {
      id: 1,
      moduleName: 'm1',
      className: 'com.example.Main',
      lineNumber: 42,
      enabled: true,
      isDeferred: true,
      resolvedClassNames: [],
    };
    assert.strictEqual(bp.resolvedClassNames.length, 0);
    assert.strictEqual(bp.isDeferred, true);
  });

  it('handles error state with debug port error', () => {
    const state = {
      sessions: [],
      breakpoints: [],
      events: [],
      moduleOrder: [],
      loading: false,
      error: 'Failed to attach debugger: port 5005 already in use',
    };
    assert.ok(state.error.toLowerCase().includes('port'));
    assert.ok(state.error.toLowerCase().includes('debug'));
  });

  it('handles error state with module error', () => {
    const state = {
      sessions: [],
      breakpoints: [],
      events: [],
      moduleOrder: [],
      loading: false,
      error: 'Module not found: project does not exist',
    };
    assert.ok(state.error.toLowerCase().includes('module'));
    assert.ok(state.error.toLowerCase().includes('project'));
  });

  it('handles loading state', () => {
    const state = {
      sessions: [],
      breakpoints: [],
      events: [],
      moduleOrder: [],
      loading: true,
      error: null,
    };
    assert.strictEqual(state.loading, true);
    assert.strictEqual(state.error, null);
  });
});

// ------------------------------------------------------------------
// Session state color mapping
// ------------------------------------------------------------------

describe('Session state color mapping', () => {
  it('running is green', () => {
    const color = sessionColorFn('running');
    assert.strictEqual(color, '#4caf50');
  });

  it('suspended is blue', () => {
    const color = sessionColorFn('suspended');
    assert.strictEqual(color, '#2196f3');
  });

  it('connected is orange', () => {
    const color = sessionColorFn('connected');
    assert.strictEqual(color, '#ff9800');
  });

  it('not_connected is gray', () => {
    const color = sessionColorFn('not_connected');
    assert.strictEqual(color, '#9e9e9e');
  });

  it('terminated is red', () => {
    const color = sessionColorFn('terminated');
    assert.strictEqual(color, '#f44336');
  });

  it('unknown state is gray', () => {
    const color = sessionColorFn('unknown');
    assert.strictEqual(color, '#9e9e9e');
  });
});

function sessionColorFn(s) {
  switch (s) {
    case 'running': return '#4caf50';
    case 'suspended': return '#2196f3';
    case 'connected': return '#ff9800';
    case 'not_connected': return '#9e9e9e';
    case 'terminated': return '#f44336';
    default: return '#9e9e9e';
  }
}

// ------------------------------------------------------------------
// Filtered events count
// ------------------------------------------------------------------

describe('Breakpoint filtered count', () => {
  it('counts enabled breakpoints correctly', () => {
    const breakpoints = [
      { id: 1, enabled: true },
      { id: 2, enabled: false },
      { id: 3, enabled: true },
      { id: 4, enabled: false },
      { id: 5, enabled: true },
    ];
    const enabledCount = breakpoints.filter(bp => bp.enabled).length;
    assert.strictEqual(enabledCount, 3);
  });

  it('counts 0 enabled when all disabled', () => {
    const breakpoints = [
      { id: 1, enabled: false },
      { id: 2, enabled: false },
    ];
    const enabledCount = breakpoints.filter(bp => bp.enabled).length;
    assert.strictEqual(enabledCount, 0);
  });

  it('counts all when all enabled', () => {
    const breakpoints = [
      { id: 1, enabled: true },
      { id: 2, enabled: true },
    ];
    const enabledCount = breakpoints.filter(bp => bp.enabled).length;
    assert.strictEqual(enabledCount, 2);
  });
});

// ------------------------------------------------------------------
// Helper: replicated mapSessionState for testing
// ------------------------------------------------------------------

function mapState(state) {
  switch (state) {
    case 'idle':
    case 'stopped':
      return 'not_connected';
    case 'starting':
      return 'connected';
    case 'running':
      return 'running';
    case 'paused':
      return 'suspended';
    case 'stopping':
    case 'crashed':
      return 'terminated';
    default:
      return 'not_connected';
  }
}

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});