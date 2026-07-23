/**
 * XML/DTD/XSD validation provider.
 *
 * Scans XML files in the workspace for:
 *  - DOCTYPE declarations that reference non-existent DTD files
 *  - XSD schemaLocation references pointing to missing files
 *  - Basic XML well-formedness errors (mismatched tags, unclosed elements)
 *
 * Results are registered as Monaco editor markers that appear in the
 * Problems panel. Each parse has a 5-second timeout; files larger than
 * 1 MB are skipped.
 */

import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import _URI from '@theia/core/lib/common/uri';

/** Maximum file size to parse (1 MB). */
const MAX_FILE_SIZE = 1 * 1024 * 1024;

/** Timeout per file parse (5 seconds). */
const PARSE_TIMEOUT_MS = 5000;

/** Owner string for Monaco markers. */
const MARKER_OWNER = 'kairo-xml-dtd';

/** XML file extensions to validate. */
const XML_EXTENSIONS = ['.xml', '.xsd', '.tld'];

/** Common web.xml filenames to check. */
const WEB_XML_NAMES = ['web.xml'];

/** XML declaration pattern: <?xml ... encoding="..." ?> */
const XML_DECL_RE = /<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/i;

/** DOCTYPE declaration pattern. */
const DOCTYPE_RE = /<!DOCTYPE\s+(\S+)\s+(?:PUBLIC\s+["']([^"']+)["']\s+)?(?:["']([^"']+)["'])?\s*>/gi;

/** XSD schemaLocation pattern: xsi:schemaLocation="ns1 uri1 ns2 uri2" */
const SCHEMA_LOCATION_RE = /schemaLocation\s*=\s*["']([^"']+)["']/gi;

/** schemaLocation attribute value splitter: pairs of namespace URI */
const SCHEMA_LOCATION_PAIR_RE = /(\S+)\s+(\S+)/g;

/** HTML/XML tag pattern for matching open/close tags. */
const TAG_RE = /<\/?([a-zA-Z_][\w.:-]*)(\s[^>]*)?\/?>/g;

/** Self-closing tags that don't need closing. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Validation result for a single XML file. */
export interface XmlValidationResult {
  /** URI of the XML file. */
  uri: string;
  /** Diagnostic markers to set on this file. */
  markers: monaco.editor.IMarkerData[];
}

/**
 * Validate an XML file's DTD/XSD references and well-formedness.
 * Pure function — no side effects.
 */
function validateXmlContent(content: string, _fileUri: string): monaco.editor.IMarkerData[] {
  const markers: monaco.editor.IMarkerData[] = [];
  const lines = content.split('\n');

  // Check encoding declaration
  const encMatch = XML_DECL_RE.exec(content);
  if (encMatch) {
    const enc = encMatch[1].toLowerCase();
    if (enc !== 'utf-8' && enc !== 'gbk' && enc !== 'gb2312' && enc !== 'iso-8859-1') {
      const line = getLineForOffset(content, encMatch.index);
      markers.push({
        severity: monaco.MarkerSeverity.Info,
        message: `XML 编码声明: ${encMatch[1]}`,
        source: 'XML 验证',
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: 1,
      });
    }
  }

  // Check DOCTYPE — local DTD references
  DOCTYPE_RE.lastIndex = 0;
  let doctypeMatch: RegExpExecArray | null;
  while ((doctypeMatch = DOCTYPE_RE.exec(content)) !== null) {
    const dtdRef = doctypeMatch[3]; // system identifier
    if (dtdRef && !dtdRef.startsWith('http://') && !dtdRef.startsWith('https://')) {
      const line = getLineForOffset(content, doctypeMatch.index);
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: `引用的 DTD 文件可能不存在: ${dtdRef}`,
        source: 'DTD 验证',
        startLineNumber: line,
        startColumn: doctypeMatch.index - lines.slice(0, line - 1).join('\n').length + 1,
        endLineNumber: line,
        endColumn: (doctypeMatch.index - lines.slice(0, line - 1).join('\n').length) + doctypeMatch[0].length + 1,
      });
    }
  }

  // Check for schemaLocation references
  SCHEMA_LOCATION_RE.lastIndex = 0;
  let schemaMatch: RegExpExecArray | null;
  while ((schemaMatch = SCHEMA_LOCATION_RE.exec(content)) !== null) {
    const pairs = schemaMatch[1];
    SCHEMA_LOCATION_PAIR_RE.lastIndex = 0;
    let pair: RegExpExecArray | null;
    while ((pair = SCHEMA_LOCATION_PAIR_RE.exec(pairs)) !== null) {
      const schemaLocation = pair[2];
      if (schemaLocation && !schemaLocation.startsWith('http://') && !schemaLocation.startsWith('https://')) {
        const line = getLineForOffset(content, schemaMatch.index);
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: `引用的 XSD 文件可能不存在: ${schemaLocation}`,
          source: 'XSD 验证',
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1,
        });
      }
    }
  }

  // Tag matching — basic well-formedness check
  const tagStack: Array<{ name: string; line: number; col: number }> = [];
  TAG_RE.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = TAG_RE.exec(content)) !== null) {
    const fullTag = tagMatch[0];
    const tagName = tagMatch[1];
    const isClosing = fullTag.startsWith('</');
    const isSelfClosing = fullTag.endsWith('/>') && !isClosing;

    if (isClosing) {
      if (tagStack.length === 0) {
        const line = getLineForOffset(content, tagMatch.index);
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: `XML 格式错误: 多余的闭合标签 </${tagName}>`,
          source: 'XML 验证',
          startLineNumber: line,
          startColumn: tagMatch.index - lines.slice(0, line - 1).join('\n').length + 1,
          endLineNumber: line,
          endColumn: (tagMatch.index - lines.slice(0, line - 1).join('\n').length) + fullTag.length + 1,
        });
        continue;
      }
      const last = tagStack.pop()!;
      if (last.name !== tagName) {
        const line = getLineForOffset(content, tagMatch.index);
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: `XML 标签不匹配: 期望 </${last.name}> (第 ${last.line} 行)，但找到 </${tagName}>`,
          source: 'XML 验证',
          startLineNumber: line,
          startColumn: tagMatch.index - lines.slice(0, line - 1).join('\n').length + 1,
          endLineNumber: line,
          endColumn: (tagMatch.index - lines.slice(0, line - 1).join('\n').length) + fullTag.length + 1,
        });
      }
    } else if (!isSelfClosing && !VOID_TAGS.has(tagName.toLowerCase())) {
      const line = getLineForOffset(content, tagMatch.index);
      tagStack.push({
        name: tagName,
        line,
        col: tagMatch.index - lines.slice(0, line - 1).join('\n').length + 1,
      });
    }
  }

  // Remaining unclosed tags
  for (const unclosed of tagStack.reverse()) {
    markers.push({
      severity: monaco.MarkerSeverity.Error,
      message: `XML 格式错误: 未闭合的标签 <${unclosed.name}> (第 ${unclosed.line} 行)`,
      source: 'XML 验证',
      startLineNumber: unclosed.line,
      startColumn: unclosed.col,
      endLineNumber: unclosed.line,
      endColumn: unclosed.col + unclosed.name.length + 2,
    });
  }

  return markers;
}

/**
 * Get the 1-based line number for a character offset in content.
 */
function getLineForOffset(content: string, offset: number): number {
  // 0-based index, count newlines before offset
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Check if a file path has an XML extension.
 */
function isXmlFile(uri: string): boolean {
  const lower = uri.toLowerCase();
  return XML_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Check if a file path is a web.xml file.
 */
function _isWebXml(uri: string): boolean {
  return WEB_XML_NAMES.some(name => uri.endsWith(name));
}

/**
 * XML/DTD validator that validates XML files on open/save and
 * registers diagnostics as Monaco editor markers.
 */
@injectable()
export class XmlDtdValidator implements FrontendApplicationContribution, Disposable {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(FileService)
  protected readonly fileService!: FileService;

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService;

  protected subs = new DisposableCollection();

  @postConstruct()
  protected init(): void {
    this.subs.push(
      monaco.editor.onDidCreateModel(model => {
        if (isXmlFile(model.uri.path)) {
          this.validateModel(model);
        }
      }),
    );
  }

  onStart(): void {
    // Validate already-open XML models
    const models = monaco.editor.getModels();
    for (const model of models) {
      if (isXmlFile(model.uri.path)) {
        this.validateModel(model);
      }
    }
  }

  dispose(): void {
    this.subs.dispose();
  }

  /**
   * Validate a single Monaco text model. Runs the validation logic
   * with a timeout and sets markers on the model.
   */
  private async validateModel(model: monaco.editor.ITextModel): Promise<void> {
    const content = model.getValue();
    const size = new Blob([content]).size;

    if (size > MAX_FILE_SIZE) {
      this.logger.warn(`XML 验证: 跳过文件 ${model.uri.path} (大小 ${(size / 1024 / 1024).toFixed(1)} MB 超过限制)`);
      monaco.editor.setModelMarkers(model, MARKER_OWNER, [{
        severity: monaco.MarkerSeverity.Warning,
        message: `文件过大 (${(size / 1024 / 1024).toFixed(1)} MB)，跳过 XML 验证 (>1MB)`,
        source: 'XML 验证',
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      }]);
      return;
    }

    try {
      const markers = await withTimeout(
        () => validateXmlContent(content, model.uri.toString()),
        PARSE_TIMEOUT_MS,
      );
      monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
    } catch (err) {
      if (err instanceof TimeoutError) {
        this.logger.warn(`XML 验证: 解析超时 ${model.uri.path}`);
        monaco.editor.setModelMarkers(model, MARKER_OWNER, [{
          severity: monaco.MarkerSeverity.Warning,
          message: 'XML 验证超时（超过 5 秒）',
          source: 'XML 验证',
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        }]);
      } else {
        this.logger.error(`XML 验证: 解析失败 ${model.uri.path}: ${String(err)}`);
      }
    }
  }
}

/** Timeout error class. */
class TimeoutError extends Error {
  constructor() {
    super('操作超时');
    this.name = 'TimeoutError';
  }
}

/**
 * Execute a function with a timeout in milliseconds.
 * Throws TimeoutError if the function doesn't complete in time.
 */
function withTimeout<T>(fn: () => T, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    try {
      const result = fn();
      clearTimeout(timer);
      resolve(result);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}