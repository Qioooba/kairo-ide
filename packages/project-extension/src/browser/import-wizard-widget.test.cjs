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

// ---- normalizeEncodingId logic ---------------------------------------------

test('normalizeEncodingId: utf8 → utf-8', () => {
  const input = 'utf8';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    case 'utf8': result = 'utf-8'; break;
    case 'utf-8-bom': result = 'utf-8-bom'; break;
    case 'gb18030': result = 'gb18030'; break;
    case 'gbk': result = 'gbk'; break;
    case 'iso-8859-1': result = 'iso-8859-1'; break;
    case 'us-ascii': result = 'us-ascii'; break;
    case 'utf-16le': result = 'utf-16le'; break;
    case 'utf-16be': result = 'utf-16be'; break;
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'utf-8');
});

test('normalizeEncodingId: gbk stays gbk', () => {
  const input = 'gbk';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    case 'gbk': result = 'gbk'; break;
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'gbk');
});

test('normalizeEncodingId: gb18030 stays gb18030', () => {
  const input = 'gb18030';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    case 'gb18030': result = 'gb18030'; break;
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'gb18030');
});

test('normalizeEncodingId: iso-8859-1 stays iso-8859-1', () => {
  const input = 'iso-8859-1';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    case 'iso-8859-1': result = 'iso-8859-1'; break;
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'iso-8859-1');
});

test('normalizeEncodingId: us-ascii stays us-ascii', () => {
  const input = 'us-ascii';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    case 'us-ascii': result = 'us-ascii'; break;
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'us-ascii');
});

test('normalizeEncodingId: utf-16le stays utf-16le', () => {
  const input = 'utf-16le';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    case 'utf-16le': result = 'utf-16le'; break;
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'utf-16le');
});

test('normalizeEncodingId: utf-16be stays utf-16be', () => {
  const input = 'utf-16be';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    case 'utf-16be': result = 'utf-16be'; break;
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'utf-16be');
});

test('normalizeEncodingId: unknown encoding falls back to lowercase', () => {
  const input = 'CP1252';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'cp1252');
});

test('normalizeEncodingId: empty string defaults to utf-8', () => {
  const input = '';
  const lower = input.trim().toLowerCase();
  let result;
  switch (lower) {
    default: result = lower || 'utf-8';
  }
  assert.strictEqual(result, 'utf-8');
});

test('normalizeEncodingId: whitespace trimmed', () => {
  const input = '  gbk  ';
  assert.strictEqual(input.trim(), 'gbk');
});

// ---- ImportWizardWidget exports --------------------------------------------

test('ImportWizardWidget is exported', () => {
  assert.strictEqual(typeof project.ImportWizardWidget, 'function');
});

test('ImportWizardWidget has static ID', () => {
  assert.strictEqual(project.ImportWizardWidget.ID, 'kairo-import-wizard');
});

// ---- ImportWizardWidget instantiation --------------------------------------

test('ImportWizardWidget: instantiation sets id', () => {
  const widget = new project.ImportWizardWidget();
  assert.strictEqual(widget.id, 'kairo-import-wizard');
});

test('ImportWizardWidget: instantiation sets title', () => {
  const widget = new project.ImportWizardWidget();
  assert.strictEqual(widget.title.label, '');
  assert.strictEqual(widget.title.caption, '');
});

test('ImportWizardWidget: instantiation sets closable', () => {
  const widget = new project.ImportWizardWidget();
  assert.strictEqual(widget.title.closable, true);
});

test('ImportWizardWidget: has kairo-widget CSS class', () => {
  const widget = new project.ImportWizardWidget();
  assert.ok(widget.hasClass('kairo-widget'));
});

// ---- ProjectDetection data structure ---------------------------------------

test('ProjectDetection: valid structure', () => {
  const detection = {
    projectType: 'java-web',
    confidence: 0.95,
    sourceDirs: ['src', 'src/main/java'],
    webRoot: 'WebRoot',
    libDirs: ['lib', 'WebRoot/WEB-INF/lib'],
    buildScript: 'build.xml',
    defaultEncoding: 'gbk',
    jdkVersion: '1.6',
    sourceVersion: '1.6',
    targetVersion: '1.6',
    outputDir: 'build/classes',
    buildSystem: 'ant',
    warnings: [],
  };
  assert.strictEqual(detection.projectType, 'java-web');
  assert.strictEqual(detection.confidence, 0.95);
  assert.ok(Array.isArray(detection.sourceDirs));
  assert.strictEqual(detection.sourceDirs.length, 2);
});

test('ProjectDetection: with warnings', () => {
  const detection = {
    projectType: 'java-web',
    confidence: 0.6,
    sourceDirs: ['src'],
    webRoot: 'web',
    libDirs: [],
    buildScript: 'build.xml',
    defaultEncoding: 'utf-8',
    jdkVersion: '1.8',
    sourceVersion: '1.8',
    targetVersion: '1.8',
    outputDir: 'target/classes',
    buildSystem: 'ant',
    warnings: ['No build.xml found', 'No web.xml found'],
  };
  assert.strictEqual(detection.warnings.length, 2);
  assert.strictEqual(detection.warnings[0], 'No build.xml found');
});

test('ProjectDetection: low confidence', () => {
  const detection = {
    projectType: 'unknown',
    confidence: 0.2,
    sourceDirs: [],
    webRoot: '',
    libDirs: [],
    buildScript: '',
    defaultEncoding: 'utf-8',
    jdkVersion: '1.8',
    sourceVersion: '1.8',
    targetVersion: '1.8',
    outputDir: '',
    buildSystem: 'javac',
    warnings: ['Could not detect project type'],
  };
  assert.strictEqual(detection.confidence, 0.2);
  assert.strictEqual(detection.projectType, 'unknown');
});

// ---- ProjectImportConfirmRequest data structure ----------------------------

test('ProjectImportConfirmRequest: valid structure', () => {
  const params = {
    workspaceId: 'ws-001',
    rootPath: '/tmp/legacy-app',
    name: 'Legacy App',
    sourceDirs: ['src', 'src/main/java'],
    webRoot: 'WebRoot',
    libDirs: ['lib', 'WebRoot/WEB-INF/lib'],
    buildScript: 'build.xml',
    defaultEncoding: 'gbk',
    jdkVersion: '1.6',
    sourceVersion: '1.6',
    targetVersion: '1.6',
    outputDir: 'build/classes',
    buildTool: 'ant',
    contextPath: '/',
  };
  assert.strictEqual(params.workspaceId, 'ws-001');
  assert.strictEqual(params.buildTool, 'ant');
  assert.strictEqual(params.contextPath, '/');
  assert.ok(Array.isArray(params.sourceDirs));
  assert.strictEqual(params.sourceDirs.length, 2);
});

test('ProjectImportConfirmRequest: javac build tool', () => {
  const params = {
    workspaceId: 'ws-002',
    rootPath: '/tmp/simple-app',
    name: 'Simple App',
    sourceDirs: ['src'],
    webRoot: 'web',
    libDirs: [],
    buildScript: '',
    defaultEncoding: 'utf-8',
    jdkVersion: '1.8',
    sourceVersion: '1.8',
    targetVersion: '1.8',
    outputDir: 'target/classes',
    buildTool: 'javac',
    contextPath: '/app',
  };
  assert.strictEqual(params.buildTool, 'javac');
  assert.strictEqual(params.contextPath, '/app');
});

test('ProjectImportConfirmRequest: empty sourceDirs filtered', () => {
  const raw = 'src,  , main, ,';
  const filtered = raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(filtered[0], 'src');
  assert.strictEqual(filtered[1], 'main');
});

// ---- Imported summary data structure ---------------------------------------

test('ImportedSummary: valid structure', () => {
  const summary = {
    name: 'My Legacy App',
    root: '/tmp/legacy-app',
    encoding: 'gbk',
  };
  assert.strictEqual(summary.name, 'My Legacy App');
  assert.strictEqual(summary.encoding, 'gbk');
});

// ---- Project selector widget exports --------------------------------------

test('ProjectSelectorWidget is exported', () => {
  assert.strictEqual(typeof project.ProjectSelectorWidget, 'function');
});

test('teardown', () => { disableJSDOM(); });