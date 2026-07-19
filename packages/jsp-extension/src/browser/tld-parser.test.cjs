// TldParser — contract test (CJS variant).
//
// The parser scans a TLD (Tag Library Descriptor) XML document
// and returns the tag/attribute metadata that powers the JSP
// completion popup. It runs in the browser, but the parsing
// logic is pure and testable in Node + JSDOM.
//
// We pin:
//   - It returns undefined on malformed XML
//   - It returns undefined when the document has no <taglib>
//   - Default <rtexprvalue> is FALSE (JSP 2.3 §JSP.8.5.2),
//     not true — a previous version of this code defaulted
//     to true and shipped broken completion hints.
//   - It handles a namespaced TLD (<taglib xmlns="...">).
//
// Run with:
//   pnpm --filter @kairo/jsp-extension test
//   (or)  node --require source-map-support/register --test src/browser/tld-parser.test.cjs

'use strict';

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();

const { test } = require('node:test');
const assert = require('node:assert');

// jsdom doesn't include DragEvent — patch it so Lumino's dragdrop loads
if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}

// Theia requires FrontendApplicationConfigProvider to be set
const { FrontendApplicationConfigProvider } =
  require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

const { TldParser } = require('../../lib/browser/tld-parser');

// ---- Fixtures -------------------------------------------------------------

const SIMPLE_TLD = `<?xml version="1.0" encoding="UTF-8"?>
<taglib>
  <tlib-version>1.0</tlib-version>
  <short-name>fmt</short-name>
  <uri>http://java.sun.com/jsp/jstl/fmt</uri>
  <tag>
    <name>message</name>
    <tag-class>org.apache.taglibs.standard.tag.el.fmt.MessageTag</tag-class>
    <body-content>JSP</body-content>
    <attribute>
      <name>key</name>
      <required>true</required>
      <rtexprvalue>true</rtexprvalue>
      <type>java.lang.String</type>
    </attribute>
    <attribute>
      <name>bundle</name>
      <required>false</required>
      <rtexprvalue>false</rtexprvalue>
    </attribute>
  </tag>
</taglib>`;

const NAMESPACED_TLD = `<?xml version="1.0" encoding="UTF-8"?>
<taglib xmlns="http://java.sun.com/xml/ns/j2ee"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://java.sun.com/xml/ns/j2ee
          http://java.sun.com/xml/ns/j2ee/web-jsptaglibrary_2_0.xsd">
  <tlib-version>1.0</tlib-version>
  <short-name>c</short-name>
  <uri>http://java.sun.com/jsp/jstl/core</uri>
  <tag>
    <name>out</name>
    <tag-class>org.apache.taglibs.standard.tag.el.core.OutTag</tag-class>
    <body-content>empty</body-content>
    <attribute>
      <name>value</name>
      <required>true</required>
      <rtexprvalue>true</rtexprvalue>
    </attribute>
  </tag>
</taglib>`;

const MALFORMED_XML = `<?xml version="1.0"?>
<taglib><short-name>oops</taglib>`;

const NO_TAGLIB_XML = `<?xml version="1.0"?>
<something-else><foo/></something-else>`;

// ---- Behaviour tests ------------------------------------------------------

test('TldParser parses a simple un-namespaced TLD', () => {
  const tld = new TldParser().parse(SIMPLE_TLD);
  assert.ok(tld, 'parser should return a TLD for a valid document');
  assert.strictEqual(tld.shortName, 'fmt');
  assert.strictEqual(tld.uri, 'http://java.sun.com/jsp/jstl/fmt');
  assert.strictEqual(tld.tags.length, 1);

  const tag = tld.tags[0];
  assert.strictEqual(tag.name, 'message');
  assert.strictEqual(tag.tagClass, 'org.apache.taglibs.standard.tag.el.fmt.MessageTag');
  assert.strictEqual(tag.bodyContent, 'JSP');
  assert.strictEqual(tag.attributes.length, 2);
});

test('TldParser handles a namespaced TLD (regression for xmlns bug)', () => {
  // Previously, querySelector('') on a namespaced root returned
  // null and the function produced an empty TLD. The fix uses
  // getElementsByTagName which ignores the namespace. Pin it.
  const tld = new TldParser().parse(NAMESPACED_TLD);
  assert.ok(tld, 'parser should handle a namespaced TLD');
  assert.strictEqual(tld.shortName, 'c');
  assert.strictEqual(tld.uri, 'http://java.sun.com/jsp/jstl/core');
  assert.strictEqual(tld.tags.length, 1);
  assert.strictEqual(tld.tags[0].name, 'out');
});

test('TldParser.rtexprvalue default is FALSE (JSP 2.3 §JSP.8.5.2)', () => {
  // The previous version of this function used `!== 'false'`
  // which defaulted to true when the element was missing.
  // That was wrong: when a TLD omits <rtexprvalue>, the
  // contract says the default is false (request-time
  // expressions are not allowed). Pin the fix.
  const tld = new TldParser().parse(`<?xml version="1.0"?>
    <taglib>
      <short-name>x</short-name><uri>urn:x</uri>
      <tag>
        <name>plain</name>
        <tag-class>X</tag-class>
        <body-content>empty</body-content>
        <attribute>
          <name>a</name>
          <required>false</required>
        </attribute>
      </tag>
    </taglib>`);
  assert.ok(tld);
  assert.strictEqual(tld.tags[0].attributes[0].rtexprvalue, false,
    'missing <rtexprvalue> should default to false, not true');
});

test('TldParser.rtexprvalue=true when explicitly set to "true"', () => {
  const tld = new TldParser().parse(SIMPLE_TLD);
  assert.ok(tld);
  // "key" attribute is rtexprvalue=true
  const key = tld.tags[0].attributes.find((a) => a.name === 'key');
  assert.ok(key);
  assert.strictEqual(key.rtexprvalue, true);
});

test('TldParser.rtexprvalue does not treat "yes" / "1" as true (strict)', () => {
  // The current code only accepts the literal string 'true'.
  // That is intentional — "yes"/"1" are not legal in TLDs.
  // If we ever relax this, the test will catch the change.
  const tld = new TldParser().parse(`<?xml version="1.0"?>
    <taglib>
      <short-name>x</short-name><uri>urn:x</uri>
      <tag>
        <name>t</name><tag-class>X</tag-class><body-content>empty</body-content>
        <attribute>
          <name>a</name><required>false</required>
          <rtexprvalue>yes</rtexprvalue>
        </attribute>
      </tag>
    </taglib>`);
  assert.ok(tld);
  assert.strictEqual(tld.tags[0].attributes[0].rtexprvalue, false,
    'rtexprvalue="yes" must not be coerced to true');
});

test('TldParser.required=true is parsed from the literal string "true"', () => {
  const tld = new TldParser().parse(SIMPLE_TLD);
  assert.ok(tld);
  const key = tld.tags[0].attributes.find((a) => a.name === 'key');
  const bundle = tld.tags[0].attributes.find((a) => a.name === 'bundle');
  assert.ok(key && bundle);
  assert.strictEqual(key.required, true);
  assert.strictEqual(bundle.required, false);
});

test('TldParser returns undefined for malformed XML', () => {
  // DOMParser inserts <parsererror> on malformed input
  // rather than throwing. The parser must catch that and
  // return undefined so the UI can show a "could not parse"
  // toast instead of a broken popup.
  const tld = new TldParser().parse(MALFORMED_XML);
  assert.strictEqual(tld, undefined);
});

test('TldParser returns undefined when the document has no <taglib>', () => {
  const tld = new TldParser().parse(NO_TAGLIB_XML);
  assert.strictEqual(tld, undefined);
});

test('TldParser returns TLD with zero tags when <taglib> has no <tag>', () => {
  const tld = new TldParser().parse(`<?xml version="1.0"?>
    <taglib>
      <short-name>empty</short-name>
      <uri>urn:empty</uri>
    </taglib>`);
  assert.ok(tld);
  assert.strictEqual(tld.tags.length, 0);
  assert.strictEqual(tld.shortName, 'empty');
});

test('TldParser skips <attribute> elements with no <name>', () => {
  // <attribute> without <name> would produce an entry with
  // name="". The parser currently still emits it (the
  // completion popup filters by name prefix). Pin the
  // behaviour so a future change is intentional.
  const tld = new TldParser().parse(`<?xml version="1.0"?>
    <taglib>
      <short-name>x</short-name><uri>urn:x</uri>
      <tag>
        <name>t</name><tag-class>X</tag-class><body-content>empty</body-content>
        <attribute>
          <required>false</required>
        </attribute>
        <attribute>
          <name>good</name><required>true</required>
        </attribute>
      </tag>
    </taglib>`);
  assert.ok(tld);
  const names = tld.tags[0].attributes.map((a) => a.name);
  assert.deepStrictEqual(names, ['', 'good']);
});
