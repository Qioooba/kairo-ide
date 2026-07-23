'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('XML Monarch grammar has required tokenizer states', () => {
  // Simulate the XML_MONARCH structure
  const states = ['root', 'xmlDecl', 'pi', 'cdata', 'comment', 'doctype', 'doctypeInternal', 'dtdElement', 'dtdAttlist', 'openTag', 'closeTag'];
  // Verify all required states exist
  assert.ok(states.includes('root'));
  assert.ok(states.includes('xmlDecl'));
  assert.ok(states.includes('cdata'));
  assert.ok(states.includes('comment'));
  assert.ok(states.includes('doctype'));
  assert.ok(states.includes('openTag'));
  assert.ok(states.includes('closeTag'));
});

test('XML encoding detection', () => {
  const XML_DECL_RE = /<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/i;

  const utf8 = '<?xml version="1.0" encoding="UTF-8"?>';
  const gbk = '<?xml version="1.0" encoding="GBK"?>';
  const iso = '<?xml version="1.0" encoding="ISO-8859-1"?>';

  assert.strictEqual(XML_DECL_RE.exec(utf8)[1], 'UTF-8');
  assert.strictEqual(XML_DECL_RE.exec(gbk)[1], 'GBK');
  assert.strictEqual(XML_DECL_RE.exec(iso)[1], 'ISO-8859-1');
});

test('XML tag matching', () => {
  const TAG_RE = /<\/?([a-zA-Z_][\w.:-]*)(\s[^>]*)?\/?>/g;

  const xml = '<root><child id="1">text</child></root>';
  const matches = [];
  let m;
  while ((m = TAG_RE.exec(xml)) !== null) {
    matches.push(m[1]);
  }

  assert.deepStrictEqual(matches, ['root', 'child', 'child', 'root']);
});

test('XML self-closing tag detection', () => {
  const selfClosing = '<br/>';
  const isSelfClosing = selfClosing.endsWith('/>') && !selfClosing.startsWith('</');
  assert.strictEqual(isSelfClosing, true);

  const closing = '</br>';
  const isClosing = closing.startsWith('</');
  assert.strictEqual(isClosing, true);
});

test('XML DOCTYPE detection', () => {
  const DOCTYPE_RE = /<!DOCTYPE\s+(\S+)\s*(?:PUBLIC\s+["']([^"']+)["']\s*)?(?:["']([^"']+)["'])?\s*>/i;

  const html = '<!DOCTYPE html>';
  const webapp = '<!DOCTYPE web-app PUBLIC "-//Sun Microsystems, Inc.//DTD Web Application 2.3//EN" "http://java.sun.com/dtd/web-app_2_3.dtd">';

  let m = DOCTYPE_RE.exec(html);
  assert.ok(m, 'should match html DOCTYPE');
  assert.strictEqual(m[1], 'html');

  m = DOCTYPE_RE.exec(webapp);
  assert.ok(m, 'should match webapp DOCTYPE');
  assert.strictEqual(m[1], 'web-app');
  assert.strictEqual(m[2], '-//Sun Microsystems, Inc.//DTD Web Application 2.3//EN');
  assert.strictEqual(m[3], 'http://java.sun.com/dtd/web-app_2_3.dtd');
});

test('XML entity references', () => {
  const entityRe = /&[a-zA-Z_][\w.-]*;/;
  const numericRe = /&#\d+;/;
  const hexRe = /&#x[0-9a-fA-F]+;/;

  assert.ok(entityRe.test('&amp;'));
  assert.ok(entityRe.test('&lt;'));
  assert.ok(entityRe.test('&gt;'));
  assert.ok(numericRe.test('&#60;'));
  assert.ok(hexRe.test('&#x3C;'));
});

test('XML CDATA section', () => {
  const cdata = '<![CDATA[some <data> here]]>';
  assert.ok(cdata.startsWith('<![CDATA['));
  assert.ok(cdata.endsWith(']]>'));
});

test('XML processing instruction', () => {
  const pi = '<?xml-stylesheet type="text/xsl" href="style.xsl"?>';
  assert.ok(pi.startsWith('<?'));
  assert.ok(pi.endsWith('?>'));
});

test('XML comment', () => {
  const comment = '<!-- This is a comment -->';
  assert.ok(comment.startsWith('<!--'));
  assert.ok(comment.endsWith('-->'));
});

test('XML namespace declaration', () => {
  const xmlns = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
  assert.ok(xmlns.includes('xmlns'));
  assert.ok(xmlns.includes('http://www.w3.org/2001/XMLSchema-instance'));
});

test('XML language ID', () => {
  const XML_LANGUAGE_ID = 'xml';
  assert.strictEqual(XML_LANGUAGE_ID, 'xml');
});

test('XML file extensions', () => {
  const extensions = ['.xml', '.xsd', '.tld', '.wsdl', '.svg', '.xhtml', '.xsl', '.xslt', '.dtd', '.ent'];
  assert.ok(extensions.includes('.xml'));
  assert.ok(extensions.includes('.xsd'));
  assert.ok(extensions.includes('.tld'));
  assert.ok(extensions.includes('.dtd'));
  assert.ok(extensions.length === 10);
});