'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVirtualJavaFile,
  mapOffsetToVirtualPosition,
  virtualUriForBlock,
  parseVirtualUri,
  virtualWrapperLineCount,
} = require('../../lib/browser/jsp-virtual-java');

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
});
