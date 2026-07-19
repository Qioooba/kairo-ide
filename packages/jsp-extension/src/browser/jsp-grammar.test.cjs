'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSP_MONARCH } = require('../../lib/browser/jsp-grammar');

test('JSP grammar uses cached states for all server-side block types', () => {
  const states = JSP_MONARCH.tokenizer;
  for (const name of ['jspDirective', 'jspDeclaration', 'jspExpression', 'jspScriptlet']) {
    assert.ok(Array.isArray(states[name]), `missing tokenizer state ${name}`);
    assert.equal(states[name][0][0].source, '%>');
    assert.equal(states[name][0][1].next, '@pop');
  }
});

test('JSP root no longer contains unbounded percent scans', () => {
  const patterns = JSP_MONARCH.tokenizer.root.map(rule => rule[0].source);
  assert.equal(patterns.some(pattern => pattern.includes('[^%]*')), false);
});
