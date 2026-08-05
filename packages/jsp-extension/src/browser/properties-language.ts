/**
 * Properties file language registration for Monaco.
 *
 * Registers the .properties language with Monarch grammar,
 * completion provider, and language configuration.
 *
 * Provides:
 *  - Syntax highlighting for .properties files
 *  - Key completion based on common Java properties patterns
 *  - Auto-closing pairs and bracket matching
 */

import * as monaco from '@theia/monaco-editor-core';
import { PROPERTIES_LANGUAGE_ID, PROPERTIES_MONARCH } from './properties-monarch';

/**
 * Common Java properties keys for completion suggestions.
 * Organized by category.
 */
const PROPERTIES_KEY_COMPLETIONS: Record<string, Array<Omit<monaco.languages.CompletionItem, 'range'> & { range?: monaco.IRange }>> = {
  /** JDBC / Database connection properties. */
  datasource: [
    createCompletion('jdbc.driverClassName', 'Property', 'JDBC 驱动类名', 'jdbc.driverClassName'),
    createCompletion('jdbc.url', 'Property', 'JDBC 连接 URL', 'jdbc.url'),
    createCompletion('jdbc.username', 'Property', '数据库用户名', 'jdbc.username'),
    createCompletion('jdbc.password', 'Property', '数据库密码', 'jdbc.password'),
    createCompletion('jdbc.initialSize', 'Property', '连接池初始大小', 'jdbc.initialSize'),
    createCompletion('jdbc.maxActive', 'Property', '最大活跃连接数', 'jdbc.maxActive'),
    createCompletion('jdbc.maxIdle', 'Property', '最大空闲连接数', 'jdbc.maxIdle'),
    createCompletion('jdbc.minIdle', 'Property', '最小空闲连接数', 'jdbc.minIdle'),
    createCompletion('jdbc.maxWait', 'Property', '最大等待时间 (ms)', 'jdbc.maxWait'),
    createCompletion('jdbc.validationQuery', 'Property', '连接验证 SQL', 'jdbc.validationQuery'),
    createCompletion('jdbc.testOnBorrow', 'Property', '获取连接时验证', 'jdbc.testOnBorrow'),
    createCompletion('jdbc.testWhileIdle', 'Property', '空闲时验证', 'jdbc.testWhileIdle'),
  ],

  /** Logging properties. */
  logging: [
    createCompletion('log.level', 'Property', '日志级别', 'log.level'),
    createCompletion('log.file', 'Property', '日志文件路径', 'log.file'),
    createCompletion('log.maxFileSize', 'Property', '最大日志文件大小', 'log.maxFileSize'),
    createCompletion('log.maxBackupIndex', 'Property', '最大备份文件数', 'log.maxBackupIndex'),
    createCompletion('log.pattern', 'Property', '日志输出格式', 'log.pattern'),
    createCompletion('logging.level.root', 'Property', '根日志级别', 'logging.level.root'),
    createCompletion('logging.level.org.springframework', 'Property', 'Spring 日志级别', 'logging.level.org.springframework'),
    createCompletion('logging.file.name', 'Property', '日志文件名', 'logging.file.name'),
    createCompletion('logging.file.path', 'Property', '日志文件路径', 'logging.file.path'),
  ],

  /** Server / Tomcat properties. */
  server: [
    createCompletion('server.port', 'Property', '服务器端口', 'server.port'),
    createCompletion('server.address', 'Property', '绑定地址', 'server.address'),
    createCompletion('server.servlet.context-path', 'Property', '上下文路径', 'server.servlet.context-path'),
    createCompletion('server.servlet.session.timeout', 'Property', '会话超时', 'server.servlet.session.timeout'),
    createCompletion('server.tomcat.max-threads', 'Property', 'Tomcat 最大线程数', 'server.tomcat.max-threads'),
    createCompletion('server.tomcat.uri-encoding', 'Property', 'URI 编码', 'server.tomcat.uri-encoding'),
    createCompletion('server.connection-timeout', 'Property', '连接超时 (ms)', 'server.connection-timeout'),
    createCompletion('server.max-http-header-size', 'Property', '最大 HTTP 请求头大小', 'server.max-http-header-size'),
  ],

  /** Spring framework properties. */
  spring: [
    createCompletion('spring.application.name', 'Property', '应用名称', 'spring.application.name'),
    createCompletion('spring.profiles.active', 'Property', '激活的配置文件', 'spring.profiles.active'),
    createCompletion('spring.datasource.url', 'Property', '数据源 URL', 'spring.datasource.url'),
    createCompletion('spring.datasource.username', 'Property', '数据源用户名', 'spring.datasource.username'),
    createCompletion('spring.datasource.password', 'Property', '数据源密码', 'spring.datasource.password'),
    createCompletion('spring.datasource.driver-class-name', 'Property', 'JDBC 驱动', 'spring.datasource.driver-class-name'),
    createCompletion('spring.jpa.hibernate.ddl-auto', 'Property', 'Hibernate DDL 策略', 'spring.jpa.hibernate.ddl-auto'),
    createCompletion('spring.jpa.show-sql', 'Property', '显示 SQL', 'spring.jpa.show-sql'),
    createCompletion('spring.mvc.view.prefix', 'Property', '视图前缀', 'spring.mvc.view.prefix'),
    createCompletion('spring.mvc.view.suffix', 'Property', '视图后缀', 'spring.mvc.view.suffix'),
    createCompletion('spring.cache.type', 'Property', '缓存类型', 'spring.cache.type'),
    createCompletion('spring.redis.host', 'Property', 'Redis 主机', 'spring.redis.host'),
    createCompletion('spring.redis.port', 'Property', 'Redis 端口', 'spring.redis.port'),
  ],

  /** Application general properties. */
  app: [
    createCompletion('app.name', 'Property', '应用名称', 'app.name'),
    createCompletion('app.version', 'Property', '应用版本', 'app.version'),
    createCompletion('app.description', 'Property', '应用描述', 'app.description'),
    createCompletion('app.debug', 'Property', '调试模式', 'app.debug'),
    createCompletion('app.locale', 'Property', '默认语言', 'app.locale'),
    createCompletion('app.timezone', 'Property', '时区', 'app.timezone'),
    createCompletion('app.encoding', 'Property', '编码', 'app.encoding'),
    createCompletion('app.upload.max-file-size', 'Property', '最大上传文件大小', 'app.upload.max-file-size'),
    createCompletion('app.upload.path', 'Property', '上传路径', 'app.upload.path'),
  ],

  /** MyBatis properties. */
  mybatis: [
    createCompletion('mybatis.mapper-locations', 'Property', 'Mapper XML 位置', 'mybatis.mapper-locations'),
    createCompletion('mybatis.type-aliases-package', 'Property', '类型别名包', 'mybatis.type-aliases-package'),
    createCompletion('mybatis.configuration.map-underscore-to-camel-case', 'Property', '驼峰命名映射', 'mybatis.configuration.map-underscore-to-camel-case'),
    createCompletion('mybatis.configuration.log-impl', 'Property', '日志实现', 'mybatis.configuration.log-impl'),
    createCompletion('mybatis.configuration.cache-enabled', 'Property', '启用缓存', 'mybatis.configuration.cache-enabled'),
    createCompletion('mybatis.configuration.lazy-loading-enabled', 'Property', '启用延迟加载', 'mybatis.configuration.lazy-loading-enabled'),
  ],
};

function createCompletion(
  label: string,
  kind: string,
  detail: string,
  insertText: string,
): Omit<monaco.languages.CompletionItem, 'range'> & { range?: monaco.IRange } {
  const kindMap: Record<string, monaco.languages.CompletionItemKind> = {
    'Property': monaco.languages.CompletionItemKind.Property,
    'Value': monaco.languages.CompletionItemKind.Value,
    'Keyword': monaco.languages.CompletionItemKind.Keyword,
  };
  return {
    label,
    kind: kindMap[kind] ?? monaco.languages.CompletionItemKind.Property,
    detail,
    insertText,
  };
}

/**
 * Properties completion provider.
 */
class PropertiesCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['.', '='];

  provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.CompletionContext,
    _token: monaco.CancellationToken,
  ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
    const lineContent = model.getLineContent(position.lineNumber);
    const lineBeforeCursor = lineContent.substring(0, position.column - 1);

    // Don't suggest in comments
    if (/^\s*[#!]/.test(lineContent)) {
      return { suggestions: [] };
    }

    // Already has a separator (key is already complete)
    if (/[=:]/.test(lineBeforeCursor)) {
      return { suggestions: [] };
    }

    // Collect all property key suggestions with a real replace range.
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    const allSuggestions: monaco.languages.CompletionItem[] = [];
    for (const category of Object.values(PROPERTIES_KEY_COMPLETIONS)) {
      for (const item of category) {
        allSuggestions.push({ ...item, range } as monaco.languages.CompletionItem);
      }
    }

    return { suggestions: allSuggestions };
  }
}

/**
 * Register the Properties language with Monaco.
 */
export function registerPropertiesLanguage(): void {
  if (!monaco.languages.getLanguages().some(l => l.id === PROPERTIES_LANGUAGE_ID)) {
    monaco.languages.register({
      id: PROPERTIES_LANGUAGE_ID,
      extensions: ['.properties', '.cfg', '.conf', '.ini', '.env'],
      aliases: ['Properties', 'properties'],
      filenames: ['.env'],
    });
  }
  monaco.languages.setMonarchTokensProvider(PROPERTIES_LANGUAGE_ID, PROPERTIES_MONARCH as monaco.languages.IMonarchLanguage);

  // Language configuration
  monaco.languages.setLanguageConfiguration(PROPERTIES_LANGUAGE_ID, {
    comments: {
      lineComment: '#',
    },
    brackets: [
      ['{', '}'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
  });

  // Register completion provider
  monaco.languages.registerCompletionItemProvider(PROPERTIES_LANGUAGE_ID, new PropertiesCompletionProvider());
}