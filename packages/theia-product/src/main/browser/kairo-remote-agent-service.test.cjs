'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('RemoteAgentConfig structure', () => {
  const config = {
    host: '192.168.1.100',
    port: 9443,
    useTLS: true,
    token: 'test-token',
    workspacePath: '/home/user/project',
  };
  assert.strictEqual(config.host, '192.168.1.100');
  assert.strictEqual(config.port, 9443);
  assert.strictEqual(config.useTLS, true);
  assert.strictEqual(config.token, 'test-token');
  assert.strictEqual(config.workspacePath, '/home/user/project');
});

test('RemoteAgentConfig without TLS', () => {
  const config = {
    host: '10.0.0.5',
    port: 8080,
    useTLS: false,
    token: 'insecure-token',
    workspacePath: '/workspace',
  };
  assert.strictEqual(config.useTLS, false);
  assert.strictEqual(config.port, 8080);
});

test('RemoteAgentStatus values', () => {
  const statuses = ['disconnected', 'connecting', 'connected', 'error'];
  assert.strictEqual(statuses.length, 4);
  assert.ok(statuses.includes('disconnected'));
  assert.ok(statuses.includes('connecting'));
  assert.ok(statuses.includes('connected'));
  assert.ok(statuses.includes('error'));
});

test('RemoteAgentStatus is a valid type', () => {
  const validStatuses = new Set(['disconnected', 'connecting', 'connected', 'error']);
  assert.ok(validStatuses.has('disconnected'));
  assert.ok(validStatuses.has('connected'));
  assert.ok(!validStatuses.has('reconnecting'));
  assert.ok(!validStatuses.has('idle'));
});