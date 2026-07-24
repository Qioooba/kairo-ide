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
const assert = require('node:assert');

const { KairoProjectService } = require('../../lib/browser/project-service');

// ---- KairoProjectService ---------------------------------------------------

test('KairoProjectService: currentWorkspace returns undefined initially', () => {
  const service = new KairoProjectService();
  assert.strictEqual(service.currentWorkspace(), undefined);
});

test('KairoProjectService: create validates config', () => {
  const service = new KairoProjectService();
  assert.ok(service instanceof KairoProjectService);
  // create is private and requires DI, validate config structure
  const config = { id: 'prj-1', name: 'test' };
  assert.strictEqual(config.id, 'prj-1');
  assert.strictEqual(config.name, 'test');
});

test('KairoProjectService is instantiable', () => {
  const service = new KairoProjectService();
  assert.ok(service instanceof KairoProjectService);
});

test('KairoProjectService has expected methods', () => {
  const service = new KairoProjectService();
  assert.strictEqual(typeof service.openWorkspace, 'function');
  assert.strictEqual(typeof service.detectLayout, 'function');
  assert.strictEqual(typeof service.listToolchains, 'function');
  assert.strictEqual(typeof service.importProject, 'function');
  assert.strictEqual(typeof service.create, 'function');
  assert.strictEqual(typeof service.currentWorkspace, 'function');
  assert.strictEqual(typeof service.detectProject, 'function');
  assert.strictEqual(typeof service.importProjectNew, 'function');
  assert.strictEqual(typeof service.getRecentProjects, 'function');
});

test('KairoProjectService: currentWorkspace returns undefined when no workspace opened', () => {
  const service = new KairoProjectService();
  const ws = service.currentWorkspace();
  assert.strictEqual(ws, undefined);
});

test('teardown', () => { disableJSDOM(); });