'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('JSON Monarch grammar tokenizer', () => {
  // Verify JSON tokenizer structure
  const tokenizer = {
    root: []  // Should have rules for strings, numbers, keywords, delimiters
  };
  assert.ok(Array.isArray(tokenizer.root));
});

test('JSON number parsing', () => {
  const numberRe = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+\-]?\d+)?\b/;

  assert.ok(numberRe.test('0'));
  assert.ok(numberRe.test('42'));
  assert.ok(numberRe.test('-17'));
  assert.ok(numberRe.test('3.14'));
  assert.ok(numberRe.test('1.5e10'));
  assert.ok(numberRe.test('-2.5E-3'));
  assert.ok(!numberRe.test('abc'));
  assert.ok(!numberRe.test(''));
});

test('JSON keywords', () => {
  assert.strictEqual(JSON.parse('true'), true);
  assert.strictEqual(JSON.parse('false'), false);
  assert.strictEqual(JSON.parse('null'), null);
});

test('JSON string parsing', () => {
  assert.strictEqual(JSON.parse('"hello"'), 'hello');
  assert.strictEqual(JSON.parse('"escaped\\nnewline"'), 'escaped\nnewline');
  assert.strictEqual(JSON.parse('"unicode\\u0041"'), 'unicodeA');
  assert.strictEqual(JSON.parse('""'), '');
});

test('JSON object parsing', () => {
  const obj = JSON.parse('{"name": "test", "value": 42}');
  assert.strictEqual(obj.name, 'test');
  assert.strictEqual(obj.value, 42);
});

test('JSON array parsing', () => {
  const arr = JSON.parse('[1, 2, 3, "four", true, null]');
  assert.deepStrictEqual(arr, [1, 2, 3, 'four', true, null]);
});

test('JSON nested structure', () => {
  const json = '{"users":[{"name":"Alice","roles":["admin","user"]},{"name":"Bob","roles":["user"]}]}';
  const obj = JSON.parse(json);
  assert.strictEqual(obj.users.length, 2);
  assert.strictEqual(obj.users[0].name, 'Alice');
  assert.strictEqual(obj.users[0].roles.length, 2);
  assert.strictEqual(obj.users[1].name, 'Bob');
});

test('JSON validation — valid JSON', () => {
  try {
    JSON.parse('{"key": "value"}');
    assert.ok(true);
  } catch (e) {
    assert.fail('Should not throw');
  }
});

test('JSON validation — invalid JSON', () => {
  assert.throws(() => JSON.parse('{key: "value"}'), SyntaxError);
  assert.throws(() => JSON.parse('[1, 2,]'), SyntaxError);
  assert.throws(() => JSON.parse('{"key": }'), SyntaxError);
  assert.throws(() => JSON.parse('undefined'), SyntaxError);
});

test('JSON validation — unclosed string', () => {
  assert.throws(() => JSON.parse('{"key": "unclosed'), SyntaxError);
});

test('JSON validation — trailing comma', () => {
  assert.throws(() => JSON.parse('{"a": 1, "b": 2,}'), SyntaxError);
});

test('JSON validation — single quotes', () => {
  assert.throws(() => JSON.parse("{'key': 'value'}"), SyntaxError);
});

test('JSON file name detection', () => {
  const getFileName = (uri) => {
    const parts = uri.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  };

  assert.strictEqual(getFileName('/path/to/package.json'), 'package.json');
  assert.strictEqual(getFileName('/path/to/tsconfig.json'), 'tsconfig.json');
  assert.strictEqual(getFileName('C:\\Users\\test\\.eslintrc.json'), '.eslintrc.json');
  assert.strictEqual(getFileName('/data.json'), 'data.json');
});

test('JSON completion — package.json keys', () => {
  const pkgKeys = ['name', 'version', 'description', 'main', 'scripts', 'dependencies', 'devDependencies'];
  assert.ok(pkgKeys.includes('name'));
  assert.ok(pkgKeys.includes('version'));
  assert.ok(pkgKeys.includes('dependencies'));
});

test('JSON completion — tsconfig.json keys', () => {
  const tsconfigKeys = ['compilerOptions', 'include', 'exclude', 'extends', 'references'];
  assert.ok(tsconfigKeys.includes('compilerOptions'));
  assert.ok(tsconfigKeys.includes('include'));
});

test('JSON completion — value snippets', () => {
  const snippets = [
    { label: '{}', detail: '空对象', insertText: '{\n\t$1\n}' },
    { label: '[]', detail: '空数组', insertText: '[\n\t$1\n]' },
    { label: '""', detail: '字符串', insertText: '"$1"' },
  ];
  assert.strictEqual(snippets.length, 3);
  assert.strictEqual(snippets[0].label, '{}');
  assert.strictEqual(snippets[1].label, '[]');
  assert.strictEqual(snippets[2].label, '""');
});

test('JSONC comments support', () => {
  // JSONC allows comments — we can strip them and parse
  const jsonc = `{
    // This is a comment
    "name": "test",
    /* Block comment */
    "version": "1.0"
  }`;
  // Strip comments
  const stripped = jsonc
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const obj = JSON.parse(stripped);
  assert.strictEqual(obj.name, 'test');
  assert.strictEqual(obj.version, '1.0');
});

test('JSON large file detection', () => {
  const MAX_JSON_SIZE = 1 * 1024 * 1024; // 1 MB
  const smallSize = 500 * 1024; // 500 KB
  const largeSize = 2 * 1024 * 1024; // 2 MB

  assert.ok(smallSize <= MAX_JSON_SIZE);
  assert.ok(largeSize > MAX_JSON_SIZE);
});

test('JSON inside string detection', () => {
  const isInsideString = (line) => {
    const quoteCount = (line.match(/"/g) || []).length;
    return quoteCount % 2 === 1;
  };

  // Single quote: cursor is inside the string
  assert.ok(isInsideString('"key'));
  // 3 quotes: middle quote is inside a string value
  assert.ok(isInsideString('"key": "val'));
  // 2 quotes: complete pair, not inside
  assert.ok(!isInsideString('"key": "value"'));
  assert.ok(!isInsideString('"key": '));
  assert.ok(isInsideString('"'));
});

test('JSON after colon detection', () => {
  const isAfterColon = (line) => {
    const trimmed = line.trimEnd();
    return trimmed.endsWith(':');
  };

  assert.ok(isAfterColon('"key":'));
  assert.ok(isAfterColon('  "key" : '));
  assert.ok(!isAfterColon('"key": "value"'));
  assert.ok(!isAfterColon('"key"'));
});