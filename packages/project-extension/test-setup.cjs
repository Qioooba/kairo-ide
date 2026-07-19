// test-setup.cjs — Node DOM polyfill for project-extension
// service tests.
//
// Why this exists: importing KairoProjectService transitively
// pulls in @theia/core/shared/inversify, which loads
// @lumino/domutils and a wide chain of Theia browser
// modules. These modules read browser globals (navigator,
// localStorage, document, DragEvent, …) at module-load
// time. Node has none of those, so the require chain throws
// before the test runs.
//
// This file installs a minimal jsdom window and copies the
// browser globals Node is missing onto globalThis. We reuse
// the same shape as packages/runtime-extension/test-setup.cjs
// (jsdom-global + targeted stubs) so the dep tree can load.
// The actual tests don't exercise the DOM — they just need
// the require chain to resolve.

'use strict';

// 1. CSS require hook: @theia/core's browser modules
//    transitively require('./*.css') at load time.
require.extensions['.css'] = function (module, filename) {
  module.exports = {};
};

// 2. jsdom-global does the bulk of the polyfill work.
require('jsdom-global')('', { url: 'http://127.0.0.1/' });

// 3. jsdom 24 does not implement HTML5 drag-and-drop events.
//    @lumino/dragdrop references DragEvent / DataTransfer at
//    module load (class X extends DragEvent). Install stubs.
if (typeof globalThis.DragEvent === 'undefined') {
  class DragEvent extends globalThis.MouseEvent {
    constructor(type, init) { super(type, init); }
  }
  globalThis.DragEvent = DragEvent;
}
if (typeof globalThis.DataTransfer === 'undefined') {
  class DataTransfer {
    constructor() { this.data = new Map(); }
    setData(type, value) { this.data.set(type, value); }
    getData(type) { return this.data.get(type) || ''; }
  }
  globalThis.DataTransfer = DataTransfer;
}
if (typeof globalThis.DataTransferItem === 'undefined') {
  globalThis.DataTransferItem = class DataTransferItem {};
}
if (typeof globalThis.DataTransferItemList === 'undefined') {
  globalThis.DataTransferItemList = class DataTransferItemList {
    constructor() { this.items = []; }
  };
}
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEvent extends globalThis.MouseEvent {
    constructor(type, init) { super(type, init); }
  }
  globalThis.PointerEvent = PointerEvent;
}

// 4. Top up any additional browser classes jsdom-global's
//    hard-coded KEYS list might miss.
const EXTRA_KEYS = [
  'Storage', 'localStorage', 'sessionStorage', 'getComputedStyle',
  'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame',
  'IntersectionObserver', 'ResizeObserver', 'MessageEvent', 'ErrorEvent',
  'ProgressEvent', 'HashChangeEvent', 'PopStateEvent', 'UIEvent',
  'MouseEvent', 'KeyboardEvent', 'TouchEvent', 'Touch', 'TouchList',
  'Image', 'FileReader', 'Blob', 'File', 'FileList', 'FormData',
  'URL', 'URLSearchParams', 'Headers', 'Request', 'Response',
  'fetch', 'AbortController', 'AbortSignal', 'DOMException', 'WebSocket',
];
for (const key of EXTRA_KEYS) {
  if (key in globalThis.window && !(key in globalThis)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => globalThis.window[key],
    });
  }
}

// 5. @theia/core's browser modules call obsolete
//    document.execCommand / queryCommandSupported that
//    jsdom 24 doesn't implement. Install no-op stubs.
const doc = globalThis.document;
if (doc) {
  if (typeof doc.queryCommandSupported !== 'function') {
    Object.defineProperty(doc, 'queryCommandSupported', {
      configurable: true, value: function () { return false; },
    });
  }
  if (typeof doc.execCommand !== 'function') {
    Object.defineProperty(doc, 'execCommand', {
      configurable: true, value: function () { return false; },
    });
  }
}

// 6. Theia requires FrontendApplicationConfigProvider to
//    be set before any browser module is loaded. Several
//    transitive deps of @kairo/runtime-extension
//    (workspace-service, window-title-service) read it
//    during module load.
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});
