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

const { GitCherryPickService } = require('../../lib/browser/git-cherrypick-service');

describe('GitCherryPickService — State Management', () => {
  let svc;

  beforeEach(() => {
    svc = new GitCherryPickService();
    svc.gitService = {
      getRepoRoot: () => '/repo',
      onDidChange: () => ({ dispose: () => {} }),
      onDidChangeStatus: () => ({ dispose: () => {} }),
    };
  });

  it('starts with idle state', () => {
    const state = svc.getState();
    assert.strictEqual(state.status, 'idle');
    assert.strictEqual(state.remainingHashes.length, 0);
  });

  it('getState returns a copy', () => {
    const s1 = svc.getState();
    const s2 = svc.getState();
    assert.notStrictEqual(s1, s2);
  });

  it('has correct events', () => {
    assert.ok(typeof svc.onDidChangeState === 'function');
    assert.ok(typeof svc.onDidChange === 'function');
  });
});

describe('GitCherryPickService — Package exports', () => {
  it('GitCherryPickService is exported', () => {
    assert.strictEqual(typeof GitCherryPickService, 'function');
  });
});

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});
