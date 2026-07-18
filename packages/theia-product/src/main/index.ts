/**
 * Kairo IDE — Theia product entry.
 *
 * This package composes the Kairo extensions and re-exports the
 * `KairoProduct` Theia ContainerModule. The actual launching
 * is done by `apps/browser` (browser) and `apps/desktop`
 * (Electron).
 *
 * We pin to Theia 1.51.x; see ADR-0001.
 */

export * from './product';
export * from './product-frontend';
// Theia `load(container, jsModule)` reads `jsModule.default` (the
// ContainerModule itself). `export *` does not re-export the
// default, so we re-export it explicitly.
export { default } from './product-frontend';
export { default as KairoProductBackend } from './product';
