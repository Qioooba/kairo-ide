export { JavaLanguageServerManager } from './java-language-server-contribution';
export type { LaunchDescriptor } from './java-language-server-contribution';

import { interfaces } from '@theia/core/shared/inversify';
import { JavaLanguageServerManager } from './java-language-server-contribution';

export function bindJavaLanguageServerManager(bind: interfaces.Bind): void {
    bind(JavaLanguageServerManager).toSelf().inSingletonScope();
}