'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('SqlQueryResult with error', () => {
  const result = {
    columns: [],
    rows: [],
    rowCount: 0,
    executionTime: 0,
    error: 'ORA-00942: table or view does not exist',
  };
  assert.ok(result.error);
  assert.strictEqual(result.columns.length, 0);
  assert.strictEqual(result.rows.length, 0);
  assert.strictEqual(result.rowCount, 0);
  assert.strictEqual(result.executionTime, 0);
});

test('SqlQueryResult with large result set', () => {
  const rows = [];
  for (let i = 0; i < 1000; i++) {
    rows.push([i, `name_${i}`, `value_${i}`]);
  }
  const result = {
    columns: ['ID', 'NAME', 'VALUE'],
    rows,
    rowCount: 1000,
    executionTime: 250,
  };
  assert.strictEqual(result.rowCount, 1000);
  assert.strictEqual(result.rows.length, 1000);
  assert.strictEqual(result.columns.length, 3);
  assert.strictEqual(result.rows[0][0], 0);
  assert.strictEqual(result.rows[0][1], 'name_0');
  assert.strictEqual(result.rows[999][0], 999);
  assert.strictEqual(result.rows[999][2], 'value_999');
});

test('SqlQueryResult with connection error', () => {
  const result = {
    columns: [],
    rows: [],
    rowCount: 0,
    executionTime: 0,
    error: 'ORA-12514: TNS:listener does not currently know of service requested',
  };
  assert.ok(result.error.includes('ORA-12514'));
  assert.strictEqual(result.rowCount, 0);
});

test('SqlQueryResult with network timeout', () => {
  const result = {
    columns: [],
    rows: [],
    rowCount: 0,
    executionTime: 30000,
    error: 'Network timeout: connection to 192.168.1.100:1521 timed out after 30000ms',
  };
  assert.ok(result.error.includes('timeout'));
  assert.strictEqual(result.executionTime, 30000);
});

test('SqlConnectionConfig with non-standard port', () => {
  const config = {
    host: 'oracle.internal',
    port: 1522,
    sid: 'PROD',
    useServiceName: false,
    username: 'app_user',
    password: 'app_pass',
  };
  assert.strictEqual(config.port, 1522);
  assert.strictEqual(config.host, 'oracle.internal');
});

test('SqlQueryResult with single row', () => {
  const result = {
    columns: ['COUNT(*)'],
    rows: [[42]],
    rowCount: 1,
    executionTime: 8,
  };
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0][0], 42);
  assert.strictEqual(result.rowCount, 1);
});

test('SqlQueryResult with null values', () => {
  const result = {
    columns: ['ID', 'NAME', 'MANAGER_ID'],
    rows: [[1, 'Alice', null], [2, 'Bob', 1], [3, null, null]],
    rowCount: 3,
    executionTime: 12,
  };
  assert.strictEqual(result.rows[0][2], null);
  assert.strictEqual(result.rows[2][1], null);
  assert.strictEqual(result.rowCount, 3);
});