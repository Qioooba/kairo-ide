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

const { test } = require('node:test');
const assert = require('node:assert');

const sql = require('../../lib/browser/index');

test('SqlConnectionService is exported', () => {
  assert.strictEqual(typeof sql.SqlConnectionService, 'function');
});

test('SqlConnectionWidget is exported', () => {
  assert.strictEqual(typeof sql.SqlConnectionWidget, 'function');
});

test('SqlEditorWidget is exported', () => {
  assert.strictEqual(typeof sql.SqlEditorWidget, 'function');
});

test('SqlExecutionService is exported', () => {
  assert.strictEqual(typeof sql.SqlExecutionService, 'function');
});

test('SqlResultsWidget is exported', () => {
  assert.strictEqual(typeof sql.SqlResultsWidget, 'function');
});

test('SqlExecutionService.exportToJson formats JSON correctly', () => {
  const service = new sql.SqlExecutionService();
  // Mock the connectionService dependency
  service.connectionService = {};

  const result = {
    columns: [{ name: 'ID', type: 'NUMBER', label: 'ID' }, { name: 'NAME', type: 'VARCHAR2', label: 'NAME' }],
    rows: [{ ID: 1, NAME: 'Alice' }, { ID: 2, NAME: 'Bob' }],
    rowCount: 2,
    executionTimeMs: 100,
    truncated: false,
  };

  const json = service.exportToJson(result);
  const parsed = JSON.parse(json);

  assert.strictEqual(parsed.columns.length, 2);
  assert.strictEqual(parsed.columns[0].name, 'ID');
  assert.strictEqual(parsed.rows.length, 2);
  assert.strictEqual(parsed.rows[0].NAME, 'Alice');
  assert.strictEqual(parsed.rowCount, 2);
  assert.strictEqual(parsed.executionTimeMs, 100);
  assert.strictEqual(parsed.truncated, false);
});

test('SqlExecutionService.formatSql formats SELECT query', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const query = 'select id, name, email from users where status = 1 order by id desc';
  const formatted = service.formatSql(query);

  assert.ok(formatted.includes('SELECT'));
  assert.ok(formatted.includes('FROM'));
  assert.ok(formatted.includes('WHERE'));
  assert.ok(formatted.includes('ORDER BY'));
  assert.ok(formatted.includes('id'));
  assert.ok(formatted.includes('name'));
  assert.ok(formatted.includes('users'));
  assert.ok(formatted.includes('DESC'));
  // Should have newlines
  assert.ok(formatted.includes('\n'));
});

test('SqlExecutionService.formatSql handles empty string', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  assert.strictEqual(service.formatSql(''), '');
  assert.strictEqual(service.formatSql(null), '');
});

test('SqlExecutionService.formatSql formats INSERT', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const query = 'insert into users (id, name) values (1, "test")';
  const formatted = service.formatSql(query);

  assert.ok(formatted.includes('INSERT INTO'));
  assert.ok(formatted.includes('VALUES'));
  assert.ok(formatted.includes('users'));
});

test('SqlExecutionService.exportToCsv formats CSV correctly', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = {
    columns: [{ name: 'ID', type: 'NUMBER', label: 'ID' }, { name: 'NAME', type: 'VARCHAR2', label: 'NAME' }],
    rows: [{ ID: 1, NAME: 'Alice' }, { ID: 2, NAME: 'Bob' }],
    rowCount: 2,
    executionTimeMs: 0,
    truncated: false,
  };

  const csv = service.exportToCsv(result);
  const lines = csv.split('\n');

  assert.strictEqual(lines[0], 'ID,NAME');
  assert.strictEqual(lines[1], '1,Alice');
  assert.strictEqual(lines[2], '2,Bob');
});

test('teardown', () => { disableJSDOM(); });