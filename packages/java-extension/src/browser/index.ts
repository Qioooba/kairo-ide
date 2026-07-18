export { KairoJavaService, bindJavaExtension } from './java-service';
export type { JavaServiceState } from './java-service';
export { JavaLanguageClientContribution } from './java-language-client-contribution';
export { JavaLanguageServerLifecycle } from './java-ls-lifecycle';

import { JavaLanguageClientContribution } from './java-language-client-contribution';
import { JavaLanguageServerLifecycle } from './java-ls-lifecycle';

export function bindJavaLanguageClientContribution(bind: any): void {
    bind(JavaLanguageClientContribution).toSelf().inSingletonScope();
    bind(JavaLanguageServerLifecycle).toSelf().inSingletonScope();
}