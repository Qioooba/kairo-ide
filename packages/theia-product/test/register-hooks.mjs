// Registers loader hooks for tests that import the full Kairo
// frontend composition (which transitively requires Theia/Monaco
// CSS files). Use as: node --import ./test/register-hooks.mjs --test ...
import { register } from 'node:module';
register('./css-stub-hook.mjs', import.meta.url);

// Install a CommonJS-level .css stub for tests that go through
// require() chains (e.g. kairo-java-debug-service.test.cjs). Without
// this, Node throws "SyntaxError: Unexpected token ':'" when it
// encounters `require('./hover-service.css')` inside Theia.
import { Module as _Module } from 'node:module';
const _orig = _Module._extensions['.css'];
_Module._extensions['.css'] = function (mod, filename) {
  mod._compile('module.exports = {};', filename);
};
