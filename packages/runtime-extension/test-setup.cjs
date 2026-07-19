// test-setup.cjs — minimal Node DOM polyfill for runtime-extension
// wire-protocol tests.
//
// Why this exists: the runtime-extension's compiled lib/index.js
// transitively imports @theia/core/shared/inversify which pulls in
// @lumino/{domutils,dragdrop,…} — and those modules read browser
// globals (navigator, document, DragEvent, …) at top level. Node
// has none of those, so the module load throws ReferenceError
// before the test even gets a chance to run.
//
// We delegate the polyfill to `jsdom-global`, which copies every
// browser global from a fresh JSDOM window onto `globalThis`. The
// test files themselves do not exercise real browser behaviour
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

require('jsdom-global')();
