/**
 * Monaco Tokenization Adapter for Kairo IDE.
 *
 * Plugs directly into Monaco's ITokenizationSupport and createBackgroundTokenizer
 * architecture on @theia/monaco-editor-core@1.108.201.
 */

import type * as monaco from '@theia/monaco-editor-core';
import { LexerState } from '../common/lexer-state';
import { IncrementalTokenizer } from '../worker/incremental-tokenizer';
import type { TokenBatchMessage } from '../common/highlight-protocol';

// Lazy-resolve internal Monaco token storage classes
let ContiguousMultilineTokensClass: any = undefined;
function getContiguousMultilineTokensClass(): any {
  if (ContiguousMultilineTokensClass === undefined) {
    if (typeof window === 'undefined') {
      return undefined;
    }
    try {
      const m = require('@theia/monaco-editor-core/esm/vs/editor/common/tokens/contiguousMultilineTokens.js');
      ContiguousMultilineTokensClass = m.ContiguousMultilineTokens;
    } catch {
      ContiguousMultilineTokensClass = null;
    }
  }
  return ContiguousMultilineTokensClass;
}

let TokenizationRegistryObj: any = undefined;
function getTokenizationRegistry(): any {
  if (TokenizationRegistryObj === undefined) {
    if (typeof window === 'undefined') {
      return undefined;
    }
    try {
      const m = require('@theia/monaco-editor-core/esm/vs/editor/common/languages.js');
      TokenizationRegistryObj = m.TokenizationRegistry;
    } catch {
      TokenizationRegistryObj = null;
    }
  }
  return TokenizationRegistryObj;
}

export function packMonacoMetadata(
  languageId: number,
  tokenType: number,
  fontStyle: number,
  foreground: number,
  background: number = 0,
): number {
  return (
    ((languageId & 0xff) << 0) |
    ((tokenType & 0x03) << 8) |
    ((fontStyle & 0x0f) << 11) |
    ((foreground & 0x1ff) << 15) |
    ((background & 0xff) << 24)
  ) >>> 0;
}

export function kindIdToMetadata(kindId: number, languageId: number = 1): number {
  let tokenType = 0; // Other
  let fontStyle = 0; // None
  let foreground = 1; // DefaultForeground

  switch (kindId) {
    case 1: // comment.block.jsp
      tokenType = 1; // Comment
      fontStyle = 1; // Italic
      foreground = 3;
      break;
    case 2: // delimiter.jsp
      tokenType = 0;
      foreground = 4;
      break;
    case 3: // tag.jsp-directive
      tokenType = 0;
      foreground = 5;
      break;
    case 4: // metatag.el
      tokenType = 0;
      foreground = 6;
      break;
    case 5: // identifier.el
      tokenType = 0;
      foreground = 7;
      break;
    case 6: // tag.html
      tokenType = 0;
      foreground = 8;
      break;
    case 7: // string.java
      tokenType = 2; // String
      foreground = 9;
      break;
    case 8: // string.invalid.java
      tokenType = 2; // String
      foreground = 10;
      break;
    case 9: // keyword.java
      tokenType = 0;
      fontStyle = 2; // Bold
      foreground = 11;
      break;
    case 10: // identifier.java
      tokenType = 0;
      foreground = 12;
      break;
    case 11: // operator.java
      tokenType = 0;
      foreground = 13;
      break;
    default:
      tokenType = 0;
      foreground = 1;
      break;
  }

  return packMonacoMetadata(languageId, tokenType, fontStyle, foreground, 0);
}

export function convertLexicalToProviderTokens(lexicalTokens: Uint32Array, languageId: number = 1): Uint32Array {
  const result = new Uint32Array(lexicalTokens.length);
  for (let i = 0; i < lexicalTokens.length; i += 2) {
    const startIndex = i === 0 ? 0 : lexicalTokens[i - 2];
    const kindId = lexicalTokens[i + 1];
    result[i] = startIndex;
    result[i + 1] = kindIdToMetadata(kindId, languageId);
  }
  return result;
}

export function convertLexicalToStoredTokens(lexicalTokens: Uint32Array, languageId: number = 1): Uint32Array {
  const result = new Uint32Array(lexicalTokens.length);
  for (let i = 0; i < lexicalTokens.length; i += 2) {
    const endOffset = lexicalTokens[i];
    const kindId = lexicalTokens[i + 1];
    result[i] = endOffset;
    result[i + 1] = kindIdToMetadata(kindId, languageId);
  }
  return result;
}

export interface IBackgroundTokenizationStore {
  setTokens(tokens: any[]): void;
  setFontInfo?(changes: any): void;
  setEndState(lineNumber: number, state: any): void;
  backgroundTokenizationFinished(): void;
}

export interface IBackgroundTokenizer extends monaco.IDisposable {
  requestTokens(startLineNumber: number, endLineNumberExclusive: number): void;
  reportMismatchingTokens?(lineNumber: number): void;
}

export interface ITokenizationSupport {
  getInitialState(): monaco.languages.IState;
  tokenize(line: string, hasEOL: boolean, state: monaco.languages.IState): monaco.languages.ILineTokens;
  tokenizeEncoded(line: string, hasEOL: boolean, state: monaco.languages.IState): monaco.languages.IEncodedLineTokens;
  createBackgroundTokenizer?(
    textModel: monaco.editor.ITextModel,
    store: IBackgroundTokenizationStore,
  ): IBackgroundTokenizer | undefined;
}

export interface AdapterModelSession {
  model: monaco.editor.ITextModel;
  store: IBackgroundTokenizationStore;
  tokenizer: IncrementalTokenizer;
  isDisposed: boolean;
}

export class MonacoTokenizationAdapter implements ITokenizationSupport {
  readonly languageId: string;
  readonly dialect: string;

  private sessions = new Map<string, AdapterModelSession>();
  private localTokenizer: IncrementalTokenizer;
  private onTokensRequested?: (modelUri: string, startLine: number, endLine: number) => void;

  constructor(
    languageId: string,
    dialect: string = languageId,
    onTokensRequested?: (modelUri: string, startLine: number, endLine: number) => void,
  ) {
    this.languageId = languageId;
    this.dialect = dialect;
    this.localTokenizer = new IncrementalTokenizer('local-sync', languageId, dialect);
    this.onTokensRequested = onTokensRequested;
  }

  getInitialState(): monaco.languages.IState {
    return new LexerState('root', undefined, [], this.dialect);
  }

  tokenize(line: string, _hasEOL: boolean, state: monaco.languages.IState): monaco.languages.ILineTokens {
    const lexState = state instanceof LexerState ? state : new LexerState('root', undefined, [], this.dialect);
    const { tokens, nextState } = this.localTokenizer.tokenizeSingleLine(line, lexState);

    // Convert packed uint32 tokens to IToken array for classic tokenize interface
    const resTokens: monaco.languages.IToken[] = [];
    for (let i = 0; i < tokens.length; i += 2) {
      const offset = i === 0 ? 0 : tokens[i - 2];
      const typeNum = tokens[i + 1];
      resTokens.push({
        startIndex: offset,
        scopes: this.typeNumToScope(typeNum),
      });
    }

    return {
      tokens: resTokens,
      endState: nextState,
    };
  }

  tokenizeEncoded(line: string, _hasEOL: boolean, state: monaco.languages.IState): monaco.languages.IEncodedLineTokens {
    const lexState = state instanceof LexerState ? state : new LexerState('root', undefined, [], this.dialect);
    const { tokens, nextState } = this.localTokenizer.tokenizeSingleLine(line, lexState);
    const providerTokens = convertLexicalToProviderTokens(tokens);
    return {
      tokens: providerTokens,
      endState: nextState,
    };
  }

  /**
   * Monaco's internal background tokenizer hook.
   * Called by Monaco's TokenizerSyntaxTokenBackend when a model is attached.
   */
  createBackgroundTokenizer(
    textModel: monaco.editor.ITextModel,
    store: IBackgroundTokenizationStore,
  ): IBackgroundTokenizer {
    const uri = textModel.uri.toString();
    const session: AdapterModelSession = {
      model: textModel,
      store,
      tokenizer: new IncrementalTokenizer(uri, this.languageId, this.dialect),
      isDisposed: false,
    };
    this.sessions.set(uri, session);

    return {
      requestTokens: (startLineNumber: number, endLineNumberExclusive: number) => {
        if (this.onTokensRequested && !session.isDisposed) {
          this.onTokensRequested(uri, startLineNumber, endLineNumberExclusive);
        }
      },
      dispose: () => {
        session.isDisposed = true;
        this.sessions.delete(uri);
      },
    };
  }

  /**
   * Apply token batches received from the Worker to Monaco's token store.
   */
  applyTokenBatch(uri: string, batch: TokenBatchMessage): void {
    const session = this.sessions.get(uri);
    if (!session || session.isDisposed) {
      return;
    }

    // Check documentVersion: drop batch if model version has moved past batch.documentVersion
    if (batch.documentVersion !== undefined && session.model && typeof session.model.getVersionId === 'function') {
      const currentVersion = session.model.getVersionId();
      if (batch.documentVersion !== currentVersion) {
        return;
      }
    }

    try {
      const MultilineClass = getContiguousMultilineTokensClass();
      if (MultilineClass && batch.lineTokens && batch.lineTokens.length > 0) {
        const storedLineTokens = batch.lineTokens.map(line =>
          convertLexicalToStoredTokens(line instanceof Uint32Array ? line : new Uint32Array(line))
        );
        const multilineTokens = new MultilineClass(
          batch.startLineNumber,
          storedLineTokens,
        );
        session.store.setTokens([multilineTokens]);
      }

      if (batch.endState) {
        session.store.setEndState(batch.endLineNumber, batch.endState);
      }

      if (batch.isCompleted) {
        session.store.backgroundTokenizationFinished();
      }
    } catch (e) {
      console.warn(`[kairo-highlighting] Failed to apply token batch for ${uri}:`, e);
    }
  }

  disposeSession(uri: string): void {
    const session = this.sessions.get(uri);
    if (session) {
      session.isDisposed = true;
      this.sessions.delete(uri);
    }
  }

  private typeNumToScope(typeNum: number): string {
    switch (typeNum) {
      case 1: return 'comment.block.jsp';
      case 2: return 'delimiter.jsp';
      case 3: return 'tag.jsp-directive';
      case 4: return 'metatag.el';
      case 5: return 'identifier.el';
      case 6: return 'tag.html';
      case 7: return 'string.java';
      case 8: return 'string.invalid.java';
      case 9: return 'keyword.java';
      case 10: return 'identifier.java';
      case 11: return 'operator.java';
      default: return '';
    }
  }
}

/**
 * Register the adapter into Monaco's TokenizationRegistry.
 */
export function registerMonacoTokenizationAdapter(
  languageId: string,
  adapter: MonacoTokenizationAdapter,
): monaco.IDisposable {
  const reg = getTokenizationRegistry();
  if (reg && typeof reg.register === 'function') {
    return reg.register(languageId, adapter);
  }
  if (typeof window !== 'undefined') {
    try {
      const monacoModule = require('@theia/monaco-editor-core');
      return monacoModule.languages.setTokensProvider(languageId, adapter as any);
    } catch {
      // Fallback
    }
  }
  return { dispose: () => {} };
}
