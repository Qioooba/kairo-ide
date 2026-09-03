// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for JavaNavigationContribution Find/Show Usages wiring.
//
// Run with: pnpm --filter @kairo/java-extension test

'use strict';

require('../../../theia-product/test/frontend-setup.cjs');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  JavaNavigationContribution,
  JavaNavigationCommands,
} = require('../../lib/browser/java-navigation-contribution');

test('JavaNavigationCommands: FIND_USAGES and SHOW_USAGES ids', () => {
  assert.equal(JavaNavigationCommands.FIND_USAGES.id, 'kairo.java.findUsages');
  assert.equal(JavaNavigationCommands.SHOW_USAGES.id, 'kairo.java.showUsages');
  assert.ok(JavaNavigationCommands.FIND_USAGES.label.includes('Find Usages'));
  assert.ok(JavaNavigationCommands.SHOW_USAGES.label.includes('Show Usages'));
});

test('registerCommands: registers Find Usages and Show Usages', () => {
  const contribution = new JavaNavigationContribution();
  const registered = new Map();
  contribution.registerCommands({
    registerCommand: (cmd, handler) => {
      registered.set(cmd.id, { cmd, handler });
    },
  });

  assert.ok(registered.has('kairo.java.findUsages'));
  assert.ok(registered.has('kairo.java.showUsages'));
  assert.ok(registered.has('kairo.java.goToDeclaration'));
  assert.ok(registered.has('kairo.java.goToImplementation'));
  assert.ok(registered.has('kairo.java.peekDefinition'));
  assert.equal(typeof registered.get('kairo.java.findUsages').handler.execute, 'function');
  assert.equal(typeof registered.get('kairo.java.showUsages').handler.execute, 'function');
});

test('registerKeybindings: Alt+F7 Find Usages, Ctrl+Alt+F7 Show Usages', () => {
  const contribution = new JavaNavigationContribution();
  const bindings = [];
  contribution.registerKeybindings({
    registerKeybinding: (binding) => {
      bindings.push(binding);
    },
  });

  const find = bindings.find(b => b.command === 'kairo.java.findUsages');
  const show = bindings.find(b => b.command === 'kairo.java.showUsages');
  assert.ok(find);
  assert.ok(show);
  assert.equal(find.keybinding, 'alt+f7');
  assert.match(show.keybinding, /f7/);
  assert.ok(find.when.includes('editorLangId == java'));
  assert.ok(show.when.includes('editorLangId == java'));
});

test('registerMenus: Show Usages appears before Find Usages in Go To submenu', () => {
  const contribution = new JavaNavigationContribution();
  const actions = [];
  contribution.registerMenus({
    registerSubmenu: () => undefined,
    registerMenuAction: (menuPath, action) => {
      actions.push({ menuPath, action });
    },
  });

  const show = actions.find(a => a.action.commandId === 'kairo.java.showUsages');
  const find = actions.find(a => a.action.commandId === 'kairo.java.findUsages');
  const declaration = actions.find(a => a.action.commandId === 'kairo.java.goToDeclaration');
  const implementation = actions.find(a => a.action.commandId === 'kairo.java.goToImplementation');
  const peek = actions.find(a => a.action.commandId === 'kairo.java.peekDefinition');
  assert.ok(show);
  assert.ok(find);
  assert.ok(declaration, 'BUG-20260826-112: Declaration must be a Theia command, not editor.action.revealDefinition');
  assert.ok(implementation);
  assert.ok(peek);
  assert.equal(declaration.action.commandId.startsWith('editor.action.'), false);
  assert.ok(String(show.action.order) < String(find.action.order));
});

test('executeShowUsages: jumps immediately when only one usage', async () => {
  const contribution = new JavaNavigationContribution();
  const opened = [];

  contribution.editorManager = {
    currentEditor: { editor: { document: { uri: { toString: () => 'file:///ws/A.java' } } } },
  };
  contribution.getCurrentMonacoEditor = () => ({
    getModel: () => ({
      uri: { toString: () => 'file:///ws/A.java' },
      getWordAtPosition: () => ({ word: 'doWork' }),
    }),
    getPosition: () => ({ lineNumber: 12, column: 5 }),
  });
  contribution.client = {
    references: async () => [{
      uri: 'file:///ws/B.java',
      range: { start: { line: 3, character: 8 }, end: { line: 3, character: 14 } },
    }],
    definition: async () => null,
  };
  contribution.quickInput = {
    showQuickPick: async () => {
      throw new Error('should not open quick pick for single usage');
    },
  };
  contribution.navigateToUsage = async (usage, mode) => {
    opened.push({ usage, mode });
  };
  contribution.getLinePreview = () => 'doWork();';
  contribution.getWorkspaceRoot = () => 'file:///ws';
  contribution.messages = { info: () => undefined, error: () => undefined };

  await contribution.executeShowUsages();

  assert.equal(opened.length, 1);
  assert.equal(opened[0].mode, 'activate');
  assert.equal(opened[0].usage.uri, 'file:///ws/B.java');
  assert.equal(opened[0].usage.line, 3);
});

test('executeShowUsages: shows QuickPick for multiple usages', async () => {
  const contribution = new JavaNavigationContribution();
  let pickItems;
  let pickOptions;

  contribution.editorManager = {
    currentEditor: { editor: { document: { uri: { toString: () => 'file:///ws/A.java' } } } },
  };
  contribution.getCurrentMonacoEditor = () => ({
    getModel: () => ({
      uri: { toString: () => 'file:///ws/A.java' },
      getWordAtPosition: () => ({ word: 'Foo' }),
    }),
    getPosition: () => ({ lineNumber: 1, column: 1 }),
  });
  contribution.client = {
    references: async () => [
      { uri: 'file:///ws/A.java', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
      { uri: 'file:///ws/B.java', range: { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } } },
    ],
    definition: async () => ({
      uri: 'file:///ws/A.java',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    }),
  };
  contribution.quickInput = {
    showQuickPick: async (items, options) => {
      pickItems = items;
      pickOptions = options;
      return items.find(i => i.type !== 'separator');
    },
    hide: () => undefined,
  };
  const navigated = [];
  contribution.navigateToUsage = async (usage, mode) => {
    navigated.push({ usage, mode });
  };
  contribution.getLinePreview = () => 'class Foo';
  contribution.getWorkspaceRoot = () => 'file:///ws';

  await contribution.executeShowUsages();

  assert.ok(pickItems.length >= 3); // separators + items
  assert.ok(pickItems.some(i => i.type === 'separator'));
  assert.equal(pickOptions.matchOnDetail, true);
  assert.equal(pickOptions.runIfSingle, true);
  assert.ok(pickOptions.title.includes('Foo'));
  assert.ok(navigated.some(n => n.mode === 'activate'));
});
