'use strict';

// CSS extension hook must be set up BEFORE any @theia/core module is loaded.
const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

// Set up JSDOM so @lumino/domutils has access to `navigator`.
const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();

// JSDOM does not expose DragEvent as a global; @lumino/dragdrop needs it.
if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {};
}

// Theia requires FrontendApplicationConfigProvider to be set before
// any browser module is loaded.
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', '..', 'lib', 'browser', 'index.js');

describe('Project Extension — Project Service Exports', () => {
  it('exports KairoProjectService', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.KairoProjectService, 'function', 'KairoProjectService should be exported');
  });

  it('exports bindProjectExtension', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.bindProjectExtension, 'function', 'bindProjectExtension should be exported');
  });
});

describe('Project Extension — Active Project Service Exports', () => {
  it('exports ActiveProjectService', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.ActiveProjectService, 'function', 'ActiveProjectService should be exported');
  });
});

describe('Project Extension — Import Wizard Exports', () => {
  it('exports ImportWizardWidget', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.ImportWizardWidget, 'function', 'ImportWizardWidget should be exported');
  });
});

describe('Project Extension — Project Selector Exports', () => {
  it('exports ProjectSelectorWidget', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.ProjectSelectorWidget, 'function', 'ProjectSelectorWidget should be exported');
  });
});

describe('Project Extension — ProjectService Source Checks', () => {
  it('project-service source contains key methods', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(path.join(__dirname, 'project-service.ts'), 'utf8');
    assert.match(source, /async openWorkspace\(/);
    assert.match(source, /async importProject\(/);
    assert.match(source, /async detectLayout\(/);
    assert.match(source, /async listToolchains\(/);
  });
});

describe('Project Extension — ActiveProjectService Source Checks', () => {
  it('active-project-service source contains project management methods', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(path.join(__dirname, 'active-project-service.ts'), 'utf8');
    assert.match(source, /setProject\(/);
    assert.match(source, /get project\(\)/);
  });
});