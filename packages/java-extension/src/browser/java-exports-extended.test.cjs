'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const srcDir = __dirname;

describe('Java Extension — Key Exports (source check)', () => {
  it('index.ts exports KairoJavaService and bindJavaExtension', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /KairoJavaService/);
    assert.match(source, /bindJavaExtension/);
  });

  it('index.ts exports JavaLanguageServerLifecycle and related constants', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /JavaLanguageServerLifecycle/);
    assert.match(source, /JDT_LS_MAX_AUTO_RESTARTS/);
    assert.match(source, /JDT_LS_RESTART_BASE_DELAY_MS/);
    assert.match(source, /JDT_LS_RESTART_MAX_DELAY_MS/);
  });

  it('index.ts exports JavaCompletionProvider', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /JavaCompletionProvider/);
  });

  it('index.ts exports JavaMonacoRegistrationContribution', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /JavaMonacoRegistrationContribution/);
  });

  it('index.ts exports JavaDocumentSyncContribution and JavaDiagnosticsManager', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /JavaDocumentSyncContribution/);
    assert.match(source, /JavaDiagnosticsManager/);
  });

  it('index.ts exports JavaSaveActionsService', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /JavaSaveActionsService/);
  });

  it('index.ts exports JavaOrganizeImports and JavaRefactoring', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /JavaOrganizeImports/);
    assert.match(source, /JavaRefactoring/);
  });

  it('index.ts exports JavaHierarchyWidget and JavaHierarchyContribution', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /JavaHierarchyWidget/);
    assert.match(source, /JavaHierarchyContribution/);
  });

  it('index.ts exports JavaJUnitRunner', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /JavaJUnitRunner/);
  });
});

describe('Java Extension — Language Configuration', () => {
  it('Java monarch grammar source defines keywords', () => {
    const source = fs.readFileSync(path.join(srcDir, 'java-monarch.ts'), 'utf8');
    assert.match(source, /JAVA_MONARCH/);
    assert.match(source, /'class'/);
    assert.match(source, /'public'/);
    assert.match(source, /'interface'/);
    assert.match(source, /keywords:/);
  });
});

describe('Java Extension — Save Actions Configuration', () => {
  it('Java preference schema source is defined', () => {
    const source = fs.readFileSync(path.join(srcDir, 'java-preference-schema.ts'), 'utf8');
    assert.match(source, /javaPreferencesSchema/);
    assert.match(source, /export const/);
  });
});

describe('Java Extension — Debug Exports (source check)', () => {
  it('index.ts exports debug-related services', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /JavaExceptionBreakpointService/);
    assert.match(source, /JavaJvmProcessLister/);
    assert.match(source, /JavaBreakpointManager/);
    assert.match(source, /JavaThreadSwitchHelper/);
  });

  it('index.ts exports debug acceptance and compatibility checks', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /DebugAcceptanceRunner/);
    assert.match(source, /JavaSourceMismatchDetector/);
    assert.match(source, /JavaDebugCompatCheck/);
  });

  it('index.ts exports multi-module debug and hotswap', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /MultiModuleDebugManager/);
    assert.match(source, /JavaHotSwapService/);
  });
});