import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import {
  type RunConfigurationDocument,
  type TomcatRunConfiguration,
} from '@kairo/protocol';

export const RUN_CONFIGURATION_FILE = '.legacyflow/run-configurations.json' as const;
/** Must remain aligned with @kairo/protocol.RUN_CONFIGURATION_VERSION. */
export const RUN_CONFIGURATION_SCHEMA_VERSION = 1 as const;

const nonBlank = '^\\S(?:.*\\S)?$';
const stableId = '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$';
const relativePath = '^(?![A-Za-z]:[\\\\/])(?![\\\\/])\\S(?:.*\\S)?$';

const buildBase = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'clean'],
  properties: {
    type: { type: 'string' },
    clean: { type: 'boolean' },
  },
} as const;

export const runConfigurationJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://kairo.local/schemas/run-configurations/v1.json',
  title: 'Kairo Run Configuration Document',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'configurations', 'selectedConfigurationId'],
  properties: {
    version: { const: RUN_CONFIGURATION_SCHEMA_VERSION },
    configurations: {
      type: 'array',
      maxItems: 100,
      items: { $ref: '#/$defs/tomcatRunConfiguration' },
    },
    selectedConfigurationId: {
      oneOf: [{ type: 'string', pattern: stableId }, { type: 'null' }],
    },
  },
  $defs: {
    build: {
      oneOf: [
        {
          ...buildBase,
          required: ['type', 'target', 'clean'],
          properties: {
            ...buildBase.properties,
            type: { const: 'ant' },
            target: { type: 'string', minLength: 1, maxLength: 200, pattern: nonBlank },
          },
        },
        {
          ...buildBase,
          properties: { ...buildBase.properties, type: { const: 'javac' } },
        },
        {
          ...buildBase,
          required: ['type', 'command', 'clean'],
          properties: {
            ...buildBase.properties,
            type: { const: 'custom' },
            command: { type: 'string', minLength: 1, maxLength: 4096, pattern: nonBlank },
          },
        },
      ],
    },
    tomcatRunConfiguration: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id', 'name', 'type', 'projectId', 'mode', 'suspend', 'jdkRef',
        'build', 'server', 'deploy', 'env', 'vmOptions', 'beforeLaunchTasks',
      ],
      properties: {
        id: { type: 'string', pattern: stableId },
        name: { type: 'string', minLength: 1, maxLength: 200, pattern: nonBlank },
        type: { const: 'tomcat6' },
        projectId: { type: 'string', pattern: stableId },
        mode: { enum: ['run', 'debug'] },
        suspend: { type: 'boolean' },
        jdkRef: { type: 'string', pattern: stableId },
        build: { $ref: '#/$defs/build' },
        server: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'httpPort', 'debugPort', 'contextPath'],
          properties: {
            id: { type: 'string', pattern: stableId },
            httpPort: { type: 'integer', minimum: 1024, maximum: 65535 },
            debugPort: { type: 'integer', minimum: 1024, maximum: 65535 },
            contextPath: { type: 'string', pattern: '^/[A-Za-z0-9._-]*$' },
          },
        },
        deploy: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'artifact'],
          properties: {
            mode: { enum: ['exploded', 'war'] },
            artifact: { type: 'string', minLength: 1, maxLength: 1024, pattern: relativePath },
          },
        },
        env: {
          type: 'object',
          maxProperties: 128,
          propertyNames: { pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
          additionalProperties: { type: 'string', maxLength: 8192 },
        },
        vmOptions: {
          type: 'array',
          maxItems: 128,
          items: { type: 'string', minLength: 1, maxLength: 2048, pattern: nonBlank },
        },
        beforeLaunchTasks: {
          type: 'array',
          maxItems: 2,
          uniqueItems: true,
          items: { enum: ['build', 'deploy'] },
        },
      },
      allOf: [
        {
          if: { properties: { mode: { const: 'run' } }, required: ['mode'] },
          then: { properties: { suspend: { const: false } } },
        },
      ],
    },
  },
} as const;

export interface RunConfigurationValidationIssue {
  path: string;
  message: string;
}

export type RunConfigurationValidationResult =
  | { valid: true; value: RunConfigurationDocument; issues: [] }
  | { valid: false; issues: RunConfigurationValidationIssue[] };

export class RunConfigurationValidationError extends Error {
  constructor(public readonly issues: RunConfigurationValidationIssue[]) {
    super(`Invalid run configuration: ${issues.map(issue => `${issue.path} ${issue.message}`).join('; ')}`);
    this.name = 'RunConfigurationValidationError';
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema: ValidateFunction<RunConfigurationDocument> = ajv.compile(runConfigurationJsonSchema);

function schemaIssues(errors: ErrorObject[] | null | undefined): RunConfigurationValidationIssue[] {
  return (errors || []).map(error => ({
    path: error.instancePath || '/',
    message: error.message || error.keyword,
  }));
}

function semanticIssues(document: RunConfigurationDocument): RunConfigurationValidationIssue[] {
  const issues: RunConfigurationValidationIssue[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [index, configuration] of document.configurations.entries()) {
    const base = `/configurations/${index}`;
    if (ids.has(configuration.id)) issues.push({ path: `${base}/id`, message: 'must be unique' });
    ids.add(configuration.id);
    const foldedName = configuration.name.toLocaleLowerCase('en-US');
    if (names.has(foldedName)) issues.push({ path: `${base}/name`, message: 'must be unique ignoring case' });
    names.add(foldedName);
    if (configuration.server.httpPort === configuration.server.debugPort) {
      issues.push({ path: `${base}/server/debugPort`, message: 'must differ from httpPort' });
    }
    const artifactSegments = configuration.deploy.artifact.split(/[\\/]+/);
    if (configuration.deploy.artifact.includes('\\')) {
      issues.push({ path: `${base}/deploy/artifact`, message: 'must use forward slashes' });
    }
    if (configuration.deploy.artifact.includes(':')) {
      issues.push({ path: `${base}/deploy/artifact`, message: 'must not contain a colon' });
    }
    if (artifactSegments.includes('..')) {
      issues.push({ path: `${base}/deploy/artifact`, message: 'must not escape the project root with .. segments' });
    }
    const buildIndex = configuration.beforeLaunchTasks.indexOf('build');
    const deployIndex = configuration.beforeLaunchTasks.indexOf('deploy');
    if (buildIndex >= 0 && deployIndex >= 0 && deployIndex < buildIndex) {
      issues.push({ path: `${base}/beforeLaunchTasks`, message: 'deploy must not run before build' });
    }
    const envNames = new Set<string>();
    for (const [name, value] of Object.entries(configuration.env)) {
      const folded = name.toLocaleUpperCase('en-US');
      if (envNames.has(folded)) {
        issues.push({ path: `${base}/env`, message: `environment variable ${name} conflicts by case` });
      }
      envNames.add(folded);
      const sensitive = /(PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)/i.test(name);
      if (sensitive && !/^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) {
        issues.push({ path: `${base}/env/${name}`, message: 'sensitive values must use a ${env:HOST_NAME} reference' });
      }
    }
  }
  if (document.configurations.length === 0 && document.selectedConfigurationId !== null) {
    issues.push({ path: '/selectedConfigurationId', message: 'must be null when configurations is empty' });
  } else if (document.configurations.length > 0 && !ids.has(document.selectedConfigurationId || '')) {
    issues.push({ path: '/selectedConfigurationId', message: 'must reference an existing configuration' });
  }
  return issues;
}

export function validateRunConfigurationDocument(input: unknown): RunConfigurationValidationResult {
  if (!validateSchema(input)) return { valid: false, issues: schemaIssues(validateSchema.errors) };
  const issues = semanticIssues(input);
  return issues.length === 0 ? { valid: true, value: input, issues: [] } : { valid: false, issues };
}

export function parseRunConfigurationDocument(text: string): RunConfigurationDocument {
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch (error) {
    throw new RunConfigurationValidationError([{
      path: '/',
      message: `must be valid JSON (${error instanceof Error ? error.message : String(error)})`,
    }]);
  }
  const result = validateRunConfigurationDocument(input);
  if (!result.valid) throw new RunConfigurationValidationError(result.issues);
  return result.value;
}

function canonicalConfiguration(configuration: TomcatRunConfiguration): TomcatRunConfiguration {
  return {
    id: configuration.id,
    name: configuration.name,
    type: configuration.type,
    projectId: configuration.projectId,
    mode: configuration.mode,
    suspend: configuration.suspend,
    jdkRef: configuration.jdkRef,
    build: { ...configuration.build },
    server: { ...configuration.server },
    deploy: { ...configuration.deploy },
    env: Object.fromEntries(Object.entries(configuration.env).sort(([left], [right]) => left.localeCompare(right))),
    vmOptions: [...configuration.vmOptions],
    beforeLaunchTasks: [...configuration.beforeLaunchTasks],
  };
}

export function serializeRunConfigurationDocument(document: RunConfigurationDocument): string {
  const result = validateRunConfigurationDocument(document);
  if (!result.valid) throw new RunConfigurationValidationError(result.issues);
  const canonical: RunConfigurationDocument = {
    version: RUN_CONFIGURATION_SCHEMA_VERSION,
    configurations: result.value.configurations.map(canonicalConfiguration),
    selectedConfigurationId: result.value.selectedConfigurationId,
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
