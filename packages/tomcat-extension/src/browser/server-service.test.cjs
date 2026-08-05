'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toStoreServer } = require('../../lib/browser/server-model');

test('toStoreServer retains HTTP and JDWP ports without claiming an attached debugger', () => {
  const mapped = toStoreServer({
    id: 'srv-debug',
    projectId: 'legacy-app',
    type: 'tomcat6',
    state: 'running',
    pid: 321,
    ports: { http: 18080, debug: 5005 },
    startedAt: '2026-07-22T00:00:00.000Z',
    catalinaBase: '/tmp/catalina',
  }, 'ws-1');

  assert.equal(mapped.httpPort, 18080);
  assert.equal(mapped.debugPort, 5005);
  assert.equal(mapped.url, 'http://127.0.0.1:18080');
  assert.equal(mapped.workspaceId, 'ws-1');
  assert.equal(Object.hasOwn(mapped, 'debuggerAttached'), false);
});

test('toStoreServer normalizes absent optional ports to zero', () => {
  const mapped = toStoreServer({
    id: 'srv-run',
    projectId: 'legacy-app',
    type: 'tomcat6',
    state: 'stopped',
    ports: {},
    catalinaBase: '/tmp/catalina',
  }, 'ws-2');

  assert.equal(mapped.httpPort, 0);
  assert.equal(mapped.debugPort, 0);
  assert.equal(mapped.url, undefined);
  assert.equal(mapped.workspaceId, 'ws-2');
});

test('toStoreServer requires workspaceId from caller (BD-P3-8)', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'server-model.ts'), 'utf8');
  assert.match(source, /toStoreServer\(s: ProtocolServerInstance, workspaceId: string\)/);
  assert.doesNotMatch(source, /workspaceId:\s*''/);
});

test('KairoServerService adopt path owns cache/store synchronization', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'server-service.ts'), 'utf8');
  assert.match(source, /adopt\(instance: ServerInstance\)/);
  assert.match(source, /this\.cache\.set\(instance\.id, instance\)/);
  assert.match(source, /toStoreServer\(instance, this\.runtime\.workspace\(\)\)/);
  assert.match(source, /return this\.adopt\(s\)/);
  assert.match(source, /forget\(id: string\): void/);
  assert.match(source, /this\.cache\.delete\(id\)/);
  assert.match(source, /this\.store\.removeServer\(id\)/);
});
