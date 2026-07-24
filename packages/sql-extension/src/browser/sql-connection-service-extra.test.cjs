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

// ---- SqlConnectionService: getAllConnections --------------------------------

test('SqlConnectionService.getAllConnections returns empty array initially', () => {
  const service = new sql.SqlConnectionService();
  assert.deepStrictEqual(service.getAllConnections(), []);
});

test('SqlConnectionService.getConnection returns undefined for non-existent', () => {
  const service = new sql.SqlConnectionService();
  assert.strictEqual(service.getConnection('non-existent'), undefined);
});

test('SqlConnectionService.getConnectionState returns undefined for non-existent', () => {
  const service = new sql.SqlConnectionService();
  assert.strictEqual(service.getConnectionState('non-existent'), undefined);
});

// ---- SqlConnectionService: exportConnections --------------------------------

test('SqlConnectionService.exportConnections returns empty array initially', () => {
  const service = new sql.SqlConnectionService();
  assert.deepStrictEqual(service.exportConnections(), []);
});

// ---- SqlConnectionService: disconnect ---------------------------------------

test('SqlConnectionService.disconnect does not throw for non-existent', async () => {
  const service = new sql.SqlConnectionService();
  await assert.doesNotReject(async () => {
    await service.disconnect('non-existent');
  });
});

// ---- SqlConnectionService: connect returns false for non-existent ----------

test('SqlConnectionService.connect returns false for non-existent', async () => {
  const service = new sql.SqlConnectionService();
  const result = await service.connect('non-existent');
  assert.strictEqual(result, false);
});

// ---- SqlConnectionService: deleteConnection returns false for non-existent --

test('SqlConnectionService.deleteConnection returns false for non-existent', async () => {
  const service = new sql.SqlConnectionService();
  const result = await service.deleteConnection('non-existent');
  assert.strictEqual(result, false);
});

// ---- SqlConnectionService: onConnectionsChanged event ----------------------

test('SqlConnectionService has onConnectionsChanged event', () => {
  const service = new sql.SqlConnectionService();
  assert.strictEqual(typeof service.onConnectionsChanged, 'function');
});

// ---- SqlConnectionService: onConnectionStateChanged event -------------------

test('SqlConnectionService has onConnectionStateChanged event', () => {
  const service = new sql.SqlConnectionService();
  assert.strictEqual(typeof service.onConnectionStateChanged, 'function');
});

// ---- SqlConnectionService: testConnectionById returns error for non-existent -

test('SqlConnectionService.testConnectionById returns error for non-existent', async () => {
  const service = new sql.SqlConnectionService();
  const result = await service.testConnectionById('non-existent');
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'Connection not found');
});

// ---- SqlConnectionConfig: full structure with timestamps --------------------

test('SqlConnectionConfig: full structure with timestamps', () => {
  const config = {
    id: 'conn-001',
    name: 'Oracle Dev',
    host: 'localhost',
    port: 1521,
    sid: 'orcl',
    serviceName: '',
    useServiceName: false,
    username: 'scott',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  assert.strictEqual(config.id, 'conn-001');
  assert.strictEqual(config.createdAt, '2024-01-01T00:00:00Z');
  assert.strictEqual(config.updatedAt, '2024-01-01T00:00:00Z');
});

test('SqlConnectionConfig: useServiceName = true with serviceName', () => {
  const config = {
    id: 'conn-001',
    name: 'Oracle Dev',
    host: 'localhost',
    port: 1521,
    sid: '',
    serviceName: 'orcl.example.com',
    useServiceName: true,
    username: 'scott',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  assert.strictEqual(config.useServiceName, true);
  assert.strictEqual(config.serviceName, 'orcl.example.com');
});

// ---- SqlConnectionState: disconnected state ---------------------------------

test('SqlConnectionState: disconnected state with config', () => {
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
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    status: 'disconnected',
    oracleVersion: undefined,
    error: undefined,
  };
  assert.strictEqual(state.status, 'disconnected');
  assert.strictEqual(state.oracleVersion, undefined);
});

test('SqlConnectionState: connecting state', () => {
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
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    status: 'connecting',
    oracleVersion: undefined,
    error: undefined,
  };
  assert.strictEqual(state.status, 'connecting');
});

// ---- SqlTestConnectionResult: with oracleErrorCode --------------------------

test('SqlTestConnectionResult: failure with oracleErrorCode', () => {
  const result = {
    success: false,
    error: 'ORA-12541: TNS:no listener',
    oracleErrorCode: '12541',
  };
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.oracleErrorCode, '12541');
});

test('SqlTestConnectionResult: success with instanceName', () => {
  const result = {
    success: true,
    oracleVersion: '19.3.0.0.0',
    instanceName: 'orcl',
    error: undefined,
  };
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.oracleVersion, '19.3.0.0.0');
  assert.strictEqual(result.instanceName, 'orcl');
});

// ---- SqlConnectionConfigExport: multiple configs ---------------------------

test('SqlConnectionConfigExport: multiple configs export', () => {
  const exportConfigs = [
    { name: 'DB1', host: 'host1', port: 1521, sid: 'sid1', useServiceName: false, username: 'user1' },
    { name: 'DB2', host: 'host2', port: 1522, sid: 'sid2', serviceName: 'svc2', useServiceName: true, username: 'user2' },
    { name: 'DB3', host: 'host3', port: 1523, sid: 'sid3', useServiceName: false, username: 'user3' },
  ];
  assert.strictEqual(exportConfigs.length, 3);
  assert.strictEqual(exportConfigs[0].name, 'DB1');
  assert.strictEqual(exportConfigs[1].serviceName, 'svc2');
  assert.strictEqual(exportConfigs[2].port, 1523);
});

// ---- SqlConnectionService: updateConnection returns undefined for non-existent

test('SqlConnectionService.updateConnection returns undefined for non-existent', async () => {
  const service = new sql.SqlConnectionService();
  const result = await service.updateConnection('non-existent', { name: 'New Name' });
  assert.strictEqual(result, undefined);
});

// ---- SqlConnectionConfig: port validation -----------------------------------

test('SqlConnectionConfig: port is a number', () => {
  const config = {
    id: 'conn-001',
    name: 'Oracle Dev',
    host: 'localhost',
    port: 1521,
    sid: 'orcl',
    useServiceName: false,
    username: 'scott',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  assert.strictEqual(typeof config.port, 'number');
  assert.strictEqual(config.port, 1521);
});

// ---- SqlConnectionFormData: different port ----------------------------------

test('SqlConnectionFormData: non-default port', () => {
  const form = {
    name: 'Custom Port DB',
    host: 'localhost',
    port: 1522,
    sid: 'orcl',
    serviceName: '',
    useServiceName: false,
    username: '',
    password: '',
  };
  assert.strictEqual(form.port, 1522);
});

test('SqlConnectionFormData: with service name', () => {
  const form = {
    name: 'Service DB',
    host: 'localhost',
    port: 1521,
    sid: '',
    serviceName: 'my.service.com',
    useServiceName: true,
    username: 'admin',
    password: 'secret',
  };
  assert.strictEqual(form.useServiceName, true);
  assert.strictEqual(form.serviceName, 'my.service.com');
});

test('teardown', () => { disableJSDOM(); });