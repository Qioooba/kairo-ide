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
import type { I18nService } from '@kairo/i18n';
import { PROPERTIES_LANGUAGE_ID, PROPERTIES_MONARCH } from './properties-monarch';
import { setJspI18n, t } from './i18n-context';

/**
 * Common Java properties keys for completion suggestions.
 * Organized by category. Built per provide call so detail strings
 * follow the current language.
 */
function buildPropertiesKeyCompletions(): Record<string, Array<Omit<monaco.languages.CompletionItem, 'range'> & { range?: monaco.IRange }>> {
  return {
  /** JDBC / Database connection properties. */
  datasource: [
    createCompletion('jdbc.driverClassName', 'Property', t('completion.properties.driverClassName'), 'jdbc.driverClassName'),
    createCompletion('jdbc.url', 'Property', t('completion.properties.url'), 'jdbc.url'),
    createCompletion('jdbc.username', 'Property', t('completion.properties.username'), 'jdbc.username'),
    createCompletion('jdbc.password', 'Property', t('completion.properties.password'), 'jdbc.password'),
    createCompletion('jdbc.initialSize', 'Property', t('completion.properties.initialSize'), 'jdbc.initialSize'),
    createCompletion('jdbc.maxActive', 'Property', t('completion.properties.maxActive'), 'jdbc.maxActive'),
    createCompletion('jdbc.maxIdle', 'Property', t('completion.properties.maxIdle'), 'jdbc.maxIdle'),
    createCompletion('jdbc.minIdle', 'Property', t('completion.properties.minIdle'), 'jdbc.minIdle'),
    createCompletion('jdbc.maxWait', 'Property', t('completion.properties.maxWait'), 'jdbc.maxWait'),
    createCompletion('jdbc.validationQuery', 'Property', t('completion.properties.validationQuery'), 'jdbc.validationQuery'),
    createCompletion('jdbc.testOnBorrow', 'Property', t('completion.properties.testOnBorrow'), 'jdbc.testOnBorrow'),
    createCompletion('jdbc.testWhileIdle', 'Property', t('completion.properties.testWhileIdle'), 'jdbc.testWhileIdle'),
  ],

  /** Logging properties. */
  logging: [
    createCompletion('log.level', 'Property', t('completion.properties.level'), 'log.level'),
    createCompletion('log.file', 'Property', t('completion.properties.file'), 'log.file'),
    createCompletion('log.maxFileSize', 'Property', t('completion.properties.maxFileSize'), 'log.maxFileSize'),
    createCompletion('log.maxBackupIndex', 'Property', t('completion.properties.maxBackupIndex'), 'log.maxBackupIndex'),
    createCompletion('log.pattern', 'Property', t('completion.properties.pattern'), 'log.pattern'),
    createCompletion('logging.level.root', 'Property', t('completion.properties.root'), 'logging.level.root'),
    createCompletion('logging.level.org.springframework', 'Property', t('completion.properties.orgSpringframework'), 'logging.level.org.springframework'),
    createCompletion('logging.file.name', 'Property', t('completion.properties.fileName'), 'logging.file.name'),
    createCompletion('logging.file.path', 'Property', t('completion.properties.filePath'), 'logging.file.path'),
  ],

  /** Server / Tomcat properties. */
  server: [
    createCompletion('server.port', 'Property', t('completion.properties.port'), 'server.port'),
    createCompletion('server.address', 'Property', t('completion.properties.address'), 'server.address'),
    createCompletion('server.servlet.context-path', 'Property', t('completion.properties.contextPath'), 'server.servlet.context-path'),
    createCompletion('server.servlet.session.timeout', 'Property', t('completion.properties.timeout'), 'server.servlet.session.timeout'),
    createCompletion('server.tomcat.max-threads', 'Property', t('completion.properties.maxThreads'), 'server.tomcat.max-threads'),
    createCompletion('server.tomcat.uri-encoding', 'Property', t('completion.properties.uriEncoding'), 'server.tomcat.uri-encoding'),
    createCompletion('server.connection-timeout', 'Property', t('completion.properties.connectionTimeout'), 'server.connection-timeout'),
    createCompletion('server.max-http-header-size', 'Property', t('completion.properties.maxHttpHeaderSize'), 'server.max-http-header-size'),
  ],

  /** Spring framework properties. */
  spring: [
    createCompletion('spring.application.name', 'Property', t('completion.properties.name'), 'spring.application.name'),
    createCompletion('spring.profiles.active', 'Property', t('completion.properties.profilesActive'), 'spring.profiles.active'),
    createCompletion('spring.datasource.url', 'Property', t('completion.properties.datasourceUrl'), 'spring.datasource.url'),
    createCompletion('spring.datasource.username', 'Property', t('completion.properties.datasourceUsername'), 'spring.datasource.username'),
    createCompletion('spring.datasource.password', 'Property', t('completion.properties.datasourcePassword'), 'spring.datasource.password'),
    createCompletion('spring.datasource.driver-class-name', 'Property', t('completion.properties.datasourceDriverClassName'), 'spring.datasource.driver-class-name'),
    createCompletion('spring.jpa.hibernate.ddl-auto', 'Property', t('completion.properties.ddlAuto'), 'spring.jpa.hibernate.ddl-auto'),
    createCompletion('spring.jpa.show-sql', 'Property', t('completion.properties.showSql'), 'spring.jpa.show-sql'),
    createCompletion('spring.mvc.view.prefix', 'Property', t('completion.properties.prefix'), 'spring.mvc.view.prefix'),
    createCompletion('spring.mvc.view.suffix', 'Property', t('completion.properties.suffix'), 'spring.mvc.view.suffix'),
    createCompletion('spring.cache.type', 'Property', t('completion.properties.type'), 'spring.cache.type'),
    createCompletion('spring.redis.host', 'Property', t('completion.properties.host'), 'spring.redis.host'),
    createCompletion('spring.redis.port', 'Property', t('completion.properties.redisPort'), 'spring.redis.port'),
  ],

  /** Application general properties. */
  app: [
    createCompletion('app.name', 'Property', t('completion.properties.name'), 'app.name'),
    createCompletion('app.version', 'Property', t('completion.properties.version'), 'app.version'),
    createCompletion('app.description', 'Property', t('completion.properties.description'), 'app.description'),
    createCompletion('app.debug', 'Property', t('completion.properties.debug'), 'app.debug'),
    createCompletion('app.locale', 'Property', t('completion.properties.locale'), 'app.locale'),
    createCompletion('app.timezone', 'Property', t('completion.properties.timezone'), 'app.timezone'),
    createCompletion('app.encoding', 'Property', t('completion.properties.encoding'), 'app.encoding'),
    createCompletion('app.upload.max-file-size', 'Property', t('completion.properties.uploadMaxFileSize'), 'app.upload.max-file-size'),
    createCompletion('app.upload.path', 'Property', t('completion.properties.uploadPath'), 'app.upload.path'),
  ],

  /** MyBatis properties. */
  mybatis: [
    createCompletion('mybatis.mapper-locations', 'Property', t('completion.properties.mapperLocations'), 'mybatis.mapper-locations'),
    createCompletion('mybatis.type-aliases-package', 'Property', t('completion.properties.typeAliasesPackage'), 'mybatis.type-aliases-package'),
    createCompletion('mybatis.configuration.map-underscore-to-camel-case', 'Property', t('completion.properties.mapUnderscoreToCamelCase'), 'mybatis.configuration.map-underscore-to-camel-case'),
    createCompletion('mybatis.configuration.log-impl', 'Property', t('completion.properties.logImpl'), 'mybatis.configuration.log-impl'),
    createCompletion('mybatis.configuration.cache-enabled', 'Property', t('completion.properties.cacheEnabled'), 'mybatis.configuration.cache-enabled'),
    createCompletion('mybatis.configuration.lazy-loading-enabled', 'Property', t('completion.properties.lazyLoadingEnabled'), 'mybatis.configuration.lazy-loading-enabled'),
  ],
  };
}

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
    for (const category of Object.values(buildPropertiesKeyCompletions())) {
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
export function registerPropertiesLanguage(i18n?: I18nService): void {
  setJspI18n(i18n);
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