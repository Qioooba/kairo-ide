// Kairo Frontend Module — integration tests.
//
// Verifies the Kairo product frontend module composition:
//   - Widget factory bindings for all Kairo views
//   - Contribution bindings (CommandContribution, KeybindingContribution, etc.)
//   - Service replacements (EncodingService, FileService, SaveableService)
//   - All factory IDs are properly defined and registered
//   - Core runtime services are bound exactly once
//
// Run with:
//   node --import ./test/register-hooks.mjs --test src/main/browser/kairo-frontend-module.test.cjs

'use strict';

const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
register('data:text/javascript,' + encodeURIComponent(`
export function resolve(specifier, context, nextResolve) {
  if (/\\.(css|svg|ttf|woff|woff2|png|jpg|gif)$/.test(specifier)) {
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

if (!global.ResizeObserver) {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.includes('monaco-editor-core')) {
    const mockPath = require('node:path').join(__dirname, '..', '..', '..', '..', 'search-extension', 'src', 'browser', '__monaco-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  if (request === 'p-queue') {
    const mockPath = require('node:path').join(__dirname, '__p-queue-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  if (request === 'xterm' || request === 'xterm-addon-webgl' || request === 'xterm-addon-fit') {
    const mockPath = require('node:path').join(__dirname, '__xterm-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  return origResolveFilename.call(this, request, parent, ...args);
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
const { Container, ContainerModule } = require('inversify');

// ------------------------------------------------------------------
// Helper: binding count
// ------------------------------------------------------------------

function bindingCount(container, serviceIdentifier) {
  const dict = container._bindingDictionary;
  if (!dict.hasKey(serviceIdentifier)) {
    return 0;
  }
  return dict.get(serviceIdentifier).length;
}

// ------------------------------------------------------------------
// Full composition (same as kairo-composition.test.cjs)
// ------------------------------------------------------------------

const {
  RuntimeConnectionService,
  KairoRuntime,
  KairoErrorListener,
  WorkspaceContextService,
} = require('@kairo/runtime-extension/lib/browser');

const { bindKairoFrontend } = require('../../../lib/browser/kairo-product-frontend-module');
const { bindKairoProduct } = require('../../../lib/product-bindings');
const { ILogger } = require('@theia/core/lib/common/logger');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { LabelProvider } = require('@theia/core/lib/browser/label-provider');
const { FileSystemPreferences } = require('@theia/filesystem/lib/common/filesystem-preferences');
const { ProgressService } = require('@theia/core/lib/common/progress-service');
const { EncodingRegistry } = require('@theia/core/lib/browser/encoding-registry');
const { EncodingService } = require('@theia/core/lib/common/encoding-service');
const { FileServiceContribution } = require('@theia/filesystem/lib/browser/file-service');
const { FileSystemWatcherErrorHandler } = require('@theia/filesystem/lib/browser/filesystem-watcher-error-handler');
const { CorePreferences } = require('@theia/core/lib/common/core-preferences');
const { ContributionProvider, bindRootContributionProvider } = require('@theia/core/lib/common/contribution-provider');
const { SaveErrorChecker } = require('@theia/core/lib/browser/saveable-service');
const { WindowFocusService } = require('@theia/core/lib/browser/window/window-focus-service');

const mockLogger = {
  trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {},
  isTrace: () => false, isDebug: () => false, isInfo: () => false, isWarn: () => false, isError: () => false, isFatal: () => false,
  log: () => {}, child: () => mockLogger, setContext: () => {},
};

function compose() {
  const container = new Container();
  container.load(
    new ContainerModule((bind, _unbind, isBound, rebind) => {
      bind(ILogger).toConstantValue(mockLogger);
      if (!isBound(MessageService)) bind(MessageService).toConstantValue({ info: () => {}, warn: () => {}, error: () => {} });
      if (!isBound(LabelProvider)) bind(LabelProvider).toConstantValue({ getIcon: () => '', getName: () => '', getLongName: () => '' });
      if (!isBound(FileSystemPreferences)) bind(FileSystemPreferences).toConstantValue({});
      if (!isBound(ProgressService)) bind(ProgressService).toConstantValue({ showProgress: async () => ({ report: () => {}, cancel: () => {} }) });
      if (!isBound(EncodingRegistry)) bind(EncodingRegistry).toConstantValue({ getEncoding: () => 'utf8' });
      if (!isBound(EncodingService)) bind(EncodingService).toConstantValue({ decode: (b) => b.toString(), encode: (s) => Buffer.from(s) });
      if (!isBound(FileServiceContribution)) bind(FileServiceContribution).toConstantValue({ registerFileSystemProviders: () => {} });
      if (!isBound(FileSystemWatcherErrorHandler)) bind(FileSystemWatcherErrorHandler).toConstantValue({});
      if (!isBound(CorePreferences)) bind(CorePreferences).toConstantValue({ 'workbench.commandPalette.history': 0, 'workbench.colorTheme': 'dark', 'workbench.iconTheme': 'theia-file-icons' });
      bindRootContributionProvider(bind, SaveErrorChecker);
      bindRootContributionProvider(bind, FileServiceContribution);
      if (!isBound(WindowFocusService)) bind(WindowFocusService).toConstantValue({ onFocusChanged: () => ({ dispose: () => {} }) });
      bindKairoFrontend(bind, undefined, isBound, rebind);
      bindKairoProduct(bind, isBound, rebind);
    }),
  );
  return container;
}

// ------------------------------------------------------------------
// Widget Factory Tests
// ------------------------------------------------------------------

test('frontend module: all core widget factories are bound', () => {
  const container = compose();
  const { WidgetFactory } = require('@theia/core/lib/browser');

  // Collect all WidgetFactory binding IDs
  const dict = container._bindingDictionary;
  const factoryIds = new Set();
  if (dict.hasKey(WidgetFactory)) {
    const entries = dict.get(WidgetFactory);
    // Each toDynamicValue binding has a factory; we can't easily get the id
    // without calling the factory, so we count the total bindings
  }

  const count = bindingCount(container, WidgetFactory);
  assert.ok(count >= 20, `Expected at least 20 WidgetFactory bindings, got ${count}`);
});

// ------------------------------------------------------------------
// Factory IDs Tests
// ------------------------------------------------------------------

const factoryIds = require('../../../lib/browser/kairo-factory-ids');

test('factory IDs: all expected factory IDs are defined', () => {
  const expectedIds = [
    'KAIRO_SERVERS_FACTORY_ID',
    'KAIRO_BUILDS_FACTORY_ID',
    'KAIRO_DEPLOYMENTS_FACTORY_ID',
    'KAIRO_LOGS_FACTORY_ID',
    'KAIRO_IMPORT_WIZARD_FACTORY_ID',
    'KAIRO_PROJECT_SELECTOR_FACTORY_ID',
    'KAIRO_RUN_CONFIGURATIONS_FACTORY_ID',
    'KAIRO_PROBLEMS_FACTORY_ID',
    'KAIRO_TOOLBAR_FACTORY_ID',
    'KAIRO_KEYMAP_FACTORY_ID',
    'KAIRO_LOCAL_HISTORY_FACTORY_ID',
    'KAIRO_TESTS_FACTORY_ID',
    'KAIRO_MAVEN_FACTORY_ID',
    'KAIRO_TODO_FACTORY_ID',
    'KAIRO_PERF_FACTORY_ID',
    'KAIRO_SQL_CONSOLE_FACTORY_ID',
    'KAIRO_REMOTE_FACTORY_ID',
    'KAIRO_SHORTCUTS_FACTORY_ID',
  ];

  for (const id of expectedIds) {
    assert.ok(factoryIds[id] !== undefined, `Factory ID ${id} is missing from module exports`);
    assert.equal(typeof factoryIds[id], 'string');
    assert.ok(factoryIds[id].length > 0, `Factory ID ${id} must be non-empty`);
  }
});

test('factory IDs: debug widget factory IDs are defined', () => {
  const debugIds = [
    'KAIRO_DEBUG_VARIABLES_FACTORY_ID',
    'KAIRO_DEBUG_CALLSTACK_FACTORY_ID',
    'KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID',
    'KAIRO_DEBUG_TOOLBAR_FACTORY_ID',
    'KAIRO_DEBUG_CONSOLE_FACTORY_ID',
    'KAIRO_DEBUG_WATCH_FACTORY_ID',
    'KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID',
    'KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID',
    'KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID',
  ];

  for (const id of debugIds) {
    assert.ok(factoryIds[id] !== undefined, `Debug factory ID ${id} is missing from module exports`);
    assert.equal(typeof factoryIds[id], 'string');
  }
});

test('factory IDs: all factory IDs are unique', () => {
  const values = Object.values(factoryIds).filter(v => typeof v === 'string');
  const unique = new Set(values);
  assert.equal(values.length, unique.size, 'All factory IDs must be unique');
});

test('factory IDs: follow kairo-* naming convention', () => {
  const values = Object.values(factoryIds).filter(v => typeof v === 'string');
  for (const val of values) {
    assert.ok(val.startsWith('kairo-'), `Factory ID "${val}" must start with "kairo-"`);
  }
});

// ------------------------------------------------------------------
// Contribution Bindings Tests
// ------------------------------------------------------------------

test('frontend module: FrontendApplicationContribution bindings are registered', () => {
  const container = compose();
  const { FrontendApplicationContribution } = require('@theia/core/lib/browser');
  const count = bindingCount(container, FrontendApplicationContribution);
  // At minimum: KairoStatusBarContribution, KairoViewsContribution, WorkspaceContextService,
  // KairoLargeFileContribution, KairoEditorAutoSaveSync, KairoEditorContribution,
  // KairoNotificationCenterContribution, KairoMemoryTracker, KairoColdStartTimer,
  // KairoA11yPatchContribution, KairoFocusManagement, LocalHistoryContribution
  assert.ok(count >= 10, `Expected at least 10 FrontendApplicationContribution bindings, got ${count}`);
});

test('frontend module: CommandContribution bindings are registered', () => {
  const container = compose();
  const { CommandContribution } = require('@theia/core/lib/common');
  const count = bindingCount(container, CommandContribution);
  // At minimum: KairoViewsContribution, KairoFileCommandsContribution, KairoLargeFileContribution,
  // KairoEditorContribution, KairoNotificationCenterContribution, KairoNavigationContribution,
  // KairoFocusManagement, KairoEncodingCommandsContribution, LocalHistoryContribution
  assert.ok(count >= 7, `Expected at least 7 CommandContribution bindings, got ${count}`);
});

test('frontend module: KeybindingContribution bindings are registered', () => {
  const container = compose();
  const { KeybindingContribution } = require('@theia/core/lib/browser/keybinding');
  const count = bindingCount(container, KeybindingContribution);
  // At minimum: KairoViewsContribution, KairoEditorContribution, KairoNavigationContribution,
  // KairoFocusManagement
  assert.ok(count >= 4, `Expected at least 4 KeybindingContribution bindings, got ${count}`);
});

test('frontend module: MenuContribution bindings are registered', () => {
  const container = compose();
  const { MenuContribution } = require('@theia/core/lib/common');
  const count = bindingCount(container, MenuContribution);
  // At minimum: KairoViewsContribution, KairoEditorContribution
  assert.ok(count >= 2, `Expected at least 2 MenuContribution bindings, got ${count}`);
});

// ------------------------------------------------------------------
// Service Replacement Tests
// ------------------------------------------------------------------

test('frontend module: EncodingService is replaced by KairoSafeEncodingService', () => {
  const container = compose();
  const { EncodingService } = require('@theia/core/lib/common/encoding-service');
  const { KairoSafeEncodingService } = require('@kairo/encoding-extension/lib/browser');
  assert.ok(bindingCount(container, EncodingService) >= 1, 'EncodingService must be bound');
  const svc = container.get(EncodingService);
  assert.ok(svc instanceof KairoSafeEncodingService,
    'EncodingService must resolve to KairoSafeEncodingService');
});

test('frontend module: EncodingRegistry is replaced by KairoEncodingRegistry', () => {
  const container = compose();
  const { EncodingRegistry } = require('@theia/core/lib/browser/encoding-registry');
  const { KairoEncodingRegistry } = require('@kairo/encoding-extension/lib/browser');
  assert.ok(bindingCount(container, EncodingRegistry) >= 1, 'EncodingRegistry must be bound');
  const svc = container.get(EncodingRegistry);
  assert.ok(svc instanceof KairoEncodingRegistry,
    'EncodingRegistry must resolve to KairoEncodingRegistry');
});

test('frontend module: SaveableService is replaced by KairoSaveableService', () => {
  const container = compose();
  const { SaveableService } = require('@theia/core/lib/browser/saveable-service');
  const { KairoSaveableService } = require('../../../lib/browser/kairo-saveable-service');
  assert.ok(bindingCount(container, SaveableService) >= 1, 'SaveableService must be bound');
  const svc = container.get(SaveableService);
  assert.ok(svc instanceof KairoSaveableService,
    'SaveableService must resolve to KairoSaveableService');
});

test('frontend module: FileService is replaced by KairoFileService', () => {
  const container = compose();
  const { FileService } = require('@theia/filesystem/lib/browser/file-service');
  const { KairoFileService } = require('@kairo/encoding-extension/lib/browser');
  assert.ok(bindingCount(container, FileService) >= 1, 'FileService must be bound');
  const svc = container.get(FileService);
  assert.ok(svc instanceof KairoFileService,
    'FileService must resolve to KairoFileService');
});

// ------------------------------------------------------------------
// Runtime Service Binding Tests
// ------------------------------------------------------------------

test('frontend module: RuntimeConnectionService is bound exactly once', () => {
  const container = compose();
  const count = bindingCount(container, RuntimeConnectionService);
  assert.strictEqual(count, 1, 'RuntimeConnectionService must be bound exactly once');
});

test('frontend module: KairoRuntime is bound exactly once', () => {
  const container = compose();
  const count = bindingCount(container, KairoRuntime);
  assert.strictEqual(count, 1, 'KairoRuntime must be bound exactly once');
});

test('frontend module: KairoErrorListener is bound exactly once', () => {
  const container = compose();
  const count = bindingCount(container, KairoErrorListener);
  assert.strictEqual(count, 1, 'KairoErrorListener must be bound exactly once');
});

test('frontend module: WorkspaceContextService is bound exactly once', () => {
  const container = compose();
  const count = bindingCount(container, WorkspaceContextService);
  assert.strictEqual(count, 1, 'WorkspaceContextService must be bound exactly once');
});

// ------------------------------------------------------------------
// Widget Class Exports Tests
// ------------------------------------------------------------------

test('frontend module: KairoProblemsWidget is exported from the compiled module', () => {
  const { KairoProblemsWidget, KAIRO_PROBLEMS_FACTORY_ID } = require('../../../lib/browser/kairo-problems-widget');
  assert.equal(typeof KairoProblemsWidget, 'function');
  assert.equal(KAIRO_PROBLEMS_FACTORY_ID, 'kairo-problems');
  assert.equal(KairoProblemsWidget.ID, 'kairo-problems');
});

test('frontend module: KairoWelcomeWidget is exported from the compiled module', () => {
  const { KairoWelcomeWidget, KAIRO_WELCOME_FACTORY_ID } = require('../../../lib/browser/kairo-welcome-widget');
  assert.equal(typeof KairoWelcomeWidget, 'function');
  assert.equal(KAIRO_WELCOME_FACTORY_ID, 'kairo-welcome');
});

test('frontend module: KairoTodoWidget is exported from the compiled module', () => {
  const { KairoTodoWidget, KAIRO_TODO_FACTORY_ID } = require('../../../lib/browser/kairo-todo-widget');
  assert.equal(typeof KairoTodoWidget, 'function');
  assert.equal(KAIRO_TODO_FACTORY_ID, 'kairo-todo-view');
});

test('frontend module: KairoTestResultsWidget is exported from the compiled module', () => {
  const { KairoTestResultsWidget } = require('../../../lib/browser/kairo-test-results-widget');
  assert.equal(typeof KairoTestResultsWidget, 'function');
});

test('frontend module: MavenViewWidget is exported from the compiled module', () => {
  const { MavenViewWidget } = require('../../../lib/browser/maven-view-widget');
  assert.equal(typeof MavenViewWidget, 'function');
});

test('frontend module: KairoPerfDashboardWidget is exported from the compiled module', () => {
  const { KairoPerfDashboardWidget } = require('../../../lib/browser/kairo-perf-dashboard-widget');
  assert.equal(typeof KairoPerfDashboardWidget, 'function');
});

test('frontend module: KairoToolbarWidget is exported from the compiled module', () => {
  const { KairoToolbarWidget } = require('../../../lib/browser/kairo-toolbar-widget');
  assert.equal(typeof KairoToolbarWidget, 'function');
});

test('frontend module: KairoRunConfigurationsWidget is exported from the compiled module', () => {
  const { KairoRunConfigurationsWidget } = require('../../../lib/browser/kairo-run-configurations-widget');
  assert.equal(typeof KairoRunConfigurationsWidget, 'function');
});

// ------------------------------------------------------------------
// KairoRemoteWidget Exports
// ------------------------------------------------------------------

test('frontend module: KairoRemoteWidget is exported from the compiled module', () => {
  const { KairoRemoteWidget } = require('../../../lib/browser/kairo-remote-widget');
  assert.equal(typeof KairoRemoteWidget, 'function');
});

// ------------------------------------------------------------------
// KairoKeymapWidget Exports
// ------------------------------------------------------------------

test('frontend module: KairoKeymapWidget is exported from the compiled module', () => {
  const { KairoKeymapWidget, KAIRO_KEYMAP_FACTORY_ID } = require('../../../lib/browser/kairo-keymap-widget');
  assert.equal(typeof KairoKeymapWidget, 'function');
  assert.equal(KAIRO_KEYMAP_FACTORY_ID, 'kairo-keymap');
});

// ------------------------------------------------------------------
// KairoShortcutsWidget Exports
// ------------------------------------------------------------------

test('frontend module: KairoShortcutsWidget is exported from the compiled module', () => {
  const { KairoShortcutsWidget, KAIRO_SHORTCUTS_FACTORY_ID } = require('../../../lib/browser/kairo-shortcuts-widget');
  assert.equal(typeof KairoShortcutsWidget, 'function');
  assert.equal(KAIRO_SHORTCUTS_FACTORY_ID, 'kairo-shortcuts');
});

// ------------------------------------------------------------------
// KairoSqlConsoleWidget Exports
// ------------------------------------------------------------------

test('frontend module: KairoSqlConsoleWidget is exported from the compiled module', () => {
  const { KairoSqlConsoleWidget } = require('../../../lib/browser/kairo-sql-console-widget');
  assert.equal(typeof KairoSqlConsoleWidget, 'function');
});

// ------------------------------------------------------------------
// KairoNotificationCenter Exports
// ------------------------------------------------------------------

test('frontend module: KairoNotificationCenterWidget is exported from the compiled module', () => {
  const { KairoNotificationCenterWidget, KAIRO_NOTIFICATION_CENTER_FACTORY_ID } = require('../../../lib/browser/kairo-notification-center');
  assert.equal(typeof KairoNotificationCenterWidget, 'function');
  assert.equal(KAIRO_NOTIFICATION_CENTER_FACTORY_ID, 'kairo-notification-center');
});

// ------------------------------------------------------------------
// Debug Widget Exports Tests
// ------------------------------------------------------------------

test('frontend module: debug widgets are exported from compiled modules', () => {
  const { KairoDebugVariablesWidget } = require('../../../lib/browser/debug-variables-widget');
  assert.equal(typeof KairoDebugVariablesWidget, 'function');

  const { KairoDebugCallStackWidget } = require('../../../lib/browser/debug-callstack-widget');
  assert.equal(typeof KairoDebugCallStackWidget, 'function');

  const { KairoDebugBreakpointsWidget } = require('../../../lib/browser/debug-breakpoints-widget');
  assert.equal(typeof KairoDebugBreakpointsWidget, 'function');

  const { KairoDebugToolbarWidget } = require('../../../lib/browser/debug-toolbar-widget');
  assert.equal(typeof KairoDebugToolbarWidget, 'function');

  const { KairoDebugConsoleWidget } = require('../../../lib/browser/debug-console-widget');
  assert.equal(typeof KairoDebugConsoleWidget, 'function');

  const { KairoDebugWatchWidget } = require('../../../lib/browser/debug-watch-widget');
  assert.equal(typeof KairoDebugWatchWidget, 'function');
});

test('frontend module: debug advanced widgets are exported from compiled modules', () => {
  const { KairoDebugModuleSelectorWidget } = require('../../../lib/browser/debug-module-selector-widget');
  assert.equal(typeof KairoDebugModuleSelectorWidget, 'function');

  const { KairoDebugConditionEditorWidget } = require('../../../lib/browser/debug-condition-editor-widget');
  assert.equal(typeof KairoDebugConditionEditorWidget, 'function');

  const { KairoDebugHotSwapStatusWidget } = require('../../../lib/browser/debug-hotswap-status-widget');
  assert.equal(typeof KairoDebugHotSwapStatusWidget, 'function');
});

// ------------------------------------------------------------------
// KairoNavigationContribution Exports
// ------------------------------------------------------------------

test('frontend module: KairoNavigationContribution is exported from the compiled module', () => {
  const { KairoNavigationContribution, KairoNavigationCommands } = require('../../../lib/browser/kairo-navigation-contribution');
  assert.equal(typeof KairoNavigationContribution, 'function');
  assert.equal(typeof KairoNavigationCommands, 'object');
  assert.equal(typeof KairoNavigationCommands.GO_TO_LINE, 'object');
  assert.equal(KairoNavigationCommands.GO_TO_LINE.id, 'kairo.navigation.goToLine');
});

// ------------------------------------------------------------------
// KairoFocusManagement Exports
// ------------------------------------------------------------------

test('frontend module: KairoFocusManagement is exported from the compiled module', () => {
  const { KairoFocusManagement, KairoFocusCommands } = require('../../../lib/browser/kairo-focus-management');
  assert.equal(typeof KairoFocusManagement, 'function');
  assert.equal(typeof KairoFocusCommands, 'object');
  assert.equal(KairoFocusCommands.FOCUS_EDITOR.id, 'kairo.focus.editor');
  assert.equal(KairoFocusCommands.FOCUS_TERMINAL.id, 'kairo.focus.terminal');
});

// ------------------------------------------------------------------
// Cleanup
// ------------------------------------------------------------------

test('teardown', () => {
  disableJSDOM();
});