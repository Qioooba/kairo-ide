'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSP_MONARCH } = require('../../lib/browser/jsp-monarch');

test('JSP grammar uses cached states for all server-side block types', () => {
  const states = JSP_MONARCH.tokenizer;
  for (const name of ['jspDirective', 'jspDeclaration', 'jspExpression', 'jspScriptlet']) {
    assert.ok(Array.isArray(states[name]), `missing tokenizer state ${name}`);
    assert.equal(states[name][0][0].source, '%>');
    assert.equal(states[name][0][1].next, '@pop');
  }
});

test('JSP Java-bearing blocks embed the java language', () => {
  const root = JSP_MONARCH.tokenizer.root;
  const javaBlocks = root.filter(rule => rule[1] && rule[1].nextEmbedded === 'java');
  assert.equal(javaBlocks.length, 3, 'declaration/expression/scriptlet should embed java');
  for (const name of ['jspDeclaration', 'jspExpression', 'jspScriptlet']) {
    assert.equal(JSP_MONARCH.tokenizer[name][0][1].nextEmbedded, '@pop');
  }
});

test('JSP has HTML attribute, JSTL, and EL-aware states', () => {
  const states = JSP_MONARCH.tokenizer;
  for (const name of ['tagOpen', 'jstlOpen', 'taglibOpen', 'attrValueDq', 'el']) {
    assert.ok(Array.isArray(states[name]), `missing ${name}`);
  }
});

test('JSP directive treats page/taglib as keywords', () => {
  const rules = JSP_MONARCH.tokenizer.jspDirective;
  const kw = rules.find(r => r[1] === 'keyword');
  assert.ok(kw, 'directive keyword rule');
  assert.match(kw[0].source, /page/);
});

test('JSP root no longer contains unbounded percent scans', () => {
  const patterns = JSP_MONARCH.tokenizer.root.map(rule => rule[0].source);
  assert.equal(patterns.some(pattern => pattern.includes('[^%]*')), false);
});
