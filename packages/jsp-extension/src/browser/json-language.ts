/**
 * JSON language registration for Monaco.
 *
 * Registers JSON and JSONC languages with Monarch grammar,
 * completion provider, and validation. Provides:
 *  - Syntax highlighting via Monarch
 *  - JSON validation (parse errors as markers)
 *  - JSON Schema-based completion for common schemas
 *  - Auto-formatting support
 */

import * as monaco from '@theia/monaco-editor-core';
import { JSON_LANGUAGE_ID, JSON_MONARCH, JSONC_LANGUAGE_ID, JSONC_MONARCH } from './json-monarch';

/** Owner string for JSON validation markers. */
const JSON_MARKER_OWNER = 'kairo-json-validate';

/** Maximum file size for JSON validation (1 MB). */
const MAX_JSON_SIZE = 1 * 1024 * 1024;

/**
 * Common JSON Schema completions for well-known JSON file types.
 */
const COMMON_JSON_SCHEMAS: Record<string, monaco.languages.CompletionItem[]> = {
  'package.json': [
    createCompletion('name', 'Property', '项目名称', 'name'),
    createCompletion('version', 'Property', '项目版本号', 'version'),
    createCompletion('description', 'Property', '项目描述', 'description'),
    createCompletion('main', 'Property', '入口文件', 'main'),
    createCompletion('scripts', 'Property', 'NPM 脚本', 'scripts'),
    createCompletion('dependencies', 'Property', '生产依赖', 'dependencies'),
    createCompletion('devDependencies', 'Property', '开发依赖', 'devDependencies'),
    createCompletion('peerDependencies', 'Property', '对等依赖', 'peerDependencies'),
    createCompletion('keywords', 'Property', '关键词列表', 'keywords'),
    createCompletion('author', 'Property', '作者信息', 'author'),
    createCompletion('license', 'Property', '许可证', 'license'),
    createCompletion('repository', 'Property', '代码仓库', 'repository'),
    createCompletion('type', 'Enum', '模块类型', 'type'),
    createCompletion('exports', 'Property', '导出配置', 'exports'),
    createCompletion('engines', 'Property', '引擎要求', 'engines'),
  ],
  'tsconfig.json': [
    createCompletion('compilerOptions', 'Property', '编译选项', 'compilerOptions'),
    createCompletion('include', 'Property', '包含的文件', 'include'),
    createCompletion('exclude', 'Property', '排除的文件', 'exclude'),
    createCompletion('extends', 'Property', '继承的配置', 'extends'),
    createCompletion('references', 'Property', '项目引用', 'references'),
  ],
  '.eslintrc.json': [
    createCompletion('env', 'Property', '运行环境', 'env'),
    createCompletion('extends', 'Property', '继承的配置', 'extends'),
    createCompletion('parser', 'Property', '解析器', 'parser'),
    createCompletion('parserOptions', 'Property', '解析器选项', 'parserOptions'),
    createCompletion('plugins', 'Property', '插件列表', 'plugins'),
    createCompletion('rules', 'Property', '规则配置', 'rules'),
    createCompletion('settings', 'Property', '共享设置', 'settings'),
    createCompletion('overrides', 'Property', '覆盖配置', 'overrides'),
    createCompletion('ignorePatterns', 'Property', '忽略模式', 'ignorePatterns'),
  ],
};

/** JSON-specific keyword completions. */
const JSON_KEYWORD_COMPLETIONS: monaco.languages.CompletionItem[] = [
  createCompletion('true', 'Keyword', '布尔值 true', 'true'),
  createCompletion('false', 'Keyword', '布尔值 false', 'false'),
  createCompletion('null', 'Keyword', '空值 null', 'null'),
];

/** JSON value completions (object, array, string, number). */
const JSON_VALUE_COMPLETIONS: monaco.languages.CompletionItem[] = [
  createSnippetCompletion('{}', 'Snippet', '空对象', '{\n\t$1\n}'),
  createSnippetCompletion('[]', 'Snippet', '空数组', '[\n\t$1\n]'),
  createSnippetCompletion('""', 'Snippet', '字符串', '"$1"'),
];

function createCompletion(
  label: string,
  kind: string,
  detail: string,
  insertText: string,
): monaco.languages.CompletionItem {
  const kindMap: Record<string, monaco.languages.CompletionItemKind> = {
    'Property': monaco.languages.CompletionItemKind.Property,
    'Keyword': monaco.languages.CompletionItemKind.Keyword,
    'Enum': monaco.languages.CompletionItemKind.Enum,
    'Snippet': monaco.languages.CompletionItemKind.Snippet,
    'Value': monaco.languages.CompletionItemKind.Value,
  };
  return {
    label,
    kind: kindMap[kind] ?? monaco.languages.CompletionItemKind.Text,
    detail,
    insertText,
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
  } as monaco.languages.CompletionItem;
}

function createSnippetCompletion(
  label: string,
  kind: string,
  detail: string,
  insertText: string,
): monaco.languages.CompletionItem {
  return {
    label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    detail,
    insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
  } as monaco.languages.CompletionItem;
}

/**
 * Get the filename from a URI path.
 */
function getFileName(uri: string): string {
  const parts = uri.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Check if position is inside a string (for key completion).
 */
function isInsideString(lineBeforeCursor: string): boolean {
  const quoteCount = (lineBeforeCursor.match(/"/g) || []).length;
  return quoteCount % 2 === 1;
}

/**
 * Check if position is after a colon (for value completion).
 */
function isAfterColon(lineBeforeCursor: string): boolean {
  const trimmed = lineBeforeCursor.trimEnd();
  return trimmed.endsWith(':');
}

/**
 * JSON completion provider.
 */
class JsonCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['"', '.'];

  provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.CompletionContext,
    _token: monaco.CancellationToken,
  ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
    const lineContent = model.getLineContent(position.lineNumber);
    const lineBeforeCursor = lineContent.substring(0, position.column - 1);
    const fileName = getFileName(model.uri.path);

    const suggestions: monaco.languages.CompletionItem[] = [];

    if (isAfterColon(lineBeforeCursor)) {
      // Value completion — suggest JSON values
      suggestions.push(...JSON_VALUE_COMPLETIONS);
      suggestions.push(...JSON_KEYWORD_COMPLETIONS);
    } else if (isInsideString(lineBeforeCursor)) {
      // Key completion — suggest schema keys
      const schemaCompletions = COMMON_JSON_SCHEMAS[fileName];
      if (schemaCompletions) {
        suggestions.push(...schemaCompletions);
      }
    } else {
      // General — suggest both
      const schemaCompletions = COMMON_JSON_SCHEMAS[fileName];
      if (schemaCompletions) {
        suggestions.push(...schemaCompletions);
      }
      suggestions.push(...JSON_VALUE_COMPLETIONS);
    }

    return { suggestions };
  }
}

/**
 * Validate JSON content and return markers.
 */
function validateJsonContent(content: string): monaco.editor.IMarkerData[] {
  const markers: monaco.editor.IMarkerData[] = [];

  try {
    JSON.parse(content);
  } catch (e) {
    if (e instanceof SyntaxError) {
      const message = e.message;
      // Try to extract line/column from the error message
      const posMatch = message.match(/at position (\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1], 10);
        const lines = content.substring(0, pos).split('\n');
        const line = lines.length;
        const column = lines[lines.length - 1].length + 1;
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: `JSON 解析错误: ${message}`,
          source: 'JSON 验证',
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column + 1,
        });
      } else {
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: `JSON 解析错误: ${message}`,
          source: 'JSON 验证',
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        });
      }
    }
  }

  return markers;
}

/**
 * Register JSON language with Monaco.
 */
export function registerJsonLanguage(): void {
  if (!monaco.languages.getLanguages().some(l => l.id === JSON_LANGUAGE_ID)) {
    monaco.languages.register({
      id: JSON_LANGUAGE_ID,
      extensions: ['.json', '.jsonc', '.har', '.jsonl', '.geojson'],
      aliases: ['JSON', 'json'],
      mimetypes: ['application/json'],
    });
  }
  monaco.languages.setMonarchTokensProvider(JSON_LANGUAGE_ID, JSON_MONARCH as monaco.languages.IMonarchLanguage);

  // Register JSONC as a separate language
  if (!monaco.languages.getLanguages().some(l => l.id === JSONC_LANGUAGE_ID)) {
    monaco.languages.register({
      id: JSONC_LANGUAGE_ID,
      extensions: ['.jsonc'],
      aliases: ['JSONC', 'jsonc'],
    });
  }
  monaco.languages.setMonarchTokensProvider(JSONC_LANGUAGE_ID, JSONC_MONARCH as monaco.languages.IMonarchLanguage);

  // Language configuration
  const config: monaco.languages.LanguageConfiguration = {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
    folding: {
      offSide: true,
    },
  };
  monaco.languages.setLanguageConfiguration(JSON_LANGUAGE_ID, config);
  monaco.languages.setLanguageConfiguration(JSONC_LANGUAGE_ID, config);

  // Register completion provider
  monaco.languages.registerCompletionItemProvider(JSON_LANGUAGE_ID, new JsonCompletionProvider());
  monaco.languages.registerCompletionItemProvider(JSONC_LANGUAGE_ID, new JsonCompletionProvider());

  // Register JSON validation
  monaco.editor.onDidCreateModel(model => {
    if (model.getLanguageId() === JSON_LANGUAGE_ID || model.getLanguageId() === JSONC_LANGUAGE_ID) {
      validateJsonModel(model);
    }
  });

  // Validate already-open JSON models
  const models = monaco.editor.getModels();
  for (const model of models) {
    if (model.getLanguageId() === JSON_LANGUAGE_ID || model.getLanguageId() === JSONC_LANGUAGE_ID) {
      validateJsonModel(model);
    }
  }
}

/**
 * Validate a JSON Monaco model and set markers.
 */
function validateJsonModel(model: monaco.editor.ITextModel): void {
  const content = model.getValue();
  const size = new Blob([content]).size;

  if (size > MAX_JSON_SIZE) {
    monaco.editor.setModelMarkers(model, JSON_MARKER_OWNER, [{
      severity: monaco.MarkerSeverity.Warning,
      message: `文件过大 (${(size / 1024 / 1024).toFixed(1)} MB)，跳过 JSON 验证 (>1MB)`,
      source: 'JSON 验证',
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    }]);
    return;
  }

  const markers = validateJsonContent(content);
  monaco.editor.setModelMarkers(model, JSON_MARKER_OWNER, markers);
}