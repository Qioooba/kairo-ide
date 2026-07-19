export { TomcatManager } from './tomcat-manager';
export type { TomcatInstance, TomcatEvent, TomcatStartOptions, TomcatState } from './tomcat-manager';
export { TomcatRegistry } from './tomcat-registry';
export type { TomcatRegistryEvent } from './tomcat-registry';

import { interfaces } from '@theia/core/shared/inversify';
import { TomcatRegistry } from './tomcat-registry';

export function bindTomcatRegistry(bind: interfaces.Bind): void {
  bind(TomcatRegistry).toSelf().inSingletonScope();
}
