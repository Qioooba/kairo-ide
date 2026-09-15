'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  JspRegionScanner,
  defaultJspRegionScanner,
} = require('../../packages/highlighting-extension/lib/common/jsp-region-scanner');

const {
  IncrementalTokenizer,
} = require('../../packages/highlighting-extension/lib/worker/incremental-tokenizer');

const {
  LexerState,
} = require('../../packages/highlighting-extension/lib/common/lexer-state');

describe('Lexical Golden Tests (JSP & Java Monarch)', () => {
  const scanner = new JspRegionScanner();

  it('JSP comment <%-- ... --%> containing nested delimiters and quotes', () => {
    const text = '<%-- This is a comment with <% and %> and "quotes" and \'single\' --%><div>Hello</div>';
    const regions = scanner.scanRegions(text, 'jsp');
    assert.ok(regions.length >= 2);
    assert.equal(regions[0].kind, 'jsp-comment');
    assert.equal(regions[0].isClosed, true);
    assert.equal(text.slice(regions[0].startOffset, regions[0].endOffset), '<%-- This is a comment with <% and %> and "quotes" and \'single\' --%>');
    assert.equal(regions[1].kind, 'tag');
  });

  it('Body EL expressions ${...} with operators and quotes', () => {
    const text = '<h1>Welcome ${user.name != null ? user.name : \'Guest\'}</h1>';
    const regions = scanner.scanRegions(text, 'jsp');
    const elRegions = regions.filter(r => r.kind === 'el-expression');
    assert.equal(elRegions.length, 1);
    assert.equal(elRegions[0].embeddedLanguage, 'el');
    assert.equal(text.slice(elRegions[0].startOffset, elRegions[0].endOffset), '${user.name != null ? user.name : \'Guest\'}');
  });

  it('Attribute EL expressions #{...} and ${...}', () => {
    const text = '<h:inputText id="name" value="#{userBean.name}" title="${tooltip}" />';
    const regions = scanner.scanRegions(text, 'jsp');
    const elRegions = regions.filter(r => r.kind === 'el-expression');
    assert.equal(elRegions.length, 2);
    assert.equal(text.slice(elRegions[0].startOffset, elRegions[0].endOffset), '#{userBean.name}');
    assert.equal(text.slice(elRegions[1].startOffset, elRegions[1].endOffset), '${tooltip}');
  });

  it('Attribute Java expression <%= ... %> embedding', () => {
    const text = '<img src="<%= request.getContextPath() %>/images/logo.png" alt="Logo" />';
    const regions = scanner.scanRegions(text, 'jsp');
    const exprRegions = regions.filter(r => r.kind === 'jsp-expression');
    assert.equal(exprRegions.length, 1);
    assert.equal(text.slice(exprRegions[0].innerStartOffset, exprRegions[0].innerEndOffset), ' request.getContextPath() ');
  });

  it('Escape sequence %\\> does not close scriptlet per JSP 2.0 / Tomcat 6 spec', () => {
    const text = '<% String s = "%\\>"; int x = 10; %>';
    const regions = scanner.scanRegions(text, 'jsp');
    const scriptlets = regions.filter(r => r.kind === 'jsp-scriptlet');
    assert.equal(scriptlets.length, 1);
    assert.equal(scriptlets[0].isClosed, true);
    assert.equal(text.slice(scriptlets[0].startOffset, scriptlets[0].endOffset), text);
  });

  it('Scriptlet skips %> inside Java string and comment literals', () => {
    const text = '<% String s = "%>"; // %>\n /* %> */ int y = 20; %>';
    const regions = scanner.scanRegions(text, 'jsp');
    const scriptlets = regions.filter(r => r.kind === 'jsp-scriptlet');
    assert.equal(scriptlets.length, 1);
    assert.equal(scriptlets[0].isClosed, true);
    assert.equal(text.slice(scriptlets[0].startOffset, scriptlets[0].endOffset), text);
  });

  it('Java Monarch unclosed string literal pops at newline and recovers', () => {
    const tokenizer = new IncrementalTokenizer('test://test.java', 'java', 'java');
    const initialState = new LexerState('root', undefined, [], 'java');

    // Line 1: unclosed string
    const line1 = 'String s = "unclosed;';
    const res1 = tokenizer.tokenizeSingleLine(line1, initialState);

    // End state of line 1 must recover back to root, not stay trapped in @string
    assert.equal(res1.nextState.mode, 'root');

    // Line 2: normal Java statement
    const line2 = 'int count = 42;';
    const res2 = tokenizer.tokenizeSingleLine(line2, res1.nextState);
    assert.equal(res2.nextState.mode, 'root');
    // Verify tokens were generated for line 2
    assert.ok(res2.tokens.length > 0);
  });

  it('Embedded <script> and <style> partition correctly', () => {
    const text = '<script>function test() { var x = 1; }</script><style>body { color: red; }</style>';
    const regions = scanner.scanRegions(text, 'jsp');
    const jsRegions = regions.filter(r => r.kind === 'embedded-script');
    const cssRegions = regions.filter(r => r.kind === 'embedded-style');
    assert.equal(jsRegions.length, 1);
    assert.equal(cssRegions.length, 1);
    assert.equal(jsRegions[0].embeddedLanguage, 'javascript');
    assert.equal(cssRegions[0].embeddedLanguage, 'css');
  });
});
