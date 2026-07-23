/**
 * JSON Schema (draft-2020-12) for `.legacyflow/project.yaml`.
 *
 * The schema is the same shape the Go agent validates against;
 * `runtime-agent/internal/api/configschema/schema.json` is
 * generated from this file. Both must stay in lock-step.
 */

export const PROJECT_SCHEMA_VERSION = 1;

export const projectJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://kairo.local/schemas/project/v1.json',
  title: 'Kairo Project Configuration',
  description: 'Canonical project configuration for a legacy Java Web project.',
  type: 'object',
  required: [
    'schemaVersion',
    'id',
    'name',
    'rootPath',
    'sourceLayout',
    'encoding',
    'java',
    'serverRuntime',
    'build',
    'deploy',
    'hotReload',
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: PROJECT_SCHEMA_VERSION },
    id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_.-]+$' },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    rootPath: { type: 'string', minLength: 1 },
    sourceLayout: {
      type: 'object',
      required: ['src', 'webRoot', 'config'],
      additionalProperties: false,
      properties: {
        src: { type: 'array', items: { type: 'string' }, minItems: 1 },
        webRoot: { type: 'string' },
        config: { type: 'array', items: { type: 'string' }, minItems: 1 },
        lib: { type: 'string' },
        testSrc: { type: 'array', items: { type: 'string' } },
        resources: { type: 'array', items: { type: 'string' } },
        buildXml: { type: 'string' },
      },
    },
    encoding: {
      type: 'object',
      required: ['default'],
      additionalProperties: false,
      properties: {
        default: {
          type: 'string',
          enum: ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'gbk', 'gb18030', 'iso-8859-1', 'us-ascii'],
        },
        aliases: { type: 'object', additionalProperties: { type: 'string' } },
        perExtension: { type: 'object', additionalProperties: { type: 'string' } },
        directoryEncodingOverrides: {
          type: 'object',
          additionalProperties: {
            type: 'string',
            enum: ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'gbk', 'gb18030', 'iso-8859-1', 'us-ascii'],
          },
          description: 'Per-directory encoding overrides. Keys are relative directory paths (e.g. "src/"), values are encoding names.',
        },
      },
    },
    java: {
      type: 'object',
      required: ['languageServer', 'compiler', 'runtime'],
      additionalProperties: false,
      properties: {
        languageServer: { $ref: '#/$defs/toolchainRef' },
        compiler: { $ref: '#/$defs/toolchainCompiler' },
        runtime: { $ref: '#/$defs/toolchainRef' },
      },
    },
    serverRuntime: {
      type: 'object',
      required: ['type', 'config'],
      additionalProperties: false,
      properties: {
        type: { type: 'string', minLength: 1 },
        config: {
          type: 'object',
          additionalProperties: false,
          properties: {
            httpPort: { type: 'integer', minimum: 1024, maximum: 65535 },
            shutdownPort: { type: 'integer', minimum: 1024, maximum: 65535 },
            ajpPort: { type: 'integer', minimum: 1024, maximum: 65535 },
            jmxPort: { type: 'integer', minimum: 1024, maximum: 65535 },
            debugPort: { type: 'integer', minimum: 1024, maximum: 65535 },
            contextPath: { type: 'string', pattern: '^/[A-Za-z0-9._-]*$' },
            env: { type: 'object', additionalProperties: { type: 'string' } },
            jvm: {
              type: 'object',
              additionalProperties: false,
              properties: {
                maxHeapMb: { type: 'integer', minimum: 64, maximum: 8192 },
                permGenMb: { type: 'integer', minimum: 16, maximum: 1024 },
                extraArgs: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    build: {
      type: 'object',
      required: ['mode'],
      additionalProperties: false,
      properties: {
        mode: { enum: ['ant', 'javac', 'custom'] },
        antFile: { type: 'string' },
        customCommand: { type: 'string' },
        excludes: { type: 'array', items: { type: 'string' } },
      },
    },
    deploy: {
      type: 'object',
      required: ['mode', 'target'],
      additionalProperties: false,
      properties: {
        mode: { enum: ['copy', 'direct'] },
        target: { type: 'string' },
        classesPath: { type: 'string' },
        libPath: { type: 'string' },
      },
    },
    hotReload: {
      type: 'object',
      required: ['mode'],
      additionalProperties: false,
      properties: {
        mode: { enum: ['staticSync', 'compileOnly', 'classHotSwap', 'contextReload'] },
        debounceMs: { type: 'integer', minimum: 0, maximum: 60_000 },
        fallbackToReload: { type: 'boolean' },
      },
    },
  },
  $defs: {
    toolchainRef: {
      type: 'object',
      required: ['toolchainId', 'fingerprint'],
      additionalProperties: false,
      properties: {
        toolchainId: { type: 'string' },
        fingerprint: { type: 'string', pattern: '^(sha256|empty):' },
        label: { type: 'string' },
        vmOptions: { type: 'array', items: { type: 'string' } },
        jvmHeapMb: { type: 'integer', minimum: 64, maximum: 8192 },
      },
    },
    toolchainCompiler: {
      allOf: [
        { $ref: '#/$defs/toolchainRef' },
        {
          type: 'object',
          required: ['sourceLevel', 'targetLevel'],
          additionalProperties: false,
          properties: {
            sourceLevel: { enum: ['1.5', '1.6', '1.7', '1.8', '9', '11', '17'] },
            targetLevel: { enum: ['1.5', '1.6', '1.7', '1.8', '9', '11', '17'] },
            args: { type: 'array', items: { type: 'string' } },
            emulatedV6: { type: 'boolean' },
          },
        },
      ],
    },
  },
} as const;

export type ProjectJsonSchema = typeof projectJsonSchema;

export * from './run-configuration';
