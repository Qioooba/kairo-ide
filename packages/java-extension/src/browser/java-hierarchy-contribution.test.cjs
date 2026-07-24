// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for JavaHierarchyContribution.
//
// Verifies:
//   - Command definitions are correct
//   - Command registration
//   - Menu registration
//
// JavaHierarchyWidget is a React component with heavy dependencies
// (React, @theia/core, @theia/editor) and is tested separately.
//
// Run with: pnpm --filter @kairo/java-extension test

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
const assert = require('node:assert/strict');

const {
  JavaHierarchyContribution,
  JavaHierarchyCommands,
} = require('../../lib/browser/java-hierarchy-contribution');

// ------------------------------------------------------------------
// Command definitions
// ------------------------------------------------------------------

test('JavaHierarchyCommands: SHOW_CALL_HIERARCHY_INCOMING has correct id', () => {
  assert.equal(JavaHierarchyCommands.SHOW_CALL_HIERARCHY_INCOMING.id, 'kairo.java.callHierarchy.showIncoming');
  assert.ok(JavaHierarchyCommands.SHOW_CALL_HIERARCHY_INCOMING.label.includes('Call Hierarchy'));
});

test('JavaHierarchyCommands: SHOW_CALL_HIERARCHY_OUTGOING has correct id', () => {
  assert.equal(JavaHierarchyCommands.SHOW_CALL_HIERARCHY_OUTGOING.id, 'kairo.java.callHierarchy.showOutgoing');
  assert.ok(JavaHierarchyCommands.SHOW_CALL_HIERARCHY_OUTGOING.label.includes('Call Hierarchy'));
});

test('JavaHierarchyCommands: SHOW_TYPE_HIERARCHY_SUPERTYPES has correct id', () => {
  assert.equal(JavaHierarchyCommands.SHOW_TYPE_HIERARCHY_SUPERTYPES.id, 'kairo.java.typeHierarchy.showSupertypes');
  assert.ok(JavaHierarchyCommands.SHOW_TYPE_HIERARCHY_SUPERTYPES.label.includes('Type Hierarchy'));
});

test('JavaHierarchyCommands: SHOW_TYPE_HIERARCHY_SUBTYPES has correct id', () => {
  assert.equal(JavaHierarchyCommands.SHOW_TYPE_HIERARCHY_SUBTYPES.id, 'kairo.java.typeHierarchy.showSubtypes');
  assert.ok(JavaHierarchyCommands.SHOW_TYPE_HIERARCHY_SUBTYPES.label.includes('Type Hierarchy'));
});

// ------------------------------------------------------------------
// Command registration
// ------------------------------------------------------------------

test('registerCommands: registers all 4 hierarchy commands', () => {
  const contribution = new JavaHierarchyContribution();
  const registered = new Map();
  const registry = {
    registerCommand: (cmd, handler) => {
      registered.set(cmd.id, { cmd, handler });
    },
  };

  contribution.registerCommands(registry);

  assert.equal(registered.size, 4);
  assert.ok(registered.has('kairo.java.callHierarchy.showIncoming'));
  assert.ok(registered.has('kairo.java.callHierarchy.showOutgoing'));
  assert.ok(registered.has('kairo.java.typeHierarchy.showSupertypes'));
  assert.ok(registered.has('kairo.java.typeHierarchy.showSubtypes'));

  // Verify each handler has an execute function
  for (const [, entry] of registered) {
    assert.equal(typeof entry.handler.execute, 'function');
  }
});

// ------------------------------------------------------------------
// Menu registration
// ------------------------------------------------------------------

test('registerMenus: registers call hierarchy and type hierarchy menus', () => {
  const contribution = new JavaHierarchyContribution();
  const menuActions = [];
  const registry = {
    registerMenuAction: (menuPath, action) => {
      menuActions.push({ menuPath, action });
    },
  };

  contribution.registerMenus(registry);

  assert.equal(menuActions.length, 2);
  assert.equal(menuActions[0].action.commandId, 'kairo.java.callHierarchy.showIncoming');
  assert.equal(menuActions[1].action.commandId, 'kairo.java.typeHierarchy.showSupertypes');
});

// ------------------------------------------------------------------
// JavaHierarchyContribution class structure
// ------------------------------------------------------------------

test('JavaHierarchyContribution: is constructable', () => {
  assert.equal(typeof JavaHierarchyContribution, 'function');
});

test('JavaHierarchyContribution: has registerCommands method', () => {
  assert.equal(typeof JavaHierarchyContribution.prototype.registerCommands, 'function');
});

test('JavaHierarchyContribution: has registerMenus method', () => {
  assert.equal(typeof JavaHierarchyContribution.prototype.registerMenus, 'function');
});