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

const sql = require('../../lib/browser/index');

// ---- SqlExecutionService: splitStatements ----------------------------------

test('SqlExecutionService.splitStatements splits by semicolons', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.splitStatements('SELECT * FROM users; SELECT * FROM orders;');
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0], 'SELECT * FROM users');
  assert.strictEqual(result[1], 'SELECT * FROM orders');
});

test('SqlExecutionService.splitStatements handles single statement without semicolon', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.splitStatements('SELECT * FROM users');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], 'SELECT * FROM users');
});

test('SqlExecutionService.splitStatements ignores semicolons in strings', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.splitStatements("SELECT 'a;b' FROM users; SELECT 'c;d' FROM orders;");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0], "SELECT 'a;b' FROM users");
  assert.strictEqual(result[1], "SELECT 'c;d' FROM orders");
});

test('SqlExecutionService.splitStatements ignores semicolons in double-quoted strings', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.splitStatements('SELECT "a;b" FROM users; SELECT "c;d" FROM orders;');
  assert.strictEqual(result.length, 2);
});

test('SqlExecutionService.splitStatements handles line comments', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.splitStatements('SELECT * FROM users; -- comment\nSELECT * FROM orders;');
  assert.strictEqual(result.length, 2);
  assert.ok(result[1].includes('-- comment'));
});

test('SqlExecutionService.splitStatements handles block comments', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.splitStatements('SELECT * FROM users; /* block */ SELECT * FROM orders;');
  assert.strictEqual(result.length, 2);
});

test('SqlExecutionService.splitStatements handles empty SQL', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  assert.deepStrictEqual(service.splitStatements(''), []);
  assert.deepStrictEqual(service.splitStatements(';'), []);
});

// ---- SqlExecutionService: extractCurrentStatement ---------------------------

test('SqlExecutionService.extractCurrentStatement returns correct statement at cursor', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const sqlText = 'SELECT * FROM users; INSERT INTO log VALUES(1);';
  const stmt = service.extractCurrentStatement(sqlText, 5);
  assert.strictEqual(stmt, 'SELECT * FROM users');
});

test('SqlExecutionService.extractCurrentStatement returns second statement', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const sqlText = 'SELECT * FROM users; INSERT INTO log VALUES(1);';
  const stmt = service.extractCurrentStatement(sqlText, 30);
  assert.strictEqual(stmt, 'INSERT INTO log VALUES(1)');
});

test('SqlExecutionService.extractCurrentStatement returns whole SQL for single statement', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const stmt = service.extractCurrentStatement('SELECT * FROM users', 5);
  assert.strictEqual(stmt, 'SELECT * FROM users');
});

// ---- SqlExecutionService: isDangerousStatement ------------------------------

test('SqlExecutionService.isDangerousStatement detects DROP TABLE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.isDangerousStatement('DROP TABLE users');
  assert.strictEqual(result.dangerous, true);
  assert.ok(result.reason.includes('DROP'));
});

test('SqlExecutionService.isDangerousStatement detects DROP VIEW', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.isDangerousStatement('DROP VIEW my_view');
  assert.strictEqual(result.dangerous, true);
});

test('SqlExecutionService.isDangerousStatement detects TRUNCATE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.isDangerousStatement('TRUNCATE TABLE users');
  assert.strictEqual(result.dangerous, true);
  assert.ok(result.reason.includes('TRUNCATE'));
});

test('SqlExecutionService.isDangerousStatement detects DELETE without WHERE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.isDangerousStatement('DELETE FROM users');
  assert.strictEqual(result.dangerous, true);
  assert.ok(result.reason.includes('DELETE without WHERE'));
});

test('SqlExecutionService.isDangerousStatement allows DELETE with WHERE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.isDangerousStatement('DELETE FROM users WHERE id = 1');
  assert.strictEqual(result.dangerous, false);
});

test('SqlExecutionService.isDangerousStatement detects UPDATE without WHERE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.isDangerousStatement('UPDATE users SET name = "test"');
  assert.strictEqual(result.dangerous, true);
  assert.ok(result.reason.includes('UPDATE without WHERE'));
});

test('SqlExecutionService.isDangerousStatement allows UPDATE with WHERE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.isDangerousStatement('UPDATE users SET name = "test" WHERE id = 1');
  assert.strictEqual(result.dangerous, false);
});

test('SqlExecutionService.isDangerousStatement detects ALTER TABLE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.isDangerousStatement('ALTER TABLE users ADD COLUMN age NUMBER');
  assert.strictEqual(result.dangerous, true);
  assert.ok(result.reason.includes('ALTER'));
});

test('SqlExecutionService.isDangerousStatement allows SELECT', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.isDangerousStatement('SELECT * FROM users');
  assert.strictEqual(result.dangerous, false);
});

test('SqlExecutionService.isDangerousStatement is case-insensitive', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  assert.strictEqual(service.isDangerousStatement('drop table users').dangerous, true);
  assert.strictEqual(service.isDangerousStatement('Drop Table users').dangerous, true);
  assert.strictEqual(service.isDangerousStatement('delete from users').dangerous, true);
});

// ---- SqlExecutionService: exportToCsv ---------------------------------------

test('SqlExecutionService.exportToCsv handles null values', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = {
    columns: [{ name: 'ID', type: 'NUMBER', label: 'ID' }, { name: 'NAME', type: 'VARCHAR2', label: 'NAME' }],
    rows: [{ ID: 1, NAME: null }, { ID: 2, NAME: 'Bob' }],
    rowCount: 2,
    executionTimeMs: 0,
    truncated: false,
  };

  const csv = service.exportToCsv(result);
  const lines = csv.split('\n');
  assert.strictEqual(lines[0], 'ID,NAME');
  assert.strictEqual(lines[1], '1,');
  assert.strictEqual(lines[2], '2,Bob');
});

test('SqlExecutionService.exportToCsv escapes fields with commas', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = {
    columns: [{ name: 'NAME', type: 'VARCHAR2', label: 'NAME' }],
    rows: [{ NAME: 'Doe, John' }],
    rowCount: 1,
    executionTimeMs: 0,
    truncated: false,
  };

  const csv = service.exportToCsv(result);
  const lines = csv.split('\n');
  assert.strictEqual(lines[0], 'NAME');
  assert.ok(lines[1].includes('"Doe, John"'));
});

test('SqlExecutionService.exportToCsv escapes fields with quotes', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = {
    columns: [{ name: 'NAME', type: 'VARCHAR2', label: 'NAME' }],
    rows: [{ NAME: 'He said "hello"' }],
    rowCount: 1,
    executionTimeMs: 0,
    truncated: false,
  };

  const csv = service.exportToCsv(result);
  const lines = csv.split('\n');
  assert.ok(lines[1].includes('"He said ""hello"""'));
});

// ---- SqlExecutionService: exportToJson --------------------------------------

test('SqlExecutionService.exportToJson handles empty result', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = {
    columns: [],
    rows: [],
    rowCount: 0,
    executionTimeMs: 0,
    truncated: false,
  };

  const json = service.exportToJson(result);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.columns.length, 0);
  assert.strictEqual(parsed.rows.length, 0);
  assert.strictEqual(parsed.rowCount, 0);
});

// ---- SqlExecutionService: formatSql -----------------------------------------

test('SqlExecutionService.formatSql handles null and undefined', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  assert.strictEqual(service.formatSql(null), '');
  assert.strictEqual(service.formatSql(''), '');
});

test('SqlExecutionService.formatSql uppercases keywords', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.formatSql('select * from users where id = 1');
  assert.ok(result.includes('SELECT'));
  assert.ok(result.includes('FROM'));
  assert.ok(result.includes('WHERE'));
});

test('SqlExecutionService.formatSql adds newlines before major clauses', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};

  const result = service.formatSql('select * from users where id = 1 order by name');
  assert.ok(result.includes('\n'));
});

// ---- SqlExecutionService: cancelQuery ---------------------------------------

test('SqlExecutionService.cancelQuery does not throw for non-existent request', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  assert.doesNotThrow(() => service.cancelQuery('non-existent'));
});

test('SqlExecutionService.cancelAll does not throw when no queries running', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  assert.doesNotThrow(() => service.cancelAll());
});

// ---- SqlExecutionService: getHistory ----------------------------------------

test('SqlExecutionService.getHistory returns empty array initially', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const history = service.getHistory();
  assert.deepStrictEqual(history, []);
});

test('SqlExecutionService.getHistory filters by connectionId', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const history = service.getHistory('conn-1');
  assert.deepStrictEqual(history, []);
});

test('teardown', () => { disableJSDOM(); });