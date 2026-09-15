/**
 * Public exports of @kairo/highlighting-extension.
 */

export * from './common/highlight-protocol';
export * from './common/language-coverage';
export * from './common/jsp-region-scanner';
export * from './common/lexer-state';
export * from './common/token-cache';
export * from './common/grammars/jsp-rules';
export * from './common/grammars/java-rules';

export * from './worker/incremental-tokenizer';
export * from './worker/highlighting-scheduler';
export * from './worker/highlighting-worker';

export * from './browser/tokenizer-owner-registry';
export * from './browser/monaco-tokenization-adapter';
export * from './browser/highlighting-service';
export * from './browser/highlighting-diagnostics';
export * from './browser/highlighting-frontend-module';
