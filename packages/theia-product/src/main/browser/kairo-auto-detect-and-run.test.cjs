'use strict';

const { disableJSDOM } = require('../../../test/frontend-setup.cjs');

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDefaultTomcatRunConfiguration,
  emptyRunConfigurationDocument,
  KairoRunConfigurationService,
} = require('../../../lib/browser/kairo-run-configuration-service');
const { ActiveProjectService } = require('@kairo/project-extension/lib/browser/active-project-service');

test('E2E reproduction flow: opening an unconfigured Java Web folder auto-detects, auto-binds, and seeds default Tomcat config', async () => {
  // 1. Mock backend state
  const mockWorkspace = { id: 'ws-demo', rootPath: 'D:/projects/my-legacy-web' };
  let catalogProjects = [];
  let runConfigDoc = emptyRunConfigurationDocument();
  let importParams = null;
  let notifications = [];

  const mockRuntime = {
    workspace: () => mockWorkspace.id,
    request: async (endpoint, payload, init) => {
      if (endpoint === 'GET /api/v1/projects') {
        return catalogProjects;
      }
      if (endpoint === 'POST /api/v1/projects/detect') {
        // Backend scanner detects WebRoot, build.xml, src
        return {
          sourceDirs: ['src'],
          webRoot: 'WebRoot',
          libDirs: ['lib'],
          buildScript: 'build.xml',
          defaultEncoding: 'gbk',
          jdkVersion: '1.6',
          sourceVersion: '1.6',
          targetVersion: '1.6',
          outputDir: 'build/classes',
          buildSystem: 'ant',
          confidence: 0.85,
          warnings: [],
        };
      }
      if (endpoint === 'POST /api/v1/projects/import') {
        importParams = payload;
        const newProj = {
          id: 'my-legacy-web',
          name: payload.name,
          rootPath: payload.rootPath,
        };
        catalogProjects.push(newProj);
        return newProj;
      }
      if (endpoint === 'GET /api/v1/workspaces/{workspaceId}/run-configurations') {
        return runConfigDoc;
      }
      if (endpoint === 'POST /api/v1/workspaces/{workspaceId}/run-configurations') {
        runConfigDoc = {
          version: 1,
          configurations: [payload],
          selectedConfigurationId: payload.id,
        };
        return runConfigDoc;
      }
      return {};
    },
  };

  const mockStorageService = {
    data: {},
    setData: async (k, v) => { mockStorageService.data[k] = v; },
    getData: async (k) => mockStorageService.data[k],
  };

  const mockMessageService = {
    info: async (msg, action) => {
      notifications.push({ msg, action });
      return action;
    },
  };

  // 2. ActiveProjectService initialization
  const activeProjectSvc = new ActiveProjectService();
  activeProjectSvc.runtime = mockRuntime;
  activeProjectSvc.storageService = mockStorageService;
  activeProjectSvc.messageService = mockMessageService;
  activeProjectSvc.workspaceContext = {
    detectedProject: undefined, // No on-disk .kairo/project.yaml initially
    onDidChangeContext: (fn) => {
      activeProjectSvc._contextHandler = fn;
      return { dispose: () => {} };
    },
  };

  // 3. KairoRunConfigurationService initialization
  const runConfigSvc = new KairoRunConfigurationService();
  runConfigSvc.runtime = mockRuntime;
  runConfigSvc.activeProject = activeProjectSvc;
  runConfigSvc.servers = { adopt: s => s, forget: () => {} };
  runConfigSvc.javaDebug = { probeAvailability: async () => ({ state: 'available' }) };
  runConfigSvc.commands = { executeCommand: async () => {} };

  // 4. Simulate user opening folder "D:/projects/my-legacy-web"
  // This triggers onDidChangeContext with ws-demo
  const context = {
    workspaceId: mockWorkspace.id,
    workspaceRoot: mockWorkspace.rootPath,
  };

  // Fire context change (simulating ActiveProjectService init)
  let boundProject;
  activeProjectSvc.onDidChangeProject(p => {
    boundProject = p;
    // When project changes, run config service seeds default config
    if (p && runConfigSvc.current.document.configurations.length === 0) {
      void runConfigSvc.ensureDefaultConfiguration(p);
    }
  });

  // Call the auto-detection directly to test the flow
  const detectedAndBound = await activeProjectSvc.tryAutoDetectAndBind(context, 0);

  // 5. Verify auto-detection and auto-binding
  assert.equal(detectedAndBound, true, 'Project must be detected and bound');
  assert.ok(importParams, 'Project import must have been triggered');
  assert.equal(importParams.name, 'my-legacy-web', 'Project name should match folder basename');
  assert.equal(importParams.webRoot, 'WebRoot');
  assert.equal(importParams.defaultEncoding, 'gbk');
  assert.equal(importParams.buildTool, 'ant');

  assert.ok(boundProject, 'Active project must be emitted');
  assert.equal(boundProject.projectId, 'my-legacy-web');
  assert.equal(boundProject.root, 'D:/projects/my-legacy-web');

  // Verify notification was presented to user
  assert.ok(notifications.length >= 1, 'User notification must be shown');
  assert.match(notifications[0].msg, /已自动识别并关联.*my-legacy-web/);

  // 6. Verify default Tomcat run configuration was seeded
  const currentRunConfig = runConfigSvc.current.document;
  assert.equal(currentRunConfig.configurations.length, 1, 'Default run configuration must be seeded');
  const seeded = currentRunConfig.configurations[0];
  assert.equal(seeded.id, 'tomcat-my-legacy-web');
  assert.equal(seeded.name, 'Tomcat 6: my-legacy-web');
  assert.equal(seeded.type, 'tomcat6');
  assert.equal(seeded.projectId, 'my-legacy-web');
  assert.equal(seeded.mode, 'run');
  assert.equal(seeded.server.httpPort, 18080);
  assert.equal(seeded.server.debugPort, 8000);
  assert.equal(seeded.server.contextPath, '/');
  assert.equal(currentRunConfig.selectedConfigurationId, 'tomcat-my-legacy-web');

  // 7. Test empty folder fallback (unconfigured folder prompt)
  notifications = [];
  const emptyContext = { workspaceId: 'ws-empty', workspaceRoot: 'D:/empty-folder' };
  mockRuntime.request = async (endpoint) => {
    if (endpoint === 'POST /api/v1/projects/detect') {
      return { confidence: 0.1, sourceDirs: [], webRoot: '' };
    }
    return [];
  };

  const emptyResult = await activeProjectSvc.tryAutoDetectAndBind(emptyContext, activeProjectSvc.generation);
  assert.equal(emptyResult, false, 'Non-project directory must not be bound');
  activeProjectSvc.promptUnconfiguredFolder(emptyContext.workspaceId);
  assert.equal(notifications.length, 1, 'Prompt must be displayed for unconfigured folder');
  assert.match(notifications[0].msg, /尚未配置为 Kairo 项目/);
  assert.equal(notifications[0].action, '导入项目');
});

test('teardown', () => disableJSDOM());
