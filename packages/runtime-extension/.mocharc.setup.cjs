// Mocha setup file — registers DOM globals (window/document/navigator/etc.)
// via jsdom-global, so that the runtime-extension's browser-targeted
// source can be unit-tested under Node. Mirrors the spirit of mocha 9's
// `jsdom: 'jsdom-global'` config option, expressed as an explicit
// setup file so it is portable across mocha 9/10/11.
//
// We pin jsdom to 24.x in devDependencies because jsdom 25+ pulled in
// the ESM-only `@exodus/bytes` package via html-encoding-sniffer, and
// jsdom 25-28 still CJS-require that transitive dep — which fails on
// the Node 20 line. jsdom 24.x is the last CJS-clean version.
//
// See docs/hotfix-windows-test-readiness.md §8.

'use strict';

require('jsdom-global')();
