// test-setup.cjs — minimal Node DOM polyfill for runtime-extension
// wire-protocol tests.
//
// Why this exists: the runtime-extension's compiled lib/index.js
// transitively imports @theia/core/shared/inversify which pulls in
// @lumino/{domutils,dragdrop,…} and @theia/core's browser-targeted
// modules. The lumino modules read browser globals (navigator,
// document, DragEvent, localStorage, …) at top level. The theia
// modules require their companion CSS files via webpack-style
// `require('./*.css')` calls, and call a handful of obsolete
// `document.execCommand` / `document.queryCommandSupported` methods.
// Node has none of those, so the module load throws before the
// test even gets a chance to run.
//
// This setup:
//   1. Hooks require() so `.css` files resolve to an empty module.
//   2. Delegates the DOM polyfill to `jsdom-global`, which copies a
//      well-known set of browser globals from a fresh JSDOM window
//      onto `globalThis`. We pass the URL through so the origin is
//      not opaque (otherwise localStorage is unavailable).
//   3. Tops up a few extras that the lumino / inversify / @theia
//      dep tree references at module load but that jsdom-global's
//      hard-coded KEYS list does not include (DragEvent,
//      DataTransfer, etc.). For the few that jsdom 24 itself does
//      not implement (DragEvent / DataTransfer / PointerEvent /
//      document.queryCommandSupported / document.execCommand), we
//      install minimal no-op stubs so the expression evaluates
//      without throwing.
//
// The test files themselves do not exercise real browser behaviour
// (they are pure wire-protocol tests against a local HTTP server),
// so the shim is broad but the tests still run deterministically.
//
// We pin jsdom to 24.x in devDependencies because jsdom 25+ pulled
// in the ESM-only `@exodus/bytes` package via html-encoding-sniffer
// and breaks CJS require() on the Node 20 line.
//
// This is referenced via `node --require ./test-setup.cjs` from
// the `test` script in package.json.

'use strict';

// 1. CSS require hook: stub .css files as empty modules. Required
//    for the @theia/core browser-side modules that the runtime-
//    extension transitively pulls in.
require.extensions['.css'] = function (module, filename) {
  module.exports = {};
};

// 2. Run jsdom-global so it does the bulk of the polyfill work.
//    jsdom-global creates its own internal JSDOM; we use that one
//    for the EXTRA_KEYS / stub work below so we do not race with
//    the getter on `globalThis.document`.
require('jsdom-global')('', { url: 'http://127.0.0.1/' });

// 3a. jsdom 24 does not implement HTML5 drag-and-drop events on
//     the window. The @lumino/dragdrop module references
//     `DragEvent` and `DataTransfer` at module load (class X
//     extends DragEvent). We install a minimal stub for each so
//     the `extends` clause evaluates.
if (typeof globalThis.DragEvent === 'undefined') {
  class DragEvent extends globalThis.MouseEvent {
    constructor(type, init) {
      super(type, init);
    }
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
    constructor(type, init) {
      super(type, init);
    }
  }
  globalThis.PointerEvent = PointerEvent;
}

// 3b. Top up: copy any additional browser classes / constructors
//     that the dependency tree references at module load but that
//     jsdom-global does not include in its hard-coded KEYS list.
const EXTRA_KEYS = [
  'ClipboardEvent',
  'WheelEvent',
  'InputEvent',
  'FocusEvent',
  'AnimationEvent',
  'TransitionEvent',
  'StorageEvent',
  'Storage',
  'localStorage',
  'sessionStorage',
  'getComputedStyle',
  'matchMedia',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'MutationObserver',
  'IntersectionObserver',
  'ResizeObserver',
  'Event',
  'CustomEvent',
  'MessageEvent',
  'ErrorEvent',
  'ProgressEvent',
  'HashChangeEvent',
  'PopStateEvent',
  'UIEvent',
  'MouseEvent',
  'KeyboardEvent',
  'TouchEvent',
  'Touch',
  'TouchList',
  'Image',
  'FileReader',
  'Blob',
  'File',
  'FileList',
  'FormData',
  'URL',
  'URLSearchParams',
  'Headers',
  'Request',
  'Response',
  'fetch',
  'AbortController',
  'AbortSignal',
  'DOMException',
  'WebSocket',
];

for (const key of EXTRA_KEYS) {
  if (key in globalThis.window && !(key in globalThis)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => globalThis.window[key],
    });
  }
}

// 3c. @theia/core's browser modules call a handful of obsolete
//     `document.execCommand` / `document.queryCommandSupported`
//     APIs that jsdom 24 does not implement. Install no-op stubs
//     on the document object. We use the proxy-getter global so
//     that the patch is observable via `document.*`.
const doc = globalThis.document;
if (doc) {
  if (typeof doc.queryCommandSupported !== 'function') {
    Object.defineProperty(doc, 'queryCommandSupported', {
      configurable: true,
      value: function () { return false; },
    });
  }
  if (typeof doc.execCommand !== 'function') {
    Object.defineProperty(doc, 'execCommand', {
      configurable: true,
      value: function () { return false; },
    });
  }
}
