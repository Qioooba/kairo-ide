export { JavaLanguageServerManager } from './java-language-server-contribution';
export type { LaunchDescriptor } from './java-language-server-contribution';

import { JavaLanguageServerManager } from './java-language-server-contribution';

export function bindJavaLanguageServerManager(bind: any): void {
    bind(JavaLanguageServerManager).toSelf().inSingletonScope();
}