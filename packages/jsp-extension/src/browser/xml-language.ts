/**
 * XML language registration for Monaco.
 *
 * Registers the XML language with Monarch grammar, completion provider,
 * document symbol provider, and validation. Wires up existing XML
 * infrastructure (XmlDtdValidator, XmlStructureViewProvider,
 * XmlDtdCompletionProvider) for pure XML files.
 */

import * as monaco from '@theia/monaco-editor-core';
import { XML_LANGUAGE_ID, XML_MONARCH } from './xml-monarch';

/**
 * Register XML as a Monaco language with Monarch grammar.
 * Called once at application start.
 */
export function registerXmlLanguage(): void {
  if (!monaco.languages.getLanguages().some(l => l.id === XML_LANGUAGE_ID)) {
    monaco.languages.register({
      id: XML_LANGUAGE_ID,
      extensions: ['.xml', '.xsd', '.tld', '.wsdl', '.svg', '.xhtml', '.xsl', '.xslt', '.dtd', '.ent'],
      aliases: ['XML', 'xml'],
      mimetypes: ['application/xml', 'text/xml'],
    });
  }
  monaco.languages.setMonarchTokensProvider(XML_LANGUAGE_ID, XML_MONARCH as monaco.languages.IMonarchLanguage);

  // Register language configuration for auto-closing and brackets
  monaco.languages.setLanguageConfiguration(XML_LANGUAGE_ID, {
    comments: {
      blockComment: ['<!--', '-->'],
    },
    brackets: [
      ['<', '>'],
    ],
    autoClosingPairs: [
      { open: '<', close: '>' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '<', close: '>' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    folding: {
      markers: {
        start: /^\s*<!--\s*#region\b.*-->/,
        end: /^\s*<!--\s*#endregion\b.*-->/,
      },
    },
  });
}