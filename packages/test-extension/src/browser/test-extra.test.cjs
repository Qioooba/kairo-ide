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
  TestRunner,
  parseJUnitXml,
  parseFailureLocation,
} = require('../../lib/browser/test-runner');

// ---- TestRunner: buildJavacCommand -----------------------------------------

test('TestRunner.buildJavacCommand builds basic command', () => {
  const runner = new TestRunner();
  const cmd = runner.buildJavacCommand([], ['FooTest.java'], 'out');
  assert.ok(cmd.includes('javac'));
  assert.ok(cmd.includes('-d'));
  assert.ok(cmd.includes('out'));
  assert.ok(cmd.includes('FooTest.java'));
});

test('TestRunner.buildJavacCommand includes source level', () => {
  const runner = new TestRunner();
  const cmd = runner.buildJavacCommand([], ['FooTest.java'], 'out', '1.6');
  assert.ok(cmd.includes('-source'));
  assert.ok(cmd.includes('1.6'));
  assert.ok(cmd.includes('-target'));
  assert.ok(cmd.includes('1.6'));
});

test('TestRunner.buildJavacCommand includes classpath', () => {
  const runner = new TestRunner();
  const cmd = runner.buildJavacCommand(['lib/a.jar', 'lib/b.jar'], ['FooTest.java'], 'out');
  assert.ok(cmd.includes('-cp'));
  assert.ok(cmd.some(a => a.includes('lib/a.jar') || a.includes('a.jar')));
  assert.ok(cmd.some(a => a.includes('lib/b.jar') || a.includes('b.jar')));
});

test('TestRunner.buildJavacCommand default source level is 1.6', () => {
  const runner = new TestRunner();
  const cmd = runner.buildJavacCommand([], ['FooTest.java'], 'out');
  assert.ok(cmd.includes('-source'));
  assert.ok(cmd.includes('1.6'));
});

test('TestRunner.buildJavacCommand custom source level', () => {
  const runner = new TestRunner();
  const cmd = runner.buildJavacCommand([], ['FooTest.java'], 'out', '1.8');
  assert.ok(cmd.includes('1.8'));
});

// ---- TestRunner: buildJavaRunCommand ---------------------------------------

test('TestRunner.buildJavaRunCommand for JUnit 4', () => {
  const runner = new TestRunner();
  const cmd = runner.buildJavaRunCommand(['out'], 'com.example.MyTest', 'junit4');
  assert.ok(cmd.includes('java'));
  assert.ok(cmd.includes('org.junit.runner.JUnitCore'));
  assert.ok(cmd.includes('com.example.MyTest'));
  assert.ok(cmd.some(a => a.includes('junit-4.jar')));
  assert.ok(cmd.some(a => a.includes('hamcrest-core.jar')));
});

test('TestRunner.buildJavaRunCommand for JUnit 3', () => {
  const runner = new TestRunner();
  const cmd = runner.buildJavaRunCommand(['out'], 'com.example.MyTest', 'junit3');
  assert.ok(cmd.includes('java'));
  assert.ok(cmd.includes('junit.textui.TestRunner'));
  assert.ok(cmd.includes('com.example.MyTest'));
  assert.ok(cmd.some(a => a.includes('junit.jar')));
});

test('TestRunner.buildJavaRunCommand includes classpath', () => {
  const runner = new TestRunner();
  const cmd = runner.buildJavaRunCommand(['out'], 'com.example.MyTest', 'junit4');
  assert.ok(cmd.includes('-cp'));
});

// ---- TestRunner: convertResults ---------------------------------------------

test('TestRunner.convertResults converts passed test case', () => {
  const runner = new TestRunner();
  const suites = [{
    name: 'com.example.MyTest',
    tests: 1,
    failures: 0,
    errors: 0,
    skipped: 0,
    time: 0.5,
    testCases: [{
      className: 'com.example.MyTest',
      name: 'testFoo',
      time: 0.5,
    }],
  }];
  const results = runner.convertResults(suites);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].testId, 'method:com.example.MyTest#testFoo');
  assert.strictEqual(results[0].status, 'passed');
  assert.strictEqual(results[0].durationMs, 500);
});

test('TestRunner.convertResults converts failed test case', () => {
  const runner = new TestRunner();
  const suites = [{
    name: 'com.example.MyTest',
    tests: 1,
    failures: 1,
    errors: 0,
    skipped: 0,
    time: 0.3,
    testCases: [{
      className: 'com.example.MyTest',
      name: 'testFail',
      time: 0.3,
      failure: {
        message: 'expected true but was false',
        type: 'AssertionError',
        stackTrace: ['at com.example.MyTest.testFail(MyTest.java:25)'],
      },
    }],
  }];
  const results = runner.convertResults(suites);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'failed');
  assert.strictEqual(results[0].failureMessage, 'expected true but was false');
  assert.ok(results[0].stackTrace);
});

test('TestRunner.convertResults converts skipped test case', () => {
  const runner = new TestRunner();
  const suites = [{
    name: 'com.example.MyTest',
    tests: 1,
    failures: 0,
    errors: 0,
    skipped: 1,
    time: 0,
    testCases: [{
      className: 'com.example.MyTest',
      name: 'testSkipped',
      time: 0,
      skipped: true,
    }],
  }];
  const results = runner.convertResults(suites);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'skipped');
});

test('TestRunner.convertResults converts error test case', () => {
  const runner = new TestRunner();
  const suites = [{
    name: 'com.example.MyTest',
    tests: 1,
    failures: 0,
    errors: 1,
    skipped: 0,
    time: 0.2,
    testCases: [{
      className: 'com.example.MyTest',
      name: 'testError',
      time: 0.2,
      error: {
        message: 'NullPointerException',
        type: 'java.lang.NullPointerException',
        stackTrace: ['at com.example.MyTest.testError(MyTest.java:42)'],
      },
    }],
  }];
  const results = runner.convertResults(suites);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'error');
  assert.strictEqual(results[0].failureMessage, 'NullPointerException');
});

test('TestRunner.convertResults handles multiple suites', () => {
  const runner = new TestRunner();
  const suites = [
    { name: 'A', tests: 1, failures: 0, errors: 0, skipped: 0, time: 0.1, testCases: [{ className: 'A', name: 'testA', time: 0.1 }] },
    { name: 'B', tests: 1, failures: 0, errors: 0, skipped: 0, time: 0.1, testCases: [{ className: 'B', name: 'testB', time: 0.1 }] },
  ];
  const results = runner.convertResults(suites);
  assert.strictEqual(results.length, 2);
});

test('TestRunner.convertResults handles empty suites', () => {
  const runner = new TestRunner();
  const results = runner.convertResults([]);
  assert.deepStrictEqual(results, []);
});

// ---- TestRunner: createTestRun ----------------------------------------------

test('TestRunner.createTestRun creates succeeded run', () => {
  const runner = new TestRunner();
  const results = [
    { testId: 'method:Test#testA', status: 'passed', durationMs: 100 },
    { testId: 'method:Test#testB', status: 'passed', durationMs: 50 },
  ];
  const run = runner.createTestRun('run-1', 'ws-1', 'prj-1', 'class', 'Test', results, 'output', '2024-01-01T00:00:00Z', '2024-01-01T00:00:05Z');
  assert.strictEqual(run.id, 'run-1');
  assert.strictEqual(run.state, 'succeeded');
  assert.strictEqual(run.totalCount, 2);
  assert.strictEqual(run.passedCount, 2);
  assert.strictEqual(run.failedCount, 0);
  assert.strictEqual(run.skippedCount, 0);
  assert.strictEqual(run.errorCount, 0);
});

test('TestRunner.createTestRun creates failed run', () => {
  const runner = new TestRunner();
  const results = [
    { testId: 'method:Test#testA', status: 'passed', durationMs: 100 },
    { testId: 'method:Test#testB', status: 'failed', durationMs: 50, failureMessage: 'error' },
  ];
  const run = runner.createTestRun('run-2', 'ws-1', 'prj-1', 'class', 'Test', results, 'output', '2024-01-01T00:00:00Z', '2024-01-01T00:00:05Z');
  assert.strictEqual(run.state, 'failed');
  assert.strictEqual(run.totalCount, 2);
  assert.strictEqual(run.passedCount, 1);
  assert.strictEqual(run.failedCount, 1);
});

test('TestRunner.createTestRun with errors counts as failed', () => {
  const runner = new TestRunner();
  const results = [
    { testId: 'method:Test#testA', status: 'error', durationMs: 100, failureMessage: 'NPE' },
  ];
  const run = runner.createTestRun('run-3', 'ws-1', 'prj-1', 'method', 'Test#testA', results, 'output', '2024-01-01T00:00:00Z', '2024-01-01T00:00:01Z');
  assert.strictEqual(run.state, 'failed');
  assert.strictEqual(run.errorCount, 1);
});

test('TestRunner.createTestRun with skipped', () => {
  const runner = new TestRunner();
  const results = [
    { testId: 'method:Test#testA', status: 'skipped', durationMs: 0 },
  ];
  const run = runner.createTestRun('run-4', 'ws-1', 'prj-1', 'method', 'Test#testA', results, 'output', '2024-01-01T00:00:00Z', '2024-01-01T00:00:01Z');
  assert.strictEqual(run.state, 'succeeded');
  assert.strictEqual(run.skippedCount, 1);
});

// ---- parseJUnitXml: more edge cases -----------------------------------------

test('parseJUnitXml handles XML with nested testsuites element', () => {
  const xml = `<testsuites>
<testsuite name="com.example.TestA" tests="1" failures="0" errors="0" skipped="0" time="0.1">
  <testcase classname="com.example.TestA" name="testA" time="0.1"></testcase>
</testsuite>
</testsuites>`;
  const suites = parseJUnitXml(xml);
  assert.strictEqual(suites.length, 1);
  assert.strictEqual(suites[0].name, 'com.example.TestA');
});

test('parseJUnitXml handles XML without suite name attribute', () => {
  const xml = `<testsuite tests="1" failures="0" errors="0" skipped="0" time="0">
  <testcase classname="Foo" name="bar" time="0"></testcase>
</testsuite>`;
  const suites = parseJUnitXml(xml);
  assert.strictEqual(suites.length, 1);
  assert.strictEqual(suites[0].name, 'unknown');
});

test('parseJUnitXml handles test case without classname', () => {
  const xml = `<testsuite name="test" tests="1" failures="0" errors="0" skipped="0" time="0">
  <testcase name="testFoo" time="0"></testcase>
</testsuite>`;
  const suites = parseJUnitXml(xml);
  assert.strictEqual(suites[0].testCases[0].className, '');
  assert.strictEqual(suites[0].testCases[0].name, 'testFoo');
});

test('parseJUnitXml handles failure with empty body', () => {
  const xml = `<testsuite name="test" tests="1" failures="1" errors="0" skipped="0" time="0">
  <testcase classname="Foo" name="bar" time="0">
    <failure message="error"></failure>
  </testcase>
</testsuite>`;
  const suites = parseJUnitXml(xml);
  const tc = suites[0].testCases[0];
  assert.ok(tc.failure);
  assert.strictEqual(tc.failure.stackTrace.length, 0);
});

test('parseJUnitXml handles error with empty body', () => {
  const xml = `<testsuite name="test" tests="1" failures="0" errors="1" skipped="0" time="0">
  <testcase classname="Foo" name="bar" time="0">
    <error message="error"></error>
  </testcase>
</testsuite>`;
  const suites = parseJUnitXml(xml);
  const tc = suites[0].testCases[0];
  assert.ok(tc.error);
  assert.strictEqual(tc.error.stackTrace.length, 0);
});

// ---- parseFailureLocation: more edge cases ----------------------------------

test('parseFailureLocation handles stack trace with multiple "at" lines', () => {
  const location = parseFailureLocation([
    'at com.example.TestA.testA(TestA.java:10)',
    'at com.example.TestB.testB(TestB.java:20)',
    'at com.example.TestC.testC(TestC.java:30)',
  ]);
  assert.ok(location);
  assert.strictEqual(location.file, 'TestA.java');
  assert.strictEqual(location.line, 10);
});

test('parseFailureLocation handles mixed at and non-at lines', () => {
  const location = parseFailureLocation([
    'java.lang.AssertionError: expected true',
    'at com.example.MyTest.testFoo(MyTest.java:15)',
    'at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)',
  ]);
  assert.ok(location);
  assert.strictEqual(location.file, 'MyTest.java');
  assert.strictEqual(location.line, 15);
});

test('parseFailureLocation handles non-at line with file:line', () => {
  const location = parseFailureLocation([
    'java.lang.AssertionError: expected true',
    'at com.example.MyTest.testFoo(Unknown Source)',
    'com.example.MyTest.testFoo(MyTest.java:15)',
  ]);
  assert.ok(location);
  assert.strictEqual(location.file, 'MyTest.java');
  assert.strictEqual(location.line, 15);
});

test('parseFailureLocation returns undefined for Unknown Source', () => {
  assert.strictEqual(parseFailureLocation(['at com.example.Foo.bar(Unknown Source)']), undefined);
});

test('parseFailureLocation returns undefined for Native Method', () => {
  assert.strictEqual(parseFailureLocation(['at com.example.Foo.bar(Native Method)']), undefined);
});

// ---- TestDiscoveryService: parseTestClass more edge cases -------------------

const { TestDiscoveryService } = require('../../lib/browser/test-discovery');

test('parseTestClass detects JUnit 4 with @Test and @Before', () => {
  const service = new TestDiscoveryService();
  const content = `import org.junit.Test;
import org.junit.Before;
public class MyTest {
  @Before
  public void setUp() {}
  @Test
  public void testFoo() {}
}`;
  const result = service.parseTestClass(content, '/test/MyTest.java');
  assert.ok(result);
  assert.strictEqual(result.framework, 'junit4');
  assert.strictEqual(result.methods.length, 1);
  assert.strictEqual(result.methods[0].name, 'testFoo');
});

test('parseTestClass detects JUnit 3 by naming convention only', () => {
  const service = new TestDiscoveryService();
  const content = `public class CompatibilityTest {
  public void testOldStyle() {
  }
  public void testAnotherOldStyle() {
  }
}`;
  const result = service.parseTestClass(content, '/test/CompatibilityTest.java');
  assert.ok(result);
  assert.strictEqual(result.framework, 'junit3');
  assert.strictEqual(result.methods.length, 2);
});

test('parseTestClass returns undefined for class with no test methods', () => {
  const service = new TestDiscoveryService();
  const content = `public class Helper {
  public void doSomething() {}
  public void doAnother() {}
}`;
  const result = service.parseTestClass(content, '/test/Helper.java');
  assert.strictEqual(result, undefined);
});

test('parseTestClass handles JUnit 4 with @Test annotation but no test prefix', () => {
  const service = new TestDiscoveryService();
  const content = `import org.junit.Test;
public class MyTest {
  @Test
  public void shouldDoSomething() {}
}`;
  const result = service.parseTestClass(content, '/test/MyTest.java');
  assert.ok(result);
  assert.strictEqual(result.framework, 'junit4');
  assert.strictEqual(result.methods.length, 1);
  assert.strictEqual(result.methods[0].name, 'shouldDoSomething');
});

test('parseTestClass handles JUnit 4 with multiple annotations', () => {
  const service = new TestDiscoveryService();
  const content = `import org.junit.Test;
public class MyTest {
  @Test(expected = IllegalArgumentException.class)
  public void testException() {}
  @Test(timeout = 1000)
  public void testTimeout() {}
}`;
  const result = service.parseTestClass(content, '/test/MyTest.java');
  assert.ok(result);
  assert.strictEqual(result.framework, 'junit4');
  assert.strictEqual(result.methods.length, 2);
});

// ---- TestDiscoveryService: extractPackage more cases ------------------------

test('extractPackage returns undefined for no package declaration', () => {
  const service = new TestDiscoveryService();
  assert.strictEqual(service.extractPackage('public class Foo {}'), undefined);
  assert.strictEqual(service.extractPackage(''), undefined);
});

test('extractPackage extracts nested package', () => {
  const service = new TestDiscoveryService();
  const result = service.extractPackage('package com.example.service.impl;\n\npublic class Foo {}');
  assert.strictEqual(result, 'com.example.service.impl');
});

// ---- TestDiscoveryService: filePathToClassName more cases -------------------

test('filePathToClassName handles Windows path', () => {
  const service = new TestDiscoveryService();
  const result = service.filePathToClassName(
    'C:\\workspace\\src\\test\\java\\com\\example\\MyTest.java',
    'MyTest',
  );
  assert.strictEqual(result, 'com.example.MyTest');
});

test('filePathToClassName handles src/test path', () => {
  const service = new TestDiscoveryService();
  const result = service.filePathToClassName(
    '/proj/src/test/java/com/example/MyTest.java',
    'MyTest',
  );
  assert.strictEqual(result, 'com.example.MyTest');
});

// ---- TestDiscoveryService: lineNumberOf more cases --------------------------

test('lineNumberOf handles empty string', () => {
  const service = new TestDiscoveryService();
  assert.strictEqual(service.lineNumberOf('', 0), 1);
});

test('lineNumberOf handles index at end of content', () => {
  const service = new TestDiscoveryService();
  const content = 'line1\nline2\n';
  assert.strictEqual(service.lineNumberOf(content, content.length), 3);
});

test('lineNumberOf with index beyond content', () => {
  const service = new TestDiscoveryService();
  const content = 'line1\nline2';
  assert.strictEqual(service.lineNumberOf(content, 999), 2);
});

// ---- TestStore: more data structure tests -----------------------------------

test('TestStore: getRuns returns empty array initially', () => {
  const { TestStore } = require('../../lib/browser/test-store');
  const store = new TestStore();
  assert.deepStrictEqual(store.getRuns(), []);
});

test('TestStore: getLatestRun returns undefined initially', () => {
  const { TestStore } = require('../../lib/browser/test-store');
  const store = new TestStore();
  assert.strictEqual(store.getLatestRun(), undefined);
});

test('TestStore: getItems returns empty array initially', () => {
  const { TestStore } = require('../../lib/browser/test-store');
  const store = new TestStore();
  assert.deepStrictEqual(store.getItems(), []);
});

test('TestStore: getRootItems returns empty array initially', () => {
  const { TestStore } = require('../../lib/browser/test-store');
  const store = new TestStore();
  assert.deepStrictEqual(store.getRootItems(), []);
});

test('TestStore: getChildren returns empty array for non-existent parent', () => {
  const { TestStore } = require('../../lib/browser/test-store');
  const store = new TestStore();
  assert.deepStrictEqual(store.getChildren('non-existent'), []);
});

test('TestStore: getItem returns undefined for non-existent', () => {
  const { TestStore } = require('../../lib/browser/test-store');
  const store = new TestStore();
  assert.strictEqual(store.getItem('non-existent'), undefined);
});

// ---- TestTreeContribution exports -------------------------------------------

test('TestTreeContribution is exported', () => {
  const { TestTreeContribution } = require('../../lib/browser/test-tree-contribution');
  assert.strictEqual(typeof TestTreeContribution, 'function');
});

test('TestTreeWidget is exported', () => {
  const { TestTreeWidget } = require('../../lib/browser/test-tree-widget');
  assert.strictEqual(typeof TestTreeWidget, 'function');
});

test('teardown', () => { disableJSDOM(); });