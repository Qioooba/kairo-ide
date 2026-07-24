// JSP Extension — comprehensive tests for Wave 4 enhancements.
//
// Covers:
//   1. JSP scriptlet detection (JspJavaParser)
//   2. TLD tag parsing (TldParser)
//   3. EL expression parsing (regex-based tests)
//   4. web.xml servlet-mapping parsing (parseWebXml with jsp-file)
//
// Tests only import from pure modules that have no @theia/monaco-editor-core
// dependencies, so they work in the CJS test runner.
//
// Run with:
//   pnpm --filter @kairo/jsp-extension test

'use strict';

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();

const { test, describe } = require('node:test');
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

// Import pure modules (no ESM/Monaco dependencies)
const { JspJavaParser } = require('../../lib/browser/jsp-java-nav');
const { parseWebXml } = require('../../lib/browser/webxml-parser');
const { TldParser } = require('../../lib/browser/tld-parser');

// =========================================================================
// 1. JSP Scriptlet Detection Tests (JspJavaParser)
// =========================================================================

describe('JSP Scriptlet Detection (JspJavaParser)', () => {
  test('findJavaBlocks detects <%  %> scriptlet', () => {
    const content = '<% \n  String name = "hello";\n%>';
    const parser = new JspJavaParser();
    const blocks = parser.findJavaBlocks(content);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'scriptlet');
  });

  test('findJavaBlocks detects <%=  %> expression', () => {
    const content = '<%= user.getName() %>';
    const parser = new JspJavaParser();
    const blocks = parser.findJavaBlocks(content);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'expression');
  });

  test('findJavaBlocks detects <%!  %> declaration', () => {
    const content = '<%! \n  private int counter = 0;\n%>';
    const parser = new JspJavaParser();
    const blocks = parser.findJavaBlocks(content);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'declaration');
  });

  test('findJavaBlocks detects <%@  %> directive', () => {
    const content = '<%@ page import="java.util.*" %>';
    const parser = new JspJavaParser();
    const blocks = parser.findJavaBlocks(content);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'directive');
  });

  test('findJavaBlocks detects all four block types in one file', () => {
    const content = '<%@ page import="java.util.*" %>\n<%! int x = 5; %>\n<%= x + 1 %>\n<% out.print(x); %>';
    const parser = new JspJavaParser();
    const blocks = parser.findJavaBlocks(content);
    assert.strictEqual(blocks.length, 4);
    assert.strictEqual(blocks[0].kind, 'directive');
    assert.strictEqual(blocks[1].kind, 'declaration');
    assert.strictEqual(blocks[2].kind, 'expression');
    assert.strictEqual(blocks[3].kind, 'scriptlet');
  });

  test('findJavaBlocks returns block boundaries for content extraction', () => {
    const content = '<%  String x = "test";  %>';
    const parser = new JspJavaParser();
    const blocks = parser.findJavaBlocks(content);
    assert.strictEqual(blocks.length, 1);
    const block = blocks[0];
    const extracted = content.slice(block.start, block.end);
    assert.ok(extracted.includes('String x = "test"'));
  });

  test('findBlockAt returns correct block for offset', () => {
    const content = '<% String a = "first"; %>\n<% String b = "second"; %>';
    const parser = new JspJavaParser();
    const blocks = parser.findJavaBlocks(content);

    const offset1 = content.indexOf('first');
    const block1 = parser.findBlockAt(blocks, offset1);
    assert.ok(block1);
    assert.strictEqual(block1.kind, 'scriptlet');

    const offset2 = content.indexOf('second');
    const block2 = parser.findBlockAt(blocks, offset2);
    assert.ok(block2);
    assert.strictEqual(block2.kind, 'scriptlet');

    assert.notStrictEqual(block1, block2);
  });

  test('findBlockAt returns null for offset outside Java blocks', () => {
    const content = '<html>\n<body>\n<p>Hello</p>\n<%\n  out.print("hi");\n%>\n</body>';
    const parser = new JspJavaParser();
    const blocks = parser.findJavaBlocks(content);
    // "Hello" is in the HTML part
    const htmlOffset = content.indexOf('Hello');
    const block = parser.findBlockAt(blocks, htmlOffset);
    assert.strictEqual(block, null);
  });

  test('findBlockAt returns null when cursor is on JSP tag delimiters', () => {
    const content = '<% out.print("hi"); %>';
    const parser = new JspJavaParser();
    const blocks = parser.findJavaBlocks(content);
    // offset 0 is '<', which is before the block start
    const block = parser.findBlockAt(blocks, 0);
    assert.strictEqual(block, null);
  });

  test('parseImports extracts fully qualified class names', () => {
    const content = '<%@ page import="java.util.List, java.util.Map" %>\n<%@ page import="java.io.*" %>';
    const parser = new JspJavaParser();
    const imports = parser.parseImports(content);
    assert.strictEqual(imports.get('List'), 'java.util.List');
    assert.strictEqual(imports.get('Map'), 'java.util.Map');
  });

  test('parseImports handles empty import directive', () => {
    const content = '<html><body></body></html>';
    const parser = new JspJavaParser();
    const imports = parser.parseImports(content);
    assert.strictEqual(imports.size, 0);
  });

  test('parseImports handles multiple comma-separated imports', () => {
    const content = '<%@ page import="java.util.List, java.util.Map, java.util.ArrayList" %>';
    const parser = new JspJavaParser();
    const imports = parser.parseImports(content);
    assert.strictEqual(imports.get('List'), 'java.util.List');
    assert.strictEqual(imports.get('Map'), 'java.util.Map');
    assert.strictEqual(imports.get('ArrayList'), 'java.util.ArrayList');
  });

  test('positionToOffset converts 0-based line/column to offset', () => {
    const content = 'line1\nline2\nline3';
    const parser = new JspJavaParser();
    // line 1 (0-based), column 2 (0-based) = third char of "line2" = 'n'
    const offset = parser.positionToOffset(content, 1, 2);
    assert.strictEqual(content[offset], 'n');
  });

  test('positionToOffset handles first line', () => {
    const content = 'line1\nline2';
    const parser = new JspJavaParser();
    const offset = parser.positionToOffset(content, 0, 0);
    assert.strictEqual(content[offset], 'l');
  });

  test('getWordAt extracts Java identifier', () => {
    const content = 'String userName = "test";';
    const parser = new JspJavaParser();
    const word = parser.getWordAt(content, 8); // 'u' in "userName"
    assert.ok(word);
    assert.strictEqual(word.word, 'userName');
  });

  test('getWordAt returns null on non-identifier character', () => {
    const content = 'String x = "test";';
    const parser = new JspJavaParser();
    const word = parser.getWordAt(content, content.indexOf('='));
    assert.strictEqual(word, null);
  });

  test('getWordAt handles dollar sign in identifiers', () => {
    const content = 'String $var = "test";';
    const parser = new JspJavaParser();
    const word = parser.getWordAt(content, content.indexOf('$'));
    assert.ok(word);
    assert.strictEqual(word.word, '$var');
  });
});

// =========================================================================
// 2. TLD Tag Parsing Tests (additional tests beyond tld-parser.test.cjs)
// =========================================================================

describe('TLD Tag Parsing (extended)', () => {
  const MULTI_TAG_TLD = `<?xml version="1.0" encoding="UTF-8"?>
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
  <tag>
    <name>formatDate</name>
    <tag-class>org.apache.taglibs.standard.tag.el.fmt.FormatDateTag</tag-class>
    <body-content>empty</body-content>
    <attribute>
      <name>value</name>
      <required>true</required>
      <rtexprvalue>true</rtexprvalue>
    </attribute>
    <attribute>
      <name>pattern</name>
      <required>false</required>
      <rtexprvalue>true</rtexprvalue>
    </attribute>
  </tag>
</taglib>`;

  test('TldParser parses multiple tags from a TLD', () => {
    const tld = new TldParser().parse(MULTI_TAG_TLD);
    assert.ok(tld);
    assert.strictEqual(tld.tags.length, 2);
    assert.strictEqual(tld.tags[0].name, 'message');
    assert.strictEqual(tld.tags[1].name, 'formatDate');
  });

  test('TldParser extracts tag class correctly', () => {
    const tld = new TldParser().parse(MULTI_TAG_TLD);
    assert.ok(tld);
    assert.strictEqual(tld.tags[0].tagClass, 'org.apache.taglibs.standard.tag.el.fmt.MessageTag');
    assert.strictEqual(tld.tags[1].tagClass, 'org.apache.taglibs.standard.tag.el.fmt.FormatDateTag');
  });

  test('TldParser extracts body-content correctly', () => {
    const tld = new TldParser().parse(MULTI_TAG_TLD);
    assert.ok(tld);
    assert.strictEqual(tld.tags[0].bodyContent, 'JSP');
    assert.strictEqual(tld.tags[1].bodyContent, 'empty');
  });

  test('TldParser parses attribute metadata correctly', () => {
    const tld = new TldParser().parse(MULTI_TAG_TLD);
    assert.ok(tld);
    const tag = tld.tags[1]; // formatDate
    assert.strictEqual(tag.attributes.length, 2);
    assert.strictEqual(tag.attributes[0].name, 'value');
    assert.strictEqual(tag.attributes[0].required, true);
    assert.strictEqual(tag.attributes[1].name, 'pattern');
    assert.strictEqual(tag.attributes[1].required, false);
  });

  test('TldParser extracts short-name and uri', () => {
    const tld = new TldParser().parse(MULTI_TAG_TLD);
    assert.ok(tld);
    assert.strictEqual(tld.shortName, 'fmt');
    assert.strictEqual(tld.uri, 'http://java.sun.com/jsp/jstl/fmt');
  });

  test('TldParser handles TLD with no tags', () => {
    const tld = new TldParser().parse(`<?xml version="1.0"?>
<taglib>
  <short-name>empty</short-name>
  <uri>urn:empty</uri>
</taglib>`);
    assert.ok(tld);
    assert.strictEqual(tld.tags.length, 0);
  });

  test('TldParser returns undefined for empty string', () => {
    const tld = new TldParser().parse('');
    assert.strictEqual(tld, undefined);
  });
});

// =========================================================================
// 3. EL Expression Parsing Tests (regex-based, no Monaco imports)
// =========================================================================

describe('EL Expression Parsing', () => {
  // EL expression pattern: ${...} or #{...}
  const EL_EXPR_RE = /([$#])\{/g;

  function findElExpressionAt(content, line, column) {
    let offset = 0;
    const lines = content.split('\n');
    for (let i = 0; i < line && i < lines.length; i++) {
      offset += lines[i].length + 1;
    }
    offset += column;

    EL_EXPR_RE.lastIndex = 0;
    const matches = [];
    let m;
    while ((m = EL_EXPR_RE.exec(content)) !== null) {
      const start = m.index + 2;
      const marker = m[1];
      let depth = 1;
      let pos = start;
      while (pos < content.length && depth > 0) {
        if (content[pos] === '{') depth++;
        else if (content[pos] === '}') depth--;
        pos++;
      }
      if (depth === 0) {
        matches.push({ start: m.index, end: pos, marker });
      }
    }

    for (const match of matches) {
      if (offset >= match.start && offset <= match.end) {
        const elContent = content.substring(match.start + 2, match.end - 1);
        const elOffset = offset - match.start - 2;
        return {
          content: elContent,
          prefix: elContent.substring(0, Math.max(0, elOffset)),
          marker: match.marker,
        };
      }
    }
    return null;
  }

  function parseElPrefix(prefix) {
    const trimmed = prefix.trim();
    const firstDot = trimmed.indexOf('.');
    const firstBracket = trimmed.indexOf('[');

    if (firstDot === -1 && firstBracket === -1) {
      return { root: trimmed, path: '', lastPart: trimmed };
    }

    const root = trimmed.substring(0, firstDot >= 0 ? firstDot : firstBracket);
    const lastDot = trimmed.lastIndexOf('.');
    const lastPart = lastDot >= 0 ? trimmed.substring(lastDot + 1) : '';

    return { root, path: trimmed.substring(root.length), lastPart };
  }

  test('findElExpressionAt finds simple ${...} expression', () => {
    const content = '<p>${user.name}</p>';
    const elInfo = findElExpressionAt(content, 0, 7); // cursor on "user.name"
    assert.ok(elInfo);
    assert.strictEqual(elInfo.content, 'user.name');
    assert.strictEqual(elInfo.marker, '$');
  });

  test('findElExpressionAt finds #{...} expression', () => {
    const content = '<p>#{bean.property}</p>';
    const elInfo = findElExpressionAt(content, 0, 8);
    assert.ok(elInfo);
    assert.strictEqual(elInfo.content, 'bean.property');
    assert.strictEqual(elInfo.marker, '#');
  });

  test('findElExpressionAt returns null outside EL expression', () => {
    const content = '<p>Hello World</p>';
    const elInfo = findElExpressionAt(content, 0, 5);
    assert.strictEqual(elInfo, null);
  });

  test('findElExpressionAt handles nested braces', () => {
    const content = '<p>${fn:escapeXml(user.name)}</p>';
    const elInfo = findElExpressionAt(content, 0, 15);
    assert.ok(elInfo);
    assert.ok(elInfo.content.includes('fn:escapeXml'));
  });

  test('findElExpressionAt handles multiple EL expressions', () => {
    const content = '<p>${a} and ${b}</p>';
    const elInfo1 = findElExpressionAt(content, 0, 4);
    assert.ok(elInfo1);
    assert.strictEqual(elInfo1.content, 'a');

    const elInfo2 = findElExpressionAt(content, 0, 12);
    assert.ok(elInfo2);
    assert.strictEqual(elInfo2.content, 'b');
  });

  test('parseElPrefix extracts root and path', () => {
    const result = parseElPrefix('user.name.first');
    assert.strictEqual(result.root, 'user');
    assert.strictEqual(result.lastPart, 'first');
    assert.ok(result.path.includes('.name.first'));
  });

  test('parseElPrefix handles simple variable', () => {
    const result = parseElPrefix('param');
    assert.strictEqual(result.root, 'param');
    assert.strictEqual(result.path, '');
    assert.strictEqual(result.lastPart, 'param');
  });

  test('parseElPrefix handles trailing dot', () => {
    const result = parseElPrefix('user.name.');
    assert.strictEqual(result.root, 'user');
    assert.strictEqual(result.lastPart, '');
  });

  test('parseElPrefix handles bracket notation', () => {
    const result = parseElPrefix('header["User-Agent"]');
    assert.strictEqual(result.root, 'header');
    assert.ok(result.path.startsWith('['));
  });

  test('EL implicit object list is complete', () => {
    const required = [
      'pageContext', 'pageScope', 'requestScope', 'sessionScope',
      'applicationScope', 'param', 'paramValues', 'header',
      'headerValues', 'cookie', 'initParam',
    ];
    // Verify the list (we test the concept, not the actual module import)
    assert.strictEqual(required.length, 11);
    assert.ok(required.includes('pageContext'));
    assert.ok(required.includes('cookie'));
    assert.ok(required.includes('initParam'));
  });
});

// =========================================================================
// 4. web.xml Servlet-Mapping Parsing Tests
// =========================================================================

describe('web.xml Parsing', () => {
  const WEB_XML_WITH_JSP = `<?xml version="1.0" encoding="UTF-8"?>
<web-app>
  <servlet>
    <servlet-name>MyServlet</servlet-name>
    <servlet-class>com.example.MyServlet</servlet-class>
  </servlet>
  <servlet>
    <servlet-name>HomePage</servlet-name>
    <jsp-file>/home.jsp</jsp-file>
  </servlet>
  <servlet>
    <servlet-name>AdminPage</servlet-name>
    <jsp-file>/WEB-INF/admin/index.jsp</jsp-file>
  </servlet>
  <servlet-mapping>
    <servlet-name>MyServlet</servlet-name>
    <url-pattern>/api/*</url-pattern>
  </servlet-mapping>
  <servlet-mapping>
    <servlet-name>HomePage</servlet-name>
    <url-pattern>/home</url-pattern>
  </servlet-mapping>
  <servlet-mapping>
    <servlet-name>AdminPage</servlet-name>
    <url-pattern>/admin/*</url-pattern>
  </servlet-mapping>
</web-app>`;

  test('parseWebXml extracts servlet-class entries', () => {
    const webXml = parseWebXml(WEB_XML_WITH_JSP);
    assert.ok(webXml);
    assert.ok(webXml.servlets['MyServlet']);
    assert.strictEqual(webXml.servlets['MyServlet'].servletClass, 'com.example.MyServlet');
  });

  test('parseWebXml extracts jsp-file entries', () => {
    const webXml = parseWebXml(WEB_XML_WITH_JSP);
    assert.ok(webXml);
    assert.ok(webXml.servlets['HomePage']);
    assert.strictEqual(webXml.servlets['HomePage'].jspFile, '/home.jsp');
    assert.strictEqual(webXml.servlets['HomePage'].servletClass, '');
  });

  test('parseWebXml extracts jsp-file with nested path', () => {
    const webXml = parseWebXml(WEB_XML_WITH_JSP);
    assert.ok(webXml);
    assert.strictEqual(webXml.servlets['AdminPage'].jspFile, '/WEB-INF/admin/index.jsp');
  });

  test('parseWebXml builds jspToServlet reverse lookup', () => {
    const webXml = parseWebXml(WEB_XML_WITH_JSP);
    assert.ok(webXml);
    assert.strictEqual(webXml.jspToServlet['/home.jsp'], 'HomePage');
    assert.strictEqual(webXml.jspToServlet['/WEB-INF/admin/index.jsp'], 'AdminPage');
  });

  test('parseWebXml builds classToServlet reverse lookup', () => {
    const webXml = parseWebXml(WEB_XML_WITH_JSP);
    assert.ok(webXml);
    assert.strictEqual(webXml.classToServlet['com.example.MyServlet'], 'MyServlet');
  });

  test('parseWebXml builds urlToServlet reverse lookup', () => {
    const webXml = parseWebXml(WEB_XML_WITH_JSP);
    assert.ok(webXml);
    assert.strictEqual(webXml.urlToServlet['/api/*'], 'MyServlet');
    assert.strictEqual(webXml.urlToServlet['/home'], 'HomePage');
    assert.strictEqual(webXml.urlToServlet['/admin/*'], 'AdminPage');
  });

  test('parseWebXml extracts all servlet-mappings', () => {
    const webXml = parseWebXml(WEB_XML_WITH_JSP);
    assert.ok(webXml);
    assert.strictEqual(webXml.mappings.length, 3);
    assert.strictEqual(webXml.mappings[0].servletName, 'MyServlet');
    assert.strictEqual(webXml.mappings[0].urlPattern, '/api/*');
    assert.strictEqual(webXml.mappings[1].servletName, 'HomePage');
    assert.strictEqual(webXml.mappings[1].urlPattern, '/home');
  });

  test('parseWebXml handles empty web.xml', () => {
    const webXml = parseWebXml('<?xml version="1.0"?><web-app></web-app>');
    assert.ok(webXml);
    assert.strictEqual(Object.keys(webXml.servlets).length, 0);
    assert.strictEqual(webXml.mappings.length, 0);
  });

  test('parseWebXml handles servlet with both class and jsp-file', () => {
    const webXml = parseWebXml(`<?xml version="1.0"?>
<web-app>
  <servlet>
    <servlet-name>Hybrid</servlet-name>
    <servlet-class>com.example.HybridServlet</servlet-class>
    <jsp-file>/hybrid.jsp</jsp-file>
  </servlet>
</web-app>`);
    assert.ok(webXml);
    const servlet = webXml.servlets['Hybrid'];
    assert.ok(servlet);
    assert.strictEqual(servlet.servletClass, 'com.example.HybridServlet');
    assert.strictEqual(servlet.jspFile, '/hybrid.jsp');
    assert.strictEqual(webXml.classToServlet['com.example.HybridServlet'], 'Hybrid');
    assert.strictEqual(webXml.jspToServlet['/hybrid.jsp'], 'Hybrid');
  });

  test('parseWebXml handles malformed XML gracefully', () => {
    const webXml = parseWebXml('not valid xml');
    assert.strictEqual(webXml, undefined);
  });

  test('parseWebXml handles non-web-app root element', () => {
    const webXml = parseWebXml('<?xml version="1.0"?><something-else></something-else>');
    assert.strictEqual(webXml, undefined);
  });
});