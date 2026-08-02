/**
 * Java language registration for Monaco (language id + Monarch
 * grammar). Theia's monaco-editor-core ships NO basic-languages,
 * so .java files opened as Plain Text: no highlighting AND, far
 * worse, the java completion/definition providers never fired
 * (KAIRO-RC-WEB-251 — flow-02 screenshot showed "Plain Text" in
 * the status bar and word-based fallback completions).
 *
 * Heuristic scopes (no JDT LS required) beat IDEA's plain syntax
 * when the language server is down:
 *   - method calls before '(' → method (#FFC66D)
 *   - Capitalized names → type
 *   - UPPER_SNAKE → constant (fields/enums)
 *   - true/false/null → constant.language (keyword orange)
 */

export const JAVA_MONARCH: object = {
  defaultToken: '',
  tokenPostfix: '.java',

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

  tokenizer: {
    root: [
      // annotations (@Override, @org.foo.Bar)
      [/@\s*[a-zA-Z_$][\w$.]*/, 'annotation'],

      // Method / constructor call: Name(  — before keyword check so
      // `if (` stays a keyword via the non-lookahead path below.
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

      // UPPER_SNAKE constants / enum-like fields (SERIAL_VERSION, HTTP_OK)
      [/\b[A-Z][A-Z0-9_]{1,}\b/, 'constant'],

      // Capitalized type / class names (HttpServlet, String, List)
      [/\b[A-Z][\w$]*\b/, 'type'],

      // identifiers and keywords
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

      // whitespace
      { include: '@whitespace' },

      // delimiters
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

      // numbers
      [/(@digits)[eE]([-+]?(@digits))?[fFdD]?/, 'number.float'],
      [/(@digits)\.(@digits)([eE][-+]?(@digits))?[fFdD]?/, 'number.float'],
      [/0[xX](@hexdigits)[Ll]?/, 'number.hex'],
      [/0[oO]?(@octaldigits)[Ll]?/, 'number.octal'],
      [/0[bB](@binarydigits)[Ll]?/, 'number.binary'],
      [/(@digits)[fFdD]/, 'number.float'],
      [/(@digits)[lL]?/, 'number'],

      // strings / chars
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

    string: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, { token: 'string.quote', next: '@pop' }],
    ],

    string_char: [
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/[^\\']/, 'string'],
      [/'/, { token: 'string.quote', next: '@pop' }],
    ],

    textblock: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"""/, { token: 'string', next: '@pop' }],
      [/"/, 'string'],
    ],
  },
};
