export { KairoJavaService, bindJavaExtension } from './java-service';
export type { JavaServiceState } from './java-service';
export { KairoJavaLanguageClientContribution } from './java-language-client-contribution';
export { JavaLanguageServerLifecycle, extractWorkspaceDataDir, pathToFileUri } from './java-ls-lifecycle';
export type { JdtLsLaunchDescriptor } from './java-ls-lifecycle';
export { JavaLanguageClient } from './java-language-client';
export { JavaCompletionProvider } from './java-completion-provider';
export { JavaMonacoRegistrationContribution } from './java-monaco-registration';
export type { JavaCompletionRequest, JavaCompletionResponse, JavaCompletionResponseItem, JavaDefinitionResponse } from './java-completion-provider';

import { interfaces } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { KairoJavaLanguageClientContribution } from './java-language-client-contribution';
import { JavaLanguageServerLifecycle } from './java-ls-lifecycle';
import { JavaLanguageClient } from './java-language-client';
import { JavaCompletionProvider } from './java-completion-provider';
import { JavaMonacoRegistrationContribution } from './java-monaco-registration';

export function bindJavaLanguageClientContribution(bind: interfaces.Bind): void {
    bind(KairoJavaLanguageClientContribution).toSelf().inSingletonScope();
    bind(JavaLanguageServerLifecycle).toSelf().inSingletonScope();
    // Bound as a FrontendApplicationContribution so Theia
    // instantiates the lifecycle at startup — without this the
    // service is never constructed and the prepare /
    // launch-descriptor / start chain never runs. Its
    // @postConstruct must stay synchronous (see the LazyInSync
    // comment in java-ls-lifecycle.ts).
    bind(FrontendApplicationContribution).toService(JavaLanguageServerLifecycle);
    bind(JavaLanguageClient).toSelf().inSingletonScope();
    bind(JavaCompletionProvider).toSelf().inSingletonScope();
    bind(JavaMonacoRegistrationContribution).toSelf().inSingletonScope();
    // Registers the Java completion + definition providers with
    // Monaco at application start.
    bind(FrontendApplicationContribution).toService(JavaMonacoRegistrationContribution);
}
