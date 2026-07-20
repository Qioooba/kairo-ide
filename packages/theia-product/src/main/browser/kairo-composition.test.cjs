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

test('composition: widget factories for all six Kairo views are registered', () => {
  const container = compose();
  const { WidgetFactory } = require('@theia/core/lib/browser');
  const factories = bindingCount(container, WidgetFactory);
  assert.ok(
    factories >= 6,
    `expected at least 6 WidgetFactory bindings (servers/builds/deployments/logs/import-wizard/project-selector), got ${factories}`,
  );
});

test('composition: JSP language contribution is bound (KAIRO-RC-WEB-002)', () => {
  const container = compose();
  const { KairoJspLanguageContribution } = require('@kairo/jsp-extension/lib/browser');
  // Assert the binding exists WITHOUT getAll(FrontendApplicationContribution):
  // that would eagerly construct every contribution and fail on Theia
  // services (StatusBar, ApplicationShell, …) absent from this bare
  // container. The class itself is dependency-free, so get() is safe.
  assert.strictEqual(
    bindingCount(container, KairoJspLanguageContribution),
    1,
    'KairoJspLanguageContribution must be bound exactly once (toSelf) by bindJspExtension',
  );
  const instance = container.get(KairoJspLanguageContribution);
  assert.ok(instance instanceof KairoJspLanguageContribution);
  assert.strictEqual(typeof instance.onStart, 'function', 'must implement FrontendApplicationContribution.onStart');
});

test('teardown', () => {
  disableJSDOM();
});
