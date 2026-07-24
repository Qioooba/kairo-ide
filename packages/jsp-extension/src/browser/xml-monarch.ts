/**
 * XML Monarch grammar for syntax highlighting.
 *
 * Provides tokenization for pure XML files (.xml, .xsd, .tld, .wsdl, .svg).
 * Handles XML declarations, processing instructions, comments, CDATA
 * sections, DOCTYPE declarations, tags, attributes, and entities.
 */

interface MonarchLanguage {
  defaultToken: string;
  tokenPostfix?: string;
  tokenizer: Record<string, unknown[]>;
}

export const XML_LANGUAGE_ID = 'xml';

export const XML_MONARCH: MonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.xml',

  tokenizer: {
    root: [
      // XML declaration: <?xml ... ?>
      [/<\?xml/, { token: 'metatag.xml-decl', next: '@xmlDecl' }],

      // Processing instructions: <?target ... ?>
      [/<\?[a-zA-Z_][\w.-]*/, { token: 'metatag.xml-pi', next: '@pi' }],

      // CDATA sections
      [/<!\[CDATA\[/, { token: 'metatag.xml-cdata', next: '@cdata' }],

      // Comments
      [/<!--/, { token: 'comment.xml', next: '@comment' }],

      // DOCTYPE declaration
      [/<!DOCTYPE/, { token: 'metatag.xml-doctype', next: '@doctype' }],

      // Closing tags
      [/<\/\s*([a-zA-Z_][\w.:-]*)/, { token: 'tag.xml', next: '@closeTag' }],

      // Opening tags
      [/<\s*([a-zA-Z_][\w.:-]*)/, { token: 'tag.xml', next: '@openTag' }],

      // Entities
      [/&[a-zA-Z_][\w.-]*;/, 'string.escape.xml'],
      [/&#\d+;/, 'string.escape.xml'],
      [/&#x[0-9a-fA-F]+;/, 'string.escape.xml'],

      // Text content
      [/[^<&]+/, 'string.xml'],
    ],

    /** XML declaration state. */
    xmlDecl: [
      [/\?>/, { token: 'metatag.xml-decl', next: '@pop' }],
      [/[a-zA-Z_][\w.-]*\s*=/, 'attribute.name.xml'],
      [/"[^"]*"/, 'attribute.value.xml'],
      [/'[^']*'/, 'attribute.value.xml'],
      [/\s+/, ''],
    ],

    /** Processing instruction state. */
    pi: [
      [/\?>/, { token: 'metatag.xml-pi', next: '@pop' }],
      [/[^?]+/, 'metatag.xml-pi'],
    ],

    /** CDATA state. */
    cdata: [
      [/\]\]>/, { token: 'metatag.xml-cdata', next: '@pop' }],
      [/[^\]]+/, 'string.xml'],
      [/\]/, 'string.xml'],
    ],

    /** Comment state. */
    comment: [
      [/-->/, { token: 'comment.xml', next: '@pop' }],
      [/[^-]+/, 'comment.xml'],
      [/-/, 'comment.xml'],
    ],

    /** DOCTYPE state. */
    doctype: [
      [/>/, { token: 'metatag.xml-doctype', next: '@pop' }],
      [/"[^"]*"/, 'string.quote.xml'],
      [/'[^']*'/, 'string.quote.xml'],
      [/\[/, { token: 'delimiter.xml', next: '@doctypeInternal' }],
      [/[^>"'\[]+/, 'metatag.xml-doctype'],
    ],

    /** Internal DTD subset. */
    doctypeInternal: [
      [/\]/, { token: 'delimiter.xml', next: '@pop' }],
      [/<!ELEMENT/, { token: 'keyword.xml-dtd', next: '@dtdElement' }],
      [/<!ATTLIST/, { token: 'keyword.xml-dtd', next: '@dtdAttlist' }],
      [/<!ENTITY/, { token: 'keyword.xml-dtd' }],
      [/<!--/, { token: 'comment.xml', next: '@comment' }],
      [/[^<\]-]+/, ''],
      [/-/, ''],
    ],

    /** DTD ELEMENT declaration. */
    dtdElement: [
      [/>/, { token: 'keyword.xml-dtd', next: '@pop' }],
      [/[a-zA-Z_][\w.-]*/, 'type.xml'],
      [/\(/, 'delimiter.xml'],
      [/\)/, 'delimiter.xml'],
      [/,/, 'delimiter.xml'],
      [/\|/, 'delimiter.xml'],
      [/\*/, 'operator.xml'],
      [/\+/, 'operator.xml'],
      [/\?/, 'operator.xml'],
      [/#PCDATA/, 'keyword.xml-dtd'],
      [/\s+/, ''],
    ],

    /** DTD ATTLIST declaration. */
    dtdAttlist: [
      [/>/, { token: 'keyword.xml-dtd', next: '@pop' }],
      [/[a-zA-Z_][\w.-]*/, 'attribute.name.xml'],
      [/CDATA|ID|IDREF|IDREFS|NMTOKEN|NMTOKENS|ENTITY|ENTITIES/, 'type.xml'],
      [/#REQUIRED|#IMPLIED|#FIXED/, 'keyword.xml-dtd'],
      [/"[^"]*"/, 'string.quote.xml'],
      [/'[^']*'/, 'string.quote.xml'],
      [/\(/, 'delimiter.xml'],
      [/\)/, 'delimiter.xml'],
      [/\|/, 'delimiter.xml'],
      [/\s+/, ''],
    ],

    /** Opening tag state. */
    openTag: [
      [/\/?>/, { token: 'tag.xml', next: '@pop' }],
      [/[a-zA-Z_][\w.:-]*\s*=/, 'attribute.name.xml'],
      [/"[^"]*"/, 'attribute.value.xml'],
      [/'[^']*'/, 'attribute.value.xml'],
      [/\s+/, ''],
      [/[a-zA-Z_][\w.:-]*/, 'attribute.name.xml'],
    ],

    /** Closing tag state. */
    closeTag: [
      [/>/, { token: 'tag.xml', next: '@pop' }],
      [/\s+/, ''],
      [/[a-zA-Z_][\w.:-]*/, 'tag.xml'],
    ],
  },
};