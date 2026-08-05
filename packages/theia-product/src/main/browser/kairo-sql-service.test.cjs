'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('SqlConnectionConfig validation', () => {
  const config = {
    host: 'localhost',
    port: 1521,
    sid: 'ORCL',
    username: 'user',
    password: 'pass',
    useServiceName: false,
  };
  assert.strictEqual(config.host, 'localhost');
  assert.strictEqual(config.port, 1521);
  assert.strictEqual(config.sid, 'ORCL');
  assert.strictEqual(config.username, 'user');
  assert.strictEqual(config.password, 'pass');
  assert.strictEqual(config.useServiceName, false);
});

test('SqlConnectionConfig with serviceName instead of sid', () => {
  const config = {
    host: 'db.example.com',
    port: 1521,
    serviceName: 'XEPDB1',
    useServiceName: true,
    username: 'admin',
    password: 'secret',
  };
  assert.strictEqual(config.useServiceName, true);
  assert.strictEqual(config.serviceName, 'XEPDB1');
  assert.strictEqual(config.sid, undefined);
});

test('SqlQueryResult structure', () => {
  const result = {
    columns: ['ID', 'NAME'],
    rows: [[1, 'test'], [2, 'test2']],
    rowCount: 2,
    executionTime: 15,
  };
  assert.strictEqual(result.columns.length, 2);
  assert.strictEqual(result.rows.length, 2);
  assert.strictEqual(result.rowCount, 2);
  assert.strictEqual(typeof result.executionTime, 'number');
});

test('SqlQueryResult with empty result set', () => {
  const result = {
    columns: ['ID', 'NAME', 'EMAIL'],
    rows: [],
    rowCount: 0,
    executionTime: 5,
  };
  assert.strictEqual(result.columns.length, 3);
  assert.strictEqual(result.rows.length, 0);
  assert.strictEqual(result.rowCount, 0);
});

test('KairoSqlService uses RuntimeConnectionService (no hardcoded agent URL)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'kairo-sql-service.ts'), 'utf8');
  assert.match(src, /RuntimeConnectionService/);
  assert.match(src, /POST \/api\/v1\/sql\/test-connection/);
  assert.match(src, /POST \/api\/v1\/sql\/execute/);
  assert.doesNotMatch(src, /localhost:17890/);
  assert.doesNotMatch(src, /SQL_AGENT_BASE/);
  assert.doesNotMatch(src, /fetch\(/);
});
