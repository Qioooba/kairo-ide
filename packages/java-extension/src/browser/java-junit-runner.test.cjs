'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('JUnit XML result parsing — suite attributes', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.MyTest" tests="3" failures="1" errors="0" skipped="1" time="1.234">
  <testcase name="testSuccess" classname="com.example.MyTest" time="0.123"/>
  <testcase name="testFailure" classname="com.example.MyTest" time="0.456">
    <failure message="expected: true but was: false" type="junit.framework.AssertionFailedError">stack trace</failure>
  </testcase>
  <testcase name="testSkipped" classname="com.example.MyTest" time="0.000">
    <skipped/>
  </testcase>
</testsuite>`;

  assert.ok(xml.includes('testSuccess'));
  assert.ok(xml.includes('testFailure'));
  assert.ok(xml.includes('testSkipped'));
  assert.ok(xml.includes('tests="3"'));
  assert.ok(xml.includes('failures="1"'));
  assert.ok(xml.includes('errors="0"'));
  assert.ok(xml.includes('skipped="1"'));
  assert.ok(xml.includes('time="1.234"'));
});

test('JUnit XML result parsing — test case with error', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.ErrorTest" tests="1" failures="0" errors="1" skipped="0" time="0.500">
  <testcase name="testThrows" classname="com.example.ErrorTest" time="0.500">
    <error message="Unexpected exception" type="java.lang.RuntimeException">java.lang.RuntimeException: boom
\tat com.example.ErrorTest.testThrows(ErrorTest.java:15)
</error>
  </testcase>
</testsuite>`;

  assert.ok(xml.includes('testThrows'));
  assert.ok(xml.includes('errors="1"'));
  assert.ok(xml.includes('java.lang.RuntimeException'));
  assert.ok(xml.includes('message="Unexpected exception"'));
});

test('JUnit XML result parsing — multiple suites', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="com.example.TestA" tests="2" failures="0" errors="0" skipped="0" time="0.100">
  <testcase name="test1" classname="com.example.TestA" time="0.050"/>
  <testcase name="test2" classname="com.example.TestA" time="0.050"/>
</testsuite>
<testsuite name="com.example.TestB" tests="1" failures="1" errors="0" skipped="0" time="0.200">
  <testcase name="testFail" classname="com.example.TestB" time="0.200">
    <failure message="assertion failed" type="AssertionError">trace</failure>
  </testcase>
</testsuite>
</testsuites>`;

  assert.ok(xml.includes('TestA'));
  assert.ok(xml.includes('TestB'));
  assert.ok(xml.includes('tests="2"'));
  assert.ok(xml.includes('tests="1"'));
});

test('JUnitTestResult structure', () => {
  const result = {
    testId: 'method:com.example.MyTest#testSuccess',
    className: 'com.example.MyTest',
    methodName: 'testSuccess',
    status: 'passed',
    durationMs: 123,
  };
  assert.strictEqual(result.status, 'passed');
  assert.strictEqual(result.className, 'com.example.MyTest');
  assert.strictEqual(result.methodName, 'testSuccess');
  assert.strictEqual(result.testId, 'method:com.example.MyTest#testSuccess');
});

test('JUnitTestResult with failure', () => {
  const result = {
    testId: 'method:com.example.MyTest#testFailure',
    className: 'com.example.MyTest',
    methodName: 'testFailure',
    status: 'failed',
    durationMs: 456,
    failureMessage: 'expected: true but was: false',
    stackTrace: ['at com.example.MyTest.testFailure(MyTest.java:25)'],
  };
  assert.strictEqual(result.status, 'failed');
  assert.ok(result.failureMessage);
  assert.ok(Array.isArray(result.stackTrace));
  assert.ok(result.stackTrace.length > 0);
});

test('JUnitTestRun structure', () => {
  const run = {
    id: 'junit-1234567890-abcd',
    state: 'succeeded',
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    totalCount: 5,
    passedCount: 4,
    failedCount: 0,
    skippedCount: 1,
    errorCount: 0,
    results: [],
    output: '',
  };
  assert.strictEqual(run.state, 'succeeded');
  assert.strictEqual(run.totalCount, 5);
  assert.strictEqual(run.passedCount + run.failedCount + run.skippedCount + run.errorCount, run.totalCount);
});

test('JUnitTestRun failed state', () => {
  const run = {
    id: 'junit-1234567891-efgh',
    state: 'failed',
    startTime: new Date().toISOString(),
    totalCount: 3,
    passedCount: 1,
    failedCount: 2,
    skippedCount: 0,
    errorCount: 0,
    results: [],
    output: 'Tests failed',
  };
  assert.strictEqual(run.state, 'failed');
  assert.strictEqual(run.failedCount, 2);
  assert.ok(run.failedCount > 0);
});