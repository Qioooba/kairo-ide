/**
 * JSON Monarch grammar for syntax highlighting.
 *
 * Provides tokenization for JSON and JSONC (JSON with comments) files.
 * Handles strings, numbers, booleans, null, objects, arrays, and comments.
 */

interface MonarchLanguage {
  defaultToken: string;
  tokenPostfix?: string;
  tokenizer: Record<string, unknown[]>;
}

export const JSON_LANGUAGE_ID = 'json';

export const JSON_MONARCH: MonarchLanguage = {
  defaultToken: 'invalid',
  tokenPostfix: '.json',

  tokenizer: {
    root: [
      // Whitespace
      [/[ \t\r\n]+/, ''],

      // Comments (JSONC)
      [/\/\*/, { token: 'comment.json', next: '@blockComment' }],
      [/\/\/.*$/, 'comment.json'],

      // Strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'],  // non-terminated string
      [/"/, { token: 'string.json', next: '@string' }],

      // Numbers
      [/-?(0|[1-9]\d*)(\.\d+)?([eE][+\-]?\d+)?\b/, 'number.json'],

      // Keywords
      [/\btrue\b/, 'keyword.json'],
      [/\bfalse\b/, 'keyword.json'],
      [/\bnull\b/, 'keyword.json'],

      // Delimiters
      [/[{]/, 'delimiter.bracket.json'],
      [/[}]/, 'delimiter.bracket.json'],
      [/[[]/, 'delimiter.bracket.json'],
      [/[\]]/, 'delimiter.bracket.json'],
      [/[,]/, 'delimiter.comma.json'],
      [/[:]/, 'delimiter.colon.json'],
    ],

    /** String state with escape handling. */
    string: [
      [/[^\\"]+/, 'string.json'],
      [/\\./, 'string.escape.json'],
      [/"/, { token: 'string.json', next: '@pop' }],
    ],

    /** Block comment state. */
    blockComment: [
      [/[^*]+/, 'comment.json'],
      [/\*\//, { token: 'comment.json', next: '@pop' }],
      [/\*/, 'comment.json'],
    ],
  },
};

export const JSONC_LANGUAGE_ID = 'jsonc';

export const JSONC_MONARCH: MonarchLanguage = {
  ...JSON_MONARCH,
  tokenPostfix: '.jsonc',
};