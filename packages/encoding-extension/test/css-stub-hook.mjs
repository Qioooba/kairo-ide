// Loader hook: stub .css imports with an empty module.
// Needed because @theia/monaco-editor-core ships ESM that imports
// plain .css files; Node's ESM loader rejects the .css extension
// even when the CJS `Module._extensions['.css']` stub is installed.
// Used by kairo-composition.test.cjs via test/register-hooks.mjs.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  return nextLoad(url, context);
}
