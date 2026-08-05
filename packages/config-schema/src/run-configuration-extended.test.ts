// config-schema — extended contract tests for run-configuration.
//
// Run with:
//   pnpm --filter @kairo/config-schema test
//   (or)  node --require ts-node/register --require source-map-support/register --test src/run-configuration-extended.test.ts

import { test } from 'node:test';
import assert from 'node:assert';
import type { TomcatRunConfiguration, RunConfigurationDocument } from '@kairo/protocol';
import {
  RunConfigurationValidationError,
  parseRunConfigurationDocument,
  serializeRunConfigurationDocument,
  validateRunConfigurationDocument,
} from './run-configuration';

function configuration(overrides: Partial<TomcatRunConfiguration> = {}): TomcatRunConfiguration {
  return {
    id: 'cfg-1',
    name: 'Default Config',
    type: 'tomcat6',
    projectId: 'proj-1',
    mode: 'run',
    suspend: false,
    jdkRef: 'jdk-1',
    build: { type: 'javac', clean: true },
    server: { id: 'srv-1', httpPort: 8080, debugPort: 8000, contextPath: '/app' },
    deploy: { mode: 'exploded', artifact: 'dist/app' },
    env: { JAVA_HOME: '/usr/lib/jvm/java-6' },
    vmOptions: ['-Xmx512m'],
    beforeLaunchTasks: ['build'],
    ...overrides,
  };
}

function document(configurations = [configuration()]): RunConfigurationDocument {
  return {
    version: 1,
    configurations,
    selectedConfigurationId: configurations[0]?.id || null,
  };
}

// ---- Schema validation edge cases ------------------------------------------

test('rejects empty configurations with non-null selectedConfigurationId', () => {
  const result = validateRunConfigurationDocument({
    version: 1,
    configurations: [],
    selectedConfigurationId: 'cfg-1',
  });
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some(i => i.path === '/selectedConfigurationId'));
  }
});

test('accepts empty configurations with null selectedConfigurationId', () => {
  const result = validateRunConfigurationDocument({
    version: 1,
    configurations: [],
    selectedConfigurationId: null,
  });
  assert.strictEqual(result.valid, true);
});

test('rejects configuration with empty name', () => {
  const result = validateRunConfigurationDocument(document([configuration({ name: '' })]));
  assert.strictEqual(result.valid, false);
});

test('rejects configuration with whitespace-only name', () => {
  const result = validateRunConfigurationDocument(document([configuration({ name: '   ' })]));
  assert.strictEqual(result.valid, false);
});

test('rejects configuration with invalid id format', () => {
  const result = validateRunConfigurationDocument(document([configuration({ id: 'bad id!' })]));
  assert.strictEqual(result.valid, false);
});

test('accepts configuration with valid id format', () => {
  const result = validateRunConfigurationDocument(document([configuration({ id: 'my-config_1' })]));
  assert.strictEqual(result.valid, true);
});

test('rejects configuration with war deploy mode', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    deploy: { mode: 'war', artifact: 'dist/legacy.war' },
  })]));
  assert.strictEqual(result.valid, true);
});

test('rejects configuration with invalid context path', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    server: { id: 'srv-1', httpPort: 8080, debugPort: 8000, contextPath: 'bad path' },
  })]));
  assert.strictEqual(result.valid, false);
});

test('accepts configuration with root context path', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    server: { id: 'srv-1', httpPort: 8080, debugPort: 8000, contextPath: '/' },
  })]));
  assert.strictEqual(result.valid, true);
});

test('accepts multilevel context path', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    server: { id: 'srv-1', httpPort: 8080, debugPort: 8000, contextPath: '/app/admin' },
  })]));
  assert.strictEqual(result.valid, true);
});

test('rejects configuration with port out of range', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    server: { id: 'srv-1', httpPort: 80, debugPort: 8000, contextPath: '/app' },
  })]));
  assert.strictEqual(result.valid, false);
});

test('rejects configuration with port 65536', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    server: { id: 'srv-1', httpPort: 65536, debugPort: 8000, contextPath: '/app' },
  })]));
  assert.strictEqual(result.valid, false);
});

test('accepts configuration with custom build command', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    build: { type: 'custom', command: 'ant build', clean: true },
  })]));
  assert.strictEqual(result.valid, true);
});

test('rejects custom build without command', () => {
  const invalid = {
    ...document(),
    configurations: [{
      ...configuration(),
      build: { type: 'custom', clean: true },
    }],
  };
  const result = validateRunConfigurationDocument(invalid);
  assert.strictEqual(result.valid, false);
});

test('rejects build with unknown type', () => {
  const invalid = {
    ...document(),
    configurations: [{
      ...configuration(),
      build: { type: 'maven', clean: true },
    }],
  };
  const result = validateRunConfigurationDocument(invalid);
  assert.strictEqual(result.valid, false);
});

test('accepts configuration with Debug mode and suspend', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    id: 'debug-cfg',
    name: 'Debug Config',
    mode: 'debug',
    suspend: true,
  })]));
  assert.strictEqual(result.valid, true);
});

test('rejects Run mode with suspend', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    mode: 'run',
    suspend: true,
  })]));
  assert.strictEqual(result.valid, false);
});

test('accepts multiple valid configurations', () => {
  const result = validateRunConfigurationDocument(document([
    configuration({ id: 'cfg-1', name: 'Config 1' }),
    configuration({ id: 'cfg-2', name: 'Config 2', server: { id: 'srv-2', httpPort: 9090, debugPort: 9000, contextPath: '/app2' } }),
  ]));
  assert.strictEqual(result.valid, true);
});

test('accepts configuration with beforeLaunchTasks empty', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    beforeLaunchTasks: [],
  })]));
  assert.strictEqual(result.valid, true);
});

test('rejects configuration with too many beforeLaunchTasks', () => {
  const invalid = {
    ...document(),
    configurations: [{
      ...configuration(),
      beforeLaunchTasks: ['build', 'deploy', 'build'],
    }],
  };
  const result = validateRunConfigurationDocument(invalid);
  assert.strictEqual(result.valid, false);
});

test('accepts configuration with env var reference for sensitive data', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    env: { DB_PASSWORD: '${env:DB_PASS}' },
  })]));
  assert.strictEqual(result.valid, true);
});

test('rejects sensitive env with plain text value', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    env: { API_KEY: 'my-secret-key' },
  })]));
  assert.strictEqual(result.valid, false);
});

test('accepts env var with TOKEN in name using reference', () => {
  const result = validateRunConfigurationDocument(document([configuration({
    env: { AUTH_TOKEN: '${env:AUTH_TOKEN}' },
  })]));
  assert.strictEqual(result.valid, true);
});

// ---- parseRunConfigurationDocument -----------------------------------------

test('parseRunConfigurationDocument throws on invalid JSON', () => {
  assert.throws(
    () => parseRunConfigurationDocument('not json'),
    RunConfigurationValidationError,
  );
});

test('parseRunConfigurationDocument returns valid document', () => {
  const doc = parseRunConfigurationDocument(JSON.stringify(document()));
  assert.strictEqual(doc.version, 1);
  assert.strictEqual(doc.configurations.length, 1);
});

// ---- serializeRunConfigurationDocument -------------------------------------

test('serializeRunConfigurationDocument produces valid JSON', () => {
  const json = serializeRunConfigurationDocument(document());
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.version, 1);
  assert.ok(Array.isArray(parsed.configurations));
});

test('serializeRunConfigurationDocument sorts env keys', () => {
  const doc = document([configuration({ env: { Z_KEY: 'z', A_KEY: 'a' } })]);
  const json = serializeRunConfigurationDocument(doc);
  const aIndex = json.indexOf('A_KEY');
  const zIndex = json.indexOf('Z_KEY');
  assert.ok(aIndex < zIndex, 'env keys should be sorted alphabetically');
});

test('serializeRunConfigurationDocument throws on invalid data', () => {
  assert.throws(
    () => serializeRunConfigurationDocument({
      version: 1,
      configurations: [],
      selectedConfigurationId: 'missing',
    }),
    RunConfigurationValidationError,
  );
});