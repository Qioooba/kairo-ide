import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { injectable } from '@theia/core/shared/inversify';
import type { DebugConfiguration } from '@theia/debug/lib/common/debug-configuration';
import type {
  DebugAdapterContribution,
  DebugAdapterExecutable,
} from '@theia/debug/lib/common/debug-model';
import {
  KAIRO_JAVA_DEBUG_ADAPTER_ARGS_ENV,
  KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV,
  KAIRO_JAVA_DEBUG_TYPE,
} from '../common/kairo-java-debug';

export interface KairoJavaDebugAdapterCapability {
  available: boolean;
  command?: string;
  args: string[];
  reason?: string;
}

export const KAIRO_DEBUG_ADAPTER_MAX_ARGS = 64;
export const KAIRO_DEBUG_ADAPTER_MAX_ARG_LENGTH = 8_192;
export const KAIRO_DEBUG_ADAPTER_MAX_ENCODED_ARGS_LENGTH = 65_536;

/** Pure capability probe, exported so failure-closed behaviour is testable. */
export function probeKairoJavaDebugAdapter(
  env: NodeJS.ProcessEnv = process.env,
  isExecutable: (path: string) => boolean = path => {
    try {
      if (!existsSync(path) || !statSync(path).isFile()) return false;
      if (process.platform !== 'win32') accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
): KairoJavaDebugAdapterCapability {
  const command = env[KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV]?.trim();
  if (!command) {
    return {
      available: false,
      args: [],
      reason: `${KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV} is not configured`,
    };
  }
  if (!isAbsolute(command)) {
    return { available: false, args: [], reason: 'Debug adapter command must be an absolute path' };
  }
  if (command.includes('\0')) {
    return { available: false, args: [], reason: 'Debug adapter command must not contain NUL characters' };
  }
  if (!isExecutable(command)) {
    return { available: false, args: [], reason: `Debug adapter command is not an executable file: ${command}` };
  }

  let args: unknown = [];
  const encodedArgs = env[KAIRO_JAVA_DEBUG_ADAPTER_ARGS_ENV]?.trim();
  if (encodedArgs) {
    if (encodedArgs.length > KAIRO_DEBUG_ADAPTER_MAX_ENCODED_ARGS_LENGTH) {
      return {
        available: false,
        args: [],
        reason: `${KAIRO_JAVA_DEBUG_ADAPTER_ARGS_ENV} exceeds ${KAIRO_DEBUG_ADAPTER_MAX_ENCODED_ARGS_LENGTH} characters`,
      };
    }
    try {
      args = JSON.parse(encodedArgs);
    } catch {
      return { available: false, args: [], reason: `${KAIRO_JAVA_DEBUG_ADAPTER_ARGS_ENV} must be a JSON string array` };
    }
  }
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    return { available: false, args: [], reason: `${KAIRO_JAVA_DEBUG_ADAPTER_ARGS_ENV} must be a JSON string array` };
  }
  if (args.length > KAIRO_DEBUG_ADAPTER_MAX_ARGS) {
    return {
      available: false,
      args: [],
      reason: `${KAIRO_JAVA_DEBUG_ADAPTER_ARGS_ENV} accepts at most ${KAIRO_DEBUG_ADAPTER_MAX_ARGS} arguments`,
    };
  }
  if (args.some(arg => arg.length > KAIRO_DEBUG_ADAPTER_MAX_ARG_LENGTH)) {
    return {
      available: false,
      args: [],
      reason: `${KAIRO_JAVA_DEBUG_ADAPTER_ARGS_ENV} arguments must not exceed ${KAIRO_DEBUG_ADAPTER_MAX_ARG_LENGTH} characters`,
    };
  }
  if (args.some(arg => arg.includes('\0'))) {
    return {
      available: false,
      args: [],
      reason: `${KAIRO_JAVA_DEBUG_ADAPTER_ARGS_ENV} arguments must not contain NUL characters`,
    };
  }
  return { available: true, command, args: args as string[] };
}

function validateAttachConfiguration(config: DebugConfiguration): void {
  if (config.request !== 'attach') {
    throw new Error('Kairo Java Debug supports attach requests only');
  }
  if (config.hostName !== '127.0.0.1') {
    throw new Error('Kairo Java Debug only attaches to the local 127.0.0.1 JDWP listener');
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new Error(`Invalid JDWP port: ${String(config.port)}`);
  }
}

/**
 * Theia backend contribution for an operator-supplied, mature Java DAP
 * adapter speaking DAP over stdio. Kairo never downloads or guesses one.
 */
@injectable()
export class KairoJavaDebugAdapterContribution implements DebugAdapterContribution {
  readonly type = KAIRO_JAVA_DEBUG_TYPE;
  readonly label = 'Kairo Java (configured adapter)';
  readonly languages = ['java'];

  provideDebugConfigurations(): DebugConfiguration[] {
    const capability = probeKairoJavaDebugAdapter();
    if (!capability.available) return [];
    return [{
      type: this.type,
      name: 'Kairo Java: Attach to local JDWP',
      request: 'attach',
      hostName: '127.0.0.1',
      port: 0,
    }];
  }

  provideDebugAdapterExecutable(config: DebugConfiguration): DebugAdapterExecutable {
    validateAttachConfiguration(config);
    const capability = probeKairoJavaDebugAdapter();
    if (!capability.available || !capability.command) {
      throw new Error(`Java Debug Adapter unavailable: ${capability.reason ?? 'capability probe failed'}`);
    }
    return { command: capability.command, args: capability.args };
  }
}
