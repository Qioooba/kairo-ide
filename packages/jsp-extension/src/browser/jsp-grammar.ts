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
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { JavaCompletionProvider, JavaLanguageClient, JAVA_LANGUAGE_ID, JAVA_MONARCH, registerJavaLiveTemplates, applyKairoLanguageEditorDefaults } from '@kairo/java-extension';
import { KairoI18nService } from '@kairo/i18n';
import { JSP_LANGUAGE_ID, JSP_MONARCH } from './jsp-monarch';
import { registerJspNavigation } from './jsp-navigation';
import { registerJspFindUsages } from './jsp-find-usages';
import { registerJspServletNavigation } from './jsp-servlet-nav';
import {
  JspDebugBreakpointMapper,
  registerJspDebugCodeLens,
  registerJspBreakpointCommand,
  registerJspBreakpointEditorOpener,
} from './jsp-debug-breakpoint';
import { WebXmlNavigationContribution } from './webxml-navigation';
import { XmlDtdValidator } from './xml-dtd-validator';
import { registerXmlDtdCompletion } from './xml-dtd-completion';
import { registerElExpressionProviders } from './el-expression-provider';
import { registerElNavigation } from './el-navigation';
import { registerXmlStructureView } from './xml-structure-view';
import { registerJspScriptletProviders } from './jsp-scriptlet-provider';
import { analyzeCursorContext, registerJspScriptletJavaCompletion } from './jsp-scriptlet-java-completion';
import { registerJspScriptletDiagnostics } from './jsp-scriptlet-diagnostics';
import { registerJspScriptletBackgrounds } from './jsp-scriptlet-background';
import { TldCompletionProvider, registerJspTldCompletion } from './jsp-tld-completion';
import { TldParser } from './tld-parser';
import { WebXmlCompletionProvider } from './webxml-completion';
import { registerXmlLanguage } from './xml-language';
import { registerJsonLanguage } from './json-language';
import { registerPropertiesLanguage } from './properties-language';

export { JSP_LANGUAGE_ID, JSP_MONARCH } from './jsp-monarch';

export function registerJspLanguage(): void {
  // Embedded Java inside scriptlets needs language id `java` + Monarch.
  // Register defensively so JSP highlighting works even if the Java
  // contribution starts later (or fails to bind in a minimal shell).
  if (!monaco.languages.getLanguages().some(l => l.id === JAVA_LANGUAGE_ID)) {
    monaco.languages.register({
      id: JAVA_LANGUAGE_ID,
      extensions: ['.java'],
      aliases: ['Java', 'java'],
      mimetypes: ['text/x-java-source', 'text/x-java'],
    });
  }
  monaco.languages.setMonarchTokensProvider(JAVA_LANGUAGE_ID, JAVA_MONARCH as monaco.languages.IMonarchLanguage);

  if (!monaco.languages.getLanguages().some(l => l.id === JSP_LANGUAGE_ID)) {
    monaco.languages.register({
      id: JSP_LANGUAGE_ID,
      extensions: ['.jsp', '.jspx', '.tag', '.tagx'],
      aliases: ['JSP', 'jsp'],
    });
  }
  monaco.languages.setMonarchTokensProvider(JSP_LANGUAGE_ID, JSP_MONARCH as monaco.languages.IMonarchLanguage);
  monaco.languages.setLanguageConfiguration(JSP_LANGUAGE_ID, {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [
      ['<!--', '-->'],
      ['<%', '%>'],
      ['<%!', '%>'],
      ['<%=', '%>'],
      ['<%@', '%>'],
      ['${', '}'],
      ['#{', '}'],
      ['<', '>'],
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '<!--', close: '-->' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '${', close: '}' },
    ],
    surroundingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '<', close: '>' },
    ],
    folding: {
      markers: {
        start: new RegExp('^\\s*<!--\\s*#?region\\b'),
        end: new RegExp('^\\s*<!--\\s*#?endregion\\b'),
      },
    },
  });
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

  @inject(FileService)
  protected readonly fileService!: FileService;

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService;

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(JspDebugBreakpointMapper)
  protected readonly jspDebugMapper!: JspDebugBreakpointMapper;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  protected subs = new DisposableCollection();

  protected navServices(): { fileService: FileService; workspaceService: WorkspaceService } {
    return { fileService: this.fileService, workspaceService: this.workspaceService };
  }

  onStart(): void {
    applyKairoLanguageEditorDefaults();
    registerJspLanguage();
    registerXmlLanguage();
    registerJsonLanguage(this.i18n);
    registerPropertiesLanguage(this.i18n);
    const nav = this.navServices();
    this.subs.push(registerJspNavigation(nav));
    this.subs.push(registerJspFindUsages(nav));
    this.subs.push(registerXmlDtdCompletion(this.i18n));
    this.subs.push(registerElExpressionProviders(this.i18n));
    this.subs.push(registerElNavigation(nav));
    this.subs.push(registerXmlStructureView(this.i18n));
    this.subs.push(registerJspScriptletProviders(this.javaProvider));
    this.subs.push(registerJspScriptletJavaCompletion(this.javaProvider, this.javaClient, this.i18n));
    this.subs.push(registerJavaLiveTemplates(JSP_LANGUAGE_ID, {
      shouldProvide: (model, position) => {
        const ctx = analyzeCursorContext(
          model.getValue(),
          position.lineNumber - 1,
          position.column - 1,
        );
        return ctx.insideJavaBlock;
      },
    }));
    this.subs.push(registerJspScriptletDiagnostics(this.javaClient));
    this.subs.push(registerJspScriptletBackgrounds());
    this.subs.push(registerJspServletNavigation(nav));
    this.subs.push(registerJspDebugCodeLens(this.i18n));
    this.subs.push(registerJspBreakpointCommand(this.jspDebugMapper, this.i18n));
    this.subs.push(registerJspBreakpointEditorOpener(this.editorManager, this.fileService));
    this.subs.push(registerJspTldCompletion(this.tldProvider));
    this.subs.push(monaco.languages.registerCompletionItemProvider('xml', this.webxmlCompletionProvider));
  }
}

export function bindJspExtension(bind: interfaces.Bind): void {
  bind(KairoJspLanguageContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoJspLanguageContribution);
  bind(WebXmlNavigationContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(WebXmlNavigationContribution);
  bind(JspDebugBreakpointMapper).toSelf().inSingletonScope();
  bind(XmlDtdValidator).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(XmlDtdValidator);
  bind(TldCompletionProvider).toSelf().inSingletonScope();
  bind(TldParser).toSelf().inSingletonScope();
  bind(WebXmlCompletionProvider).toSelf().inSingletonScope();
}
