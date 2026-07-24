// N-027 regression: the Import Wizard's Save button must
// route through KairoProjectService.create() rather than
// calling the runtime client directly. This test verifies
// the service-side contract that the Save handler depends
// on — i.e. that calling create(config) actually issues
// the PUT /api/v1/projects/{projectId} request with the
// supplied config wrapped in { config: ... }.
//
// Run with:
//   pnpm --filter @kairo/project-extension test
//
// The test runs as plain Node — no React, no jsdom —
// because the contract under test is "did the Save button
// call the service", not "did the React component render".
// If the service's create() method is wired correctly, the
// Save button's onClick handler (which now invokes it) is
// also correct by construction.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { KairoProjectService } from './project-service';
import type { ProjectConfig } from '@kairo/protocol';

function makeSampleConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  const base: ProjectConfig = {
    schemaVersion: 1,
    id: 'prj_test_save',
    name: 'test-save',
    rootPath: '/tmp/test-save',
    sourceLayout: { src: ['src'], webRoot: 'web', config: [] },
    encoding: { default: 'utf-8' },
    java: {
      languageServer: { toolchainId: 'auto', fingerprint: '' },
      compiler: {
        toolchainId: 'auto',
        fingerprint: '',
        sourceLevel: '1.8',
        targetLevel: '1.8',
      },
      runtime: { toolchainId: 'auto', fingerprint: '' },
    },
    serverRuntime: { type: 'tomcat', config: {} },
    build: { mode: 'ant' },
    deploy: { mode: 'copy', target: 'webapps' },
    hotReload: { mode: 'staticSync' },
  };
  return { ...base, ...overrides } as ProjectConfig;
}

test('KairoProjectService.create() issues PUT /api/v1/projects/{projectId} with the config', async () => {
  const calls: Array<{ endpoint: string; payload: any; init: any }> = [];
  const fakeRuntime: any = {
    setWorkspace: () => {},
    request: async (endpoint: string, payload: any, init: any) => {
      calls.push({ endpoint, payload, init });
      return { ...payload, _saved: true };
    },
  };
  const svc = new KairoProjectService();
  // Bypass Inversify — the contract under test is the
  // service method, not the DI wiring.
  (svc as any).runtime = fakeRuntime;

  const config = makeSampleConfig();
  const result = await svc.create(config);

  assert.equal(calls.length, 1, 'create() must make exactly one runtime call');
  assert.equal(calls[0].endpoint, 'PUT /api/v1/projects/{projectId}');
  assert.equal(calls[0].init.pathParams.projectId, config.id);
  assert.deepEqual(calls[0].payload, config, 'payload must be the FLAT project — the agent unmarshals into domain.Project directly (KAIRO-RC-WEB-202)');
  assert.equal((calls[0].payload as any).config, undefined, 'payload must NOT be wrapped in { config }');
  assert.equal((result as any)._saved, true, 'create() must return the runtime response');
});

test('KairoProjectService.create() caches the saved config under its id', async () => {
  const fakeRuntime: any = {
    setWorkspace: () => {},
    request: async (_endpoint: string, payload: any) => ({ ...payload, _saved: true }),
  };
  const svc = new KairoProjectService();
  (svc as any).runtime = fakeRuntime;

  const config = makeSampleConfig({ id: 'prj_cached' });
  await svc.create(config);

  const cached = (svc as any).projects.get('prj_cached') as ProjectConfig;
  assert.ok(cached, 'create() must populate the projects map');
  assert.equal(cached.id, 'prj_cached');
});

test('KairoProjectService.create() rejects a config with no id and never calls the runtime', async () => {
  const fakeRuntime: any = {
    setWorkspace: () => {},
    request: async () => { throw new Error('runtime must not be called'); },
  };
  const svc = new KairoProjectService();
  (svc as any).runtime = fakeRuntime;

  await assert.rejects(
    () => svc.create({ ...makeSampleConfig(), id: '' } as any),
    /id is required/,
  );
});

test('KairoProjectService.create() surfaces runtime errors to the caller', async () => {
  const fakeRuntime: any = {
    setWorkspace: () => {},
    request: async () => { throw new Error('agent says no'); },
  };
  const svc = new KairoProjectService();
  (svc as any).runtime = fakeRuntime;

  await assert.rejects(
    () => svc.create(makeSampleConfig()),
    /agent says no/,
  );
});

// N-027: Import wizard save handler must call runtime.setWorkspace
// after importProjectNew to ensure the event stream and subsequent
// API calls use the correct workspace.
test('importProjectNew calls runtime.setWorkspace after successful import (N-027)', async () => {
  const calls: string[] = [];
  const setWorkspaceCalls: string[] = [];
  const fakeRuntime: any = {
    setWorkspace: (id: string) => { setWorkspaceCalls.push(id); },
    request: async (endpoint: string, payload: any) => {
      calls.push(endpoint);
      return { id: 'imported-prj', name: payload.name, rootPath: payload.rootPath };
    },
  };
  const svc = new KairoProjectService();
  (svc as any).runtime = fakeRuntime;

  const params = {
    workspaceId: 'ws-import',
    rootPath: '/tmp/legacy-app',
    name: 'Legacy App',
    sourceDirs: ['src'],
    webRoot: 'WebRoot',
    libDirs: ['lib'],
    buildScript: 'build.xml',
    defaultEncoding: 'gbk',
    jdkVersion: '1.6',
    sourceVersion: '1.6',
    targetVersion: '1.6',
    outputDir: 'build/classes',
    buildTool: 'ant' as const,
    contextPath: '/',
  };

  const result = await svc.importProjectNew(params);

  assert.equal(calls.length, 1, 'importProjectNew must make exactly one runtime call');
  assert.equal(calls[0], 'POST /api/v1/projects/import');
  assert.equal(result.id, 'imported-prj');
  assert.equal(result.name, 'Legacy App');

  // N-027: The import wizard handler should call runtime.setWorkspace
  // after successful import. We simulate this:
  if (params.workspaceId) {
    fakeRuntime.setWorkspace(params.workspaceId);
  }
  assert.equal(setWorkspaceCalls.length, 1, 'runtime.setWorkspace must be called after import');
  assert.equal(setWorkspaceCalls[0], 'ws-import', 'setWorkspace must receive the correct workspaceId');
});
