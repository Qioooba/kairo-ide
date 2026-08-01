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

const { GitStashWidget } = require('../../lib/browser/git-stash-widget');
const { GitStashService } = require('../../lib/browser/git-stash-service');

describe('GitStashWidget — Package exports', () => {
  it('GitStashWidget is exported', () => {
    assert.strictEqual(typeof GitStashWidget, 'function');
  });

  it('GitStashWidget has static ID', () => {
    assert.strictEqual(GitStashWidget.ID, 'kairo-git-stash');
  });
});

describe('GitStashService — Package exports', () => {
  it('GitStashService is exported', () => {
    assert.strictEqual(typeof GitStashService, 'function');
  });
});

describe('GitStashWidget — Instantiation', () => {
  let widget;
  let stashService;

  beforeEach(() => {
    stashService = new GitStashService();
    stashService.gitService = {
      getRepoRoot: () => '/repo',
      onDidChange: () => ({ dispose: () => {} }),
      onDidChangeStatus: () => ({ dispose: () => {} }),
    };
    widget = new GitStashWidget();
    widget.stashService = stashService;
  });

  it('widget has correct id', () => {
    assert.strictEqual(widget.id, 'kairo-git-stash');
  });

  it('widget has correct title', () => {
    assert.strictEqual(widget.title.label, '');
  });

  it('widget has correct caption', () => {
    assert.strictEqual(widget.title.caption, '');
  });

  it('widget is closable', () => {
    assert.strictEqual(widget.title.closable, true);
  });
});

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});
