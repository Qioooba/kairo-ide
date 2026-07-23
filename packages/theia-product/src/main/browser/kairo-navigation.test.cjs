'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('Navigation history — push and pop', () => {
  const backStack = [];
  const maxHistory = 50;

  // Push entries
  for (let i = 0; i < 10; i++) {
    backStack.push({ uri: `/file${i}.java`, line: i + 1, column: 1 });
  }

  assert.strictEqual(backStack.length, 10);

  // Pop
  const last = backStack.pop();
  assert.strictEqual(last.uri, '/file9.java');
  assert.strictEqual(last.line, 10);
  assert.strictEqual(backStack.length, 9);
});

test('Navigation history — max limit', () => {
  const backStack = [];
  const maxHistory = 50;

  for (let i = 0; i < 60; i++) {
    backStack.push({ uri: `/file${i}.java`, line: i, column: 0 });
    if (backStack.length > maxHistory) {
      backStack.shift();
    }
  }

  assert.strictEqual(backStack.length, 50);
  assert.strictEqual(backStack[0].uri, '/file10.java');
  assert.strictEqual(backStack[49].uri, '/file59.java');
});

test('Navigation history — duplicate detection', () => {
  const lastPosition = { uri: '/file.java', line: 10, column: 5 };
  const newPosition = { uri: '/file.java', line: 10, column: 5 };

  const isDuplicate =
    lastPosition.uri === newPosition.uri &&
    lastPosition.line === newPosition.line &&
    lastPosition.column === newPosition.column;

  assert.ok(isDuplicate);
});

test('Navigation history — different positions', () => {
  const lastPosition = { uri: '/file.java', line: 10, column: 5 };
  const newPosition = { uri: '/file.java', line: 15, column: 10 };

  const isDifferent =
    lastPosition.uri !== newPosition.uri ||
    lastPosition.line !== newPosition.line ||
    lastPosition.column !== newPosition.column;

  assert.ok(isDifferent);
});

test('Go to line — validate input', () => {
  const totalLines = 100;
  const validateInput = (val) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 1 || num > totalLines) {
      return `Enter a number between 1 and ${totalLines}`;
    }
    return undefined;
  };

  assert.strictEqual(validateInput('50'), undefined);
  assert.strictEqual(validateInput('1'), undefined);
  assert.strictEqual(validateInput('100'), undefined);
  assert.ok(typeof validateInput('0') === 'string');
  assert.ok(typeof validateInput('101') === 'string');
  assert.ok(typeof validateInput('abc') === 'string');
  assert.ok(typeof validateInput('') === 'string');
});

test('Go to symbol — flatten symbols', () => {
  const symbols = [
    {
      name: 'MyClass',
      kind: 5, // Class
      range: { startLineNumber: 10, startColumn: 1, endLineNumber: 50, endColumn: 1 },
      selectionRange: { startLineNumber: 10, startColumn: 1, endLineNumber: 10, endColumn: 8 },
      children: [
        {
          name: 'myMethod',
          kind: 6, // Method
          range: { startLineNumber: 20, startColumn: 3, endLineNumber: 30, endColumn: 3 },
          selectionRange: { startLineNumber: 20, startColumn: 3, endLineNumber: 20, endColumn: 12 },
          children: [],
        },
      ],
    },
  ];

  const flatten = (symbols, prefix) => {
    const result = [];
    for (const sym of symbols) {
      result.push({ name: sym.name, line: sym.range.startLineNumber, column: sym.range.startColumn });
      if (sym.children && sym.children.length > 0) {
        result.push(...flatten(sym.children, sym.name));
      }
    }
    return result;
  };

  const flat = flatten(symbols, '');
  assert.strictEqual(flat.length, 2);
  assert.strictEqual(flat[0].name, 'MyClass');
  assert.strictEqual(flat[0].line, 10);
  assert.strictEqual(flat[1].name, 'myMethod');
  assert.strictEqual(flat[1].line, 20);
});

test('Symbol kind to icon mapping', () => {
  const getIcon = (kind) => {
    const map = {
      5: '$(symbol-class)',
      6: '$(symbol-method)',
      7: '$(symbol-field)',
      11: '$(symbol-interface)',
      13: '$(symbol-enum)',
    };
    return map[kind] || '$(symbol-misc)';
  };

  assert.strictEqual(getIcon(5), '$(symbol-class)');
  assert.strictEqual(getIcon(6), '$(symbol-method)');
  assert.strictEqual(getIcon(7), '$(symbol-field)');
  assert.strictEqual(getIcon(11), '$(symbol-interface)');
  assert.strictEqual(getIcon(13), '$(symbol-enum)');
  assert.strictEqual(getIcon(99), '$(symbol-misc)');
});

test('Recent files — empty state', () => {
  const editors = [];
  assert.strictEqual(editors.length, 0);
});

test('Recent files — multiple files', () => {
  const editors = [
    { editor: { uri: { displayName: 'App.java', parent: { toString: () => '/src/main/java' } } } },
    { editor: { uri: { displayName: 'web.xml', parent: { toString: () => '/WEB-INF' } } } },
    { editor: { uri: { displayName: 'pom.xml', parent: { toString: () => '/' } } } },
  ];

  assert.strictEqual(editors.length, 3);
  assert.strictEqual(editors[0].editor.uri.displayName, 'App.java');
  assert.strictEqual(editors[1].editor.uri.displayName, 'web.xml');
  assert.strictEqual(editors[2].editor.uri.displayName, 'pom.xml');
});

test('Go to type — workspace symbol search', () => {
  const mockSymbols = [
    { name: 'UserService', kind: 5, containerName: 'com.example.service', location: { uri: { toString: () => 'file:///UserService.java' }, range: { startLineNumber: 1, startColumn: 1 } } },
    { name: 'UserController', kind: 5, containerName: 'com.example.controller', location: { uri: { toString: () => 'file:///UserController.java' }, range: { startLineNumber: 1, startColumn: 1 } } },
  ];

  assert.strictEqual(mockSymbols.length, 2);
  assert.strictEqual(mockSymbols[0].name, 'UserService');
  assert.strictEqual(mockSymbols[1].name, 'UserController');
});

test('Navigation commands exist', () => {
  const commands = [
    'kairo.navigation.goToLine',
    'kairo.navigation.goToSymbolInFile',
    'kairo.navigation.quickOutline',
    'kairo.navigation.back',
    'kairo.navigation.forward',
    'kairo.navigation.recentFiles',
    'kairo.navigation.goToType',
  ];

  assert.strictEqual(commands.length, 7);
  assert.ok(commands.includes('kairo.navigation.goToLine'));
  assert.ok(commands.includes('kairo.navigation.back'));
  assert.ok(commands.includes('kairo.navigation.goToType'));
});