/**
 * Kairo Java Debug Launch Configuration Provider — P1-DBG-01
 *
 * Provides default launch configurations for the kairo-java debug type:
 *   - "Launch Tomcat (Debug)": launches Tomcat and attaches the debugger
 *   - "Attach to JVM": attaches to an already-running JVM via JDWP
 *
 * Registered as a DebugAdapterContribution in the frontend DI container
 * so the Theia DebugConfigurationManager picks it up.
 */

import { injectable } from '@theia/core/shared/inversify';
import type { DebugConfiguration } from '@theia/debug/lib/common/debug-configuration';
import type { DebugAdapterContribution } from '@theia/debug/lib/common/debug-model';

export const KAIRO_JAVA_DEBUG_TYPE = 'kairo-java';

/** Default JDWP port for Tomcat debug mode. */
const DEFAULT_JDWP_PORT = 8000;

@injectable()
export class KairoJavaDebugLaunchConfigProvider implements DebugAdapterContribution {
  readonly type = KAIRO_JAVA_DEBUG_TYPE;
  readonly label = 'Kairo Java (Launch Config)';
  readonly languages = ['java'];

  provideDebugConfigurations(): DebugConfiguration[] {
    return [
      {
        type: KAIRO_JAVA_DEBUG_TYPE,
        request: 'launch',
        name: 'Launch Tomcat (Debug)',
        hostName: 'localhost',
        port: DEFAULT_JDWP_PORT,
        mainClass: '',
        projectName: '',
      },
      {
        type: KAIRO_JAVA_DEBUG_TYPE,
        request: 'attach',
        name: 'Attach to JVM',
        hostName: 'localhost',
        port: DEFAULT_JDWP_PORT,
      },
    ];
  }

  resolveDebugConfiguration(
    config: DebugConfiguration,
    _workspaceFolderUri?: string,
  ): DebugConfiguration | undefined {
    if (config.type !== KAIRO_JAVA_DEBUG_TYPE) {
      return undefined;
    }

    const resolved: DebugConfiguration = { ...config };

    // Ensure hostName defaults to localhost for attach
    if (config.request === 'attach' && !config.hostName) {
      resolved.hostName = 'localhost';
    }

    // Validate port
    if (config.port !== undefined && (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535)) {
      resolved.port = DEFAULT_JDWP_PORT;
    }

    return resolved;
  }
}