// config-schema — contract test for the .legacyflow/project.yaml
// JSON Schema.
//
// The schema is the SINGLE source of truth for the project
// config wire format. The Go agent validates against a
// generated mirror; if the two drift, the agent will reject
// config the UI produces (or vice versa). This test pins the
// load-bearing properties so a refactor cannot silently weaken
// the contract.
//
// Run with:
//   pnpm --filter @kairo/config-schema test
//   (or)  node --require ts-node/register --require source-map-support/register --test src/index.test.ts

import { test } from 'node:test';
import assert from 'node:assert';
import { PROJECT_SCHEMA_VERSION, projectJsonSchema } from './index';

test('PROJECT_SCHEMA_VERSION is 1 (wire version; do not bump without /v2)', () => {
  assert.strictEqual(PROJECT_SCHEMA_VERSION, 1);
  // The schema's $id must embed the version — a drift here is
  // an agent/UI break.
  assert.ok(
    (projectJsonSchema as { $id?: string }).$id?.includes('/v1.json'),
    `$id should include '/v1.json' (got ${(projectJsonSchema as { $id?: string }).$id})`,
  );
});

test('schema has additionalProperties: false (strict — no silent extras)', () => {
  // Any new top-level field must be added here FIRST or the
  // Go agent will reject the project. Pin the strictness.
  const s = projectJsonSchema as { additionalProperties?: boolean };
  assert.strictEqual(s.additionalProperties, false);
});

test('schema $schema URI is draft 2020-12', () => {
  const s = projectJsonSchema as { $schema?: string };
  assert.strictEqual(s.$schema, 'https://json-schema.org/draft/2020-12/schema');
});

test('schema.required lists every top-level key the agent expects', () => {
  const required = (projectJsonSchema as { required: readonly string[] }).required;
  // Order matters for some Go decoders; pin it.
  assert.deepStrictEqual([...required], [
    'schemaVersion', 'id', 'name', 'rootPath',
    'sourceLayout', 'encoding', 'java', 'serverRuntime',
    'build', 'deploy', 'hotReload',
  ]);
});

test('schemaVersion const equals PROJECT_SCHEMA_VERSION', () => {
  const s = projectJsonSchema as { properties: { schemaVersion: { const: number } } };
  assert.strictEqual(s.properties.schemaVersion.const, PROJECT_SCHEMA_VERSION);
});

test('encoding.default enum covers the Kairo encoding contract', () => {
  const s = projectJsonSchema as {
    properties: { encoding: { properties: { default: { enum: readonly string[] } } } };
  };
  const e = s.properties.encoding.properties.default.enum;
  // The Go agent's encoding.Validate() returns one of these
  // strings. The UI's encoding selector must show the same set.
  for (const enc of ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'gbk', 'gb18030', 'iso-8859-1', 'us-ascii']) {
    assert.ok(e.includes(enc), `encoding.default enum missing "${enc}"`);
  }
});

test('build.mode enum allows ant, javac, custom (no maven/gradle)', () => {
  // Kairo targets legacy Tomcat 6 / Ant projects. Maven /
  // Gradle are explicitly NOT first-class — the build provider
  // tree only ships Ant, javac, and custom-command modes.
  const s = projectJsonSchema as {
    properties: { build: { properties: { mode: { enum: readonly string[] } } } };
  };
  assert.deepStrictEqual([...s.properties.build.properties.mode.enum], ['ant', 'javac', 'custom']);
});

test('hotReload.mode enum is the four documented values', () => {
  const s = projectJsonSchema as {
    properties: { hotReload: { properties: { mode: { enum: readonly string[] } } } };
  };
  assert.deepStrictEqual(
    [...s.properties.hotReload.properties.mode.enum],
    ['staticSync', 'compileOnly', 'classHotSwap', 'contextReload'],
  );
});

test('toolchainRef.fingerprint pattern requires sha256: or empty: prefix', () => {
  // The fingerprint is the security anchor — if its format
  // changes the agent's toolchain cache becomes invalid.
  const s = projectJsonSchema as {
    $defs: { toolchainRef: { properties: { fingerprint: { pattern: string } } } };
  };
  assert.strictEqual(s.$defs.toolchainRef.properties.fingerprint.pattern, '^(sha256|empty):');
});

test('compiler.sourceLevel + targetLevel enum is the seven documented JDK levels', () => {
  const s = projectJsonSchema as unknown as {
    $defs: { toolchainCompiler: { allOf: Array<{ properties?: { sourceLevel?: { enum: readonly string[] }; targetLevel?: { enum: readonly string[] } } }> } };
  };
  // toolchainCompiler is { allOf: [{$ref: toolchainRef}, {properties: {sourceLevel, targetLevel}}] }
  const compilerProps = s.$defs.toolchainCompiler.allOf[1].properties!;
  for (const level of ['1.5', '1.6', '1.7', '1.8', '9', '11', '17']) {
    assert.ok(compilerProps.sourceLevel!.enum.includes(level),
      `sourceLevel enum missing "${level}"`);
    assert.ok(compilerProps.targetLevel!.enum.includes(level),
      `targetLevel enum missing "${level}"`);
  }
});
