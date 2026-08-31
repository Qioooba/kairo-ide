/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';

import esbuild from 'esbuild';

// Override: disable ALL minification to prevent InversifyJS DI binding
// failures. minifyIdentifiers renames service identifiers (e.g. WorkspaceService
// -> w4), causing "No matching bindings found" errors at runtime because
// some ContainerModules may use the original name while others use the
// minified name. minifySyntax/minifyWhitespace break multiline template
// literals. The bundle size increase is acceptable for a desktop app.
const { minify: _minify, ...browserBase } = browserOptions;
const browserOpts = {
  ...browserBase,
  minifyWhitespace: false,
  minifySyntax: false,
  minifyIdentifiers: false,
  plugins: browserBase.plugins.map(plugin =>
    plugin && plugin.name === 'node-modules-polyfill'
      ? nodeModulesPolyfillPlugin({ globals: { Buffer: true, process: false } })
      : plugin
  ),
  banner: {
    // Keep the compatibility binding lexical. A top-level `var process` becomes
    // `window.process` in a browser and weakens Electron's renderer boundary by
    // making a process-looking object visible to arbitrary web content.
    js: 'const process = globalThis.process || { env: {}, platform: "browser", cwd: function() { return ""; }, version: "", argv: [], pid: 0, stdout: null, stderr: null, stdin: null, exit: function() {} };'
  }
};

const nodeOpts = {
  ...nodeOptions,
  external: [...(nodeOptions.external || []), '@vscode/proxy-agent', '@vscode/windows-ca-certs'],
};

const browserContext = await esbuild.context(browserOpts);
const nodeContext = await esbuild.context(nodeOpts);

if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
    } catch {
        process.exit(1);
    }
}
