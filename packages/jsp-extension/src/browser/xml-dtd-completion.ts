/**
 * XML/DTD code completion provider.
 *
 * Provides completion suggestions for:
 *  - web.xml elements (servlet, servlet-mapping, filter, listener, etc.)
 *  - TLD tag elements (tag, name, tag-class, body-content, attribute, etc.)
 *  - Common XML attributes (xmlns, schemaLocation, version, encoding)
 *
 * Completion is triggered by '<' for element names and by typing
 * attribute names in open tags.
 */

import * as monaco from '@theia/monaco-editor-core';
import type { I18nService } from '@kairo/i18n';
import { injectable } from '@theia/core/shared/inversify';
import { setJspI18n, t } from './i18n-context';

/** Create a completion item without a hard-coded range (caller supplies word range). */
function item(partial: Partial<monaco.languages.CompletionItem> & {
  label: string;
  kind: monaco.languages.CompletionItemKind;
  insertText: string;
}): monaco.languages.CompletionItem {
  return {
    ...partial,
  } as monaco.languages.CompletionItem;
}

/** web.xml completion items for common elements. Built per provide call. */
function buildWebxmlElements(): monaco.languages.CompletionItem[] {
  return [
    item({ label: 'web-app', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.webApp.detail'), insertText: 'web-app', documentation: t('completion.dtd.webApp.doc') }),
    item({ label: 'servlet', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.servlet.detail'), insertText: 'servlet>\n  <servlet-name>${1}</servlet-name>\n  <servlet-class>${2}</servlet-class>\n</servlet', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.servlet.doc') }),
    item({ label: 'servlet-mapping', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.servletMapping.detail'), insertText: 'servlet-mapping>\n  <servlet-name>${1}</servlet-name>\n  <url-pattern>${2}</url-pattern>\n</servlet-mapping', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.servletMapping.doc') }),
    item({ label: 'servlet-name', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.servletName.detail'), insertText: 'servlet-name', documentation: t('completion.dtd.servletName.doc') }),
    item({ label: 'servlet-class', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.servletClass.detail'), insertText: 'servlet-class', documentation: t('completion.dtd.servletClass.doc') }),
    item({ label: 'url-pattern', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.urlPattern.detail'), insertText: 'url-pattern', documentation: t('completion.dtd.urlPattern.doc') }),
    item({ label: 'filter', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.filter.detail'), insertText: 'filter>\n  <filter-name>${1}</filter-name>\n  <filter-class>${2}</filter-class>\n</filter', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.filter.doc') }),
    item({ label: 'filter-name', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.filterName.detail'), insertText: 'filter-name', documentation: t('completion.dtd.filterName.doc') }),
    item({ label: 'filter-class', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.filterClass.detail'), insertText: 'filter-class', documentation: t('completion.dtd.filterClass.doc') }),
    item({ label: 'filter-mapping', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.filterMapping.detail'), insertText: 'filter-mapping>\n  <filter-name>${1}</filter-name>\n  <url-pattern>${2}</url-pattern>\n</filter-mapping', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.filterMapping.doc') }),
    item({ label: 'listener', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.listener.detail'), insertText: 'listener>\n  <listener-class>${1}</listener-class>\n</listener', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.listener.doc') }),
    item({ label: 'listener-class', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.listenerClass.detail'), insertText: 'listener-class', documentation: t('completion.dtd.listenerClass.doc') }),
    item({ label: 'welcome-file-list', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.welcomeFileList.detail'), insertText: 'welcome-file-list>\n  <welcome-file>${1}</welcome-file>\n</welcome-file-list', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.welcomeFileList.doc') }),
    item({ label: 'welcome-file', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.welcomeFile.detail'), insertText: 'welcome-file', documentation: t('completion.dtd.welcomeFile.doc') }),
    item({ label: 'error-page', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.errorPage.detail'), insertText: 'error-page>\n  <error-code>${1}</error-code>\n  <location>${2}</location>\n</error-page', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.errorPage.doc') }),
    item({ label: 'error-code', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.errorCode.detail'), insertText: 'error-code', documentation: t('completion.dtd.errorCode.doc') }),
    item({ label: 'exception-type', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.exceptionType.detail'), insertText: 'exception-type', documentation: t('completion.dtd.exceptionType.doc') }),
    item({ label: 'location', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.location.detail'), insertText: 'location', documentation: t('completion.dtd.location.doc') }),
    item({ label: 'context-param', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.contextParam.detail'), insertText: 'context-param>\n  <param-name>${1}</param-name>\n  <param-value>${2}</param-value>\n</context-param', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.contextParam.doc') }),
    item({ label: 'param-name', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.paramName.detail'), insertText: 'param-name', documentation: t('completion.dtd.paramName.doc') }),
    item({ label: 'param-value', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.paramValue.detail'), insertText: 'param-value', documentation: t('completion.dtd.paramValue.doc') }),
    item({ label: 'init-param', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.initParam.detail'), insertText: 'init-param>\n  <param-name>${1}</param-name>\n  <param-value>${2}</param-value>\n</init-param', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.initParam.doc') }),
    item({ label: 'load-on-startup', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.loadOnStartup.detail'), insertText: 'load-on-startup', documentation: t('completion.dtd.loadOnStartup.doc') }),
    item({ label: 'session-config', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.sessionConfig.detail'), insertText: 'session-config>\n  <session-timeout>${1}</session-timeout>\n</session-config', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.sessionConfig.doc') }),
    item({ label: 'session-timeout', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.sessionTimeout.detail'), insertText: 'session-timeout', documentation: t('completion.dtd.sessionTimeout.doc') }),
    item({ label: 'mime-mapping', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.mimeMapping.detail'), insertText: 'mime-mapping>\n  <extension>${1}</extension>\n  <mime-type>${2}</mime-type>\n</mime-mapping', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.mimeMapping.doc') }),
    item({ label: 'display-name', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.displayName.detail'), insertText: 'display-name', documentation: t('completion.dtd.displayName.doc') }),
    item({ label: 'description', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.description.detail'), insertText: 'description', documentation: t('completion.dtd.description.doc') }),
  ];
}

/** TLD element completion items. Built per provide call. */
function buildTldElements(): monaco.languages.CompletionItem[] {
  return [
    item({ label: 'taglib', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.taglib.detail'), insertText: 'taglib', documentation: t('completion.dtd.taglib.doc') }),
    item({ label: 'tlib-version', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.tlibVersion.detail'), insertText: 'tlib-version', documentation: t('completion.dtd.tlibVersion.doc') }),
    item({ label: 'short-name', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.shortName.detail'), insertText: 'short-name', documentation: t('completion.dtd.shortName.doc') }),
    item({ label: 'uri', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.uri.detail'), insertText: 'uri', documentation: t('completion.dtd.uri.doc') }),
    item({ label: 'tag', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.tag.detail'), insertText: 'tag>\n  <name>${1}</name>\n  <tag-class>${2}</tag-class>\n  <body-content>${3}</body-content>\n</tag', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.tag.doc') }),
    item({ label: 'name', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.name.detail'), insertText: 'name', documentation: t('completion.dtd.name.doc') }),
    item({ label: 'tag-class', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.tagClass.detail'), insertText: 'tag-class', documentation: t('completion.dtd.tagClass.doc') }),
    item({ label: 'body-content', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.bodyContent.detail'), insertText: 'body-content', documentation: t('completion.dtd.bodyContent.doc') }),
    item({ label: 'attribute', kind: monaco.languages.CompletionItemKind.Class, detail: t('completion.dtd.attribute.detail'), insertText: 'attribute>\n  <name>${1}</name>\n  <required>${2|true,false|}</required>\n  <rtexprvalue>${3|true,false|}</rtexprvalue>\n</attribute', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.attribute.doc') }),
    item({ label: 'required', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.required.detail'), insertText: 'required', documentation: t('completion.dtd.required.doc') }),
    item({ label: 'rtexprvalue', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.rtexprvalue.detail'), insertText: 'rtexprvalue', documentation: t('completion.dtd.rtexprvalue.doc') }),
    item({ label: 'type', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.type.detail'), insertText: 'type', documentation: t('completion.dtd.type.doc') }),
    item({ label: 'description', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.dtd.tldDescription.detail'), insertText: 'description', documentation: t('completion.dtd.tldDescription.doc') }),
  ];
}

/** Common XML attribute completion items. Built per provide call. */
function buildCommonAttributes(): monaco.languages.CompletionItem[] {
  return [
    item({ label: 'xmlns', kind: monaco.languages.CompletionItemKind.Property, detail: t('completion.dtd.attr.xmlns.detail'), insertText: 'xmlns="${1}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.attr.xmlns.doc') }),
    item({ label: 'xmlns:xsi', kind: monaco.languages.CompletionItemKind.Property, detail: t('completion.dtd.attr.xmlnsXsi.detail'), insertText: 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"', documentation: t('completion.dtd.attr.xmlnsXsi.doc') }),
    item({ label: 'xsi:schemaLocation', kind: monaco.languages.CompletionItemKind.Property, detail: t('completion.dtd.attr.xsiSchemaLocation.detail'), insertText: 'xsi:schemaLocation="${1} ${2}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.attr.xsiSchemaLocation.doc') }),
    item({ label: 'version', kind: monaco.languages.CompletionItemKind.Property, detail: t('completion.dtd.attr.version.detail'), insertText: 'version="${1}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.attr.version.doc') }),
    item({ label: 'encoding', kind: monaco.languages.CompletionItemKind.Property, detail: t('completion.dtd.attr.encoding.detail'), insertText: 'encoding="${1}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.attr.encoding.doc') }),
    item({ label: 'id', kind: monaco.languages.CompletionItemKind.Property, detail: t('completion.dtd.attr.id.detail'), insertText: 'id="${1}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: t('completion.dtd.attr.id.doc') }),
  ];
}

/** Check if a URI corresponds to a web.xml file. */
function isWebXml(uri: string): boolean {
  return /WEB-INF[/\\]web\.xml$/i.test(uri);
}

/** Check if a URI corresponds to a TLD file. */
function isTldFile(uri: string): boolean {
  return /\.tld$/i.test(uri);
}

/** Check if the cursor is inside an opening tag (before the closing `>`). */
function isInsideOpenTag(lineBeforeCursor: string): boolean {
  const lastOpen = lineBeforeCursor.lastIndexOf('<');
  const lastClose = lineBeforeCursor.lastIndexOf('>');
  return lastOpen > lastClose;
}

/**
 * XML/DTD completion provider.
 *
 * Registers with Monaco to provide completion items for XML files.
 * The type of completion (web.xml vs TLD) is determined by the file URI.
 */
@injectable()
export class XmlDtdCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['<', ' '];

  provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.CompletionContext,
    _token: monaco.CancellationToken,
  ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
    const lineContent = model.getLineContent(position.lineNumber);
    const lineBeforeCursor = lineContent.substring(0, position.column - 1);
    const uri = model.uri.path;
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const withRange = (items: monaco.languages.CompletionItem[]) => items.map(it => ({ ...it, range } as monaco.languages.CompletionItem));

    // Determine completion context
    if (isInsideOpenTag(lineBeforeCursor)) {
      const afterLt = lineBeforeCursor.substring(lineBeforeCursor.lastIndexOf('<') + 1);
      // If after '<' contains a space, we are inside an open tag's attribute list -> suggest attributes
      // e.g. "<web-app " or "<servlet "
      if (/\s/.test(afterLt)) {
        return { suggestions: withRange(buildCommonAttributes()) };
      }
      // After '<' — suggest element names
      if (isTldFile(uri)) {
        return { suggestions: withRange(buildTldElements()) };
      }
      if (isWebXml(uri)) {
        return { suggestions: withRange(buildWebxmlElements()) };
      }
      // For generic XML files, provide both
      return { suggestions: withRange([...buildWebxmlElements(), ...buildTldElements()]) };
    }

    return { suggestions: [] };
  }
}

/**
 * Register the XML completion provider with Monaco.
 * Returns a Disposable for cleanup.
 */
export function registerXmlDtdCompletion(i18n?: I18nService): monaco.IDisposable {
  setJspI18n(i18n);
  return monaco.languages.registerCompletionItemProvider('xml', new XmlDtdCompletionProvider());
}