'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const srcDir = __dirname;

describe('Theia Product — Frontend Module Exports', () => {
  it('kairo-product-frontend-module source imports key widgets', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-product-frontend-module.ts'), 'utf8');
    assert.match(source, /KairoViewsContribution/);
    assert.match(source, /KairoStatusBarContribution/);
    assert.match(source, /KairoEditorContribution/);
    assert.match(source, /KairoWindowTitleContribution/);
  });

  it('kairo-product-frontend-module imports service layer bindings', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-product-frontend-module.ts'), 'utf8');
    assert.match(source, /RuntimeConnectionService/);
    assert.match(source, /KairoRuntime/);
    assert.match(source, /ImportWizardWidget/);
    assert.match(source, /BuildViewWidget/);
  });
});

describe('Theia Product — Views Contribution', () => {
  it('kairo-views-contribution source imports key services', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-views-contribution.tsx'), 'utf8');
    assert.match(source, /KairoServerService/);
    assert.match(source, /KairoProjectService/);
    assert.match(source, /RuntimeConnectionService/);
    assert.match(source, /BuildViewWidget/);
  });

  it('kairo-views-contribution exports KairoDeploymentsWidget', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-views-contribution.tsx'), 'utf8');
    assert.match(source, /KairoDeploymentsWidget/);
    assert.match(source, /KairoViewsContribution/);
  });
});

describe('Theia Product — Editor Contribution', () => {
  it('kairo-editor-contribution source contains key methods', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-editor-contribution.ts'), 'utf8');
    assert.match(source, /KairoEditorContribution/);
    assert.match(source, /onStart\(/);
    assert.match(source, /ExternalChangeDialog/);
  });
});

describe('Theia Product — Settings Service', () => {
  it('kairo-settings-service source exists and exports KairoSettingsService', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-settings-service.ts'), 'utf8');
    assert.match(source, /KairoSettingsService/);
    assert.match(source, /export class/);
  });
});

describe('Theia Product — File Commands', () => {
  it('kairo-file-commands source exports KairoFileCommandsContribution', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-file-commands.ts'), 'utf8');
    assert.match(source, /KairoFileCommandsContribution/);
    assert.match(source, /export class/);
  });
});

describe('Theia Product — Navigation Contribution', () => {
  it('kairo-navigation-contribution source exports navigation contribution', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-navigation-contribution.ts'), 'utf8');
    assert.match(source, /KairoNavigationContribution/);
    assert.match(source, /export class/);
  });
});

describe('Theia Product — Status Bar Contribution', () => {
  it('kairo-status-bar-contribution source exports contribution', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-status-bar-contribution.ts'), 'utf8');
    assert.match(source, /KairoStatusBarContribution/);
    assert.match(source, /export class/);
  });
});

describe('Theia Product — Saveable Service', () => {
  it('kairo-saveable-service source exports KairoSaveableService', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-saveable-service.ts'), 'utf8');
    assert.match(source, /KairoSaveableService/);
    assert.match(source, /export class/);
  });
});

describe('Theia Product — Window Title', () => {
  it('kairo-window-title-contribution source exports contribution', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-window-title-contribution.ts'), 'utf8');
    assert.match(source, /KairoWindowTitleContribution/);
    assert.match(source, /export class/);
  });
});

describe('Theia Product — Factory IDs', () => {
  it('kairo-factory-ids source exports factory ID constants', () => {
    const source = fs.readFileSync(path.join(srcDir, 'kairo-factory-ids.ts'), 'utf8');
    assert.match(source, /KAIRO_SERVERS_FACTORY_ID/);
    assert.match(source, /KAIRO_BUILDS_FACTORY_ID/);
    assert.match(source, /KAIRO_DEPLOYMENTS_FACTORY_ID/);
  });
});