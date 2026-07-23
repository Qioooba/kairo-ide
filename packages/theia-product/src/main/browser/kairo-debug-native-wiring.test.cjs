'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createKairoJavaAttachConfiguration } = require('../../../lib/common/kairo-java-debug');

const workspaceRoot = path.resolve(__dirname, '../../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8');
}

test('browser composition loads pinned native Theia Debug UI', () => {
  const browserPackage = JSON.parse(read('apps/browser/package.json'));
  assert.equal(browserPackage.dependencies['@theia/debug'], '1.73.1');
  assert.match(read('apps/browser/src-gen/frontend/index.js'), /@theia\/debug\/lib\/browser\/debug-frontend-module/);

  const sessionWidget = read('node_modules/@theia/debug/lib/browser/view/debug-session-widget.d.ts');
  for (const widget of [
    'DebugThreadsWidget',
    'DebugStackFramesWidget',
    'DebugBreakpointsWidget',
    'DebugVariablesWidget',
    'DebugWatchWidget',
  ]) {
    assert.match(sessionWidget, new RegExp(widget), `${widget} must remain part of the native Debug view`);
  }
});

test('pinned Theia Debug contribution retains IDE-standard keybindings', () => {
  const contribution = read('node_modules/@theia/debug/lib/browser/debug-frontend-application-contribution.js');
  for (const keybinding of ['f5', 'shift+f5', 'f10', 'f11', 'shift+f11', 'f6', 'f9']) {
    assert.match(contribution, new RegExp(`keybinding: '${keybinding.replace('+', '\\+')}'`));
  }
  for (const command of ['START', 'STOP', 'CONTINUE', 'PAUSE', 'STEP_OVER', 'STEP_INTO', 'STEP_OUT']) {
    assert.match(contribution, new RegExp(`DebugCommands\\.${command}\\.id`));
  }
});

test('Kairo attach configuration asks native Debug and Debug Console to open', () => {
  const configuration = createKairoJavaAttachConfiguration({
    serverId: 'server-1',
    projectId: 'project-1',
    projectName: 'Legacy App',
    projectRoot: '/workspace/legacy-app',
    port: 5005,
  });
  assert.equal(configuration.type, 'kairo-java');
  assert.equal(configuration.openDebug, 'openOnSessionStart');
  assert.equal(configuration.internalConsoleOptions, 'openOnSessionStart');

  const frontendModule = read('packages/theia-product/src/main/browser/kairo-product-frontend-module.ts');
  assert.match(frontendModule, /bind\(KairoDebugSessionManager\)\.toService\(DebugSessionManager\)/);
  assert.doesNotMatch(frontendModule, /DebugSessionFactory|DebugSessionContribution/);
});
