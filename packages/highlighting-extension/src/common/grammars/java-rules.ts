/**
 * Robust Java Monarch Grammar with String Error Recovery.
 * Fixes:
 *  - Unclosed string/char literals popping on newline instead of ruining following lines.
 *  - Support for Java 6 to modern Java features.
 * Pure data/logic — no DOM or Theia UI dependencies.
 */

import type { MonarchLanguage } from './jsp-rules';

export const JAVA_MONARCH_RULES: MonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.java',

  tokenizer: {
    root: [
      // Annotations
      [/@\s*[a-zA-Z_$][\w$.]*/, 'annotation'],

      // Method / Constructor call before '('
      [
        /[a-zA-Z_$][\w$]*(?=\s*\()/,
        {
          cases: {
            '@keywords': 'keyword',
            '@literals': 'constant.language',
            '@default': 'method',
          },
        },
      ],

      // Constants (UPPER_SNAKE)
      [/\b[A-Z][A-Z0-9_]{1,}\b/, 'constant'],

      // Types / Classes (Capitalized)
      [/\b[A-Z][\w$]*\b/, 'type'],

      // Keywords and Identifiers
      [
        /[a-zA-Z_$][\w$]*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@literals': 'constant.language',
            '@default': 'identifier',
          },
        },
      ],

      // Whitespace and comments
      { include: '@whitespace' },

      // Delimiters
      [/[{}()\[\]]/, '@brackets'],
      [/[<>](?!@symbols)/, '@brackets'],
      [
        /@symbols/,
        {
          cases: {
            '@operators': 'operator',
            '@default': '',
          },
        },
      ],

      // Numbers
      [/(@digits)[eE]([-+]?(@digits))?[fFdD]?/, 'number.float'],
      [/(@digits)\.(@digits)([eE][-+]?(@digits))?[fFdD]?/, 'number.float'],
      [/0[xX](@hexdigits)[Ll]?/, 'number.hex'],
      [/0[oO]?(@octaldigits)[Ll]?/, 'number.octal'],
      [/0[bB](@binarydigits)[Ll]?/, 'number.binary'],
      [/(@digits)[fFdD]/, 'number.float'],
      [/(@digits)[lL]?/, 'number'],

      // Strings / Chars
      [/"""/, { token: 'string', next: '@textblock' }],
      [/"/, { token: 'string.quote', next: '@string' }],
      [/'/, { token: 'string.quote', next: '@string_char' }],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\*\*(?!\/)/, { token: 'comment.doc', next: '@javadoc' }],
      [/\/\*/, { token: 'comment', next: '@comment' }],
      [/\/\/.*$/, 'comment'],
    ],

    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, { token: 'comment', next: '@pop' }],
      [/[/*]/, 'comment'],
    ],

    javadoc: [
      [/@\s*[a-zA-Z]+/, 'keyword.doc'],
      [/\{@[^}]+\}/, 'keyword.doc'],
      [/[^/*@{]+/, 'comment.doc'],
      [/\*\//, { token: 'comment.doc', next: '@pop' }],
      [/[/*@{]/, 'comment.doc'],
    ],

    // String with newline error recovery
    string: [
      [/[^\\"\r\n]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, { token: 'string.quote', next: '@pop' }],
      // Linebreak recovery: pop state so subsequent lines are not stained!
      [/\r?\n/, { token: 'string.invalid', next: '@pop' }],
    ],

    // Char with newline error recovery
    string_char: [
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/[^\\'\r\n]/, 'string'],
      [/'/, { token: 'string.quote', next: '@pop' }],
      [/\r?\n/, { token: 'string.invalid', next: '@pop' }],
    ],

    // Multi-line text block (Java 15+)
    textblock: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"""/, { token: 'string', next: '@pop' }],
      [/"/, 'string'],
    ],
  },
};

// Add tables to JAVA_MONARCH_RULES
Object.assign(JAVA_MONARCH_RULES, {
  keywords: [
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
    'char', 'class', 'const', 'continue', 'default', 'do', 'double',
    'else', 'enum', 'exports', 'extends', 'final', 'finally', 'float',
    'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int',
    'interface', 'long', 'module', 'native', 'new', 'non-sealed',
    'open', 'opens', 'package', 'permits', 'private', 'protected',
    'provides', 'public', 'record', 'requires', 'return', 'sealed',
    'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
    'this', 'throw', 'throws', 'to', 'transient', 'transitive', 'try',
    'uses', 'var', 'void', 'volatile', 'while', 'with', 'yield',
  ],
  literals: ['true', 'false', 'null'],
  operators: [
    '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
    '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
    '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=',
    '%=', '<<=', '>>=', '>>>=', '->', '::',
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  digits: /\d+(_+\d+)*/,
  octaldigits: /[0-7]+(_+[0-7]+)*/,
  binarydigits: /[0-1]+(_+[0-1]+)*/,
  hexdigits: /[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
});
