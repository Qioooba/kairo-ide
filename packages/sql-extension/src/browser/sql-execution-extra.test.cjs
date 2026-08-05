'use strict';

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

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

// ---- SqlExecutionService: splitStatements edge cases ------------------------

test('splitStatements handles SQL with only whitespace', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  assert.deepStrictEqual(service.splitStatements('   '), []);
  assert.deepStrictEqual(service.splitStatements('\n\t'), []);
});

test('splitStatements handles multiple semicolons in a row', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.splitStatements('SELECT 1;;;SELECT 2;');
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0], 'SELECT 1');
  assert.strictEqual(result[1], 'SELECT 2');
});

test('splitStatements handles trailing semicolon', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.splitStatements('SELECT * FROM users;');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], 'SELECT * FROM users');
});

test('splitStatements handles PL/SQL block-like content', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  // splitStatements splits at all semicolons, even inside PL/SQL blocks
  const result = service.splitStatements('BEGIN\n  INSERT INTO t VALUES(1);\nEND;');
  assert.strictEqual(result.length, 2);
  assert.ok(result[0].includes('BEGIN'));
  assert.ok(result[0].includes('VALUES(1)'));
  assert.ok(result[1].includes('END'));
});

test('splitStatements handles escaped quote in string', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.splitStatements("SELECT 'it''s a test' FROM dual;SELECT 1 FROM dual;");
  assert.strictEqual(result.length, 2);
});

test('splitStatements handles block comment spanning multiple lines', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.splitStatements('SELECT * /* multi\nline\ncomment */ FROM users;');
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes('/* multi'));
  assert.ok(result[0].includes('*/'));
});

// ---- SqlExecutionService: extractCurrentStatement edge cases ----------------

test('extractCurrentStatement returns last statement', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const sqlText = 'SELECT 1; SELECT 2; SELECT 3;';
  const stmt = service.extractCurrentStatement(sqlText, 25);
  assert.strictEqual(stmt, 'SELECT 3');
});

test('extractCurrentStatement at position 0 returns first statement', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const sqlText = 'SELECT 1; SELECT 2;';
  const stmt = service.extractCurrentStatement(sqlText, 0);
  assert.strictEqual(stmt, 'SELECT 1');
});

test('extractCurrentStatement with cursor beyond text returns trimmed text', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const sqlText = 'SELECT 1; SELECT 2;';
  const stmt = service.extractCurrentStatement(sqlText, 999);
  assert.strictEqual(stmt, 'SELECT 1; SELECT 2;');
});

// ---- SqlExecutionService: isDangerousStatement more cases -------------------

test('isDangerousStatement detects DROP INDEX', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('DROP INDEX idx_users');
  assert.strictEqual(result.dangerous, true);
});

test('isDangerousStatement detects DROP PROCEDURE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('DROP PROCEDURE my_proc');
  assert.strictEqual(result.dangerous, true);
});

test('isDangerousStatement detects DROP SEQUENCE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('DROP SEQUENCE seq_users');
  assert.strictEqual(result.dangerous, true);
});

test('isDangerousStatement detects ALTER SYSTEM', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('ALTER SYSTEM SET parameter = value');
  assert.strictEqual(result.dangerous, true);
});

test('isDangerousStatement detects ALTER SESSION', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('ALTER SESSION SET nls_date_format = "YYYY-MM-DD"');
  assert.strictEqual(result.dangerous, true);
});

test('isDangerousStatement allows SELECT with subquery', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)');
  assert.strictEqual(result.dangerous, false);
});

test('isDangerousStatement allows INSERT', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('INSERT INTO users (id, name) VALUES (1, "test")');
  assert.strictEqual(result.dangerous, false);
});

test('isDangerousStatement detects UPDATE with subquery but no WHERE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('UPDATE users SET name = (SELECT name FROM temp)');
  assert.strictEqual(result.dangerous, true);
  assert.ok(result.reason.includes('UPDATE without WHERE'));
});

test('isDangerousStatement detects DELETE with JOIN but no WHERE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('DELETE FROM users USING users u JOIN orders o ON u.id = o.user_id');
  assert.strictEqual(result.dangerous, true);
});

test('isDangerousStatement allows DELETE with WHERE EXISTS', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.isDangerousStatement('DELETE FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)');
  assert.strictEqual(result.dangerous, false);
});

// ---- SqlExecutionService: formatSql more cases ------------------------------

test('formatSql handles INSERT with multiple values', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.formatSql('insert into users (id, name, email) values (1, "test", "test@test.com")');
  assert.ok(result.includes('INSERT INTO'));
  assert.ok(result.includes('VALUES'));
  assert.ok(result.includes('users'));
});

test('formatSql handles CREATE TABLE', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.formatSql('create table users (id number, name varchar2(100))');
  assert.ok(result.includes('CREATE'));
  assert.ok(result.includes('TABLE'));
  assert.ok(result.includes('users'));
});

test('formatSql handles JOIN', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.formatSql('select * from users u join orders o on u.id = o.user_id');
  assert.ok(result.includes('SELECT'));
  assert.ok(result.includes('FROM'));
  assert.ok(result.includes('JOIN'));
  assert.ok(result.includes('ON'));
});

test('formatSql handles GROUP BY and HAVING', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.formatSql('select dept_id, count(*) from users group by dept_id having count(*) > 5');
  assert.ok(result.includes('SELECT'));
  assert.ok(result.includes('FROM'));
  assert.ok(result.includes('GROUP BY'));
  assert.ok(result.includes('HAVING'));
});

test('formatSql handles ORDER BY with ASC/DESC', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = service.formatSql('select * from users order by name asc, id desc');
  assert.ok(result.includes('ORDER BY'));
  assert.ok(result.includes('ASC'));
  assert.ok(result.includes('DESC'));
});

test('formatSql returns empty string for undefined', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  assert.strictEqual(service.formatSql(undefined), '');
});

// ---- SqlExecutionService: exportToCsv edge cases ----------------------------

test('exportToCsv handles empty result', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = {
    columns: [],
    rows: [],
    rowCount: 0,
    executionTimeMs: 0,
    truncated: false,
  };
  const csv = service.exportToCsv(result);
  assert.strictEqual(csv, '');
});

test('exportToCsv handles fields with newlines', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = {
    columns: [{ name: 'DESC', type: 'VARCHAR2', label: 'DESC' }],
    rows: [{ DESC: 'Line1\nLine2' }],
    rowCount: 1,
    executionTimeMs: 0,
    truncated: false,
  };
  const csv = service.exportToCsv(result);
  assert.ok(csv.includes('"Line1\nLine2"'));
});

test('exportToCsv handles number values', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = {
    columns: [{ name: 'ID', type: 'NUMBER', label: 'ID' }, { name: 'SALARY', type: 'NUMBER', label: 'SALARY' }],
    rows: [{ ID: 1, SALARY: 50000.5 }, { ID: 2, SALARY: 0 }],
    rowCount: 2,
    executionTimeMs: 0,
    truncated: false,
  };
  const csv = service.exportToCsv(result);
  const lines = csv.split('\n');
  assert.strictEqual(lines[0], 'ID,SALARY');
  assert.strictEqual(lines[1], '1,50000.5');
  assert.strictEqual(lines[2], '2,0');
});

// ---- SqlExecutionService: exportToJson edge cases ---------------------------

test('exportToJson includes totalRows when present', () => {
  const service = new sql.SqlExecutionService();
  service.connectionService = {};
  const result = {
    columns: [{ name: 'ID', type: 'NUMBER', label: 'ID' }],
    rows: [{ ID: 1 }],
    rowCount: 1,
    totalRows: 500,
    executionTimeMs: 50,
    truncated: true,
  };
  const json = service.exportToJson(result);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.totalRows, 500);
  assert.strictEqual(parsed.truncated, true);
});

// ---- SqlQueryResult data structure ------------------------------------------

test('SqlQueryResult: with totalRows', () => {
  const result = {
    columns: [{ name: 'ID', type: 'NUMBER', label: 'ID' }],
    rows: [{ ID: 1 }, { ID: 2 }],
    rowCount: 2,
    totalRows: 1000,
    executionTimeMs: 150,
    truncated: true,
  };
  assert.strictEqual(result.totalRows, 1000);
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.executionTimeMs, 150);
});

// ---- SqlColumnDef data structure --------------------------------------------

test('SqlColumnDef: various types', () => {
  const cols = [
    { name: 'ID', type: 'NUMBER', label: 'ID' },
    { name: 'NAME', type: 'VARCHAR2', label: 'NAME' },
    { name: 'CREATED_AT', type: 'DATE', label: 'CREATED_AT' },
    { name: 'IS_ACTIVE', type: 'CHAR', label: 'IS_ACTIVE' },
  ];
  assert.strictEqual(cols.length, 4);
  assert.strictEqual(cols[0].type, 'NUMBER');
  assert.strictEqual(cols[1].type, 'VARCHAR2');
  assert.strictEqual(cols[2].type, 'DATE');
  assert.strictEqual(cols[3].type, 'CHAR');
});

// ---- SqlError data structure ------------------------------------------------

test('SqlError: with oracleErrorCode and position', () => {
  const error = {
    message: 'Invalid identifier',
    oracleErrorCode: '00904',
    sqlState: '42000',
    position: 15,
  };
  assert.strictEqual(error.message, 'Invalid identifier');
  assert.strictEqual(error.oracleErrorCode, '00904');
  assert.strictEqual(error.sqlState, '42000');
  assert.strictEqual(error.position, 15);
});

// ---- SqlHistoryEntry data structure -----------------------------------------

test('SqlHistoryEntry: valid structure', () => {
  const entry = {
    id: 'hist-001',
    sql: 'SELECT * FROM users',
    connectionId: 'conn-001',
    executedAt: '2024-01-01T00:00:00Z',
    executionTimeMs: 100,
    success: true,
    error: undefined,
    rowCount: 50,
  };
  assert.strictEqual(entry.id, 'hist-001');
  assert.strictEqual(entry.success, true);
  assert.strictEqual(entry.rowCount, 50);
});

test('SqlHistoryEntry: failed entry', () => {
  const entry = {
    id: 'hist-002',
    sql: 'SELECT * FROM invalid_table',
    connectionId: 'conn-001',
    executedAt: '2024-01-01T00:00:01Z',
    executionTimeMs: 200,
    success: false,
    error: 'ORA-00942: table or view does not exist',
    rowCount: undefined,
  };
  assert.strictEqual(entry.success, false);
  assert.ok(entry.error.includes('ORA-00942'));
});

// ---- SqlExecuteRequest data structure ---------------------------------------

test('SqlExecuteRequest: with maxRows and timeoutMs', () => {
  const request = {
    connectionId: 'conn-001',
    sql: 'SELECT * FROM large_table',
    maxRows: 500,
    timeoutMs: 60000,
  };
  assert.strictEqual(request.connectionId, 'conn-001');
  assert.strictEqual(request.maxRows, 500);
  assert.strictEqual(request.timeoutMs, 60000);
});

test('SqlExecuteRequest: without optional fields', () => {
  const request = {
    connectionId: 'conn-001',
    sql: 'SELECT 1 FROM dual',
  };
  assert.strictEqual(request.connectionId, 'conn-001');
  assert.strictEqual(request.maxRows, undefined);
  assert.strictEqual(request.timeoutMs, undefined);
});

// ---- SqlExecuteResponse data structure --------------------------------------

test('SqlExecuteResponse: success response', () => {
  const response = {
    requestId: 'req-001',
    ok: true,
    payload: {
      columns: [{ name: 'ID', type: 'NUMBER', label: 'ID' }],
      rows: [{ ID: 1 }],
      rowCount: 1,
      executionTimeMs: 50,
      truncated: false,
    },
  };
  assert.strictEqual(response.ok, true);
  assert.strictEqual(response.payload.rowCount, 1);
});

test('SqlExecuteResponse: error response', () => {
  const response = {
    requestId: 'req-002',
    ok: false,
    error: {
      code: 'SQL_ERROR',
      message: 'Table not found',
      details: {
        oracleErrorCode: '00942',
        sqlState: '42000',
        position: 14,
      },
    },
  };
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.error.code, 'SQL_ERROR');
  assert.strictEqual(response.error.details.oracleErrorCode, '00942');
});

// ---- SqlEditorWidget: additional properties ---------------------------------

test('SqlEditorWidget has static ID', () => {
  assert.strictEqual(sql.SqlEditorWidget.ID, 'kairo-sql-editor-widget');
});

test('SqlEditorWidget constructor creates instance', () => {
  const widget = new sql.SqlEditorWidget();
  assert.ok(widget instanceof sql.SqlEditorWidget);
});

// ---- SqlResultsWidget: additional properties --------------------------------

test('SqlResultsWidget has static ID', () => {
  assert.strictEqual(sql.SqlResultsWidget.ID, 'kairo-sql-results-widget');
});

test('SqlResultsWidget constructor creates instance', () => {
  const widget = new sql.SqlResultsWidget();
  assert.ok(widget instanceof sql.SqlResultsWidget);
});

test('SqlConnectionWidget has static ID', () => {
  assert.strictEqual(sql.SqlConnectionWidget.ID, 'kairo-sql-connection-widget');
});

test('SqlConnectionWidget constructor creates instance', () => {
  const widget = new sql.SqlConnectionWidget();
  assert.ok(widget instanceof sql.SqlConnectionWidget);
});

test('teardown', () => { disableJSDOM(); });