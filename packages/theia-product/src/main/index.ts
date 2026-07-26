/**
 * Kairo IDE — Theia product entry.
 *
 * This package composes the Kairo extensions and re-exports the
 * `KairoProductFrontend` Theia ContainerModule. The actual launching
 * is done by `apps/browser` (browser) and `apps/desktop` (Electron).
 *
 * IMPORTANT: This entry point is consumed by the Theia BROWSER bundle.
 * It MUST NOT transitively import the Node-only backend module
 * (`./node/kairo-product-backend-module`), because doing so pulls in
 * `child_process`, `fs`, `net`, and other Node built-ins that esbuild
 * cannot resolve when bundling for the browser.
 *
 * The backend module is reachable separately via the
 * `theiaExtensions[].backend` field in `package.json`
 * (`lib/node/kairo-product-backend-module`).
 *
 * Theia `load(container, jsModule)` reads `jsModule.default`, so
 * `KairoProductFrontend` is re-exported as the default export.
 */

export * from './product-frontend';
export { default } from './product-frontend';
export { default as KairoProductFrontend } from './product-frontend';
