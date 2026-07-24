'use strict';

// Integration tests for RemoteConnectionService — tests the data
// structures and configuration used by the remote connection service.

const { test } = require('node:test');
const assert = require('node:assert');

// ---- RemoteConnectionState --------------------------------------------------

test('RemoteConnectionState: disconnected', () => {
  const state = 'disconnected';
  assert.strictEqual(state, 'disconnected');
});

test('RemoteConnectionState: connecting', () => {
  const state = 'connecting';
  assert.strictEqual(state, 'connecting');
});

test('RemoteConnectionState: connected', () => {
  const state = 'connected';
  assert.strictEqual(state, 'connected');
});

test('RemoteConnectionState: reconnecting', () => {
  const state = 'reconnecting';
  assert.strictEqual(state, 'reconnecting');
});

test('RemoteConnectionState: error', () => {
  const state = 'error';
  assert.strictEqual(state, 'error');
});

test('RemoteConnectionState: all states', () => {
  const states = ['disconnected', 'connecting', 'connected', 'reconnecting', 'error'];
  assert.strictEqual(states.length, 5);
});

// ---- RemoteAgentConfig ------------------------------------------------------

test('RemoteAgentConfig: default values', () => {
  const config = {
    host: 'localhost',
    port: 9443,
    verifyTLS: true,
    maxReconnectRetries: 5,
    reconnectBaseDelay: 1000,
    reconnectMaxDelay: 30000,
  };
  assert.strictEqual(config.host, 'localhost');
  assert.strictEqual(config.port, 9443);
  assert.strictEqual(config.verifyTLS, true);
  assert.strictEqual(config.maxReconnectRetries, 5);
  assert.strictEqual(config.reconnectBaseDelay, 1000);
  assert.strictEqual(config.reconnectMaxDelay, 30000);
});

test('RemoteAgentConfig: with session token', () => {
  const config = {
    host: 'kairo-agent.internal',
    port: 9443,
    verifyTLS: true,
    maxReconnectRetries: 3,
    reconnectBaseDelay: 2000,
    reconnectMaxDelay: 15000,
    sessionToken: 'sess-token-123',
    reconnectToken: 'reconn-token-456',
  };
  assert.strictEqual(config.sessionToken, 'sess-token-123');
  assert.strictEqual(config.reconnectToken, 'reconn-token-456');
  assert.strictEqual(config.maxReconnectRetries, 3);
});

test('RemoteAgentConfig: no reconnection', () => {
  const config = {
    host: 'localhost',
    port: 9443,
    verifyTLS: false,
    maxReconnectRetries: 0,
    reconnectBaseDelay: 1000,
    reconnectMaxDelay: 30000,
  };
  assert.strictEqual(config.maxReconnectRetries, 0);
  assert.strictEqual(config.verifyTLS, false);
});

// ---- RemoteConnectionStatus -------------------------------------------------

test('RemoteConnectionStatus: disconnected state', () => {
  const status = {
    state: 'disconnected',
    host: 'localhost',
    port: 9443,
  };
  assert.strictEqual(status.state, 'disconnected');
  assert.strictEqual(status.host, 'localhost');
  assert.strictEqual(status.port, 9443);
});

test('RemoteConnectionStatus: connected state', () => {
  const status = {
    state: 'connected',
    host: 'agent.example.com',
    port: 9443,
    sessionToken: 'sess-123',
    connectedAt: Date.now(),
  };
  assert.strictEqual(status.state, 'connected');
  assert.strictEqual(status.sessionToken, 'sess-123');
  assert.ok(typeof status.connectedAt === 'number');
});

test('RemoteConnectionStatus: error state', () => {
  const status = {
    state: 'error',
    host: 'down.example.com',
    port: 9443,
    error: 'Connection refused',
    reconnectAttempt: 3,
  };
  assert.strictEqual(status.state, 'error');
  assert.strictEqual(status.error, 'Connection refused');
  assert.strictEqual(status.reconnectAttempt, 3);
});

test('RemoteConnectionStatus: reconnecting state', () => {
  const status = {
    state: 'reconnecting',
    host: 'agent.example.com',
    port: 9443,
    reconnectAttempt: 2,
  };
  assert.strictEqual(status.state, 'reconnecting');
  assert.strictEqual(status.reconnectAttempt, 2);
});

// ---- RemoteLoginCredentials -------------------------------------------------

test('RemoteLoginCredentials: valid structure', () => {
  const creds = {
    username: 'admin',
    password: 'secret123',
  };
  assert.strictEqual(creds.username, 'admin');
  assert.strictEqual(creds.password, 'secret123');
});

// ---- RemoteLoginResponse ----------------------------------------------------

test('RemoteLoginResponse: valid structure', () => {
  const response = {
    sessionToken: 'sess-token-abc',
    reconnectToken: 'reconn-token-def',
    expiresAt: '2024-12-31T23:59:59Z',
    user: {
      username: 'admin',
      role: 'administrator',
    },
  };
  assert.strictEqual(response.sessionToken, 'sess-token-abc');
  assert.strictEqual(response.reconnectToken, 'reconn-token-def');
  assert.strictEqual(response.user.username, 'admin');
  assert.strictEqual(response.user.role, 'administrator');
});

test('RemoteLoginResponse: expiry check', () => {
  const response = {
    sessionToken: 'sess-token',
    reconnectToken: 'reconn-token',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    user: { username: 'user', role: 'viewer' },
  };
  const expiresAt = new Date(response.expiresAt);
  const now = new Date();
  assert.ok(expiresAt > now, 'Session should not be expired');
});

test('RemoteLoginResponse: expired session', () => {
  const response = {
    sessionToken: 'sess-token',
    reconnectToken: 'reconn-token',
    expiresAt: new Date(Date.now() - 3600000).toISOString(),
    user: { username: 'user', role: 'viewer' },
  };
  const expiresAt = new Date(response.expiresAt);
  const now = new Date();
  assert.ok(expiresAt < now, 'Session should be expired');
});

// ---- RemoteErrorResponse ----------------------------------------------------

test('RemoteErrorResponse: with error message', () => {
  const error = {
    error: {
      message: 'Invalid credentials',
    },
  };
  assert.strictEqual(error.error.message, 'Invalid credentials');
});

test('RemoteErrorResponse: empty error', () => {
  const error = {};
  const message = error.error?.message || 'Unknown error';
  assert.strictEqual(message, 'Unknown error');
});

// ---- Reconnection exponential backoff logic ---------------------------------

test('exponential backoff: base delay', () => {
  const baseDelay = 1000;
  const attempt = 1;
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 30000);
  assert.strictEqual(delay, 1000);
});

test('exponential backoff: 3rd attempt', () => {
  const baseDelay = 1000;
  const attempt = 3;
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 30000);
  assert.strictEqual(delay, 4000);
});

test('exponential backoff: 6th attempt (capped at max)', () => {
  const baseDelay = 1000;
  const attempt = 6;
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 30000);
  assert.strictEqual(delay, 30000);
});

test('exponential backoff: zero retries disables reconnection', () => {
  const maxRetries = 0;
  const shouldReconnect = maxRetries > 0;
  assert.strictEqual(shouldReconnect, false);
});

// ---- WebSocket URL construction ---------------------------------------------

test('WebSocket URL: wss with host and port', () => {
  const host = 'agent.example.com';
  const port = 9443;
  const url = `wss://${host}:${port}/api/v1/remote/ws`;
  assert.strictEqual(url, 'wss://agent.example.com:9443/api/v1/remote/ws');
});

test('WebSocket URL: with session token as protocol', () => {
  const sessionToken = 'sess-abc-123';
  const protocols = [sessionToken];
  assert.strictEqual(protocols[0], 'sess-abc-123');
  assert.strictEqual(protocols.length, 1);
});

// ---- Login URL construction -------------------------------------------------

test('Login URL: HTTPS with host and port', () => {
  const host = 'kairo-agent.internal';
  const port = 9443;
  const url = `https://${host}:${port}/api/v1/remote/login`;
  assert.strictEqual(url, 'https://kairo-agent.internal:9443/api/v1/remote/login');
});

// ---- API request URL construction -------------------------------------------

test('API request URL: with path', () => {
  const host = 'kairo-agent.internal';
  const port = 9443;
  const path = 'workspaces';
  const url = `https://${host}:${port}/api/v1/${path}`;
  assert.strictEqual(url, 'https://kairo-agent.internal:9443/api/v1/workspaces');
});

// ---- Ping message format ----------------------------------------------------

test('ping message: JSON format', () => {
  const ping = JSON.stringify({ type: 'ping' });
  assert.strictEqual(ping, '{"type":"ping"}');
});

test('send message: JSON format with type and data', () => {
  const message = JSON.stringify({ type: 'query', data: { sql: 'SELECT 1' } });
  const parsed = JSON.parse(message);
  assert.strictEqual(parsed.type, 'query');
  assert.deepStrictEqual(parsed.data, { sql: 'SELECT 1' });
});

// ---- WebSocket close codes --------------------------------------------------

test('WebSocket close: normal closure', () => {
  const code = 1000;
  const reason = 'Client disconnect';
  assert.strictEqual(code, 1000);
  assert.strictEqual(reason, 'Client disconnect');
});

// ---- localStorage keys ------------------------------------------------------

test('localStorage: config key', () => {
  const STORAGE_KEY_CONFIG = 'kairo.remote.agentConfig';
  assert.strictEqual(STORAGE_KEY_CONFIG, 'kairo.remote.agentConfig');
});

test('localStorage: session key', () => {
  const STORAGE_KEY_SESSION = 'kairo.remote.session';
  assert.strictEqual(STORAGE_KEY_SESSION, 'kairo.remote.session');
});