// Public package entry: browser + common only. Node symbols live in
// './node/index' and must be imported from there to avoid pulling
// vscode-jsonrpc (node-only) into the browser bundle.
export * from './browser/index';
export * from './common/java-common';
export * from './common/lsp-protocol';
export type { JdtLsState } from './common/jdt-ls-state';
export { JdtLsBackendService, JdtLsFrontendClient, JdtLsBackendPath } from './common/java-ls-protocol';
export type { JdtLsBackendService as IJdtLsBackendService, JdtLsFrontendClient as IJdtLsFrontendClient } from './common/java-ls-protocol';
