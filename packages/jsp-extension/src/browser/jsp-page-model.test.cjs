'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  JspPageModelBuilder,
  convertAdditionalTextEditsToJsp,
} = require('../../lib/browser/jsp-page-model');
const { JspSourceMap } = require('../../lib/browser/jsp-sourcemap');

describe('PR12: JSP 整页模型与 SourceMap (F16 / T40 ~ T43)', () => {
  const builder = new JspPageModelBuilder();

  test('T40: cross-block variable definition and usage inside _jspService', async () => {
    const jspContent = [
      '<%@ page language="java" contentType="text/html; charset=UTF-8" %>',
      '<html><body>',
      '<% String userName = "Alice"; %>',
      '<div>Hello</div>',
      '<% out.print(userName); %>',
      '<%= userName.toUpperCase() %>',
      '</body></html>',
    ].join('\n');

    const result = await builder.buildPageVirtualJava('file:///test/user.jsp', jspContent);
    const java = result.virtualJava;

    // Both blocks must be inside the same _jspService method in sequential order
    assert.match(java, /public void _jspService\(/);
    const firstBlockIdx = java.indexOf('String userName = "Alice";');
    const secondBlockIdx = java.indexOf('out.print(userName);');
    const thirdBlockIdx = java.indexOf('userName.toUpperCase()');

    assert.ok(firstBlockIdx > 0, 'First scriptlet block found in virtual Java');
    assert.ok(secondBlockIdx > firstBlockIdx, 'Second scriptlet block appears after first block in _jspService');
    assert.ok(thirdBlockIdx > secondBlockIdx, 'Expression block appears after second block in _jspService');

    // Implicits must be present in _jspService
    assert.match(java, /HttpServletRequest request/);
    assert.match(java, /JspWriter out/);
    assert.match(java, /HttpSession session/);
  });

  test('T41: declarations placed at class level and static includes resolved via DAG', async () => {
    const mainJsp = [
      '<%@ page import="java.util.List" %>',
      '<%@ include file="header.jsp" %>',
      '<%! public String getAppName() { return "Kairo"; } %>',
      '<%',
      '    out.print(getAppName() + " : " + getHeaderVersion());',
      '%>',
    ].join('\n');

    const headerJsp = [
      '<%! public int getHeaderVersion() { return 2; } %>',
      '<% String headerTitle = "Welcome"; %>',
    ].join('\n');

    const fileMap = new Map([
      ['header.jsp', headerJsp],
    ]);

    const resolver = (path) => fileMap.get(path);

    const result = await builder.buildPageVirtualJava('file:///test/main.jsp', mainJsp, resolver);
    const java = result.virtualJava;

    // 1. Declarations from main and included files should be at class level (outside _jspService)
    const serviceIdx = java.indexOf('public void _jspService');
    const getAppNameIdx = java.indexOf('public String getAppName()');
    const getHeaderVersionIdx = java.indexOf('public int getHeaderVersion()');

    assert.ok(getAppNameIdx > 0 && getAppNameIdx < serviceIdx, 'main declaration placed at class level');
    assert.ok(getHeaderVersionIdx > 0 && getHeaderVersionIdx < serviceIdx, 'included declaration placed at class level');

    // 2. User import must be present at top
    assert.match(java, /import java\.util\.List;/);

    // 3. Scriptlets from both files should be in _jspService
    assert.ok(java.indexOf('headerTitle = "Welcome"') > serviceIdx, 'included scriptlet in _jspService');
    assert.ok(java.indexOf('getAppName() + " : " + getHeaderVersion()') > serviceIdx, 'main scriptlet in _jspService');
  });

  test('T41: static include cycle detection prevents infinite recursion', async () => {
    const fileA = '<%@ include file="b.jsp" %>\n<% int a = 1; %>';
    const fileB = '<%@ include file="a.jsp" %>\n<% int b = 2; %>';

    const files = new Map([
      ['b.jsp', fileB],
      ['a.jsp', fileA],
    ]);

    const resolver = (path) => files.get(path);

    // Should not throw or stack overflow
    const result = await builder.buildPageVirtualJava('file:///test/a.jsp', fileA, resolver);
    assert.ok(result.virtualJava.includes('int a = 1;'));
    assert.ok(result.virtualJava.includes('int b = 2;'));
  });

  test('diamond include DAG resolves correctly without false cycle detection', async () => {
    // A includes B and C. Both B and C include D.
    const fileA = '<%@ include file="b.jsp" %>\n<%@ include file="c.jsp" %>\n<% int a = 1; %>';
    const fileB = '<%@ include file="d.jsp" %>\n<% int b = 2; %>';
    const fileC = '<%@ include file="d.jsp" %>\n<% int c = 3; %>';
    const fileD = '<%! int sharedD = 42; %>';

    const files = new Map([
      ['b.jsp', fileB],
      ['c.jsp', fileC],
      ['d.jsp', fileD],
    ]);

    const resolver = (path) => files.get(path);

    const result = await builder.buildPageVirtualJava('file:///test/a.jsp', fileA, resolver);
    assert.ok(result.virtualJava.includes('int a = 1;'));
    assert.ok(result.virtualJava.includes('int b = 2;'));
    assert.ok(result.virtualJava.includes('int c = 3;'));
    assert.ok(result.virtualJava.includes('int sharedD = 42;'));
  });

  test('T42: SourceMap dual-directional mapping with Chinese characters and multi-line expressions', async () => {
    const jspLines = [
      '<%@ page contentType="text/html; charset=UTF-8" %>',
      '<%',
      '  // 中文字符与特殊符号：¥100 & ©2026',
      '  String greeting = "你好，世界";',
      '%>',
      '<%=',
      '  greeting != null',
      '    ? greeting.trim()',
      '    : "空"',
      '%>',
    ];
    const jspContent = jspLines.join('\n');

    const result = await builder.buildPageVirtualJava('file:///test/unicode.jsp', jspContent);
    const sm = result.sourceMap;

    // 1. Map JSP -> Virtual for String greeting line (Line 3, col 9 -> "greeting")
    const jspLine = 3;
    const jspCol = 9; // on 'greeting'
    const vPos = sm.mapJspPositionToVirtual('file:///test/unicode.jsp', jspLine, jspCol);
    assert.ok(vPos !== null, 'Mapped JSP position to virtual');
    assert.ok(vPos.line > 0, 'Virtual line > 0');

    // 2. Map Virtual back -> JSP
    const back = sm.mapVirtualPositionToJsp(vPos.line, vPos.character);
    assert.ok(back !== null, 'Mapped virtual position back to JSP');
    assert.equal(back.inUserCode, true);
    assert.equal(back.line, jspLine);
    assert.equal(back.character, jspCol);

    // 3. Multi-line expression mapping
    // Line 7: `    ? greeting.trim()`
    const exprLine = 7;
    const exprCol = 6; // on 'greeting'
    const exprVPos = sm.mapJspPositionToVirtual('file:///test/unicode.jsp', exprLine, exprCol);
    assert.ok(exprVPos !== null, 'Multi-line expression line 7 mapped');

    const exprBack = sm.mapVirtualPositionToJsp(exprVPos.line, exprVPos.character);
    assert.ok(exprBack !== null, 'Mapped multi-line expression back to JSP');
    assert.equal(exprBack.line, exprLine);
    assert.equal(exprBack.character, exprCol);
  });

  test('T43: convertAdditionalTextEditsToJsp converts Java imports to JSP directives', () => {
    const initialJsp = [
      '<%@ page language="java" %>',
      '<html>',
      '<%',
      '  List list = new ArrayList();',
      '%>',
      '</html>',
    ].join('\n');

    const edits = [
      {
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
        newText: 'import java.util.ArrayList;\n',
      },
      {
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
        newText: 'import java.util.List;\n',
      },
      {
        // Non-import edit targeting synthetic virtual class wrapper — must be ignored!
        range: { start: { line: 15, character: 0 }, end: { line: 15, character: 0 } },
        newText: 'public void someSyntheticMethod() {}\n',
      },
    ];

    const jspEdits = convertAdditionalTextEditsToJsp(initialJsp, edits);
    assert.equal(jspEdits.length, 2);

    assert.equal(jspEdits[0].range.startLineNumber, 1);
    assert.equal(jspEdits[0].newText, '<%@ page import="java.util.ArrayList" %>\n');

    assert.equal(jspEdits[1].range.startLineNumber, 1);
    assert.equal(jspEdits[1].newText, '<%@ page import="java.util.List" %>\n');

    // Deduplication test: if JSP already has the import, do not generate duplicate
    const jspWithImport = '<%@ page import="java.util.ArrayList" %>\n' + initialJsp;
    const dedupeEdits = convertAdditionalTextEditsToJsp(jspWithImport, edits);
    assert.equal(dedupeEdits.length, 1);
    assert.equal(dedupeEdits[0].newText, '<%@ page import="java.util.List" %>\n');
  });

  test('P0-5: multi-line sourcemap correctly accounts for 8-space method indent on lineOffset > 0 and round-trips with Unicode', async () => {
    const jsp = [
      '<html>',
      '<%',
      '    String greeting = "你好，世界";',
      '    int count = greeting.length();',
      '%>',
      '</html>',
    ].join('\n');

    const uri = 'file:///test/multiline.jsp';
    const result = await builder.buildPageVirtualJava(uri, jsp);
    const sm = result.sourceMap;

    // Line 2 in JSP is: "    String greeting = "你好，世界";" (lineOffset = 1 in the scriptlet)
    // In JSP, 'int count' is on line 3, character 4 (4 spaces indent)
    const jspLine = 3;
    const jspChar = 4;

    const vPos = sm.mapJspPositionToVirtual(uri, jspLine, jspChar);
    assert.ok(vPos !== null, 'mapped virtual position must not be null');

    // In virtual Java, the scriptlet body has 8 spaces indent
    // So targetVirtualCol must be 8 + 4 = 12, NOT 4!
    assert.equal(vPos.character, 12, 'targetVirtualCol must include the 8-space method indentation');

    // Round-trip back to JSP
    const backJsp = sm.mapVirtualPositionToJsp(vPos.line, vPos.character);
    assert.ok(backJsp !== null, 'reverse mapped JSP position must not be null');
    assert.equal(backJsp.line, jspLine);
    assert.equal(backJsp.character, jspChar);

    // Test cursor inside Chinese text on line 2
    // Line 2: "    String greeting = "你好，世界";"
    // '你' is character 23
    const chineseJspLine = 2;
    const chineseJspChar = 23;
    const vPosZh = sm.mapJspPositionToVirtual(uri, chineseJspLine, chineseJspChar);
    assert.ok(vPosZh !== null);
    assert.equal(vPosZh.character, 8 + chineseJspChar, 'Chinese character column must also have 8-space indent');

    const backZh = sm.mapVirtualPositionToJsp(vPosZh.line, vPosZh.character);
    assert.ok(backZh !== null);
    assert.equal(backZh.line, chineseJspLine);
    assert.equal(backZh.character, chineseJspChar);
  });
});
