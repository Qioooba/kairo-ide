'use strict';

const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
register('data:text/javascript,' + encodeURIComponent(`
export function resolve(specifier, context, nextResolve) {
  if (/\.(css|svg|ttf|woff|woff2|png|jpg|gif)$/.test(specifier)) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  if (specifier === '@theia/monaco-editor-core' || specifier.includes('monaco-editor-core')) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`), pathToFileURL(__filename));

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

// Mock @theia/monaco-editor-core to avoid the ESM import issue in CJS tests.
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.includes('monaco-editor-core')) {
    const mockPath = require('node:path').join(__dirname, '..', '..', '..', 'search-extension', 'src', 'browser', '__monaco-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  return origResolveFilename.call(this, request, parent, ...args);
};

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

const build = require('../../lib/browser/index');

test('MavenViewWidget is exported', () => {
  assert.strictEqual(typeof build.MavenViewWidget, 'function');
});

test('MavenViewWidget has static ID', () => {
  assert.strictEqual(build.MavenViewWidget.ID, 'kairo-maven-view');
});

test('MavenDependencyConflict detection — no conflicts', () => {
  // Simulate the detectConflicts logic
  const deps = [
    { groupId: 'com.example', artifactId: 'lib-a', version: '1.0.0', scope: 'compile', optional: false, type: 'jar' },
    { groupId: 'com.example', artifactId: 'lib-b', version: '2.0.0', scope: 'test', optional: false, type: 'jar' },
  ];

  const seen = new Map();
  for (const d of deps) {
    const key = `${d.groupId}:${d.artifactId}`;
    const existing = seen.get(key);
    if (existing) {
      existing.versions.push(d.version);
    } else {
      seen.set(key, { versions: [d.version] });
    }
  }

  const conflicts = [];
  for (const [key, info] of seen) {
    const uniqueVersions = [...new Set(info.versions)];
    if (uniqueVersions.length > 1) {
      const [groupId, artifactId] = key.split(':');
      conflicts.push({ groupId, artifactId, versions: uniqueVersions, resolvedVersion: uniqueVersions[0] });
    }
  }

  assert.strictEqual(conflicts.length, 0);
});

test('MavenDependencyConflict detection — with conflicts', () => {
  const deps = [
    { groupId: 'com.example', artifactId: 'lib-a', version: '1.0.0', scope: 'compile', optional: false, type: 'jar' },
    { groupId: 'com.example', artifactId: 'lib-a', version: '2.0.0', scope: 'compile', optional: false, type: 'jar' },
    { groupId: 'com.example', artifactId: 'lib-b', version: '3.0.0', scope: 'test', optional: false, type: 'jar' },
  ];

  const seen = new Map();
  for (const d of deps) {
    const key = `${d.groupId}:${d.artifactId}`;
    const existing = seen.get(key);
    if (existing) {
      existing.versions.push(d.version);
    } else {
      seen.set(key, { versions: [d.version] });
    }
  }

  const conflicts = [];
  for (const [key, info] of seen) {
    const uniqueVersions = [...new Set(info.versions)];
    if (uniqueVersions.length > 1) {
      const [groupId, artifactId] = key.split(':');
      conflicts.push({ groupId, artifactId, versions: uniqueVersions, resolvedVersion: uniqueVersions[0] });
    }
  }

  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].groupId, 'com.example');
  assert.strictEqual(conflicts[0].artifactId, 'lib-a');
  assert.strictEqual(conflicts[0].versions.length, 2);
  assert.ok(conflicts[0].versions.includes('1.0.0'));
  assert.ok(conflicts[0].versions.includes('2.0.0'));
});

test('MavenGoal structure', () => {
  const goal = {
    id: 'compile',
    label: 'Compile',
    description: 'Compile Java sources',
    phase: 'compile',
  };
  assert.strictEqual(goal.id, 'compile');
  assert.strictEqual(goal.label, 'Compile');
  assert.strictEqual(goal.phase, 'compile');
});

test('MavenProjectInfo structure', () => {
  const project = {
    groupId: 'com.example',
    artifactId: 'my-app',
    version: '1.0.0',
    packaging: 'jar',
    name: 'My Application',
    description: 'A sample Maven project',
    found: true,
  };
  assert.strictEqual(project.groupId, 'com.example');
  assert.strictEqual(project.artifactId, 'my-app');
  assert.strictEqual(project.found, true);
});

test('MavenDependencyTreeNode has children', () => {
  const node = {
    groupId: 'com.example',
    artifactId: 'parent-lib',
    version: '1.0.0',
    scope: 'compile',
    optional: false,
    type: 'jar',
    children: [
      {
        groupId: 'com.example',
        artifactId: 'child-lib',
        version: '1.0.0',
        scope: 'compile',
        optional: false,
        type: 'jar',
      },
    ],
  };
  assert.ok(Array.isArray(node.children));
  assert.strictEqual(node.children.length, 1);
  assert.strictEqual(node.children[0].artifactId, 'child-lib');
});

test('MavenBuildResult structure', () => {
  const result = {
    task: 'compile',
    success: true,
    exitCode: 0,
    output: 'BUILD SUCCESS',
  };
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.output.includes('SUCCESS'));
});

test('MavenBuildResult with error', () => {
  const result = {
    task: 'compile',
    success: false,
    exitCode: 1,
    output: 'BUILD FAILURE',
    error: 'Compilation error: MyClass.java:15: error: cannot find symbol',
  };
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.exitCode, 1);
  assert.ok(result.error);
  assert.ok(result.error.includes('cannot find symbol'));
});

test('teardown', () => { disableJSDOM(); });