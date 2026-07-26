/**
 * JSP language registration for Monaco.
 *
 * Monaco is imported as a module (NOT the fragile `window.monaco`
 * global — KAIRO-RC-WEB-002), and registration is wired into the
 * Theia composition via KairoJspLanguageContribution below.
 */

import * as monaco from '@theia/monaco-editor-core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { injectable, inject, interfaces } from '@theia/core/shared/inversify';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { JavaCompletionProvider, JavaLanguageClient } from '@kairo/java-extension';
import { JSP_LANGUAGE_ID, JSP_MONARCH } from './jsp-monarch';
import { registerJspNavigation } from './jsp-navigation';
import { registerJspFindUsages } from './jsp-find-usages';
import { registerJspServletNavigation } from './jsp-servlet-nav';
import { registerJspDebugCodeLens, registerJspBreakpointCommand, registerJspBreakpointEditorOpener } from './jsp-debug-breakpoint';
import { WebXmlNavigationContribution } from './webxml-navigation';
import { XmlDtdValidator } from './xml-dtd-validator';
import { registerXmlDtdCompletion } from './xml-dtd-completion';
import { registerElExpressionProviders } from './el-expression-provider';
import { registerElNavigation } from './el-navigation';
import { registerXmlStructureView } from './xml-structure-view';
import { registerJspScriptletProviders } from './jsp-scriptlet-provider';
import { registerJspScriptletJavaCompletion } from './jsp-scriptlet-java-completion';
import { registerJspScriptletDiagnostics } from './jsp-scriptlet-diagnostics';
import { TldCompletionProvider, registerJspTldCompletion } from './jsp-tld-completion';
import { TldParser } from './tld-parser';
import { WebXmlCompletionProvider } from './webxml-completion';
import { registerXmlLanguage } from './xml-language';
import { registerJsonLanguage } from './json-language';
import { registerPropertiesLanguage } from './properties-language';

export { JSP_LANGUAGE_ID, JSP_MONARCH } from './jsp-monarch';

export function registerJspLanguage(): void {
  if (!monaco.languages.getLanguages().some(l => l.id === JSP_LANGUAGE_ID)) {
    monaco.languages.register({
      id: JSP_LANGUAGE_ID,
      extensions: ['.jsp', '.jspx', '.tag', '.tagx'],
      aliases: ['JSP', 'jsp'],
    });
  }
  monaco.languages.setMonarchTokensProvider(JSP_LANGUAGE_ID, JSP_MONARCH as monaco.languages.IMonarchLanguage);
}

/**
 * Registers the JSP Monarch grammar and navigation provider
 * at application start. Bound into the composition by
 * bindJspExtension (KAIRO-RC-WEB-002: previously
 * registerJspLanguage had zero callers and JSP files got no
 * syntax highlighting at all).
 */
@injectable()
export class KairoJspLanguageContribution implements FrontendApplicationContribution {
  @inject(JavaCompletionProvider)
  protected readonly javaProvider!: JavaCompletionProvider;

  @inject(JavaLanguageClient)
  protected readonly javaClient!: JavaLanguageClient;

  @inject(TldCompletionProvider)
  protected readonly tldProvider!: TldCompletionProvider;

  @inject(WebXmlCompletionProvider)
  protected readonly webxmlCompletionProvider!: WebXmlCompletionProvider;

  protected subs = new DisposableCollection();

  onStart(): void {
    registerJspLanguage();
    registerXmlLanguage();
    registerJsonLanguage();
    registerPropertiesLanguage();
    this.subs.push(Disposable.create(() => registerJspNavigation().dispose()));
    this.subs.push(Disposable.create(() => registerJspFindUsages().dispose()));
    this.subs.push(registerXmlDtdCompletion());
    this.subs.push(registerElExpressionProviders());
    this.subs.push(registerElNavigation());
    this.subs.push(registerXmlStructureView());
    this.subs.push(registerJspScriptletProviders(this.javaProvider));
    this.subs.push(registerJspScriptletJavaCompletion(this.javaProvider));
    this.subs.push(registerJspScriptletDiagnostics(this.javaClient));
    this.subs.push(Disposable.create(() => registerJspServletNavigation().dispose()));
    this.subs.push(registerJspDebugCodeLens());
    this.subs.push(registerJspBreakpointCommand());
    this.subs.push(registerJspBreakpointEditorOpener());
    this.subs.push(registerJspTldCompletion(this.tldProvider));
    this.subs.push(monaco.languages.registerCompletionItemProvider('xml', this.webxmlCompletionProvider));
  }
}

export function bindJspExtension(bind: interfaces.Bind): void {
  bind(KairoJspLanguageContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoJspLanguageContribution);
  bind(WebXmlNavigationContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(WebXmlNavigationContribution);
  bind(XmlDtdValidator).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(XmlDtdValidator);
  bind(TldCompletionProvider).toSelf().inSingletonScope();
  bind(TldParser).toSelf().inSingletonScope();
  bind(WebXmlCompletionProvider).toSelf().inSingletonScope();
}
