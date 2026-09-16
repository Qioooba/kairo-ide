'use strict';

// Regression tests for the Kairo Maven view polish:
// - toolbar hierarchy (detect=main, refresh=secondary)
// - agent errors surface in a .kairo-error-banner with a localized prefix
//   instead of a bare .theia-error text node.

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
const assert = require('node:assert');
const React = require('react');
const { createRoot } = require('react-dom/client');

const maven = require('../../../lib/browser/maven-view-widget');

const OUTSIDE_ROOT = 'path is outside any authorized workspace root';

function fakeI18n() {
  return {
    getCurrentLanguage: () => 'zh-CN',
    onDidChangeLanguage: () => ({ dispose() { /* no-op */ } }),
    t: (key, params) => {
      if (key === 'widget.maven.workspaceOutsideRoot') {
        return `项目路径不在授权的工作区内：${params?.message ?? ''}`;
      }
      return String(key);
    },
  };
}

function failingRuntime(message = OUTSIDE_ROOT) {
  return {
    workspace: () => '/ws',
    request: async () => { throw new Error(message); },
  };
}

async function renderWidget({ runtime, i18n }) {
  const widget = new maven.MavenViewWidget();
  widget.runtime = runtime;
  widget.messageService = { info() { /* no-op */ }, error() { /* no-op */ } };
  widget.i18n = i18n ?? fakeI18n();
  const container = document.createElement('div');
  document.body.appendChild(container);
  createRoot(container).render(widget.render());
  // let effects + the rejected detect promise flush through re-render
  await new Promise(resolve => setTimeout(resolve, 50));
  await new Promise(resolve => setTimeout(resolve, 50));
  return container;
}

test('MavenViewWidget is exported with static ID', () => {
  assert.strictEqual(typeof maven.MavenViewWidget, 'function');
  assert.strictEqual(maven.MavenViewWidget.ID, 'kairo-maven-view');
});

test('Maven toolbar uses main/secondary hierarchy', async () => {
  const container = await renderWidget({ runtime: failingRuntime('boom') });
  const detect = container.querySelector('[data-testid="maven-detect-button"]');
  const deps = container.querySelector('[data-testid="maven-deps-button"]');
  assert.ok(detect, 'detect button rendered');
  assert.ok(deps, 'refresh-dependencies button rendered');
  assert.ok(detect.className.includes('main'), `detect is primary, got: ${detect.className}`);
  assert.ok(deps.className.includes('secondary'), `refresh is secondary, got: ${deps.className}`);
  assert.ok(!container.querySelector('.theia-error'), 'legacy bare .theia-error is gone');
});

test('workspace-root agent error renders localized error banner', async () => {
  const container = await renderWidget({ runtime: failingRuntime() });
  const banner = container.querySelector('[data-testid="maven-error"]');
  assert.ok(banner, 'maven-error banner rendered');
  assert.ok(banner.className.includes('kairo-error-banner'), `banner class, got: ${banner.className}`);
  assert.ok(banner.querySelector('.codicon-error'), 'banner has error icon');
  assert.ok(
    banner.textContent.includes('项目路径不在授权的工作区内'),
    `banner is localized, got: ${banner.textContent}`,
  );
  assert.ok(banner.textContent.includes(OUTSIDE_ROOT), 'raw agent detail preserved');
});

test('unknown agent errors still render inside the banner', async () => {
  const container = await renderWidget({ runtime: failingRuntime('ECONNREFUSED 127.0.0.1:18410') });
  const banner = container.querySelector('[data-testid="maven-error"]');
  assert.ok(banner, 'maven-error banner rendered');
  assert.ok(banner.className.includes('kairo-error-banner'), `banner class, got: ${banner.className}`);
  assert.ok(banner.textContent.includes('ECONNREFUSED'), 'raw detail preserved');
});

test('teardown', () => {
  disableJSDOM();
});
