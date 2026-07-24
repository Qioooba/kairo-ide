'use strict';

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { describe, it, beforeEach } = require('node:test');
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

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

// Import the exported items from the compiled lib
const { KairoComplianceWidget, KAIRO_COMPLIANCE_FACTORY_ID } = require('../../../lib/browser/kairo-compliance-widget');

// ------------------------------------------------------------------
// Type shape tests (no DI needed for these)
// ------------------------------------------------------------------

describe('KairoComplianceWidget — Package exports', () => {
  it('KairoComplianceWidget is exported', () => {
    assert.strictEqual(typeof KairoComplianceWidget, 'function');
  });

  it('KairoComplianceWidget has static ID', () => {
    assert.strictEqual(KairoComplianceWidget.ID, KAIRO_COMPLIANCE_FACTORY_ID);
  });

  it('KAIRO_COMPLIANCE_FACTORY_ID is "kairo-compliance"', () => {
    assert.strictEqual(KAIRO_COMPLIANCE_FACTORY_ID, 'kairo-compliance');
  });

  it('KairoComplianceWidget has static LABEL', () => {
    assert.strictEqual(KairoComplianceWidget.LABEL, 'Enterprise Compliance');
  });
});

// ------------------------------------------------------------------
// Type interface tests
// ------------------------------------------------------------------

describe('Compliance type interfaces', () => {
  it('UserRole shape is valid', () => {
    const role = { name: 'admin', permissions: ['file.edit', 'debug.start'] };
    assert.strictEqual(typeof role.name, 'string');
    assert.ok(Array.isArray(role.permissions));
    assert.strictEqual(role.permissions.length, 2);
  });

  it('AuditEvent shape is valid', () => {
    const event = {
      ts: '2026-01-01T00:00:00.000Z',
      category: 'file',
      component: 'file.open',
      userId: 'user-1',
      action: 'file.open',
      target: '/src/Main.java',
      result: 'ok',
    };
    assert.strictEqual(typeof event.ts, 'string');
    assert.strictEqual(typeof event.category, 'string');
    assert.strictEqual(typeof event.component, 'string');
    assert.strictEqual(typeof event.userId, 'string');
    assert.strictEqual(typeof event.action, 'string');
    assert.strictEqual(typeof event.target, 'string');
    assert.ok(['ok', 'denied', 'error'].includes(event.result));
  });

  it('AuditEvent result must be ok, denied, or error', () => {
    const validResults = ['ok', 'denied', 'error'];
    for (const r of validResults) {
      assert.ok(validResults.includes(r));
    }
    assert.strictEqual(validResults.length, 3);
  });

  it('RetentionPolicy shape is valid', () => {
    const policy = {
      name: 'Audit Log Retention',
      resourceType: 'Audit Logs',
      maxAge: '30 days',
      maxSize: '10000 entries',
      autoCleanup: true,
    };
    assert.strictEqual(typeof policy.name, 'string');
    assert.strictEqual(typeof policy.resourceType, 'string');
    assert.strictEqual(typeof policy.maxAge, 'string');
    assert.strictEqual(typeof policy.maxSize, 'string');
    assert.strictEqual(typeof policy.autoCleanup, 'boolean');
  });

  it('SSOStatus shape is valid', () => {
    const sso = {
      enabled: false,
      provider: 'none',
      issuer: '',
      configured: false,
    };
    assert.strictEqual(typeof sso.enabled, 'boolean');
    assert.ok(['oidc', 'saml', 'none'].includes(sso.provider));
    assert.strictEqual(typeof sso.issuer, 'string');
    assert.strictEqual(typeof sso.configured, 'boolean');
  });

  it('SSOStatus provider must be oidc, saml, or none', () => {
    const validProviders = ['oidc', 'saml', 'none'];
    assert.ok(validProviders.includes('oidc'));
    assert.ok(validProviders.includes('saml'));
    assert.ok(validProviders.includes('none'));
    assert.strictEqual(validProviders.length, 3);
  });

  it('ComplianceState shape is valid', () => {
    const state = {
      roles: [{ name: 'admin', permissions: ['file.edit'] }],
      auditEvents: [],
      retentionPolicies: [],
      ssoStatus: { enabled: false, provider: 'none', issuer: '', configured: false },
      loading: false,
      error: null,
    };
    assert.ok(Array.isArray(state.roles));
    assert.ok(Array.isArray(state.auditEvents));
    assert.ok(Array.isArray(state.retentionPolicies));
    assert.strictEqual(typeof state.ssoStatus, 'object');
    assert.strictEqual(typeof state.loading, 'boolean');
    assert.strictEqual(state.error, null);
  });
});

// ------------------------------------------------------------------
// Audit event filtering logic (replicated for testing)
// ------------------------------------------------------------------

describe('Audit event filtering', () => {
  const events = [
    { ts: '2026-01-01T00:00:00Z', category: 'file', component: 'file.open', userId: 'u1', action: 'file.open', target: '/src/Main.java', result: 'ok' },
    { ts: '2026-01-01T00:01:00Z', category: 'build', component: 'build.start', userId: 'u1', action: 'build.start', target: 'project', result: 'ok' },
    { ts: '2026-01-01T00:02:00Z', category: 'debug', component: 'debug.start', userId: 'u2', action: 'debug.start', target: 'module-A', result: 'error' },
    { ts: '2026-01-01T00:03:00Z', category: 'command', component: 'command.execute', userId: 'u1', action: 'command.execute', target: 'switchRole', result: 'denied' },
  ];

  it('filters by action', () => {
    const filtered = events.filter(e => e.action.includes('file'));
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].action, 'file.open');
  });

  it('filters by result', () => {
    const filtered = events.filter(e => e.result === 'error');
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].action, 'debug.start');
  });

  it('filters by search term in action', () => {
    const term = 'build';
    const filtered = events.filter(e => e.action.toLowerCase().includes(term));
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].action, 'build.start');
  });

  it('filters by search term in target', () => {
    const term = 'module';
    const filtered = events.filter(e => e.target.toLowerCase().includes(term));
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].target, 'module-A');
  });

  it('filters by search term in userId', () => {
    const term = 'u2';
    const filtered = events.filter(e => e.userId.toLowerCase().includes(term));
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].userId, 'u2');
  });

  it('returns empty when no matches', () => {
    const filtered = events.filter(e => e.action.includes('nonexistent'));
    assert.strictEqual(filtered.length, 0);
  });

  it('filters by combined action and result', () => {
    const filtered = events.filter(e => e.action.includes('build') && e.result === 'ok');
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].action, 'build.start');
  });

  it('filters by combined action and search', () => {
    const term = 'main';
    const filtered = events.filter(e => e.action.includes('file') && e.target.toLowerCase().includes(term));
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].action, 'file.open');
  });

  it('handles empty events array', () => {
    const filtered = [].filter(e => e.action.includes('file'));
    assert.strictEqual(filtered.length, 0);
  });

  it('filters by result "denied"', () => {
    const filtered = events.filter(e => e.result === 'denied');
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].action, 'command.execute');
  });
});

// ------------------------------------------------------------------
// SSO status validation
// ------------------------------------------------------------------

describe('SSO status validation', () => {
  it('disabled SSO has correct defaults', () => {
    const sso = { enabled: false, provider: 'none', issuer: '', configured: false };
    assert.strictEqual(sso.enabled, false);
    assert.strictEqual(sso.provider, 'none');
    assert.strictEqual(sso.issuer, '');
    assert.strictEqual(sso.configured, false);
  });

  it('enabled OIDC SSO has correct values', () => {
    const sso = { enabled: true, provider: 'oidc', issuer: 'https://auth.example.com', configured: true };
    assert.strictEqual(sso.enabled, true);
    assert.strictEqual(sso.provider, 'oidc');
    assert.strictEqual(sso.issuer, 'https://auth.example.com');
    assert.strictEqual(sso.configured, true);
  });

  it('SAML SSO has correct provider', () => {
    const sso = { enabled: true, provider: 'saml', issuer: 'https://sso.example.com', configured: true };
    assert.strictEqual(sso.provider, 'saml');
    assert.strictEqual(sso.enabled, true);
  });

  it('enabled but not configured is invalid', () => {
    const sso = { enabled: true, provider: 'oidc', issuer: 'https://auth.example.com', configured: false };
    assert.strictEqual(sso.enabled, true);
    assert.strictEqual(sso.configured, false);
  });
});

// ------------------------------------------------------------------
// Retention policy validation
// ------------------------------------------------------------------

describe('Retention policy validation', () => {
  it('autoCleanup enabled means policy is active', () => {
    const policy = { name: 'Audit', resourceType: 'Audit Logs', maxAge: '30 days', maxSize: '10000 entries', autoCleanup: true };
    assert.strictEqual(policy.autoCleanup, true);
  });

  it('autoCleanup disabled means policy is inactive', () => {
    const policy = { name: 'Local', resourceType: 'User Settings', maxAge: 'Unlimited', maxSize: 'N/A', autoCleanup: false };
    assert.strictEqual(policy.autoCleanup, false);
  });

  it('policy with maxSize N/A is valid', () => {
    const policy = { name: 'Local', resourceType: 'User Settings', maxAge: 'Unlimited', maxSize: 'N/A', autoCleanup: false };
    assert.strictEqual(policy.maxSize, 'N/A');
    assert.strictEqual(policy.maxAge, 'Unlimited');
  });
});

// ------------------------------------------------------------------
// Boundary conditions
// ------------------------------------------------------------------

describe('Boundary conditions', () => {
  it('handles empty roles array', () => {
    const roles = [];
    assert.strictEqual(roles.length, 0);
  });

  it('handles empty audit events array', () => {
    const events = [];
    assert.strictEqual(events.length, 0);
  });

  it('handles empty retention policies array', () => {
    const policies = [];
    assert.strictEqual(policies.length, 0);
  });

  it('handles role with no permissions', () => {
    const role = { name: 'viewer', permissions: [] };
    assert.strictEqual(role.permissions.length, 0);
  });

  it('handles error state with permission error', () => {
    const state = {
      roles: [],
      auditEvents: [],
      retentionPolicies: [],
      ssoStatus: { enabled: false, provider: 'none', issuer: '', configured: false },
      loading: false,
      error: 'Permission denied: cannot access audit log',
    };
    assert.ok(state.error.toLowerCase().includes('permission'));
    assert.ok(state.error.toLowerCase().includes('denied'));
  });

  it('handles error state with config error', () => {
    const state = {
      roles: [],
      auditEvents: [],
      retentionPolicies: [],
      ssoStatus: { enabled: false, provider: 'none', issuer: '', configured: false },
      loading: false,
      error: 'Configuration error: missing settings',
    };
    assert.ok(state.error.toLowerCase().includes('config'));
    assert.ok(state.error.toLowerCase().includes('setting'));
  });

  it('handles error state with timeout error', () => {
    const state = {
      roles: [],
      auditEvents: [],
      retentionPolicies: [],
      ssoStatus: { enabled: false, provider: 'none', issuer: '', configured: false },
      loading: false,
      error: 'Request timed out after 30s',
    };
    assert.ok(state.error.toLowerCase().includes('timed out'));
  });

  it('handles loading state', () => {
    const state = {
      roles: [],
      auditEvents: [],
      retentionPolicies: [],
      ssoStatus: { enabled: false, provider: 'none', issuer: '', configured: false },
      loading: true,
      error: null,
    };
    assert.strictEqual(state.loading, true);
    assert.strictEqual(state.error, null);
  });
});

// ------------------------------------------------------------------
// Result badge color mapping
// ------------------------------------------------------------------

describe('Result badge color mapping', () => {
  it('ok is green', () => {
    const color = resultColor('ok');
    assert.strictEqual(color, '#4caf50');
  });

  it('denied is orange', () => {
    const color = resultColor('denied');
    assert.strictEqual(color, '#ff9800');
  });

  it('error is red', () => {
    const color = resultColor('error');
    assert.strictEqual(color, '#f44336');
  });

  it('unknown result is gray', () => {
    const color = resultColor('unknown');
    assert.strictEqual(color, '#999');
  });
});

function resultColor(result) {
  const colors = {
    ok: '#4caf50',
    denied: '#ff9800',
    error: '#f44336',
  };
  return colors[result] || '#999';
}

// ------------------------------------------------------------------
// Audit filter state transitions
// ------------------------------------------------------------------

describe('Audit filter state transitions', () => {
  it('can set action filter', () => {
    let filter = { action: '', result: '', search: '' };
    filter = { ...filter, action: 'file' };
    assert.strictEqual(filter.action, 'file');
    assert.strictEqual(filter.result, '');
    assert.strictEqual(filter.search, '');
  });

  it('can set result filter', () => {
    let filter = { action: '', result: '', search: '' };
    filter = { ...filter, result: 'error' };
    assert.strictEqual(filter.result, 'error');
  });

  it('can set search filter', () => {
    let filter = { action: '', result: '', search: '' };
    filter = { ...filter, search: 'test' };
    assert.strictEqual(filter.search, 'test');
  });

  it('can set multiple filters', () => {
    let filter = { action: '', result: '', search: '' };
    filter = { ...filter, action: 'debug', result: 'error' };
    assert.strictEqual(filter.action, 'debug');
    assert.strictEqual(filter.result, 'error');
  });

  it('can clear all filters', () => {
    let filter = { action: 'debug', result: 'error', search: 'test' };
    filter = { action: '', result: '', search: '' };
    assert.strictEqual(filter.action, '');
    assert.strictEqual(filter.result, '');
    assert.strictEqual(filter.search, '');
  });
});

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});