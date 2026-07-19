// KairoFileCommandsContribution — contract test for the
// defensive file.* / workspace:* / core.* command
// registration (P0-14).
//
// Run with:
//   node --test src/main/browser/kairo-file-commands.test.cjs

'use strict';

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();

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
const { Container } = require('inversify');

const { CommandRegistry, MessageService } = require('@theia/core/lib/common');
const { CommonCommands } = require('@theia/core/lib/browser/common-commands');
const { WorkspaceCommands } = require('@theia/workspace/lib/browser/workspace-commands');

const { KairoFileCommandsContribution } = require('../../../lib/browser/kairo-file-commands');

function createMockMessageService() {
  return { info: () => {}, warn: () => {}, error: () => {}, log: () => {} };
}

function createMockCommandService() {
  return { executeCommand: () => Promise.resolve() };
}

test('KairoFileCommandsContribution.registerCommands registers every guarded id', () => {
  const container = new Container();
  container.bind(MessageService).toConstantValue(createMockMessageService());
  // CommandService interface is used by the contribution's
  // catch-all fallback. Bind a no-op mock.
  container.bind(require('@theia/core/lib/common').CommandService).toConstantValue(createMockCommandService());
  container.bind(KairoFileCommandsContribution).toSelf().inSingletonScope();

  const contribution = container.get(KairoFileCommandsContribution);
  const registry = new CommandRegistry();
  contribution.registerCommands(registry);

  // Build the set of expected ids from the two Theia
  // command namespaces. These are the IDs that the
  // Kairo menu bar / palette reference.
  const expected = [
    CommonCommands.OPEN.id,
    CommonCommands.SAVE.id,
    CommonCommands.SAVE_ALL.id,
    CommonCommands.SAVE_AS.id,
    CommonCommands.UNDO.id,
    CommonCommands.REDO.id,
    CommonCommands.CUT.id,
    CommonCommands.COPY.id,
    CommonCommands.PASTE.id,
    CommonCommands.SELECT_ALL.id,
    WorkspaceCommands.CLOSE.id,
    WorkspaceCommands.NEW_FILE.id,
    WorkspaceCommands.NEW_FOLDER.id,
    WorkspaceCommands.FILE_RENAME.id,
    WorkspaceCommands.FILE_DELETE.id,
    WorkspaceCommands.FILE_DUPLICATE.id,
    WorkspaceCommands.FILE_COMPARE.id,
    WorkspaceCommands.ADD_FOLDER.id,
    WorkspaceCommands.REMOVE_FOLDER.id,
    WorkspaceCommands.OPEN.id,
    WorkspaceCommands.OPEN_FILE.id,
    WorkspaceCommands.OPEN_FOLDER.id,
  ];

  for (const id of expected) {
    assert.ok(registry.commandIds.includes(id),
      `KairoFileCommandsContribution should register command "${id}"`);
  }
});

test('KairoFileCommandsContribution does not overwrite an existing handler', () => {
  const container = new Container();
  container.bind(MessageService).toConstantValue(createMockMessageService());
  container.bind(require('@theia/core/lib/common').CommandService).toConstantValue(createMockCommandService());
  container.bind(KairoFileCommandsContribution).toSelf().inSingletonScope();

  const contribution = container.get(KairoFileCommandsContribution);
  const registry = new CommandRegistry();

  // Pre-register a custom handler for `file.newFile` so
  // we can verify KairoFileCommandsContribution leaves it
  // alone.
  let preRegistered = false;
  registry.registerCommand(
    { id: 'file.newFile', category: 'Test' },
    { execute: () => { preRegistered = true; return Promise.resolve(); } },
  );
  contribution.registerCommands(registry);

  // Executing `file.newFile` should hit the pre-registered
  // handler, not the fallback. We use getAllHandlers
  // (CommandRegistry returns Command from getCommand, not
  // a handler).
  const handlers = registry.getAllHandlers('file.newFile');
  assert.ok(handlers.length > 0, 'pre-registered handler should still be present');
  handlers[0].execute();
  assert.strictEqual(preRegistered, true, 'pre-registered handler should be preserved');
});
