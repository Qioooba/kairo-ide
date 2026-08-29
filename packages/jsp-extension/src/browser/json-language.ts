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
import type { I18nService } from '@kairo/i18n';
import { JSON_LANGUAGE_ID, JSON_MONARCH, JSONC_LANGUAGE_ID, JSONC_MONARCH } from './json-monarch';
import { setJspI18n, t } from './i18n-context';

/** Owner string for JSON validation markers. */
const JSON_MARKER_OWNER = 'kairo-json-validate';

/** Maximum file size for JSON validation (1 MB). */
const MAX_JSON_SIZE = 1 * 1024 * 1024;

/**
 * Common JSON Schema completions for well-known JSON file types.
 * Built per provide call so detail strings follow the current language.
 */
function buildCommonJsonSchemas(): Record<string, monaco.languages.CompletionItem[]> {
  return {
    'package.json': [
      createCompletion('name', 'Property', t('completion.json.property.name'), 'name'),
      createCompletion('version', 'Property', t('completion.json.property.version'), 'version'),
      createCompletion('description', 'Property', t('completion.json.property.description'), 'description'),
      createCompletion('main', 'Property', t('completion.json.property.main'), 'main'),
      createCompletion('scripts', 'Property', t('completion.json.property.scripts'), 'scripts'),
      createCompletion('dependencies', 'Property', t('completion.json.property.dependencies'), 'dependencies'),
      createCompletion('devDependencies', 'Property', t('completion.json.property.devDependencies'), 'devDependencies'),
      createCompletion('peerDependencies', 'Property', t('completion.json.property.peerDependencies'), 'peerDependencies'),
      createCompletion('keywords', 'Property', t('completion.json.property.keywords'), 'keywords'),
      createCompletion('author', 'Property', t('completion.json.property.author'), 'author'),
      createCompletion('license', 'Property', t('completion.json.property.license'), 'license'),
      createCompletion('repository', 'Property', t('completion.json.property.repository'), 'repository'),
      createCompletion('type', 'Enum', t('completion.json.property.type'), 'type'),
      createCompletion('exports', 'Property', t('completion.json.property.exports'), 'exports'),
      createCompletion('engines', 'Property', t('completion.json.property.engines'), 'engines'),
    ],
    'tsconfig.json': [
      createCompletion('compilerOptions', 'Property', t('completion.json.property.compilerOptions'), 'compilerOptions'),
      createCompletion('include', 'Property', t('completion.json.property.include'), 'include'),
      createCompletion('exclude', 'Property', t('completion.json.property.exclude'), 'exclude'),
      createCompletion('extends', 'Property', t('completion.json.property.extends'), 'extends'),
      createCompletion('references', 'Property', t('completion.json.property.references'), 'references'),
    ],
    '.eslintrc.json': [
      createCompletion('env', 'Property', t('completion.json.property.env'), 'env'),
      createCompletion('extends', 'Property', t('completion.json.property.extends'), 'extends'),
      createCompletion('parser', 'Property', t('completion.json.property.parser'), 'parser'),
      createCompletion('parserOptions', 'Property', t('completion.json.property.parserOptions'), 'parserOptions'),
      createCompletion('plugins', 'Property', t('completion.json.property.plugins'), 'plugins'),
      createCompletion('rules', 'Property', t('completion.json.property.rules'), 'rules'),
      createCompletion('settings', 'Property', t('completion.json.property.settings'), 'settings'),
      createCompletion('overrides', 'Property', t('completion.json.property.overrides'), 'overrides'),
      createCompletion('ignorePatterns', 'Property', t('completion.json.property.ignorePatterns'), 'ignorePatterns'),
    ],
  };
}

/** JSON-specific keyword completions. */
function buildJsonKeywordCompletions(): monaco.languages.CompletionItem[] {
  return [
    createCompletion('true', 'Keyword', t('completion.json.keyword.true'), 'true'),
    createCompletion('false', 'Keyword', t('completion.json.keyword.false'), 'false'),
    createCompletion('null', 'Keyword', t('completion.json.keyword.null'), 'null'),
  ];
}

/** JSON value completions (object, array, string, number). */
function buildJsonValueCompletions(): monaco.languages.CompletionItem[] {
  return [
    createSnippetCompletion('{}', 'Snippet', t('completion.json.snippet.emptyObject'), '{\n\t$1\n}'),
    createSnippetCompletion('[]', 'Snippet', t('completion.json.snippet.emptyArray'), '[\n\t$1\n]'),
    createSnippetCompletion('""', 'Snippet', t('completion.json.snippet.string'), '"$1"'),
  ];
}

function createCompletion(
  label: string,
  kind: string,
  detail: string,
  insertText: string,
  range?: monaco.IRange,
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
    ...(range ? { range } : {}),
  } as monaco.languages.CompletionItem;
}

function createSnippetCompletion(
  label: string,
  kind: string,
  detail: string,
  insertText: string,
  range?: monaco.IRange,
): monaco.languages.CompletionItem {
  return {
    label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    detail,
    insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    ...(range ? { range } : {}),
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
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const withRange = (items: monaco.languages.CompletionItem[]) => items.map(it => ({ ...it, range } as monaco.languages.CompletionItem));

    const suggestions: monaco.languages.CompletionItem[] = [];

    if (isAfterColon(lineBeforeCursor)) {
      // Value completion — suggest JSON values
      suggestions.push(...withRange(buildJsonValueCompletions()));
      suggestions.push(...withRange(buildJsonKeywordCompletions()));
    } else if (isInsideString(lineBeforeCursor)) {
      // Key completion — suggest schema keys
      const schemaCompletions = buildCommonJsonSchemas()[fileName];
      if (schemaCompletions) {
        suggestions.push(...withRange(schemaCompletions));
      }
    } else {
      // General — suggest both
      const schemaCompletions = buildCommonJsonSchemas()[fileName];
      if (schemaCompletions) {
        suggestions.push(...withRange(schemaCompletions));
      }
      suggestions.push(...withRange(buildJsonValueCompletions()));
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
            message: t('validator.json.parseError', { message }),
            source: t('validator.json.source'),
            startLineNumber: line,
            startColumn: column,
            endLineNumber: line,
            endColumn: column + 1,
          });
        } else {
          markers.push({
            severity: monaco.MarkerSeverity.Error,
            message: t('validator.json.parseError', { message }),
            source: t('validator.json.source'),
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
export function registerJsonLanguage(i18n?: I18nService): void {
  setJspI18n(i18n);
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
      message: t('validator.json.tooLarge', { size: (size / 1024 / 1024).toFixed(1) }),
      source: t('validator.json.source'),
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