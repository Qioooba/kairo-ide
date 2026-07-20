'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  KairoJavaLanguageClientContribution,
} = require('../../lib/browser/java-language-client-contribution');

test('JDT client defaults avoid expensive legacy-workspace features', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const opts = contribution.initializationOptions;
  const java = opts.settings.java;
  assert.equal(java.completion.guessMethodArguments, false);
  assert.equal(java.references.includeDecompiledSources, false);
  assert.equal(java.implementationsCodeLens.enabled, false);
  assert.equal(java.trace.server, 'off');
});