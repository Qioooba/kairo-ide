// Public package entry: re-exports the browser module.
// Server-side imports can use this same path; backend-specific
// modules will be added under src/node/ as needed.
export * from './browser/index';
