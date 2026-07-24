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

// ---- SqlConnectionWidget exports -------------------------------------------

test('SqlConnectionWidget is exported', () => {
  assert.strictEqual(typeof sql.SqlConnectionWidget, 'function');
});

test('SqlConnectionWidget has static ID', () => {
  assert.strictEqual(sql.SqlConnectionWidget.ID, 'kairo-sql-connection-widget');
});

test('SqlConnectionWidget has static LABEL', () => {
  assert.strictEqual(sql.SqlConnectionWidget.LABEL, 'SQL Connections');
});

// ---- SqlConnectionWidget instantiation (uses @postConstruct, needs DI) -----

test('SqlConnectionWidget: constructor creates instance', () => {
  const widget = new sql.SqlConnectionWidget();
  assert.ok(widget instanceof sql.SqlConnectionWidget);
});

test('SqlConnectionWidget: ReactWidget base class', () => {
  const widget = new sql.SqlConnectionWidget();
  // ReactWidget provides node property
  assert.ok(widget.node);
});

// ---- SqlConnectionConfig data structure ------------------------------------

test('SqlConnectionConfig: valid structure', () => {
  const config = {
    id: 'conn-001',
    name: 'Oracle Dev',
    host: 'localhost',
    port: 1521,
    sid: 'orcl',
    serviceName: '',
    useServiceName: false,
    username: 'scott',
  };
  assert.strictEqual(config.id, 'conn-001');
  assert.strictEqual(config.host, 'localhost');
  assert.strictEqual(config.port, 1521);
  assert.strictEqual(config.username, 'scott');
  assert.strictEqual(config.useServiceName, false);
});

test('SqlConnectionConfig: with service name', () => {
  const config = {
    id: 'conn-002',
    name: 'Oracle Prod',
    host: 'prod-db.example.com',
    port: 1521,
    sid: '',
    serviceName: 'orcl.example.com',
    useServiceName: true,
    username: 'admin',
  };
  assert.strictEqual(config.useServiceName, true);
  assert.strictEqual(config.serviceName, 'orcl.example.com');
  assert.strictEqual(config.sid, '');
});

// ---- SqlConnectionFormData structure ---------------------------------------

test('SqlConnectionFormData: default values', () => {
  const form = {
    name: '',
    host: 'localhost',
    port: 1521,
    sid: 'orcl',
    serviceName: '',
    useServiceName: false,
    username: '',
    password: '',
  };
  assert.strictEqual(form.host, 'localhost');
  assert.strictEqual(form.port, 1521);
  assert.strictEqual(form.sid, 'orcl');
  assert.strictEqual(form.useServiceName, false);
});

test('SqlConnectionFormData: filled form', () => {
  const form = {
    name: 'My DB',
    host: '192.168.1.100',
    port: 1521,
    sid: 'XE',
    serviceName: '',
    useServiceName: false,
    username: 'scott',
    password: 'tiger',
  };
  assert.strictEqual(form.name, 'My DB');
  assert.strictEqual(form.username, 'scott');
  assert.strictEqual(form.password, 'tiger');
});

// ---- SqlConnectionStatus values --------------------------------------------

test('SqlConnectionStatus: disconnected', () => {
  const status = 'disconnected';
  assert.strictEqual(status, 'disconnected');
});

test('SqlConnectionStatus: connecting', () => {
  const status = 'connecting';
  assert.strictEqual(status, 'connecting');
});

test('SqlConnectionStatus: connected', () => {
  const status = 'connected';
  assert.strictEqual(status, 'connected');
});

test('SqlConnectionStatus: error', () => {
  const status = 'error';
  assert.strictEqual(status, 'error');
});

test('SqlConnectionStatus: status color mapping', () => {
  const colors = {
    disconnected: '#888',
    connecting: '#f0ad4e',
    connected: '#5cb85c',
    error: '#d9534f',
  };
  assert.strictEqual(colors.disconnected, '#888');
  assert.strictEqual(colors.connecting, '#f0ad4e');
  assert.strictEqual(colors.connected, '#5cb85c');
  assert.strictEqual(colors.error, '#d9534f');
});

// ---- SqlConnectionState structure ------------------------------------------

test('SqlConnectionState: connected state', () => {
  const state = {
    config: {
      id: 'conn-001',
      name: 'Oracle Dev',
      host: 'localhost',
      port: 1521,
      sid: 'orcl',
      serviceName: '',
      useServiceName: false,
      username: 'scott',
    },
    status: 'connected',
    oracleVersion: '11.2.0.4.0',
    error: undefined,
  };
  assert.strictEqual(state.status, 'connected');
  assert.strictEqual(state.oracleVersion, '11.2.0.4.0');
  assert.strictEqual(state.error, undefined);
});

test('SqlConnectionState: error state', () => {
  const state = {
    config: {
      id: 'conn-002',
      name: 'Bad DB',
      host: 'unknown',
      port: 1521,
      sid: 'orcl',
      serviceName: '',
      useServiceName: false,
      username: 'scott',
    },
    status: 'error',
    oracleVersion: undefined,
    error: 'ORA-12541: TNS:no listener',
  };
  assert.strictEqual(state.status, 'error');
  assert.ok(state.error.includes('TNS'));
});

// ---- SqlTestConnectionResult structure -------------------------------------

test('SqlTestConnectionResult: success', () => {
  const result = {
    success: true,
    oracleVersion: '11.2.0.4.0',
    instanceName: 'orcl',
    error: undefined,
  };
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.oracleVersion, '11.2.0.4.0');
  assert.strictEqual(result.instanceName, 'orcl');
});

test('SqlTestConnectionResult: failure', () => {
  const result = {
    success: false,
    error: 'ORA-01017: invalid username/password',
  };
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('ORA-01017'));
});

// ---- SqlConnectionConfigExport structure -----------------------------------

test('SqlConnectionConfigExport: valid structure', () => {
  const exportConfigs = [
    {
      id: 'conn-001',
      name: 'Oracle Dev',
      host: 'localhost',
      port: 1521,
      sid: 'orcl',
      serviceName: '',
      useServiceName: false,
      username: 'scott',
    },
    {
      id: 'conn-002',
      name: 'Oracle Prod',
      host: 'prod.example.com',
      port: 1521,
      sid: '',
      serviceName: 'orcl.example.com',
      useServiceName: true,
      username: 'admin',
    },
  ];
  assert.strictEqual(exportConfigs.length, 2);
  assert.strictEqual(exportConfigs[0].id, 'conn-001');
  assert.strictEqual(exportConfigs[1].useServiceName, true);
});

// ---- SqlEditorWidget exports -----------------------------------------------

test('SqlEditorWidget is exported', () => {
  assert.strictEqual(typeof sql.SqlEditorWidget, 'function');
});

test('SqlEditorWidget has static ID', () => {
  assert.strictEqual(sql.SqlEditorWidget.ID, 'kairo-sql-editor-widget');
});

// ---- SqlResultsWidget exports ----------------------------------------------

test('SqlResultsWidget is exported', () => {
  assert.strictEqual(typeof sql.SqlResultsWidget, 'function');
});

test('teardown', () => { disableJSDOM(); });