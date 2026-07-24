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
  parseJUnitXml,
  parseFailureLocation,
} = require('../../lib/browser/test-runner');

// ---- parseJUnitXml --------------------------------------------------------

test('parseJUnitXml parses a single test suite with passed, failed, skipped, and error cases', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.MyTest" tests="4" failures="1" errors="1" skipped="1" time="1.234">
  <testcase classname="com.example.MyTest" name="testPass" time="0.1"></testcase>
  <testcase classname="com.example.MyTest" name="testFail" time="0.2">
    <failure message="expected:&lt;true&gt; but was:&lt;false&gt;" type="junit.framework.AssertionFailedError">
      at com.example.MyTest.testFail(MyTest.java:25)
    </failure>
  </testcase>
  <testcase classname="com.example.MyTest" name="testSkipped" time="0.0">
    <skipped/>
  </testcase>
  <testcase classname="com.example.MyTest" name="testError" time="0.3">
    <error message="NullPointerException" type="java.lang.NullPointerException">
      at com.example.MyTest.testError(MyTest.java:42)
    </error>
  </testcase>
</testsuite>`;

  const suites = parseJUnitXml(xml);
  assert.strictEqual(suites.length, 1);
  const suite = suites[0];
  assert.strictEqual(suite.name, 'com.example.MyTest');
  assert.strictEqual(suite.tests, 4);
  assert.strictEqual(suite.failures, 1);
  assert.strictEqual(suite.errors, 1);
  assert.strictEqual(suite.skipped, 1);
  assert.strictEqual(suite.testCases.length, 4);

  const [pass, fail, skip, error] = suite.testCases;
  assert.strictEqual(pass.className, 'com.example.MyTest');
  assert.strictEqual(pass.name, 'testPass');
  assert.strictEqual(pass.time, 0.1);
  assert.strictEqual(pass.failure, undefined);
  assert.strictEqual(pass.skipped, undefined);

  assert.strictEqual(fail.name, 'testFail');
  assert.ok(fail.failure);
  assert.strictEqual(fail.failure.message, 'expected:&lt;true&gt; but was:&lt;false&gt;');
  assert.strictEqual(fail.failure.type, 'junit.framework.AssertionFailedError');
  assert.ok(fail.failure.stackTrace.length > 0);

  assert.strictEqual(skip.name, 'testSkipped');
  assert.strictEqual(skip.skipped, true);

  assert.strictEqual(error.name, 'testError');
  assert.ok(error.error);
  assert.strictEqual(error.error.message, 'NullPointerException');
  assert.strictEqual(error.error.type, 'java.lang.NullPointerException');
});

test('parseJUnitXml handles multiple test suites', () => {
  const xml = `<testsuites>
<testsuite name="com.example.TestA" tests="1" failures="0" errors="0" skipped="0" time="0.5">
  <testcase classname="com.example.TestA" name="testA" time="0.5"></testcase>
</testsuite>
<testsuite name="com.example.TestB" tests="2" failures="0" errors="0" skipped="0" time="0.3">
  <testcase classname="com.example.TestB" name="testB1" time="0.1"></testcase>
  <testcase classname="com.example.TestB" name="testB2" time="0.2"></testcase>
</testsuite>
</testsuites>`;

  const suites = parseJUnitXml(xml);
  assert.strictEqual(suites.length, 2);
  assert.strictEqual(suites[0].name, 'com.example.TestA');
  assert.strictEqual(suites[0].testCases.length, 1);
  assert.strictEqual(suites[1].name, 'com.example.TestB');
  assert.strictEqual(suites[1].testCases.length, 2);
});

test('parseJUnitXml returns empty array for empty input', () => {
  assert.deepStrictEqual(parseJUnitXml(''), []);
  assert.deepStrictEqual(parseJUnitXml('<root/>'), []);
});

test('parseJUnitXml handles missing attributes with defaults', () => {
  const xml = `<testsuite name="test" tests="1" failures="0" errors="0" skipped="0" time="0">
  <testcase classname="Foo" name="bar" time="0"></testcase>
</testsuite>`;

  const suites = parseJUnitXml(xml);
  assert.strictEqual(suites[0].tests, 1);
  assert.strictEqual(suites[0].failures, 0);
  assert.strictEqual(suites[0].errors, 0);
  assert.strictEqual(suites[0].skipped, 0);
  assert.strictEqual(suites[0].time, 0);
});

test('parseJUnitXml handles failure without message attribute', () => {
  const xml = `<testsuite name="test" tests="1" failures="1" errors="0" skipped="0" time="0">
  <testcase classname="Foo" name="bar" time="0">
    <failure>raw error text</failure>
  </testcase>
</testsuite>`;

  const suites = parseJUnitXml(xml);
  const tc = suites[0].testCases[0];
  assert.ok(tc.failure);
  assert.strictEqual(tc.failure.message, 'Test failed');
});

test('parseJUnitXml handles error without message attribute', () => {
  const xml = `<testsuite name="test" tests="1" failures="0" errors="1" skipped="0" time="0">
  <testcase classname="Foo" name="bar" time="0">
    <error>raw error text</error>
  </testcase>
</testsuite>`;

  const suites = parseJUnitXml(xml);
  const tc = suites[0].testCases[0];
  assert.ok(tc.error);
  assert.strictEqual(tc.error.message, 'Test error');
});

// ---- parseFailureLocation -------------------------------------------------

test('parseFailureLocation extracts file and line from "at" stack trace', () => {
  const location = parseFailureLocation([
    'at com.example.MyTest.testFoo(MyTest.java:25)',
    'at sun.reflect.NativeMethodAccessorImpl.invoke(NativeMethodAccessorImpl.java:62)',
  ]);
  assert.ok(location);
  assert.strictEqual(location.file, 'MyTest.java');
  assert.strictEqual(location.line, 25);
});

test('parseFailureLocation extracts file and line from non-"at" stack trace', () => {
  const location = parseFailureLocation([
    'com.example.MyTest.testFoo(MyTest.java:100)',
  ]);
  assert.ok(location);
  assert.strictEqual(location.file, 'MyTest.java');
  assert.strictEqual(location.line, 100);
});

test('parseFailureLocation returns undefined when no location found', () => {
  assert.strictEqual(parseFailureLocation([]), undefined);
  assert.strictEqual(parseFailureLocation(['no location here']), undefined);
  assert.strictEqual(parseFailureLocation(['at com.example.MyTest.testFoo(Unknown Source)']), undefined);
});

test('parseFailureLocation extracts first matching location', () => {
  const location = parseFailureLocation([
    'at com.example.TestA.testA(TestA.java:10)',
    'at com.example.TestB.testB(TestB.java:20)',
  ]);
  assert.ok(location);
  assert.strictEqual(location.file, 'TestA.java');
  assert.strictEqual(location.line, 10);
});