import type { DebugConfiguration } from '@theia/debug/lib/common/debug-configuration';

/** Private debug type owned by Kairo's explicitly configured DAP adapter. */
export const KAIRO_JAVA_DEBUG_TYPE = 'kairo-java';
export const KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV = 'KAIRO_JAVA_DEBUG_ADAPTER_COMMAND';
export const KAIRO_JAVA_DEBUG_ADAPTER_ARGS_ENV = 'KAIRO_JAVA_DEBUG_ADAPTER_ARGS';

export interface KairoJavaAttachTarget {
  serverId: string;
  projectId: string;
  projectName: string;
  projectRoot: string;
  port: number;
}

/**
 * Produce the standard Java attach request consumed by a DAP adapter.
 * This object describes intent only; it never means the adapter attached.
 */
export function createKairoJavaAttachConfiguration(target: KairoJavaAttachTarget): DebugConfiguration {
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65_535) {
    throw new Error(`Invalid JDWP port: ${target.port}`);
  }
  return {
    type: KAIRO_JAVA_DEBUG_TYPE,
    name: `Kairo Tomcat: ${target.projectName}`,
    request: 'attach',
    hostName: '127.0.0.1',
    port: target.port,
    projectName: target.projectName,
    sourcePaths: [target.projectRoot],
    openDebug: 'openOnSessionStart',
    internalConsoleOptions: 'openOnSessionStart',
    __kairoServerId: target.serverId,
    __kairoProjectId: target.projectId,
  };
}

