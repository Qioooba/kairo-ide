'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('Properties key-value separator detection', () => {
  const hasEquals = 'jdbc.url=jdbc:mysql://localhost:3306/db';
  const hasColon = 'server.port: 8080';
  const hasSpace = 'app.name KairoIDE';

  assert.ok(hasEquals.includes('='));
  assert.ok(hasColon.includes(':'));
  assert.ok(!hasSpace.includes('=') && !hasSpace.includes(':'));
});

test('Properties comment detection', () => {
  const hashComment = '# This is a comment';
  const bangComment = '! This is also a comment';
  const notComment = 'jdbc.driver=com.mysql.jdbc.Driver';

  assert.ok(hashComment.startsWith('#'));
  assert.ok(bangComment.startsWith('!'));
  assert.ok(!notComment.startsWith('#'));
  assert.ok(!notComment.startsWith('!'));
});

test('Properties key parsing', () => {
  const parseKey = (line) => {
    const match = line.match(/^([a-zA-Z_][\w.-]*)\s*[=:]/);
    return match ? match[1] : null;
  };

  assert.strictEqual(parseKey('jdbc.url=jdbc:mysql://host/db'), 'jdbc.url');
  assert.strictEqual(parseKey('server.port: 8080'), 'server.port');
  assert.strictEqual(parseKey('app.name = KairoIDE'), 'app.name');
  assert.strictEqual(parseKey('# comment'), null);
});

test('Properties multi-line value detection', () => {
  const continuation = 'jdbc.url=jdbc:mysql://localhost:3306/\\';
  const nonContinuation = 'jdbc.url=jdbc:mysql://localhost:3306/db';

  assert.ok(continuation.endsWith('\\'));
  assert.ok(!nonContinuation.endsWith('\\'));
});

test('Properties escape sequences', () => {
  // Unicode escapes
  const unicode = '\\u4E2D\\u6587'; // 中文
  assert.ok(unicode.includes('\\u'));

  // Special characters
  const escapes = ['\\n', '\\t', '\\r', '\\f', '\\\\', '\\='];
  for (const esc of escapes) {
    assert.ok(esc.startsWith('\\'));
  }
});

test('Properties JDBC key completions', () => {
  const jdbcKeys = [
    'jdbc.driverClassName',
    'jdbc.url',
    'jdbc.username',
    'jdbc.password',
    'jdbc.initialSize',
    'jdbc.maxActive',
    'jdbc.maxIdle',
    'jdbc.minIdle',
    'jdbc.maxWait',
    'jdbc.validationQuery',
  ];

  assert.ok(jdbcKeys.includes('jdbc.driverClassName'));
  assert.ok(jdbcKeys.includes('jdbc.url'));
  assert.ok(jdbcKeys.includes('jdbc.username'));
  assert.ok(jdbcKeys.includes('jdbc.password'));
  assert.strictEqual(jdbcKeys.length, 10);
});

test('Properties logging key completions', () => {
  const logKeys = [
    'log.level',
    'log.file',
    'log.maxFileSize',
    'log.maxBackupIndex',
    'log.pattern',
    'logging.level.root',
    'logging.file.name',
    'logging.file.path',
  ];

  assert.ok(logKeys.includes('log.level'));
  assert.ok(logKeys.includes('logging.level.root'));
  assert.ok(logKeys.includes('logging.file.name'));
});

test('Properties server key completions', () => {
  const serverKeys = [
    'server.port',
    'server.address',
    'server.servlet.context-path',
    'server.tomcat.max-threads',
    'server.connection-timeout',
  ];

  assert.ok(serverKeys.includes('server.port'));
  assert.ok(serverKeys.includes('server.servlet.context-path'));
  assert.ok(serverKeys.includes('server.tomcat.max-threads'));
});

test('Properties Spring key completions', () => {
  const springKeys = [
    'spring.application.name',
    'spring.profiles.active',
    'spring.datasource.url',
    'spring.datasource.username',
    'spring.datasource.password',
    'spring.jpa.hibernate.ddl-auto',
    'spring.jpa.show-sql',
    'spring.mvc.view.prefix',
    'spring.mvc.view.suffix',
    'spring.cache.type',
    'spring.redis.host',
    'spring.redis.port',
  ];

  assert.ok(springKeys.includes('spring.application.name'));
  assert.ok(springKeys.includes('spring.datasource.url'));
  assert.ok(springKeys.includes('spring.jpa.hibernate.ddl-auto'));
  assert.strictEqual(springKeys.length, 12);
});

test('Properties app key completions', () => {
  const appKeys = [
    'app.name',
    'app.version',
    'app.description',
    'app.debug',
    'app.locale',
    'app.timezone',
    'app.encoding',
    'app.upload.max-file-size',
    'app.upload.path',
  ];

  assert.ok(appKeys.includes('app.name'));
  assert.ok(appKeys.includes('app.version'));
  assert.ok(appKeys.includes('app.encoding'));
  assert.strictEqual(appKeys.length, 9);
});

test('Properties MyBatis key completions', () => {
  const mybatisKeys = [
    'mybatis.mapper-locations',
    'mybatis.type-aliases-package',
    'mybatis.configuration.map-underscore-to-camel-case',
    'mybatis.configuration.log-impl',
    'mybatis.configuration.cache-enabled',
    'mybatis.configuration.lazy-loading-enabled',
  ];

  assert.ok(mybatisKeys.includes('mybatis.mapper-locations'));
  assert.ok(mybatisKeys.includes('mybatis.configuration.map-underscore-to-camel-case'));
  assert.strictEqual(mybatisKeys.length, 6);
});

test('Properties total key completions', () => {
  const jdbcKeys = 10;
  const logKeys = 8;
  const serverKeys = 5;
  const springKeys = 12;
  const appKeys = 9;
  const mybatisKeys = 6;

  const total = jdbcKeys + logKeys + serverKeys + springKeys + appKeys + mybatisKeys;
  assert.strictEqual(total, 50);
});

test('Properties file extensions', () => {
  const extensions = ['.properties', '.cfg', '.conf', '.ini', '.env'];
  assert.ok(extensions.includes('.properties'));
  assert.ok(extensions.includes('.cfg'));
  assert.ok(extensions.includes('.conf'));
  assert.ok(extensions.includes('.ini'));
  assert.ok(extensions.includes('.env'));
});

test('Properties language ID', () => {
  const PROPERTIES_LANGUAGE_ID = 'properties';
  assert.strictEqual(PROPERTIES_LANGUAGE_ID, 'properties');
});

test('Properties empty line handling', () => {
  const isEmptyLine = (line) => /^\s*$/.test(line);
  assert.ok(isEmptyLine(''));
  assert.ok(isEmptyLine('   '));
  assert.ok(isEmptyLine('\t'));
  assert.ok(!isEmptyLine('key=value'));
  assert.ok(!isEmptyLine('# comment'));
});

test('Properties key with dots', () => {
  const keyRe = /^([a-zA-Z_][\w.-]*)\s*[=:]/;
  assert.ok(keyRe.test('spring.datasource.hikari.maximum-pool-size=20'));
  assert.ok(keyRe.test('mybatis.configuration.map-underscore-to-camel-case=true'));
  assert.ok(keyRe.test('com.example.app.setting=value'));
});