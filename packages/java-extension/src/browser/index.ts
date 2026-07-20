export { KairoJavaService, bindJavaExtension } from './java-service';
export type { JavaServiceState } from './java-service';
export { KairoJavaLanguageClientContribution } from './java-language-client-contribution';
export { JavaLanguageServerLifecycle } from './java-ls-lifecycle';
export { JavaLanguageClient } from './java-language-client';
export { JavaCompletionProvider } from './java-completion-provider';
export type { JavaCompletionRequest, JavaCompletionResponse, JavaCompletionResponseItem, JavaDefinitionResponse } from './java-completion-provider';

import { interfaces } from '@theia/core/shared/inversify';
import { KairoJavaLanguageClientContribution } from './java-language-client-contribution';
import { JavaLanguageServerLifecycle } from './java-ls-lifecycle';
import { JavaLanguageClient } from './java-language-client';
import { JavaCompletionProvider } from './java-completion-provider';

export function bindJavaLanguageClientContribution(bind: interfaces.Bind): void {
    bind(KairoJavaLanguageClientContribution).toSelf().inSingletonScope();
    bind(JavaLanguageServerLifecycle).toSelf().inSingletonScope();
    bind(JavaLanguageClient).toSelf().inSingletonScope();
    bind(JavaCompletionProvider).toSelf().inSingletonScope();
}
