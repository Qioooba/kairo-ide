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

const { GitStashService } = require('../../lib/browser/git-stash-service');

describe('GitStashService — Basic Operations', () => {
  let svc;

  beforeEach(() => {
    svc = new GitStashService();
    svc.gitService = {
      getRepoRoot: () => '/repo',
      onDidChange: () => ({ dispose: () => {} }),
      onDidChangeStatus: () => ({ dispose: () => {} }),
    };
  });

  it('has correct events', () => {
    assert.ok(typeof svc.onDidChangeStash === 'function');
    assert.ok(typeof svc.onDidChange === 'function');
  });

  it('list returns empty array when no stashes', async () => {
    // Mock execGit via prototype - list will fail without git, return []
    const result = await svc.list();
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0);
  });
});

describe('GitStashService — Package exports', () => {
  it('GitStashService is exported', () => {
    assert.strictEqual(typeof GitStashService, 'function');
  });
});

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});
