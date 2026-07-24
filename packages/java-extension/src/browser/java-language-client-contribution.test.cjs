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

test('documentSelector: returns java array', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const selector = contribution.documentSelector;
  assert.deepEqual(selector, ['java']);
});

test('globPatterns: returns java file patterns', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const patterns = contribution.globPatterns;
  assert.deepEqual(patterns, ['**/*.java']);
});

test('id: returns java language id', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  assert.equal(contribution.id, 'java');
});

test('name: returns Java language name', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  assert.equal(contribution.name, 'Java');
});

test('diagnosticCollectionName: returns kairo-java-diagnostics', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  assert.equal(contribution.diagnosticCollectionName, 'kairo-java-diagnostics');
});

test('completionProvider: has resolveProvider and triggerCharacters', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const provider = contribution.completionProvider;
  assert.equal(provider.resolveProvider, true);
  assert.deepEqual(provider.triggerCharacters, ['.', '@', '#', '*', ' ']);
});

test('definitionProvider: returns true', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  assert.equal(contribution.definitionProvider, true);
});

test('hoverProvider: returns true', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  assert.equal(contribution.hoverProvider, true);
});

test('serverOptions: has run and debug commands', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const opts = contribution.serverOptions;
  assert.equal(opts.run.command, 'kairo-java');
  assert.equal(opts.debug.command, 'kairo-java');
  assert.deepEqual(opts.debug.args, ['--debug']);
});

test('initializationOptions: has extendedClientCapabilities', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const opts = contribution.initializationOptions;
  assert.equal(opts.extendedClientCapabilities.progressReportProvider, true);
  assert.equal(opts.extendedClientCapabilities.classFileContentsSupport, true);
  assert.equal(opts.extendedClientCapabilities.overrideMethodsPromptSupport, true);
  assert.equal(opts.extendedClientCapabilities.hashCodeEqualsPromptSupport, true);
  assert.equal(opts.extendedClientCapabilities.advancedOrganizeImportsSupport, true);
});

test('initializationOptions: has completion settings', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const java = contribution.initializationOptions.settings.java;
  assert.equal(java.completion.enabled, true);
  assert.ok(java.completion.favoriteStaticMembers.includes('org.junit.Assert.*'));
  assert.ok(java.completion.favoriteStaticMembers.includes('java.util.Objects.requireNonNull'));
});

test('initializationOptions: has import settings', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const java = contribution.initializationOptions.settings.java;
  assert.equal(java.import.enabled, true);
});

test('initializationOptions: has format settings', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const java = contribution.initializationOptions.settings.java;
  assert.equal(java.format.enabled, true);
});

test('initializationOptions: has signatureHelp settings', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const java = contribution.initializationOptions.settings.java;
  assert.equal(java.signatureHelp.enabled, true);
});

test('initializationOptions: has configuration settings', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const java = contribution.initializationOptions.settings.java;
  assert.equal(java.configuration.checkProjectSettingsExclusions, false);
  assert.equal(java.configuration.updateBuildConfiguration, 'interactive');
});

test('initializationOptions: has codeGeneration toString template', () => {
  const contribution = new KairoJavaLanguageClientContribution();
  const java = contribution.initializationOptions.settings.java;
  assert.ok(java.codeGeneration.toString.template.includes('${object.className}'));
  assert.ok(java.codeGeneration.toString.template.includes('${member.name()}'));
  assert.ok(java.codeGeneration.toString.template.includes('${member.value}'));
});