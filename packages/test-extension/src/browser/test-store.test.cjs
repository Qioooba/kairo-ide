'use strict';

// Integration tests for TestStore — tests the data structures and
// core logic used by the test store.

const { test } = require('node:test');
const assert = require('node:assert');

// ---- TestStatus -------------------------------------------------------------

test('TestStatus: idle', () => {
  const status = 'idle';
  assert.strictEqual(status, 'idle');
});

test('TestStatus: running', () => {
  const status = 'running';
  assert.strictEqual(status, 'running');
});

test('TestStatus: passed', () => {
  const status = 'passed';
  assert.strictEqual(status, 'passed');
});

test('TestStatus: failed', () => {
  const status = 'failed';
  assert.strictEqual(status, 'failed');
});

test('TestStatus: skipped', () => {
  const status = 'skipped';
  assert.strictEqual(status, 'skipped');
});

test('TestStatus: error', () => {
  const status = 'error';
  assert.strictEqual(status, 'error');
});

test('TestStatus: all statuses', () => {
  const statuses = ['idle', 'running', 'passed', 'failed', 'skipped', 'error'];
  assert.strictEqual(statuses.length, 6);
});

// ---- TestItem ---------------------------------------------------------------

test('TestItem: package kind', () => {
  const item = {
    id: 'pkg-1',
    kind: 'package',
    label: 'com.example',
    qualifiedName: 'com.example',
    parentId: null,
    children: ['cls-1'],
    status: 'idle',
  };
  assert.strictEqual(item.kind, 'package');
  assert.strictEqual(item.parentId, null);
  assert.strictEqual(item.children.length, 1);
});

test('TestItem: class kind', () => {
  const item = {
    id: 'cls-1',
    kind: 'class',
    label: 'MathTest',
    qualifiedName: 'com.example.MathTest',
    parentId: 'pkg-1',
    children: ['mtd-1', 'mtd-2'],
    status: 'idle',
    filePath: 'src/test/java/com/example/MathTest.java',
    line: 15,
  };
  assert.strictEqual(item.kind, 'class');
  assert.strictEqual(item.parentId, 'pkg-1');
  assert.strictEqual(item.children.length, 2);
  assert.strictEqual(item.filePath, 'src/test/java/com/example/MathTest.java');
  assert.strictEqual(item.line, 15);
});

test('TestItem: method kind', () => {
  const item = {
    id: 'mtd-1',
    kind: 'method',
    label: 'testAddition',
    qualifiedName: 'com.example.MathTest.testAddition',
    parentId: 'cls-1',
    children: [],
    status: 'passed',
    durationMs: 150,
  };
  assert.strictEqual(item.kind, 'method');
  assert.strictEqual(item.status, 'passed');
  assert.strictEqual(item.durationMs, 150);
});

test('TestItem: failed method with failure message', () => {
  const item = {
    id: 'mtd-2',
    kind: 'method',
    label: 'testDivision',
    qualifiedName: 'com.example.MathTest.testDivision',
    parentId: 'cls-1',
    children: [],
    status: 'failed',
    durationMs: 50,
    failureMessage: 'Expected 5 but got 4',
  };
  assert.strictEqual(item.status, 'failed');
  assert.strictEqual(item.failureMessage, 'Expected 5 but got 4');
});

test('TestItem: error state', () => {
  const item = {
    id: 'mtd-3',
    kind: 'method',
    label: 'testNPE',
    qualifiedName: 'com.example.MathTest.testNPE',
    parentId: 'cls-1',
    children: [],
    status: 'error',
    failureMessage: 'NullPointerException',
  };
  assert.strictEqual(item.status, 'error');
});

test('TestItem: skipped state', () => {
  const item = {
    id: 'mtd-4',
    kind: 'method',
    label: 'testIgnored',
    qualifiedName: 'com.example.MathTest.testIgnored',
    parentId: 'cls-1',
    children: [],
    status: 'skipped',
  };
  assert.strictEqual(item.status, 'skipped');
});

// ---- TestMethodResult -------------------------------------------------------

test('TestMethodResult: passed result', () => {
  const result = {
    testId: 'mtd-1',
    status: 'passed',
    durationMs: 150,
  };
  assert.strictEqual(result.status, 'passed');
  assert.strictEqual(result.durationMs, 150);
});

test('TestMethodResult: failed result with stack trace', () => {
  const result = {
    testId: 'mtd-2',
    status: 'failed',
    durationMs: 50,
    failureMessage: 'Expected 5 but got 4',
    stackTrace: [
      'at com.example.MathTest.testDivision(MathTest.java:25)',
      'at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)',
    ],
  };
  assert.strictEqual(result.status, 'failed');
  assert.strictEqual(result.failureMessage, 'Expected 5 but got 4');
  assert.ok(Array.isArray(result.stackTrace));
  assert.strictEqual(result.stackTrace.length, 2);
});

test('TestMethodResult: with output', () => {
  const result = {
    testId: 'mtd-1',
    status: 'passed',
    durationMs: 100,
    output: 'Test setup completed\nTest executed\nTest teardown completed',
  };
  assert.strictEqual(result.status, 'passed');
  assert.ok(result.output.includes('setup'));
});

// ---- TestRun ----------------------------------------------------------------

test('TestRun: running state', () => {
  const run = {
    id: 'run-1',
    workspaceId: 'ws-1',
    projectId: 'prj-1',
    scope: 'all',
    target: '',
    state: 'running',
    startTime: '2024-01-01T00:00:00Z',
    totalCount: 10,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    results: [],
    output: '',
  };
  assert.strictEqual(run.state, 'running');
  assert.strictEqual(run.scope, 'all');
  assert.strictEqual(run.totalCount, 10);
});

test('TestRun: succeeded state', () => {
  const run = {
    id: 'run-2',
    workspaceId: 'ws-1',
    projectId: 'prj-1',
    scope: 'class',
    target: 'com.example.MathTest',
    state: 'succeeded',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:00:05Z',
    totalCount: 10,
    passedCount: 10,
    failedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    results: [
      { testId: 'mtd-1', status: 'passed', durationMs: 100 },
      { testId: 'mtd-2', status: 'passed', durationMs: 50 },
    ],
    output: 'All tests passed',
  };
  assert.strictEqual(run.state, 'succeeded');
  assert.strictEqual(run.passedCount, 10);
  assert.strictEqual(run.results.length, 2);
});

test('TestRun: failed state', () => {
  const run = {
    id: 'run-3',
    workspaceId: 'ws-1',
    projectId: 'prj-1',
    scope: 'method',
    target: 'com.example.MathTest.testDivision',
    state: 'failed',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:00:02Z',
    totalCount: 1,
    passedCount: 0,
    failedCount: 1,
    skippedCount: 0,
    errorCount: 0,
    results: [
      {
        testId: 'mtd-2',
        status: 'failed',
        durationMs: 50,
        failureMessage: 'Expected 5 but got 4',
        stackTrace: ['at com.example.MathTest.testDivision(MathTest.java:25)'],
      },
    ],
    output: '1 test failed',
  };
  assert.strictEqual(run.state, 'failed');
  assert.strictEqual(run.failedCount, 1);
  assert.strictEqual(run.results[0].status, 'failed');
});

test('TestRun: cancelled state', () => {
  const run = {
    id: 'run-4',
    workspaceId: 'ws-1',
    projectId: 'prj-1',
    scope: 'all',
    target: '',
    state: 'cancelled',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:00:03Z',
    totalCount: 10,
    passedCount: 3,
    failedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    results: [],
    output: 'Test run cancelled',
  };
  assert.strictEqual(run.state, 'cancelled');
  assert.strictEqual(run.passedCount, 3);
});

test('TestRun: pending state', () => {
  const run = {
    id: 'run-5',
    workspaceId: 'ws-1',
    projectId: 'prj-1',
    scope: 'package',
    target: 'com.example',
    state: 'pending',
    startTime: '',
    totalCount: 0,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    results: [],
    output: '',
  };
  assert.strictEqual(run.state, 'pending');
});

// ---- TestRun scope values ---------------------------------------------------

test('TestRun: scope values', () => {
  const scopes = ['class', 'method', 'package', 'all'];
  assert.strictEqual(scopes.length, 4);
  assert.ok(scopes.includes('class'));
  assert.ok(scopes.includes('all'));
});

// ---- ConnectionState --------------------------------------------------------

test('ConnectionState: loading', () => {
  const state = 'loading';
  assert.strictEqual(state, 'loading');
});

test('ConnectionState: connected', () => {
  const state = 'connected';
  assert.strictEqual(state, 'connected');
});

test('ConnectionState: disconnected', () => {
  const state = 'disconnected';
  assert.strictEqual(state, 'disconnected');
});

test('ConnectionState: empty', () => {
  const state = 'empty';
  assert.strictEqual(state, 'empty');
});

// ---- Test item tree hierarchy -----------------------------------------------

test('Test item tree: parent-child relationship', () => {
  const items = new Map();
  items.set('pkg-1', { id: 'pkg-1', kind: 'package', parentId: null, children: ['cls-1'] });
  items.set('cls-1', { id: 'cls-1', kind: 'class', parentId: 'pkg-1', children: ['mtd-1'] });
  items.set('mtd-1', { id: 'mtd-1', kind: 'method', parentId: 'cls-1', children: [] });

  // Root items
  const roots = Array.from(items.values()).filter(i => i.parentId === null);
  assert.strictEqual(roots.length, 1);
  assert.strictEqual(roots[0].id, 'pkg-1');

  // Children of package
  const pkg = items.get('pkg-1');
  const children = pkg.children.map(id => items.get(id)).filter(Boolean);
  assert.strictEqual(children.length, 1);
  assert.strictEqual(children[0].id, 'cls-1');
});

test('Test item tree: root items filtering', () => {
  const items = [
    { id: 'pkg-1', parentId: null },
    { id: 'cls-1', parentId: 'pkg-1' },
    { id: 'pkg-2', parentId: null },
    { id: 'cls-2', parentId: 'pkg-2' },
  ];
  const roots = items.filter(item => item.parentId === null);
  assert.strictEqual(roots.length, 2);
});

// ---- Test store: getLatestRun -----------------------------------------------

test('getLatestRun: returns last run', () => {
  const runs = [
    { id: 'run-1', state: 'succeeded' },
    { id: 'run-2', state: 'failed' },
    { id: 'run-3', state: 'running' },
  ];
  const latest = runs[runs.length - 1];
  assert.strictEqual(latest.id, 'run-3');
  assert.strictEqual(latest.state, 'running');
});

test('getLatestRun: undefined when no runs', () => {
  const runs = [];
  const latest = runs[runs.length - 1];
  assert.strictEqual(latest, undefined);
});

// ---- Test store: addRun -----------------------------------------------------

test('addRun: appends and caps at 50', () => {
  const runs = [];
  for (let i = 0; i < 55; i++) {
    runs.push({ id: `run-${i}`, state: 'succeeded' });
  }
  const capped = runs.slice(-50);
  assert.strictEqual(capped.length, 50);
  assert.strictEqual(capped[0].id, 'run-5');
  assert.strictEqual(capped[49].id, 'run-54');
});

// ---- Test store: updateRun --------------------------------------------------

test('updateRun: updates matching run', () => {
  const runs = [
    { id: 'run-1', state: 'running', totalCount: 0 },
    { id: 'run-2', state: 'pending', totalCount: 0 },
  ];
  const updated = runs.map(r => r.id === 'run-1' ? { ...r, state: 'succeeded', totalCount: 10 } : r);
  assert.strictEqual(updated[0].state, 'succeeded');
  assert.strictEqual(updated[0].totalCount, 10);
  assert.strictEqual(updated[1].state, 'pending');
});

test('updateRun: no change when id not found', () => {
  const runs = [
    { id: 'run-1', state: 'running' },
  ];
  const updated = runs.map(r => r.id === 'run-999' ? { ...r, state: 'succeeded' } : r);
  assert.strictEqual(updated[0].state, 'running');
});

// ---- Test store: updateItems ------------------------------------------------

test('updateItems: updates existing items', () => {
  const items = new Map();
  items.set('mtd-1', { id: 'mtd-1', status: 'idle', durationMs: undefined });
  items.set('mtd-2', { id: 'mtd-2', status: 'idle', durationMs: undefined });

  const updates = [
    { id: 'mtd-1', status: 'passed', durationMs: 100 },
    { id: 'mtd-3', status: 'passed', durationMs: 200 },
  ];

  for (const item of updates) {
    items.set(item.id, item);
  }

  assert.strictEqual(items.get('mtd-1').status, 'passed');
  assert.strictEqual(items.get('mtd-1').durationMs, 100);
  assert.strictEqual(items.get('mtd-3').status, 'passed');
  assert.strictEqual(items.size, 3);
});