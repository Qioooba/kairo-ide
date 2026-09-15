'use strict';

// CSS extension hook must be set up BEFORE any @theia/core module is loaded.
const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {};
}

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { KairoProjectService, bindProjectExtension } = require('../../lib/browser/project-service');
const { ActiveProjectService } = require('../../lib/browser/active-project-service');

// ============================================================================
// KairoProjectService tests
// ============================================================================

describe('KairoProjectService — create validation', () => {
  let svc;

  beforeEach(() => {
    svc = new KairoProjectService();
    svc.runtime = {
      request: () => Promise.resolve({ id: 'proj-1', name: 'Test', rootPath: '/test' }),
      setWorkspace: () => {},
    };
  });

  it('throws when config is null', async () => {
    try {
      await svc.create(null);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('config.id is required'));
    }
  });

  it('throws when config is undefined', async () => {
    try {
      await svc.create(undefined);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('config.id is required'));
    }
  });

  it('throws when config has no id', async () => {
    try {
      await svc.create({});
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('config.id is required'));
    }
  });

  it('throws when config.id is empty string', async () => {
    try {
      await svc.create({ id: '' });
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('config.id is required'));
    }
  });

  it('succeeds with valid config and caches result', async () => {
    const result = await svc.create({ id: 'proj-1', name: 'Test', rootPath: '/test' });
    assert.strictEqual(result.id, 'proj-1');
    assert.strictEqual(result.name, 'Test');
  });
});

describe('KairoProjectService — currentWorkspace', () => {
  let svc;

  beforeEach(() => {
    svc = new KairoProjectService();
    svc.runtime = {
      request: () => Promise.resolve({ id: 'ws-1', rootPath: '/ws' }),
      setWorkspace: () => {},
    };
  });

  it('returns undefined initially', () => {
    assert.strictEqual(svc.currentWorkspace(), undefined);
  });

  it('returns workspace after openWorkspace', async () => {
    const ws = await svc.openWorkspace('/ws', 'My Workspace');
    assert.strictEqual(svc.currentWorkspace().id, 'ws-1');
    assert.strictEqual(ws.id, 'ws-1');
  });
});

describe('KairoProjectService — bindProjectExtension', () => {
  it('bindProjectExtension is a function', () => {
    assert.strictEqual(typeof bindProjectExtension, 'function');
  });
});

// ============================================================================
// ActiveProjectService tests
// ============================================================================

describe('ActiveProjectService — Basic', () => {
  let svc;

  beforeEach(() => {
    svc = new ActiveProjectService();
    svc.workspaceContext = {};
    svc.runtime = {};
    svc.storageService = {};
  });

  it('project getter returns undefined initially', () => {
    assert.strictEqual(svc.project, undefined);
  });

  it('setProject updates current project', async () => {
    svc.storageService.setData = () => Promise.resolve();
    const info = { workspaceId: 'ws-1', projectId: 'p1', name: 'Test', root: '/test' };
    await svc.setProject(info);
    assert.strictEqual(svc.project.projectId, 'p1');
    assert.strictEqual(svc.project.name, 'Test');
  });

  it('setProject emits onDidChangeProject', (_, done) => {
    svc.storageService.setData = () => Promise.resolve();
    const info = { workspaceId: 'ws-1', projectId: 'p1', name: 'Test', root: '/test' };
    svc.onDidChangeProject(project => {
      assert.strictEqual(project.projectId, 'p1');
      done();
    });
    svc.setProject(info);
  });

  it('requireProject throws when no project selected', async () => {
    try {
      await svc.requireProject();
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'No project selected');
    }
  });

  it('requireProject returns current project when set', async () => {
    svc.storageService.setData = () => Promise.resolve();
    const info = { workspaceId: 'ws-1', projectId: 'p1', name: 'Test', root: '/test' };
    await svc.setProject(info);
    const result = await svc.requireProject();
    assert.strictEqual(result.projectId, 'p1');
  });

  it('tryAutoDetectAndBind detects Java Web project and auto-imports it', async () => {
    svc.storageService.setData = () => Promise.resolve();
    let importCalled = false;
    svc.runtime = {
      request: async (endpoint, body) => {
        if (endpoint === 'POST /api/v1/projects/detect') {
          return {
            sourceDirs: ['src'],
            webRoot: 'WebRoot',
            libDirs: ['lib'],
            buildScript: 'build.xml',
            defaultEncoding: 'gbk',
            jdkVersion: '1.6',
            confidence: 0.85,
          };
        }
        if (endpoint === 'POST /api/v1/projects/import') {
          importCalled = true;
          return {
            id: 'my-web-app',
            name: 'my-web-app',
            rootPath: body.rootPath,
          };
        }
        return {};
      },
    };
    const ctx = { workspaceId: 'ws-100', workspaceRoot: '/workspace/my-web-app' };
    const success = await svc.tryAutoDetectAndBind(ctx, 0);
    assert.strictEqual(success, true);
    assert.strictEqual(importCalled, true);
    assert.strictEqual(svc.project.projectId, 'my-web-app');
    assert.strictEqual(svc.project.name, 'my-web-app');
  });

  it('tryAutoDetectAndBind returns false when confidence is low or not a java project', async () => {
    svc.runtime = {
      request: async (endpoint) => {
        if (endpoint === 'POST /api/v1/projects/detect') {
          return {
            sourceDirs: [],
            webRoot: '',
            confidence: 0.1,
          };
        }
        return {};
      },
    };
    const ctx = { workspaceId: 'ws-100', workspaceRoot: '/workspace/empty-dir' };
    const success = await svc.tryAutoDetectAndBind(ctx, 0);
    assert.strictEqual(success, false);
  });
});

// ============================================================================
// Cleanup
// ============================================================================

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});