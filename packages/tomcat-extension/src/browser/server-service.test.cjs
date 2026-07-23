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
  });

  assert.equal(mapped.httpPort, 18080);
  assert.equal(mapped.debugPort, 5005);
  assert.equal(mapped.url, 'http://127.0.0.1:18080');
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
  });

  assert.equal(mapped.httpPort, 0);
  assert.equal(mapped.debugPort, 0);
  assert.equal(mapped.url, undefined);
});

test('KairoServerService adopt path owns cache/store synchronization', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'server-service.ts'), 'utf8');
  assert.match(source, /adopt\(instance: ServerInstance\)/);
  assert.match(source, /this\.cache\.set\(instance\.id, instance\)/);
  assert.match(source, /this\.store\.upsertServer\(toStoreServer\(instance\), \{ force: true \}\)/);
  assert.match(source, /return this\.adopt\(s\)/);
});
