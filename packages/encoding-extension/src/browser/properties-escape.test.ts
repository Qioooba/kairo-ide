import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeProperties, unescapeProperties, isPropertiesPath } from './properties-escape';

test('escapeProperties encodes CJK as uppercase \\uXXXX', () => {
  assert.equal(escapeProperties('hello=\u4f60\u597d'), 'hello=\\u4F60\\u597D');
});

test('escapeProperties leaves ASCII and existing escapes alone', () => {
  assert.equal(escapeProperties('key=value'), 'key=value');
  assert.equal(escapeProperties('greeting=\\u4F60\\u597D'), 'greeting=\\u4F60\\u597D');
});

test('escapeProperties emits UTF-16 surrogate pairs for supplementary plane', () => {
  assert.equal(escapeProperties('key=\u{1F600}'), 'key=\\uD83D\\uDE00');
});

test('unescapeProperties round-trips BMP and surrogate pairs', () => {
  assert.equal(unescapeProperties('hello=\\u4F60\\u597D'), 'hello=\u4f60\u597d');
  assert.equal(unescapeProperties('key=\\uD83D\\uDE00'), 'key=\u{1F600}');
  assert.equal(unescapeProperties(escapeProperties('testKey=你好')), 'testKey=你好');
});

test('isPropertiesPath matches .properties and ignores query/hash', () => {
  assert.equal(isPropertiesPath('file:///tmp/messages.properties'), true);
  assert.equal(isPropertiesPath('C:\\app\\conf\\app.properties?ts=1'), true);
  assert.equal(isPropertiesPath('src/App.java'), false);
});
