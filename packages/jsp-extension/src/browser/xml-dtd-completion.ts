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
import { injectable } from '@theia/core/shared/inversify';

/** Create a completion item with a default range placeholder. */
function item(partial: Partial<monaco.languages.CompletionItem> & {
  label: string;
  kind: monaco.languages.CompletionItemKind;
  insertText: string;
}): monaco.languages.CompletionItem {
  return {
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
    ...partial,
  } as monaco.languages.CompletionItem;
}

/** web.xml completion items for common elements. */
const WEBXML_ELEMENTS: monaco.languages.CompletionItem[] = [
  item({ label: 'web-app', kind: monaco.languages.CompletionItemKind.Class, detail: 'web.xml 根元素', insertText: 'web-app', documentation: 'web.xml 部署描述符的根元素。' }),
  item({ label: 'servlet', kind: monaco.languages.CompletionItemKind.Class, detail: 'Servlet 定义', insertText: 'servlet>\n  <servlet-name>${1}</servlet-name>\n  <servlet-class>${2}</servlet-class>\n</servlet', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义一个 Servlet 组件。' }),
  item({ label: 'servlet-mapping', kind: monaco.languages.CompletionItemKind.Class, detail: 'Servlet 映射', insertText: 'servlet-mapping>\n  <servlet-name>${1}</servlet-name>\n  <url-pattern>${2}</url-pattern>\n</servlet-mapping', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义 Servlet 的 URL 映射规则。' }),
  item({ label: 'servlet-name', kind: monaco.languages.CompletionItemKind.Value, detail: 'Servlet 名称', insertText: 'servlet-name', documentation: 'Servlet 的标识名称。' }),
  item({ label: 'servlet-class', kind: monaco.languages.CompletionItemKind.Value, detail: 'Servlet 类名', insertText: 'servlet-class', documentation: 'Servlet 实现类的全限定名。' }),
  item({ label: 'url-pattern', kind: monaco.languages.CompletionItemKind.Value, detail: 'URL 映射模式', insertText: 'url-pattern', documentation: 'Servlet 的 URL 映射模式，如 /hello 或 *.do。' }),
  item({ label: 'filter', kind: monaco.languages.CompletionItemKind.Class, detail: 'Filter 定义', insertText: 'filter>\n  <filter-name>${1}</filter-name>\n  <filter-class>${2}</filter-class>\n</filter', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义一个 Filter 过滤器组件。' }),
  item({ label: 'filter-name', kind: monaco.languages.CompletionItemKind.Value, detail: 'Filter 名称', insertText: 'filter-name', documentation: 'Filter 的标识名称。' }),
  item({ label: 'filter-class', kind: monaco.languages.CompletionItemKind.Value, detail: 'Filter 类名', insertText: 'filter-class', documentation: 'Filter 实现类的全限定名。' }),
  item({ label: 'filter-mapping', kind: monaco.languages.CompletionItemKind.Class, detail: 'Filter 映射', insertText: 'filter-mapping>\n  <filter-name>${1}</filter-name>\n  <url-pattern>${2}</url-pattern>\n</filter-mapping', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义 Filter 的 URL 映射规则。' }),
  item({ label: 'listener', kind: monaco.languages.CompletionItemKind.Class, detail: 'Listener 定义', insertText: 'listener>\n  <listener-class>${1}</listener-class>\n</listener', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义一个事件监听器组件。' }),
  item({ label: 'listener-class', kind: monaco.languages.CompletionItemKind.Value, detail: 'Listener 类名', insertText: 'listener-class', documentation: 'Listener 实现类的全限定名。' }),
  item({ label: 'welcome-file-list', kind: monaco.languages.CompletionItemKind.Class, detail: '欢迎文件列表', insertText: 'welcome-file-list>\n  <welcome-file>${1}</welcome-file>\n</welcome-file-list', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义应用的欢迎文件列表。' }),
  item({ label: 'welcome-file', kind: monaco.languages.CompletionItemKind.Value, detail: '欢迎文件', insertText: 'welcome-file', documentation: '指定一个欢迎文件，如 index.jsp。' }),
  item({ label: 'error-page', kind: monaco.languages.CompletionItemKind.Class, detail: '错误页面定义', insertText: 'error-page>\n  <error-code>${1}</error-code>\n  <location>${2}</location>\n</error-page', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义 HTTP 错误码对应的错误页面。' }),
  item({ label: 'error-code', kind: monaco.languages.CompletionItemKind.Value, detail: '错误码', insertText: 'error-code', documentation: 'HTTP 错误码，如 404、500。' }),
  item({ label: 'exception-type', kind: monaco.languages.CompletionItemKind.Value, detail: '异常类型', insertText: 'exception-type', documentation: 'Java 异常类的全限定名。' }),
  item({ label: 'location', kind: monaco.languages.CompletionItemKind.Value, detail: '跳转位置', insertText: 'location', documentation: '错误或异常发生时的跳转路径。' }),
  item({ label: 'context-param', kind: monaco.languages.CompletionItemKind.Class, detail: '上下文参数', insertText: 'context-param>\n  <param-name>${1}</param-name>\n  <param-value>${2}</param-value>\n</context-param', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义 Servlet 上下文的初始化参数。' }),
  item({ label: 'param-name', kind: monaco.languages.CompletionItemKind.Value, detail: '参数名', insertText: 'param-name', documentation: '参数名称。' }),
  item({ label: 'param-value', kind: monaco.languages.CompletionItemKind.Value, detail: '参数值', insertText: 'param-value', documentation: '参数值。' }),
  item({ label: 'init-param', kind: monaco.languages.CompletionItemKind.Class, detail: '初始化参数', insertText: 'init-param>\n  <param-name>${1}</param-name>\n  <param-value>${2}</param-value>\n</init-param', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义 Servlet 的初始化参数。' }),
  item({ label: 'load-on-startup', kind: monaco.languages.CompletionItemKind.Value, detail: '启动加载顺序', insertText: 'load-on-startup', documentation: 'Servlet 启动时加载的优先级，值越小越先加载。' }),
  item({ label: 'session-config', kind: monaco.languages.CompletionItemKind.Class, detail: '会话配置', insertText: 'session-config>\n  <session-timeout>${1}</session-timeout>\n</session-config', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '配置 HTTP 会话参数。' }),
  item({ label: 'session-timeout', kind: monaco.languages.CompletionItemKind.Value, detail: '会话超时（分钟）', insertText: 'session-timeout', documentation: '会话超时时间，单位为分钟。' }),
  item({ label: 'mime-mapping', kind: monaco.languages.CompletionItemKind.Class, detail: 'MIME 映射', insertText: 'mime-mapping>\n  <extension>${1}</extension>\n  <mime-type>${2}</mime-type>\n</mime-mapping', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义文件扩展名到 MIME 类型的映射。' }),
  item({ label: 'display-name', kind: monaco.languages.CompletionItemKind.Value, detail: '显示名称', insertText: 'display-name', documentation: '应用的显示名称。' }),
  item({ label: 'description', kind: monaco.languages.CompletionItemKind.Value, detail: '描述', insertText: 'description', documentation: '元素描述信息。' }),
];

/** TLD element completion items. */
const TLD_ELEMENTS: monaco.languages.CompletionItem[] = [
  item({ label: 'taglib', kind: monaco.languages.CompletionItemKind.Class, detail: 'TLD 根元素', insertText: 'taglib', documentation: '标签库描述符的根元素。' }),
  item({ label: 'tlib-version', kind: monaco.languages.CompletionItemKind.Value, detail: '标签库版本', insertText: 'tlib-version', documentation: '标签库的版本号。' }),
  item({ label: 'short-name', kind: monaco.languages.CompletionItemKind.Value, detail: '标签库简称', insertText: 'short-name', documentation: '标签库的简短名称，用于 JSP 中 taglib 指令的 prefix 属性。' }),
  item({ label: 'uri', kind: monaco.languages.CompletionItemKind.Value, detail: '标签库 URI', insertText: 'uri', documentation: '标签库的唯一标识 URI。' }),
  item({ label: 'tag', kind: monaco.languages.CompletionItemKind.Class, detail: '标签定义', insertText: 'tag>\n  <name>${1}</name>\n  <tag-class>${2}</tag-class>\n  <body-content>${3}</body-content>\n</tag', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义一个自定义标签。' }),
  item({ label: 'name', kind: monaco.languages.CompletionItemKind.Value, detail: '标签名称', insertText: 'name', documentation: '标签的名称。' }),
  item({ label: 'tag-class', kind: monaco.languages.CompletionItemKind.Value, detail: '标签处理类', insertText: 'tag-class', documentation: '标签处理类的全限定名。' }),
  item({ label: 'body-content', kind: monaco.languages.CompletionItemKind.Value, detail: '标签体内容类型', insertText: 'body-content', documentation: '标签体内容类型：empty、JSP、scriptless、tagdependent。' }),
  item({ label: 'attribute', kind: monaco.languages.CompletionItemKind.Class, detail: '标签属性定义', insertText: 'attribute>\n  <name>${1}</name>\n  <required>${2|true,false|}</required>\n  <rtexprvalue>${3|true,false|}</rtexprvalue>\n</attribute', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '定义标签的属性。' }),
  item({ label: 'required', kind: monaco.languages.CompletionItemKind.Value, detail: '是否必需', insertText: 'required', documentation: '属性是否必需：true 或 false。' }),
  item({ label: 'rtexprvalue', kind: monaco.languages.CompletionItemKind.Value, detail: '是否支持 EL 表达式', insertText: 'rtexprvalue', documentation: '属性值是否支持运行时表达式（EL）：true 或 false，默认 false。' }),
  item({ label: 'type', kind: monaco.languages.CompletionItemKind.Value, detail: '属性类型', insertText: 'type', documentation: '属性的 Java 类型，如 java.lang.String。' }),
  item({ label: 'description', kind: monaco.languages.CompletionItemKind.Value, detail: '描述', insertText: 'description', documentation: '元素的描述信息。' }),
];

/** Common XML attribute completion items. */
const COMMON_ATTRIBUTES: monaco.languages.CompletionItem[] = [
  item({ label: 'xmlns', kind: monaco.languages.CompletionItemKind.Property, detail: 'XML 命名空间声明', insertText: 'xmlns="${1}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '声明默认 XML 命名空间。' }),
  item({ label: 'xmlns:xsi', kind: monaco.languages.CompletionItemKind.Property, detail: 'XSI 命名空间', insertText: 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"', documentation: 'XML Schema Instance 命名空间。' }),
  item({ label: 'xsi:schemaLocation', kind: monaco.languages.CompletionItemKind.Property, detail: 'Schema 位置', insertText: 'xsi:schemaLocation="${1} ${2}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '指定命名空间和对应的 XSD 文件位置。' }),
  item({ label: 'version', kind: monaco.languages.CompletionItemKind.Property, detail: '版本号', insertText: 'version="${1}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'XML 版本号，如 1.0。' }),
  item({ label: 'encoding', kind: monaco.languages.CompletionItemKind.Property, detail: '编码', insertText: 'encoding="${1}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'XML 文档编码，如 UTF-8、GBK。' }),
  item({ label: 'id', kind: monaco.languages.CompletionItemKind.Property, detail: '元素 ID', insertText: 'id="${1}"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: '元素的唯一标识符。' }),
];

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

    // Determine completion context
    if (isInsideOpenTag(lineBeforeCursor)) {
      // After '<' — suggest element names
      if (isTldFile(uri)) {
        return { suggestions: TLD_ELEMENTS };
      }
      if (isWebXml(uri)) {
        return { suggestions: WEBXML_ELEMENTS };
      }
      // For generic XML files, provide both
      return { suggestions: [...WEBXML_ELEMENTS, ...TLD_ELEMENTS] };
    }

    // Inside an open tag — suggest attribute names
    const lastTagStart = lineBeforeCursor.lastIndexOf('<');
    if (lastTagStart >= 0) {
      const afterTag = lineBeforeCursor.substring(lastTagStart + 1);
      // Check if we're still inside the tag (no closing >)
      if (!afterTag.includes('>')) {
        return { suggestions: COMMON_ATTRIBUTES };
      }
    }

    return { suggestions: [] };
  }
}

/**
 * Register the XML completion provider with Monaco.
 * Returns a Disposable for cleanup.
 */
export function registerXmlDtdCompletion(): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('xml', new XmlDtdCompletionProvider());
}