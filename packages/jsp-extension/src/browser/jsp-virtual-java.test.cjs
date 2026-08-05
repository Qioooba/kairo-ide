'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVirtualJavaFile,
  mapOffsetToVirtualPosition,
  mapVirtualPositionToBlockOffset,
  virtualUriForBlock,
  parseVirtualUri,
  virtualWrapperLineCount,
  JSP_EXPRESSION_PREFIX,
} = require('../../lib/browser/jsp-virtual-java');

const { JspJavaParser, findClosingScriptlet } = require('../../lib/browser/jsp-java-nav');

describe('jsp-virtual-java', () => {
  test('virtualUri round-trip', () => {
    const uri = virtualUriForBlock('file:///a.jsp', 2);
    assert.equal(uri, 'jsp-scriptlet://file:///a.jsp#block2');
    assert.deepEqual(parseVirtualUri(uri), { jspUri: 'file:///a.jsp', blockIndex: 2 });
  });

  test('scriptlet wrapper includes implicits and method body', () => {
    const text = buildVirtualJavaFile('out.println(1);', 'scriptlet');
    assert.match(text, /HttpServletRequest request/);
    assert.match(text, /void _m\(\) throws Exception/);
    assert.match(text, /out\.println\(1\);/);
    assert.equal(virtualWrapperLineCount('scriptlet'), 11);
  });

  test('declaration wrapper puts fields at class level', () => {
    const text = buildVirtualJavaFile('private int x;', 'declaration');
    assert.match(text, /private int x;/);
    assert.doesNotMatch(text, /void _m/);
  });

  test('mapOffsetToVirtualPosition accounts for wrapper', () => {
    const pos = mapOffsetToVirtualPosition('abc', 2, 'scriptlet');
    assert.equal(pos.line, 11);
    assert.equal(pos.character, 2);
  });

  test('expression keeps whitespace and maps prefix only on first line (JV-P1-1)', () => {
    const content = '  foo()\n  .bar()';
    const text = buildVirtualJavaFile(content, 'expression');
    assert.match(text, new RegExp(JSP_EXPRESSION_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '  foo\\(\\)'));
    assert.doesNotMatch(text, /Object __expr = foo/); // must NOT trim leading spaces

    const first = mapOffsetToVirtualPosition(content, 2, 'expression'); // on 'f'
    assert.equal(first.line, virtualWrapperLineCount('expression'));
    assert.equal(first.character, JSP_EXPRESSION_PREFIX.length + 2);

    const secondLine = mapOffsetToVirtualPosition(content, content.indexOf('.bar'), 'expression');
    assert.equal(secondLine.line, virtualWrapperLineCount('expression') + 1);
    assert.equal(secondLine.character, 2);

    const back = mapVirtualPositionToBlockOffset(
      content,
      first.line,
      first.character,
      'expression',
    );
    assert.deepEqual(back, { lineInBlock: 0, characterInBlock: 2 });
  });
});

describe('jsp-java-nav findJavaBlocks (JV-P1-3)', () => {
  const parser = new JspJavaParser();

  test('skips JSP comments', () => {
    const content = '<%-- comment with <% inside --%><% int x = 1; %>';
    const blocks = parser.findJavaBlocks(content);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'scriptlet');
    assert.equal(content.slice(blocks[0].start, blocks[0].end), ' int x = 1; ');
  });

  test('does not swallow whitespace after opening tag', () => {
    const content = '<%   out.print(1); %>';
    const blocks = parser.findJavaBlocks(content);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].start, 2); // right after "<%"
    assert.equal(content.slice(blocks[0].start, blocks[0].end), '   out.print(1); ');
  });

  test('ignores %> inside Java string literals', () => {
    const content = '<% String s = "%>"; out.print(s); %>';
    const blocks = parser.findJavaBlocks(content);
    assert.equal(blocks.length, 1);
    assert.equal(content.slice(blocks[0].start, blocks[0].end), ' String s = "%>"; out.print(s); ');
  });

  test('findClosingScriptlet skips string and comment closers', () => {
    assert.equal(findClosingScriptlet('x = "%>"; y', 0), -1);
    assert.equal(findClosingScriptlet('x = "%>"; y %>', 0), 12);
  });

  test('classifies expression/declaration/directive', () => {
    const content = '<%= a %><%! int x; %><%@ page %>';
    const blocks = parser.findJavaBlocks(content);
    assert.deepEqual(blocks.map(b => b.kind), ['expression', 'declaration', 'directive']);
  });
});

describe('jsp block index identity (JV-P1-4)', () => {
  test('findIndex by offsets works across re-parses', () => {
    const parser = new JspJavaParser();
    const content = '<% a %><% b %><%= c %>';
    const first = parser.findJavaBlocks(content);
    const second = parser.findJavaBlocks(content);
    const target = first[1];
    // Object identity fails across parses:
    assert.equal(second.indexOf(target), -1);
    const idx = second.findIndex(
      b => b.start === target.start && b.end === target.end && b.kind === target.kind,
    );
    assert.equal(idx, 1);
  });
});
