import { test } from 'node:test';
import assert from 'node:assert';
import type { RunConfigurationDocument, TomcatRunConfiguration } from '@kairo/protocol';
import {
  RUN_CONFIGURATION_FILE,
  RUN_CONFIGURATION_SCHEMA_VERSION,
  RunConfigurationValidationError,
  parseRunConfigurationDocument,
  runConfigurationJsonSchema,
  serializeRunConfigurationDocument,
  validateRunConfigurationDocument,
} from './run-configuration';

function configuration(overrides: Partial<TomcatRunConfiguration> = {}): TomcatRunConfiguration {
  return {
    id: 'tomcat6-legacy-run',
    name: 'Tomcat 6: legacy-sample',
    type: 'tomcat6',
    projectId: 'legacy-sample',
    mode: 'run',
    suspend: false,
    jdkRef: 'jdk6-local',
    build: { type: 'ant', target: 'war', clean: false },
    server: { id: 'tomcat6-local', httpPort: 18080, debugPort: 8000, contextPath: '/legacy' },
    deploy: { mode: 'exploded', artifact: 'dist/legacy' },
    env: { LANG: 'zh_CN.GBK', CATALINA_OPTS: '-Xmx512m' },
    vmOptions: ['-Dfile.encoding=GBK'],
    beforeLaunchTasks: ['build', 'deploy'],
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

test('pins the versioned project-level persistence contract', () => {
  assert.strictEqual(RUN_CONFIGURATION_SCHEMA_VERSION, 1);
  assert.strictEqual(RUN_CONFIGURATION_FILE, '.legacyflow/run-configurations.json');
  assert.ok(runConfigurationJsonSchema.$id.endsWith('/v1.json'));
  assert.strictEqual(runConfigurationJsonSchema.additionalProperties, false);
});

test('accepts Tomcat Run and Debug configurations', () => {
  const run = validateRunConfigurationDocument(document());
  assert.strictEqual(run.valid, true);
  const debug = configuration({ id: 'tomcat6-debug', name: 'Tomcat Debug', mode: 'debug', suspend: true });
  assert.strictEqual(validateRunConfigurationDocument(document([debug])).valid, true);
});

test('strictly rejects unknown top-level and nested properties', () => {
  const top = { ...document(), unexpected: true };
  const topResult = validateRunConfigurationDocument(top);
  assert.strictEqual(topResult.valid, false);
  const nested = document() as unknown as { configurations: Array<Record<string, unknown>> };
  nested.configurations[0].server = { ...(nested.configurations[0].server as object), password: 'must-not-persist' };
  const nestedResult = validateRunConfigurationDocument(nested);
  assert.strictEqual(nestedResult.valid, false);
  if (!nestedResult.valid) assert.ok(nestedResult.issues.some(issue => issue.path.includes('/server')));
});

test('Run mode cannot suspend and malformed versions are rejected', () => {
  const suspend = validateRunConfigurationDocument(document([configuration({ suspend: true })]));
  assert.strictEqual(suspend.valid, false);
  const wrongVersion = { ...document(), version: 2 };
  assert.strictEqual(validateRunConfigurationDocument(wrongVersion).valid, false);
});

test('requires selectedConfigurationId to reference a saved configuration', () => {
  const missing = { ...document(), selectedConfigurationId: 'does-not-exist' };
  const result = validateRunConfigurationDocument(missing);
  assert.strictEqual(result.valid, false);
  if (!result.valid) assert.deepStrictEqual(result.issues, [{
    path: '/selectedConfigurationId', message: 'must reference an existing configuration',
  }]);
  assert.strictEqual(validateRunConfigurationDocument({
    version: 1, configurations: [], selectedConfigurationId: null,
  }).valid, true);
});

test('rejects duplicate stable ids and case-insensitive names', () => {
  const duplicate = configuration({ name: 'tomcat 6: LEGACY-SAMPLE' });
  const result = validateRunConfigurationDocument(document([configuration(), duplicate]));
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some(issue => issue.path === '/configurations/1/id'));
    assert.ok(result.issues.some(issue => issue.path === '/configurations/1/name'));
  }
});

test('rejects port collisions and deploy-before-build ordering', () => {
  const invalid = configuration({
    server: { id: 'tomcat6-local', httpPort: 8000, debugPort: 8000, contextPath: '/legacy' },
    beforeLaunchTasks: ['deploy', 'build'],
  });
  const result = validateRunConfigurationDocument(document([invalid]));
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some(issue => issue.path.endsWith('/server/debugPort')));
    assert.ok(result.issues.some(issue => issue.path.endsWith('/beforeLaunchTasks')));
  }
});

test('rejects unsafe environment names, duplicate case variants, and absolute artifacts', () => {
  const badName = configuration({ env: { 'BAD-NAME': 'x' } });
  assert.strictEqual(validateRunConfigurationDocument(document([badName])).valid, false);
  const duplicateCase = configuration({ env: { PATH: 'a', Path: 'b' } });
  assert.strictEqual(validateRunConfigurationDocument(document([duplicateCase])).valid, false);
  const absolute = configuration({ deploy: { mode: 'exploded', artifact: 'C:\\release\\legacy' } });
  assert.strictEqual(validateRunConfigurationDocument(document([absolute])).valid, false);
  const windowsSeparator = configuration({ deploy: { mode: 'exploded', artifact: 'dist\\legacy' } });
  assert.strictEqual(validateRunConfigurationDocument(document([windowsSeparator])).valid, false);
  const colon = configuration({ deploy: { mode: 'exploded', artifact: 'dist/legacy:copy' } });
  assert.strictEqual(validateRunConfigurationDocument(document([colon])).valid, false);
  for (const artifact of ['../outside', 'dist/../../outside', '..\\outside', 'dist\\..\\..\\outside']) {
    const traversal = configuration({ deploy: { mode: 'exploded', artifact } });
    const result = validateRunConfigurationDocument(document([traversal]));
    assert.strictEqual(result.valid, false, `expected traversal to be rejected: ${artifact}`);
    if (!result.valid) assert.ok(result.issues.some(issue => issue.path.endsWith('/deploy/artifact')));
  }
});

test('sensitive environment variables must use non-persisted host references', () => {
  const plaintext = configuration({ env: { DB_PASSWORD: 'do-not-save-this' } });
  assert.strictEqual(validateRunConfigurationDocument(document([plaintext])).valid, false);
  const reference = configuration({ env: { DB_PASSWORD: '${env:LEGACY_DB_PASSWORD}' } });
  assert.strictEqual(validateRunConfigurationDocument(document([reference])).valid, true);
  const compactName = configuration({ env: { DBPASSWORD: 'still-secret' } });
  assert.strictEqual(validateRunConfigurationDocument(document([compactName])).valid, false);
});

test('build discriminated union requires mode-specific fields', () => {
  assert.strictEqual(validateRunConfigurationDocument(document([
    configuration({ build: { type: 'javac', clean: true } }),
  ])).valid, true);
  const missingTarget = configuration() as unknown as { build: { type: string; clean: boolean } };
  missingTarget.build = { type: 'ant', clean: false };
  assert.strictEqual(validateRunConfigurationDocument(document([
    missingTarget as unknown as TomcatRunConfiguration,
  ])).valid, false);
});

test('parse reports malformed JSON as a typed validation error', () => {
  assert.throws(
    () => parseRunConfigurationDocument('{"version":1,'),
    (error: unknown) => error instanceof RunConfigurationValidationError
      && error.issues[0].path === '/',
  );
});

test('serialization is canonical, stable, non-mutating, and round-trips', () => {
  const source = document([configuration({ env: { Z_VAR: 'last', A_VAR: 'first' } })]);
  const before = JSON.stringify(source);
  const first = serializeRunConfigurationDocument(source);
  const second = serializeRunConfigurationDocument(parseRunConfigurationDocument(first));
  assert.strictEqual(first, second);
  assert.ok(first.endsWith('\n'));
  assert.ok(first.indexOf('"A_VAR"') < first.indexOf('"Z_VAR"'));
  assert.strictEqual(JSON.stringify(source), before);
  assert.deepStrictEqual(parseRunConfigurationDocument(first), JSON.parse(first));
});

test('serialization refuses invalid in-memory data instead of persisting it', () => {
  const invalid = document([configuration({ suspend: true })]);
  assert.throws(() => serializeRunConfigurationDocument(invalid), RunConfigurationValidationError);
});
