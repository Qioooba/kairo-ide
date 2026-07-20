/**
 * JSP language registration for Monaco.
 *
 * Monaco is imported as a module (NOT the fragile `window.monaco`
 * global — KAIRO-RC-WEB-002), and registration is wired into the
 * Theia composition via KairoJspLanguageContribution below.
 */

import * as monaco from '@theia/monaco-editor-core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { injectable, interfaces } from '@theia/core/shared/inversify';
import { JSP_LANGUAGE_ID, JSP_MONARCH } from './jsp-monarch';

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
 * Registers the JSP Monarch grammar at application start.
 * Bound into the composition by bindJspExtension (KAIRO-RC-WEB-002:
 * previously registerJspLanguage had zero callers and JSP files
 * got no syntax highlighting at all).
 */
@injectable()
export class KairoJspLanguageContribution implements FrontendApplicationContribution {
  onStart(): void {
    registerJspLanguage();
  }
}

export function bindJspExtension(bind: interfaces.Bind): void {
  bind(KairoJspLanguageContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoJspLanguageContribution);
}
