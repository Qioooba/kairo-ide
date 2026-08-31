import { register } from 'node:module';
register('./css-stub-hook.mjs', import.meta.url);

import { Module } from 'node:module';
Module._extensions['.css'] = function (mod) {
  mod._compile('module.exports = {};', mod.filename);
};
