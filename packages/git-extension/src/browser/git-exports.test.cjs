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

const { test } = require('node:test');
const assert = require('node:assert');

const git = require('../../lib/browser/index');

test('GitService is exported', () => {
  assert.strictEqual(typeof git.GitService, 'function');
});

test('GitStore is exported', () => {
  assert.strictEqual(typeof git.GitStore, 'function');
});

test('GitStashService is exported', () => {
  assert.strictEqual(typeof git.GitStashService, 'function');
});

test('GitCherryPickService is exported', () => {
  assert.strictEqual(typeof git.GitCherryPickService, 'function');
});

test('GitStashWidget is exported', () => {
  assert.strictEqual(typeof git.GitStashWidget, 'function');
});

test('GitStashContribution is exported', () => {
  assert.strictEqual(typeof git.GitStashContribution, 'function');
});

test('GitCherryPickContribution is exported', () => {
  assert.strictEqual(typeof git.GitCherryPickContribution, 'function');
});

test('GIT_STASH_TOGGLE_COMMAND is exported', () => {
  assert.ok(git.GIT_STASH_TOGGLE_COMMAND);
  assert.strictEqual(typeof git.GIT_STASH_TOGGLE_COMMAND.id, 'string');
});

test('GIT_CHERRY_PICK_COMMAND is exported', () => {
  assert.ok(git.GIT_CHERRY_PICK_COMMAND);
  assert.strictEqual(typeof git.GIT_CHERRY_PICK_COMMAND.id, 'string');
});

test('GIT_CHERRY_PICK_CONTINUE_COMMAND is exported', () => {
  assert.ok(git.GIT_CHERRY_PICK_CONTINUE_COMMAND);
  assert.strictEqual(typeof git.GIT_CHERRY_PICK_CONTINUE_COMMAND.id, 'string');
});

test('GIT_CHERRY_PICK_ABORT_COMMAND is exported', () => {
  assert.ok(git.GIT_CHERRY_PICK_ABORT_COMMAND);
  assert.strictEqual(typeof git.GIT_CHERRY_PICK_ABORT_COMMAND.id, 'string');
});

test('teardown', () => { disableJSDOM(); });