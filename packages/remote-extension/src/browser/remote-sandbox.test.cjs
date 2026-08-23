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

const { RemoteSandboxService } = require('../../lib/browser/remote-sandbox-service');

const mockLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} };

function createService() {
  const service = new RemoteSandboxService();
  service.logger = mockLogger;
  return service;
}

// ---- RemoteSandboxService --------------------------------------------------

test('RemoteSandboxService: default config has no workspace roots', () => {
  const service = createService();
  const config = service.getConfig();
  assert.strictEqual(config.workspaceRoots.length, 0);
  assert.strictEqual(config.allowAbsolutePaths, false);
  assert.strictEqual(config.maxFileSize, 50 * 1024 * 1024);
});

test('RemoteSandboxService: configure updates workspace roots', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['/home/user/project'] });
  const config = service.getConfig();
  assert.deepStrictEqual(config.workspaceRoots, ['/home/user/project']);
});

test('RemoteSandboxService: checkPath allows path within workspace root', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['/home/user/project'] });
  const result = service.checkPath('/home/user/project/src/Main.java');
  assert.strictEqual(result.allowed, true);
});

test('RemoteSandboxService: checkPath rejects path outside workspace root', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['/home/user/project'] });
  // /etc/passwd is also a forbidden pattern, so it gets rejected before the root check
  const result = service.checkPath('/tmp/outside');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('outside allowed workspace roots'));
});

test('RemoteSandboxService: checkPath rejects path traversal', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['/home/user/project'] });
  const result = service.checkPath('/home/user/project/../outside');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('Path traversal'));
});

test('RemoteSandboxService: checkPath rejects forbidden patterns', () => {
  const service = createService();
  // Test with default forbidden patterns
  const result = service.checkPath('/etc/passwd');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('forbidden pattern'));
});

test('RemoteSandboxService: checkPath rejects .env pattern', () => {
  const service = createService();
  const result = service.checkPath('/home/user/project/.env');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('forbidden pattern'));
});

test('RemoteSandboxService: checkPath rejects credentials.json', () => {
  const service = createService();
  const result = service.checkPath('/home/user/project/credentials.json');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('forbidden pattern'));
});

test('RemoteSandboxService: checkPath rejects *.pem files', () => {
  const service = createService();
  const result = service.checkPath('/home/user/project/secret.pem');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('forbidden pattern'));
});

test('RemoteSandboxService: checkPath rejects *.key files', () => {
  const service = createService();
  const result = service.checkPath('/home/user/project/id_rsa.key');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('forbidden pattern'));
});

test('RemoteSandboxService: checkPath allows exact workspace root match', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['/home/user/project'] });
  const result = service.checkPath('/home/user/project');
  assert.strictEqual(result.allowed, true);
});

test('RemoteSandboxService: checkPath allows path when no workspace roots configured', () => {
  const service = createService();
  const result = service.checkPath('/any/path/File.java');
  assert.strictEqual(result.allowed, true);
});

test('RemoteSandboxService: checkPath normalizes Windows paths', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['C:/Users/test/project'] });
  const result = service.checkPath('C:\\Users\\test\\project\\src\\Main.java');
  assert.strictEqual(result.allowed, true);
});

test('RemoteSandboxService: checkFileSize rejects oversized files', () => {
  const service = createService();
  service.configure({ maxFileSize: 1024 });
  const result = service.checkFileSize(2048);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('exceeds maximum'));
});

test('RemoteSandboxService: checkFileSize allows files within limit', () => {
  const service = createService();
  service.configure({ maxFileSize: 1024 });
  const result = service.checkFileSize(512);
  assert.strictEqual(result.allowed, true);
});

test('RemoteSandboxService: validateOperation checks both path and size', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['/home/user/project'], maxFileSize: 1024 });
  const result = service.validateOperation('/home/user/project/file.txt', 2048);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('exceeds maximum'));
});

test('RemoteSandboxService: validateOperation rejects forbidden path first', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['/home/user/project'] });
  const result = service.validateOperation('/etc/passwd', 100);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('forbidden pattern'));
});

test('RemoteSandboxService: allowAbsolutePaths bypasses root check', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['/home/user/project'], allowAbsolutePaths: true });
  const result = service.checkPath('/var/log/app.log');
  assert.strictEqual(result.allowed, true);
});

test('RemoteSandboxService: configure merges partial config', () => {
  const service = createService();
  service.configure({ workspaceRoots: ['/home/user/project'] });
  service.configure({ maxFileSize: 1024 });
  const config = service.getConfig();
  assert.deepStrictEqual(config.workspaceRoots, ['/home/user/project']);
  assert.strictEqual(config.maxFileSize, 1024);
});

test('RemoteSandboxService: matchPattern handles glob patterns', () => {
  const service = createService();
  service.configure({ forbiddenPatterns: ['*.log', 'temp-?'] });
  assert.strictEqual(service.checkPath('/path/error.log').allowed, false);
  assert.strictEqual(service.checkPath('/path/temp-A').allowed, false);
  // VC-P2-8: anchored glob temp-? matches exactly one char, so temp-AB should NOT be blocked
  assert.strictEqual(service.checkPath('/path/temp-AB').allowed, true);
});

test('teardown', () => { disableJSDOM(); });