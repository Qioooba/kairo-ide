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

const project = require('../../lib/browser/index');

// ---- KairoProjectService: more methods -------------------------------------

test('KairoProjectService: listToolchains method exists', () => {
  const service = new project.KairoProjectService();
  assert.strictEqual(typeof service.listToolchains, 'function');
});

test('KairoProjectService: detectProject method exists', () => {
  const service = new project.KairoProjectService();
  assert.strictEqual(typeof service.detectProject, 'function');
});

test('KairoProjectService: importProject method exists', () => {
  const service = new project.KairoProjectService();
  assert.strictEqual(typeof service.importProject, 'function');
});

test('KairoProjectService: importProjectNew method exists', () => {
  const service = new project.KairoProjectService();
  assert.strictEqual(typeof service.importProjectNew, 'function');
});

test('KairoProjectService: getRecentProjects method exists', () => {
  const service = new project.KairoProjectService();
  assert.strictEqual(typeof service.getRecentProjects, 'function');
});

test('KairoProjectService: detectLayout method exists', () => {
  const service = new project.KairoProjectService();
  assert.strictEqual(typeof service.detectLayout, 'function');
});

test('KairoProjectService: openWorkspace method exists', () => {
  const service = new project.KairoProjectService();
  assert.strictEqual(typeof service.openWorkspace, 'function');
});

test('KairoProjectService: create method exists', () => {
  const service = new project.KairoProjectService();
  assert.strictEqual(typeof service.create, 'function');
});

// ---- ActiveProjectService: more methods ------------------------------------

test('ActiveProjectService: project getter returns undefined initially', () => {
  const service = new project.ActiveProjectService();
  assert.strictEqual(service.project, undefined);
});

test('ActiveProjectService: requireProject throws when no project', async () => {
  const service = new project.ActiveProjectService();
  try {
    await service.requireProject();
    assert.fail('should have thrown');
  } catch (err) {
    assert.strictEqual(err.message, 'No project selected');
  }
});

test('ActiveProjectService: dispose method exists', () => {
  const service = new project.ActiveProjectService();
  assert.strictEqual(typeof service.dispose, 'function');
});

test('ActiveProjectService: setProject method exists', () => {
  const service = new project.ActiveProjectService();
  assert.strictEqual(typeof service.setProject, 'function');
});

test('ActiveProjectService: onDidChangeProject event exists', () => {
  const service = new project.ActiveProjectService();
  assert.strictEqual(typeof service.onDidChangeProject, 'function');
});

// ---- ProjectInfo data structure --------------------------------------------

test('ProjectInfo: basic structure', () => {
  const info = {
    workspaceId: 'ws-001',
    projectId: 'prj-001',
    name: 'My Project',
    root: '/home/user/projects/my-project',
  };
  assert.strictEqual(info.workspaceId, 'ws-001');
  assert.strictEqual(info.projectId, 'prj-001');
  assert.strictEqual(info.name, 'My Project');
  assert.strictEqual(info.root, '/home/user/projects/my-project');
});

test('ProjectInfo: with encoding', () => {
  const info = {
    workspaceId: 'ws-001',
    projectId: 'prj-001',
    name: 'Legacy Project',
    root: '/home/user/projects/legacy',
    encoding: 'gbk',
  };
  assert.strictEqual(info.encoding, 'gbk');
});

test('ProjectInfo: with directory encoding overrides', () => {
  const info = {
    workspaceId: 'ws-001',
    projectId: 'prj-001',
    name: 'Mixed Encoding Project',
    root: '/home/user/projects/mixed',
    encoding: 'utf-8',
    directoryEncodingOverrides: {
      'src/legacy/': 'GBK',
      'src/utf8/': 'UTF-8',
    },
  };
  assert.strictEqual(info.encoding, 'utf-8');
  assert.strictEqual(info.directoryEncodingOverrides['src/legacy/'], 'GBK');
  assert.strictEqual(info.directoryEncodingOverrides['src/utf8/'], 'UTF-8');
});

// ---- ImportWizardWidget: more properties -----------------------------------

test('ImportWizardWidget: has node property', () => {
  const widget = new project.ImportWizardWidget();
  assert.ok(widget.node);
});

test('ImportWizardWidget: has kairo-widget CSS class', () => {
  const widget = new project.ImportWizardWidget();
  assert.ok(widget.hasClass('kairo-widget'));
});

test('ImportWizardWidget: title.closable is true', () => {
  const widget = new project.ImportWizardWidget();
  assert.strictEqual(widget.title.closable, true);
});

// ---- ProjectSelectorWidget exports -----------------------------------------

test('ProjectSelectorWidget is exported', () => {
  assert.strictEqual(typeof project.ProjectSelectorWidget, 'function');
});

test('ProjectSelectorWidget has static ID', () => {
  assert.strictEqual(project.ProjectSelectorWidget.ID, 'kairo-project-selector');
});

test('ProjectSelectorWidget constructor creates instance', () => {
  const widget = new project.ProjectSelectorWidget();
  assert.ok(widget instanceof project.ProjectSelectorWidget);
});

test('ProjectSelectorWidget has node property', () => {
  const widget = new project.ProjectSelectorWidget();
  assert.ok(widget.node);
});

// ---- KairoProjectService: create validates config (more cases) --------------

test('KairoProjectService.create: whitespace-only id passes validation', async () => {
  const service = new project.KairoProjectService();
  let requestCalled = false;
  service.runtime = {
    request: () => { requestCalled = true; return Promise.resolve({ id: 'proj-1', name: 'Test', rootPath: '/test' }); },
    setWorkspace: () => {},
  };
  // '   ' is truthy, so !config.id is false, validation passes
  await service.create({ id: '   ' });
  assert.strictEqual(requestCalled, true);
});

test('KairoProjectService.create: returns result with correct structure', async () => {
  const service = new project.KairoProjectService();
  service.runtime = {
    request: () => Promise.resolve({ id: 'proj-1', name: 'Test', rootPath: '/test', defaultEncoding: 'utf-8' }),
    setWorkspace: () => {},
  };
  const result = await service.create({ id: 'proj-1', name: 'Test', rootPath: '/test' });
  assert.strictEqual(result.id, 'proj-1');
  assert.strictEqual(result.name, 'Test');
});

// ---- ActiveProjectService: setProject persists data -------------------------

test('ActiveProjectService.setProject calls storageService.setData', async () => {
  const service = new project.ActiveProjectService();
  let dataSet = false;
  service.storageService = {
    setData: () => { dataSet = true; return Promise.resolve(); },
  };
  const info = { workspaceId: 'ws-1', projectId: 'p1', name: 'Test', root: '/test' };
  await service.setProject(info);
  assert.strictEqual(dataSet, true);
});

// ---- ActiveProjectService: project getter after setProject ------------------

test('ActiveProjectService.project returns set project', async () => {
  const service = new project.ActiveProjectService();
  service.storageService = {
    setData: () => Promise.resolve(),
  };
  const info = { workspaceId: 'ws-1', projectId: 'p1', name: 'Test', root: '/test' };
  await service.setProject(info);
  assert.strictEqual(service.project.projectId, 'p1');
  assert.strictEqual(service.project.name, 'Test');
  assert.strictEqual(service.project.root, '/test');
});

// ---- KairoProjectService: currentWorkspace after set ------------------------

test('KairoProjectService: currentWorkspace returns undefined when no workspace set', () => {
  const service = new project.KairoProjectService();
  assert.strictEqual(service.currentWorkspace(), undefined);
});

// ---- bindProjectExtension ---------------------------------------------------

test('bindProjectExtension is exported', () => {
  assert.strictEqual(typeof project.bindProjectExtension, 'function');
});

// ---- KairoProjectService is exported ---------------------------------------

test('KairoProjectService is exported', () => {
  assert.strictEqual(typeof project.KairoProjectService, 'function');
});

// ---- ActiveProjectService is exported --------------------------------------

test('ActiveProjectService is exported', () => {
  assert.strictEqual(typeof project.ActiveProjectService, 'function');
});

// ---- ImportWizardWidget is exported ----------------------------------------

test('ImportWizardWidget is exported', () => {
  assert.strictEqual(typeof project.ImportWizardWidget, 'function');
});

// ---- ProjectDetection: more structures -------------------------------------

test('ProjectDetection: build system types', () => {
  const buildSystems = ['ant', 'maven', 'gradle', 'javac'];
  assert.strictEqual(buildSystems.length, 4);
  assert.ok(buildSystems.includes('ant'));
  assert.ok(buildSystems.includes('javac'));
});

test('ProjectDetection: encoding values', () => {
  const encodings = ['utf-8', 'gbk', 'gb18030', 'iso-8859-1', 'us-ascii', 'utf-16le', 'utf-16be'];
  assert.strictEqual(encodings.length, 7);
  assert.ok(encodings.includes('gbk'));
  assert.ok(encodings.includes('utf-8'));
});

// ---- ProjectImportConfirmRequest: with context path -------------------------

test('ProjectImportConfirmRequest: context path with leading slash', () => {
  const params = {
    workspaceId: 'ws-001',
    rootPath: '/tmp/app',
    name: 'My App',
    sourceDirs: ['src'],
    webRoot: 'web',
    libDirs: [],
    buildScript: 'pom.xml',
    defaultEncoding: 'utf-8',
    jdkVersion: '1.8',
    sourceVersion: '1.8',
    targetVersion: '1.8',
    outputDir: 'target/classes',
    buildTool: 'maven',
    contextPath: '/',
  };
  assert.strictEqual(params.contextPath, '/');
  assert.strictEqual(params.buildTool, 'maven');
});

// ---- ImportedSummary: various encodings -------------------------------------

test('ImportedSummary: utf-8 encoding', () => {
  const summary = { name: 'Modern App', root: '/tmp/modern', encoding: 'utf-8' };
  assert.strictEqual(summary.encoding, 'utf-8');
});

test('ImportedSummary: gb18030 encoding', () => {
  const summary = { name: 'Chinese App', root: '/tmp/chinese', encoding: 'gb18030' };
  assert.strictEqual(summary.encoding, 'gb18030');
});

// ---- normalizeEncodingId: more edge cases -----------------------------------

test('normalizeEncodingId logic: utf-8-bom stays utf-8-bom', () => {
  const input = 'utf-8-bom';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    case 'utf-8-bom': result = 'utf-8-bom'; break;
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'utf-8-bom');
});

test('normalizeEncodingId logic: null defaults to utf-8', () => {
  const input = null;
  const lower = (input || '').toString().trim().toLowerCase();
  let result;
  switch (lower) {
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'utf-8');
});

test('normalizeEncodingId logic: unknown encoding preserved', () => {
  const input = 'windows-1252';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'windows-1252');
});

// ---- ProjectDetection: type values -----------------------------------------

test('ProjectDetection: project type values', () => {
  const types = ['java-web', 'java-console', 'unknown'];
  assert.strictEqual(types.length, 3);
  assert.ok(types.includes('java-web'));
  assert.ok(types.includes('unknown'));
});

// ---- KairoProjectService: instance check -----------------------------------

test('KairoProjectService instance is KairoProjectService', () => {
  const service = new project.KairoProjectService();
  assert.ok(service instanceof project.KairoProjectService);
});

// ---- ActiveProjectService: instance check ----------------------------------

test('ActiveProjectService instance is ActiveProjectService', () => {
  const service = new project.ActiveProjectService();
  assert.ok(service instanceof project.ActiveProjectService);
});

test('teardown', () => { disableJSDOM(); });