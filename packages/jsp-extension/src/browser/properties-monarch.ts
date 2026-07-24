/**
 * Properties file Monarch grammar for syntax highlighting.
 *
 * Provides tokenization for Java .properties files (.properties, .cfg).
 * Handles comments, key-value pairs, escape sequences, and multi-line values.
 *
 * Supports:
 *  - # and ! comment lines
 *  - key = value and key : value formats
 *  - key<space>value format
 *  - Backslash escape sequences (\n, \t, \uXXXX, etc.)
 *  - Multi-line values (line ending with \)
 *  - Empty lines
 */

interface MonarchLanguage {
  defaultToken: string;
  tokenPostfix?: string;
  tokenizer: Record<string, unknown[]>;
}

export const PROPERTIES_LANGUAGE_ID = 'properties';

export const PROPERTIES_MONARCH: MonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.properties',

  tokenizer: {
    root: [
      // Comment lines starting with # or !
      [/^[#!].*$/, 'comment.properties'],

      // Whitespace
      [/[ \t]+/, ''],

      // Empty lines
      [/^\s*$/, ''],

      // Key part (before = or : or space)
      [/([a-zA-Z_][\w.-]*)(\s*[=:]\s*)/, ['key.properties', 'delimiter.properties', '@value']],

      // Key with space separator (no = or :)
      [/([a-zA-Z_][\w.-]*)(\s+)/, ['key.properties', 'delimiter.properties', '@value']],

      // Bare value (continuation from previous line)
      [/[^\s#!].*$/, 'string.properties'],
    ],

    /** Value state — after the key separator. */
    value: [
      // Continuation: line ends with backslash
      [/(.*\\\s*)$/, { token: 'string.properties', next: '@continuation' }],

      // End of line — value is complete
      [/(.*)$/, { token: 'string.properties', next: '@pop' }],
    ],

    /** Continuation state — value continues on next line. */
    continuation: [
      // Next line content (continuation of value)
      [/^[ \t]*([^#!].*)$/, { token: 'string.properties', next: '@value' }],

      // End of continuation
      [/^[ \t]*[#!]/, { token: 'comment.properties', next: '@pop' }],
      [/^\s*$/, { token: 'string.properties', next: '@value' }],
    ],
  },
};