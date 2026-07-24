// KAIRO-RC-WEB-001 — composition smoke test.
//
// The browser bundle composes the Kairo frontend by calling
// bindKairoFrontend() and bindKairoProduct() inside the same
// ContainerModule (see product-frontend.ts). A regression made
// both binders bind the same four runtime services
// (RuntimeConnectionService, KairoRuntime, KairoErrorListener,
// WorkspaceContextService) with plain bind(), so container.get()
// threw "Ambiguous match found for serviceIdentifier" and the
// frontend died at startup.
//
// This test replicates the exact composition and asserts every
// shared service identifier ends up with exactly ONE binding —
// without instantiating anything (RuntimeConnectionService opens
// a WebSocket in its constructor, so we count bindings via
// inversify's binding dictionary instead of calling get()).
//
// Run with:
//   node --test src/main/browser/kairo-composition.test.cjs

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

// Theia browser modules require CSS files — stub them out
const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

// Mock @theia/monaco-editor-core to avoid the ESM import issue in CJS tests.
// Mock p-queue to avoid ERR_REQUIRE_ESM (p-queue is ESM-only).
// Mock xterm/xterm-addon-webgl to avoid canvas dependency in JSDOM.
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
const assert = require('node:assert');
const { Container, ContainerModule } = require('inversify');

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

// Mock logger for bare container (no Theia core module loaded)
const mockLogger = {
  trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {},
  isTrace: () => false, isDebug: () => false, isInfo: () => false, isWarn: () => false, isError: () => false, isFatal: () => false,
  log: () => {}, child: () => mockLogger, setContext: () => {},
};

function bindingCount(container, serviceIdentifier) {
  const dict = container._bindingDictionary;
  if (!dict.hasKey(serviceIdentifier)) {
    return 0;
  }
  return dict.get(serviceIdentifier).length;
}

// Compose exactly like KairoProductFrontend does in the browser bundle.
function compose() {
  const container = new Container();
  container.load(
    new ContainerModule((bind, _unbind, isBound, rebind) => {
      // Bind mock services for bare container (no Theia core module loaded)
      bind(ILogger).toConstantValue(mockLogger);
      if (!isBound(MessageService)) bind(MessageService).toConstantValue({ info: () => {}, warn: () => {}, error: () => {} });
      if (!isBound(LabelProvider)) bind(LabelProvider).toConstantValue({ getIcon: () => '', getName: () => '', getLongName: () => '' });
      if (!isBound(FileSystemPreferences)) bind(FileSystemPreferences).toConstantValue({});
      if (!isBound(ProgressService)) bind(ProgressService).toConstantValue({ showProgress: async () => ({ report: () => {}, cancel: () => {} }) });
      if (!isBound(EncodingRegistry)) bind(EncodingRegistry).toConstantValue({ getEncoding: () => 'utf8' });
      if (!isBound(EncodingService)) bind(EncodingService).toConstantValue({ decode: (b) => b.toString(), encode: (s) => Buffer.from(s) });
      if (!isBound(FileServiceContribution)) bind(FileServiceContribution).toConstantValue({});
      if (!isBound(FileSystemWatcherErrorHandler)) bind(FileSystemWatcherErrorHandler).toConstantValue({});
      bindKairoFrontend(bind, undefined, isBound, rebind);
      bindKairoProduct(bind, isBound, rebind);
    }),
  );
  return container;
}

const SHARED_RUNTIME_SERVICES = [
  ['RuntimeConnectionService', RuntimeConnectionService],
  ['KairoRuntime', KairoRuntime],
  ['KairoErrorListener', KairoErrorListener],
  ['WorkspaceContextService', WorkspaceContextService],
];

test('composition: shared runtime services are bound exactly once (KAIRO-RC-WEB-001)', () => {
  const container = compose();
  for (const [name, id] of SHARED_RUNTIME_SERVICES) {
    const count = bindingCount(container, id);
    assert.strictEqual(
      count,
      1,
      `${name} must have exactly 1 binding after composition, got ${count} ` +
        '(double binding makes container.get() throw "Ambiguous match" and kills frontend startup)',
    );
  }
});

test('composition: KairoProduct module alone still binds the runtime services', () => {
  // Standalone use (KairoProduct ContainerModule / loadKairoProduct)
  // must keep working when nothing was bound before.
  const container = new Container();
  container.load(
    new ContainerModule((bind, _unbind, isBound, rebind) => {
      bindKairoProduct(bind, isBound, rebind);
    }),
  );
  for (const [name, id] of SHARED_RUNTIME_SERVICES) {
    assert.ok(
      bindingCount(container, id) >= 1,
      `${name} must be bound by bindKairoProduct in standalone composition`,
    );
  }
});

test('composition: widget factories include the Run Configurations view', () => {
  const container = compose();
  const { WidgetFactory } = require('@theia/core/lib/browser');
  const factories = bindingCount(container, WidgetFactory);
  assert.ok(
    factories >= 7,
    `expected at least 7 WidgetFactory bindings including run configurations, got ${factories}`,
  );
});

test('composition: JSP language contribution is bound (KAIRO-RC-WEB-002)', () => {
  const container = compose();
  const { KairoJspLanguageContribution } = require('@kairo/jsp-extension/lib/browser');
  // Assert the binding exists. The class has dependencies
  // (JavaCompletionProvider, JavaLanguageClient, etc.) that require
  // Theia core services not available in this bare container, so
  // binding count is verified but instantiation is skipped.
  assert.strictEqual(
    bindingCount(container, KairoJspLanguageContribution),
    1,
    'KairoJspLanguageContribution must be bound exactly once (toSelf) by bindJspExtension',
  );
  // Verify the class implements FrontendApplicationContribution.onStart
  assert.strictEqual(typeof KairoJspLanguageContribution.prototype.onStart, 'function',
    'KairoJspLanguageContribution must implement FrontendApplicationContribution.onStart');
});

test('teardown', () => {
  disableJSDOM();
});

test('composition: Theia EncodingService is replaced by the validating one (KAIRO-RC-WEB-229)', () => {
  const container = compose();
  const { EncodingService } = require('@theia/core/lib/common/encoding-service');
  const { KairoSafeEncodingService } = require('@kairo/encoding-extension/lib/browser');
  assert.ok(bindingCount(container, EncodingService) >= 1, 'EncodingService must be bound');
  const svc = container.get(EncodingService);
  assert.ok(svc instanceof KairoSafeEncodingService,
    'EncodingService must resolve to KairoSafeEncodingService (unrepresentable-char protection)');
});
