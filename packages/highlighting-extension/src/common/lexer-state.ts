/**
 * Lexer state implementation for Monaco and incremental tokenization.
 * Implements Monaco's IState contract with strict deep-equality for safe suffix reuse.
 * Pure logic — no DOM or Theia UI dependencies.
 */

export interface ILexerState {
  clone(): ILexerState;
  equals(other: unknown): boolean;
}

export class LexerState implements ILexerState {
  readonly mode: string;
  readonly embeddedLanguage?: string;
  readonly embeddedStack: string[];
  readonly dialect?: string;
  readonly quote?: string;
  readonly depth: number;

  constructor(
    mode: string = 'root',
    embeddedLanguage?: string,
    embeddedStack: string[] = [],
    dialect?: string,
    quote?: string,
    depth: number = 0,
  ) {
    this.mode = mode;
    this.embeddedLanguage = embeddedLanguage;
    this.embeddedStack = embeddedStack;
    this.dialect = dialect;
    this.quote = quote;
    this.depth = depth;
  }

  static from(state: unknown, defaultDialect?: string): LexerState {
    if (state instanceof LexerState) {
      return state;
    }
    if (state && typeof state === 'object') {
      const s = state as any;
      return new LexerState(
        typeof s.mode === 'string' ? s.mode : 'root',
        typeof s.embeddedLanguage === 'string' ? s.embeddedLanguage : undefined,
        Array.isArray(s.embeddedStack) ? [...s.embeddedStack] : [],
        typeof s.dialect === 'string' ? s.dialect : defaultDialect,
        typeof s.quote === 'string' ? s.quote : undefined,
        typeof s.depth === 'number' ? s.depth : 0,
      );
    }
    return new LexerState('root', undefined, [], defaultDialect);
  }

  clone(): LexerState {
    return new LexerState(
      this.mode,
      this.embeddedLanguage,
      [...this.embeddedStack],
      this.dialect,
      this.quote,
      this.depth,
    );
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!other || typeof other !== 'object') return false;

    const o = other as any;
    if (this.mode !== o.mode) return false;
    if (this.embeddedLanguage !== o.embeddedLanguage) return false;
    if (this.dialect !== o.dialect) return false;
    if (this.quote !== o.quote) return false;
    if (this.depth !== o.depth) return false;

    const s1 = this.embeddedStack;
    const s2 = o.embeddedStack;
    if (s1 === s2) return true;
    if (!s1 || !s2 || s1.length !== s2.length) return false;
    for (let i = 0; i < s1.length; i++) {
      if (s1[i] !== s2[i]) return false;
    }

    return true;
  }
}
