import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { platform } from 'node:os';
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

function isExecutable(path: string): boolean {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return false;
    if (platform() !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the path to the built-in kairo-jdi-bridge.jar.
 * Looks in several locations relative to the app root.
 */
export function resolveBridgeJar(appRoot?: string): string | undefined {
  const root = appRoot ?? process.cwd();
  const candidates = [
    resolve(root, 'bundled', 'kairo-jdi-bridge.jar'),
    resolve(root, '..', 'bundled', 'kairo-jdi-bridge.jar'),
    resolve(root, '..', '..', 'bundled', 'kairo-jdi-bridge.jar'),
    resolve(root, 'packages', 'theia-product', 'bundled', 'kairo-jdi-bridge.jar'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Resolve the path to a suitable JDK 17+ java executable.
 * Priority: bundled/jdk17/bin/java > KAIRO_JDT_LS_JRE > JAVA_HOME > PATH java
 */
export function resolveHostJava(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const javaExe = platform() === 'win32' ? 'java.exe' : 'java';

  // 1. Bundled JDK 17
  const bundled = resolve(process.cwd(), 'bundled', 'jdk17', 'bin', javaExe);
  if (existsSync(bundled) && isExecutable(bundled)) return bundled;

  // 2. KAIRO_JDT_LS_JRE (same JRE used by JDT LS)
  const jdtJre = env['KAIRO_JDT_LS_JRE'];
  if (jdtJre) {
    const javaPath = resolve(jdtJre, 'bin', javaExe);
    if (existsSync(javaPath) && isExecutable(javaPath)) return javaPath;
  }

  // 3. JAVA_HOME
  const javaHome = env['JAVA_HOME'];
  if (javaHome) {
    const javaPath = resolve(javaHome, 'bin', javaExe);
    if (existsSync(javaPath) && isExecutable(javaPath)) return javaPath;
  }

  // 4. PATH - search PATH directories for java
  const pathEnv = env['PATH'] || env['Path'];
  if (pathEnv) {
    for (const dir of pathEnv.split(delimiter)) {
      if (!dir) continue;
      const javaPath = resolve(dir, javaExe);
      if (existsSync(javaPath) && isExecutable(javaPath)) return javaPath;
    }
  }

  return undefined;
}

/** Pure capability probe, exported so failure-closed behaviour is testable. */
export function probeKairoJavaDebugAdapter(
  env: NodeJS.ProcessEnv = process.env,
  isExecutableFn: (path: string) => boolean = path => {
    try {
      if (!existsSync(path) || !statSync(path).isFile()) return false;
      if (process.platform !== 'win32') accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  resolved?: { bridgeJar?: string | null; hostJava?: string | null },
): KairoJavaDebugAdapterCapability {
  // 1. Try the built-in JDI bridge (no env var needed)
  const bridgeJar = resolved?.bridgeJar !== undefined ? resolved.bridgeJar ?? undefined : resolveBridgeJar();
  if (bridgeJar) {
    const hostJava = resolved?.hostJava !== undefined ? resolved.hostJava ?? undefined : resolveHostJava(env);
    if (hostJava && isAbsolute(hostJava) && !hostJava.includes('\0') && isExecutableFn(hostJava)) {
      // Host/port are appended by provideDebugAdapterExecutable from the attach config.
      return { available: true, command: hostJava, args: ['-jar', bridgeJar] };
    }
  }

  // 2. Fall back to env-var-configured external adapter
  const command = env[KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV]?.trim();
  if (!command) {
    return {
      available: false,
      args: [],
      reason: bridgeJar
        ? 'Host Java not found for built-in JDI bridge'
        : `${KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV} is not configured, and kairo-jdi-bridge.jar not found`,
    };
  }
  if (!isAbsolute(command)) {
    return { available: false, args: [], reason: 'Debug adapter command must be an absolute path' };
  }
  if (command.includes('\0')) {
    return { available: false, args: [], reason: 'Debug adapter command must not contain NUL characters' };
  }
  if (!isExecutableFn(command)) {
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
 * Theia backend contribution for the built-in Kairo JDI Bridge
 * that speaks DAP over stdio. Automatically locates the bundled
 * kairo-jdi-bridge.jar and a suitable JDK 17, launching the bridge
 * as a child process — no environment variable configuration needed.
 */
@injectable()
export class KairoJavaDebugAdapterContribution implements DebugAdapterContribution {
  readonly type = KAIRO_JAVA_DEBUG_TYPE;
  readonly label = 'Kairo Java (built-in JDI Bridge)';
  readonly languages = ['java'];

  provideDebugConfigurations(): DebugConfiguration[] {
    const capability = probeKairoJavaDebugAdapter();
    return [{
      type: this.type,
      name: 'Kairo Java: Attach to Tomcat (JDWP)',
      request: 'attach',
      hostName: '127.0.0.1',
      port: 8000,
      __kairoAdapterAvailable: capability.available,
      __kairoAdapterReason: capability.reason,
    }];
  }

  provideDebugAdapterExecutable(config: DebugConfiguration): DebugAdapterExecutable {
    validateAttachConfiguration(config);
    const capability = probeKairoJavaDebugAdapter();
    if (!capability.available || !capability.command) {
      throw new Error(`Java Debug Adapter unavailable: ${capability.reason ?? 'capability probe failed'}`);
    }
    return {
      command: capability.command,
      args: [...capability.args, config.hostName ?? '127.0.0.1', String(config.port)],
    };
  }
}