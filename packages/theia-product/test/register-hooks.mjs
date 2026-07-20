// Registers loader hooks for tests that import the full Kairo
// frontend composition (which transitively requires Theia/Monaco
// CSS files). Use as: node --import ./test/register-hooks.mjs --test ...
import { register } from 'node:module';
register('./css-stub-hook.mjs', import.meta.url);
