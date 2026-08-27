'use strict';

const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
register('data:text/javascript,' + encodeURIComponent(`
export function resolve(specifier, context, nextResolve) {
  if (/\.(css|svg|ttf|woff|woff2|png|jpg|gif)$/.test(specifier)) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  if (specifier === '@theia/monaco-editor-core' || specifier.includes('monaco-editor-core')) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`), pathToFileURL(__filename));

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

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

// Mock @theia/monaco-editor-core to avoid the ESM CSS import issue in CJS tests.
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.includes('monaco-editor-core')) {
    const mockPath = require('node:path').join(__dirname, '..', '..', '..', 'search-extension', 'src', 'browser', '__monaco-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  return origResolveFilename.call(this, request, parent, ...args);
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