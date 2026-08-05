'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Mirror of parseJUnitXml from java-junit-runner.ts (pure, no Theia). */
function parseJUnitXml(xml) {
  if (!xml || typeof xml !== 'string') {
    throw new Error('Invalid XML input: empty or non-string');
  }
  const suites = [];
  const suiteRegex = /<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g;
  let suiteMatch;
  while ((suiteMatch = suiteRegex.exec(xml)) !== null) {
    const attrs = suiteMatch[1];
    const body = suiteMatch[2];
    const attrValue = (a, name) => {
      const m = a.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
      return m ? m[1] : undefined;
    };
    const suite = {
      name: attrValue(attrs, 'name') ?? 'unknown',
      testCases: [],
    };
    const caseRegex = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let caseMatch;
    while ((caseMatch = caseRegex.exec(body)) !== null) {
      const caseAttrs = caseMatch[1];
      const caseBody = caseMatch[2] ?? '';
      const tc = {
        className: attrValue(caseAttrs, 'classname') ?? '',
        name: attrValue(caseAttrs, 'name') ?? '',
        time: parseFloat(attrValue(caseAttrs, 'time') ?? '0'),
      };
      if (/<failure\b/.test(caseBody)) tc.failure = true;
      if (/<skipped\s*\/?>/.test(caseBody)) tc.skipped = true;
      suite.testCases.push(tc);
    }
    suites.push(suite);
  }
  return suites;
}

test('parseJUnitXml counts self-closing passed testcases (JV-P1-8)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.MyTest" tests="3" failures="1" errors="0" skipped="1" time="1.234">
  <testcase name="testSuccess" classname="com.example.MyTest" time="0.123"/>
  <testcase name="testFailure" classname="com.example.MyTest" time="0.456">
    <failure message="expected: true but was: false" type="junit.framework.AssertionFailedError">stack</failure>
  </testcase>
  <testcase name="testSkipped" classname="com.example.MyTest" time="0.000">
    <skipped/>
  </testcase>
</testsuite>`;
  const suites = parseJUnitXml(xml);
  assert.equal(suites.length, 1);
  assert.equal(suites[0].testCases.length, 3);
  assert.equal(suites[0].testCases[0].name, 'testSuccess');
  assert.equal(suites[0].testCases[0].failure, undefined);
  assert.ok(suites[0].testCases[1].failure);
  assert.equal(suites[0].testCases[2].skipped, true);
});

test('JUnit classpath separator is platform-correct and uses JUnitCore (JV-P1-8)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'java-junit-runner.ts'), 'utf8');
  assert.match(src, /org\.junit\.runner\.JUnitCore/);
  assert.match(src, /process\.platform === ['"]win32['"] \? [';"]/);
  assert.doesNotMatch(src, /target\/test-classes:target\/classes/);
});

test('extractClassNameFromPath normalizes Windows backslashes (JV-P1-8)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'java-junit-runner.ts'), 'utf8');
  assert.match(src, /replace\(\/\\\\\/g/);
});
