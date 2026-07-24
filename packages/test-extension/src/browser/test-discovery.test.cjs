'use strict';

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert');

const {
  TestDiscoveryService,
} = require('../../lib/browser/test-discovery');

// ---- parseTestClass --------------------------------------------------------

test('parseTestClass detects JUnit 4 test class with @Test annotation', () => {
  const service = new TestDiscoveryService();
  const content = `package com.example;
import org.junit.Test;
import static org.junit.Assert.*;

public class MyTest {
  @Test
  public void testFoo() {
    assertEquals(1, 1);
  }

  @Test
  public void testBar() {
    assertTrue(true);
  }
}`;

  const result = service.parseTestClass(content, '/src/test/MyTest.java');
  assert.ok(result);
  assert.strictEqual(result.simpleName, 'MyTest');
  assert.strictEqual(result.framework, 'junit4');
  assert.strictEqual(result.methods.length, 2);
  const names = result.methods.map(m => m.name);
  assert.ok(names.includes('testFoo'));
  assert.ok(names.includes('testBar'));
});

test('parseTestClass detects JUnit 3 test class with extends TestCase', () => {
  const service = new TestDiscoveryService();
  const content = `package com.example;
import junit.framework.TestCase;

public class MyTest extends TestCase {
  public void testSomething() {
    assertEquals(1, 1);
  }

  public void testAnother() {
    assertTrue(true);
  }
}`;

  const result = service.parseTestClass(content, '/src/test/MyTest.java');
  assert.ok(result);
  assert.strictEqual(result.simpleName, 'MyTest');
  assert.strictEqual(result.framework, 'junit3');
  assert.strictEqual(result.methods.length, 2);
});

test('parseTestClass detects JUnit 3 test class by naming convention', () => {
  const service = new TestDiscoveryService();
  const content = `public class MyTest {
  public void testMethodA() {
  }
  public void testMethodB() {
  }
}`;

  const result = service.parseTestClass(content, '/test/MyTest.java');
  assert.ok(result);
  assert.strictEqual(result.framework, 'junit3');
  assert.strictEqual(result.methods.length, 2);
});

test('parseTestClass returns undefined for non-test class', () => {
  const service = new TestDiscoveryService();
  const content = `public class MyService {
  public void doSomething() {
  }
}`;

  const result = service.parseTestClass(content, '/src/MyService.java');
  assert.strictEqual(result, undefined);
});

test('parseTestClass handles JUnit 4 import via wildcard', () => {
  const service = new TestDiscoveryService();
  const content = `import org.junit.*;
public class MyTest {
  @Test
  public void testFoo() {}
}`;

  const result = service.parseTestClass(content, '/test/MyTest.java');
  assert.ok(result);
  assert.strictEqual(result.framework, 'junit4');
});

test('parseTestClass handles JUnit 3 import via wildcard', () => {
  const service = new TestDiscoveryService();
  const content = `import junit.framework.*;
public class MyTest extends TestCase {
  public void testFoo() {}
}`;

  const result = service.parseTestClass(content, '/test/MyTest.java');
  assert.ok(result);
  assert.strictEqual(result.framework, 'junit3');
});

test('parseTestClass deduplicates method names', () => {
  const service = new TestDiscoveryService();
  const content = `public class MyTest {
  public void testFoo() {}
  public void testFoo() {}
}`;

  const result = service.parseTestClass(content, '/test/MyTest.java');
  assert.ok(result);
  assert.strictEqual(result.methods.length, 1);
});

test('parseTestClass returns line numbers', () => {
  const service = new TestDiscoveryService();
  const content = `package com.example;

public class MyTest {
  public void testFoo() {
  }
}`;

  const result = service.parseTestClass(content, '/test/MyTest.java');
  assert.ok(result);
  assert.ok(result.classLine > 0);
  assert.ok(result.methods[0].line > 0);
});

// ---- extractPackage --------------------------------------------------------

test('extractPackage extracts package name from Java source', () => {
  const service = new TestDiscoveryService();
  assert.strictEqual(service.extractPackage('package com.example;'), 'com.example');
  assert.strictEqual(service.extractPackage('package com.example.test;\n\npublic class Foo {}'), 'com.example.test');
  assert.strictEqual(service.extractPackage('public class Foo {}'), undefined);
});

// ---- filePathToClassName ---------------------------------------------------

test('filePathToClassName derives class name from src/test/java structure', () => {
  const service = new TestDiscoveryService();
  const result = service.filePathToClassName(
    '/workspace/src/test/java/com/example/MyTest.java',
    'MyTest',
  );
  assert.strictEqual(result, 'com.example.MyTest');
});

test('filePathToClassName falls back to simple name', () => {
  const service = new TestDiscoveryService();
  const result = service.filePathToClassName(
    '/random/path/MyTest.java',
    'MyTest',
  );
  assert.strictEqual(result, 'MyTest');
});

// ---- lineNumberOf ----------------------------------------------------------

test('lineNumberOf returns correct line numbers', () => {
  const service = new TestDiscoveryService();
  const content = 'line1\nline2\nline3\nline4';
  assert.strictEqual(service.lineNumberOf(content, 0), 1);
  assert.strictEqual(service.lineNumberOf(content, 6), 2);
  assert.strictEqual(service.lineNumberOf(content, 12), 3);
});

// ---- discoverFromSources ---------------------------------------------------

test('discoverFromSources builds hierarchical tree from source files', () => {
  const service = new TestDiscoveryService();
  const store = {
    updateItems: (items) => {
      storedItems = items;
    },
  };
  service.store = store;

  let storedItems = [];
  const sources = new Map();
  sources.set('/src/test/java/com/example/MyTest.java', `package com.example;
import org.junit.Test;
public class MyTest {
  @Test
  public void testFoo() {}
}`);

  service.discoverFromSources(sources);

  assert.ok(storedItems.length > 0);
  const pkg = storedItems.find(i => i.kind === 'package');
  assert.ok(pkg);
  assert.strictEqual(pkg.label, 'com.example');
  const cls = storedItems.find(i => i.kind === 'class');
  assert.ok(cls);
  assert.strictEqual(cls.label, 'MyTest');
  const method = storedItems.find(i => i.kind === 'method');
  assert.ok(method);
  assert.strictEqual(method.label, 'testFoo');
});

test('discoverFromSources skips non-Java files', () => {
  const service = new TestDiscoveryService();
  const store = {
    updateItems: (items) => {
      storedItems = items;
    },
  };
  service.store = store;

  let storedItems = [];
  const sources = new Map();
  sources.set('/src/test/java/com/example/MyTest.kt', 'public class MyTest { public void testFoo() {} }');

  service.discoverFromSources(sources);
  assert.deepStrictEqual(storedItems, []);
});

test('discoverFromSources uses (default) package when no package declared', () => {
  const service = new TestDiscoveryService();
  const store = {
    updateItems: (items) => {
      storedItems = items;
    },
  };
  service.store = store;

  let storedItems = [];
  const sources = new Map();
  sources.set('/src/test/MyTest.java', `public class MyTest {
  public void testFoo() {}
}`);

  service.discoverFromSources(sources);
  const pkg = storedItems.find(i => i.kind === 'package');
  assert.ok(pkg);
  assert.strictEqual(pkg.label, '(default)');
});