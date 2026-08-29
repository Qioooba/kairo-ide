/**
 * XML/DTD/XSD validation provider.
 *
 * Scans XML files in the workspace for:
 *  - DOCTYPE / schemaLocation references that resolve to missing local files
 *  - Basic XML well-formedness errors (mismatched tags, unclosed elements)
 *
 * Results are registered as Monaco editor markers that appear in the
 * Problems panel. Each parse has a 5-second timeout; files larger than
 * 1 MB are skipped.
 */

import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject, postConstruct, optional } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { KairoI18nService } from '@kairo/i18n';
import { setJspI18n, t } from './i18n-context';

/** Maximum file size to parse (1 MB). */
const MAX_FILE_SIZE = 1 * 1024 * 1024;

/** Timeout per file parse (5 seconds). */
const PARSE_TIMEOUT_MS = 5000;

/** Debounce for revalidation on edit. */
const VALIDATE_DEBOUNCE_MS = 300;

/** Owner string for Monaco markers. */
const MARKER_OWNER = 'kairo-xml-dtd';

/** XML file extensions to validate. */
const XML_EXTENSIONS = ['.xml', '.xsd', '.tld'];

/** XML declaration pattern: <?xml ... encoding="..." ?> */
const XML_DECL_RE = /<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/i;

/** DOCTYPE declaration pattern (PUBLIC or SYSTEM). */
const DOCTYPE_RE =
  /<!DOCTYPE\s+(\S+)(?:\s+PUBLIC\s+["']([^"']+)["']\s+["']([^"']+)["']|\s+SYSTEM\s+["']([^"']+)["']|\s+["']([^"']+)["'])?\s*>/gi;

/** XSD schemaLocation pattern: xsi:schemaLocation="ns1 uri1 ns2 uri2" */
const SCHEMA_LOCATION_RE = /schemaLocation\s*=\s*["']([^"']+)["']/gi;

/** schemaLocation attribute value splitter: pairs of namespace URI */
const SCHEMA_LOCATION_PAIR_RE = /(\S+)\s+(\S+)/g;

/** XML tag pattern for matching open/close tags. */
const TAG_RE = /<\/?([a-zA-Z_][\w.:-]*)(\s[^>]*)?\/?>/g;

/** A local DTD/XSD reference collected during parse. */
export interface LocalXmlRef {
  ref: string;
  index: number;
  length: number;
  kind: 'dtd' | 'xsd';
}

/** Validation result for a single XML file. */
export interface XmlValidationResult {
  /** URI of the XML file. */
  uri: string;
  /** Diagnostic markers to set on this file. */
  markers: monaco.editor.IMarkerData[];
}

/**
 * Replace XML comments and CDATA bodies with spaces (same length) so
 * tag matching ignores markup inside them while offsets stay stable.
 * Exported for unit tests (JV-P1-15).
 */
export function maskXmlCommentsAndCdata(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length))
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, m => ' '.repeat(m.length));
}

/**
 * Build an array of 0-based offsets where each line starts.
 * Exported for unit tests (JV-P1-15).
 */
export function buildLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Convert a character offset to 1-based line/column using a line-start index.
 * Exported for unit tests (JV-P1-15).
 */
export function offsetToLineCol(
  lineStarts: number[],
  offset: number,
): { line: number; col: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const lineIdx = Math.max(0, hi);
  return {
    line: lineIdx + 1,
    col: offset - lineStarts[lineIdx] + 1,
  };
}

/**
 * Collect local (non-http) DTD / schemaLocation references.
 * Exported for unit tests (JV-P1-15).
 */
export function collectLocalXmlRefs(content: string): LocalXmlRef[] {
  const refs: LocalXmlRef[] = [];

  DOCTYPE_RE.lastIndex = 0;
  let doctypeMatch: RegExpExecArray | null;
  while ((doctypeMatch = DOCTYPE_RE.exec(content)) !== null) {
    // Groups: 1=root, 2=publicId, 3=systemId(PUBLIC), 4=systemId(SYSTEM), 5=systemId(bare)
    const dtdRef = doctypeMatch[3] || doctypeMatch[4] || doctypeMatch[5];
    if (dtdRef && !isRemoteRef(dtdRef)) {
      refs.push({
        ref: dtdRef,
        index: doctypeMatch.index,
        length: doctypeMatch[0].length,
        kind: 'dtd',
      });
    }
  }

  SCHEMA_LOCATION_RE.lastIndex = 0;
  let schemaMatch: RegExpExecArray | null;
  while ((schemaMatch = SCHEMA_LOCATION_RE.exec(content)) !== null) {
    const pairs = schemaMatch[1];
    SCHEMA_LOCATION_PAIR_RE.lastIndex = 0;
    let pair: RegExpExecArray | null;
    while ((pair = SCHEMA_LOCATION_PAIR_RE.exec(pairs)) !== null) {
      const schemaLocation = pair[2];
      if (schemaLocation && !isRemoteRef(schemaLocation)) {
        // Approximate location: start of the schemaLocation attribute value
        const rel = pairs.indexOf(schemaLocation);
        refs.push({
          ref: schemaLocation,
          index: schemaMatch.index + (rel >= 0 ? rel : 0),
          length: schemaLocation.length,
          kind: 'xsd',
        });
      }
    }
  }

  return refs;
}

function isRemoteRef(ref: string): boolean {
  return /^(https?:|urn:)/i.test(ref);
}

/**
 * Validate XML well-formedness (tag matching) and optional encoding note.
 * Does NOT emit "DTD may not exist" — callers add those after FileService checks.
 * Exported for unit tests (JV-P1-15).
 *
 * @param deadlineMs Absolute Date.now() deadline; throws TimeoutError when exceeded.
 */
export function validateXmlContent(
  content: string,
  deadlineMs?: number,
): monaco.editor.IMarkerData[] {
  const checkDeadline = (): void => {
    if (deadlineMs !== undefined && Date.now() > deadlineMs) {
      throw new TimeoutError();
    }
  };

  const markers: monaco.editor.IMarkerData[] = [];
  const lineStarts = buildLineStarts(content);

  // Check encoding declaration
  const encMatch = XML_DECL_RE.exec(content);
  if (encMatch) {
    const enc = encMatch[1].toLowerCase();
    if (enc !== 'utf-8' && enc !== 'gbk' && enc !== 'gb2312' && enc !== 'iso-8859-1') {
      const { line } = offsetToLineCol(lineStarts, encMatch.index);
      markers.push({
        severity: monaco.MarkerSeverity.Info,
        message: t('validator.xml.encodingInfo', { encoding: encMatch[1] }),
        source: t('validator.xml.source'),
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: 1,
      });
    }
  }

  checkDeadline();

  // Tag matching on comment/CDATA-masked content — XML has no HTML void tags
  const masked = maskXmlCommentsAndCdata(content);
  const tagStack: Array<{ name: string; line: number; col: number }> = [];
  TAG_RE.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  let tagCount = 0;
  while ((tagMatch = TAG_RE.exec(masked)) !== null) {
    if ((++tagCount & 63) === 0) {
      checkDeadline();
    }

    const fullTag = tagMatch[0];
    const tagName = tagMatch[1];
    const isClosing = fullTag.startsWith('</');
    const isSelfClosing = fullTag.endsWith('/>') && !isClosing;
    const { line, col } = offsetToLineCol(lineStarts, tagMatch.index);

    if (isClosing) {
      if (tagStack.length === 0) {
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: t('validator.xml.extraCloseTag', { tag: tagName }),
          source: t('validator.xml.source'),
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + fullTag.length,
        });
        continue;
      }
      const last = tagStack.pop()!;
      if (last.name !== tagName) {
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: t('validator.xml.tagMismatch', { expected: last.name, line: last.line, found: tagName }),
          source: t('validator.xml.source'),
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + fullTag.length,
        });
      }
    } else if (!isSelfClosing) {
      tagStack.push({ name: tagName, line, col });
    }
  }

  // Remaining unclosed tags
  for (const unclosed of tagStack.reverse()) {
    markers.push({
      severity: monaco.MarkerSeverity.Error,
      message: t('validator.xml.unclosedTag', { tag: unclosed.name, line: unclosed.line }),
      source: t('validator.xml.source'),
      startLineNumber: unclosed.line,
      startColumn: unclosed.col,
      endLineNumber: unclosed.line,
      endColumn: unclosed.col + unclosed.name.length + 2,
    });
  }

  return markers;
}

/**
 * Build markers for unresolved local DTD/XSD refs.
 * Exported for unit tests (JV-P1-15).
 */
export function markersForMissingRefs(
  content: string,
  missing: ReadonlySet<string>,
): monaco.editor.IMarkerData[] {
  if (missing.size === 0) {
    return [];
  }
  const lineStarts = buildLineStarts(content);
  const markers: monaco.editor.IMarkerData[] = [];
  for (const ref of collectLocalXmlRefs(content)) {
    if (!missing.has(ref.ref)) continue;
    const { line, col } = offsetToLineCol(lineStarts, ref.index);
    markers.push({
      severity: monaco.MarkerSeverity.Warning,
      message: ref.kind === 'dtd'
        ? t('validator.xml.missingDtd', { ref: ref.ref })
        : t('validator.xml.missingXsd', { ref: ref.ref }),
      source: ref.kind === 'dtd' ? t('validator.xml.dtdSource') : t('validator.xml.xsdSource'),
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: col + ref.length,
    });
  }
  return markers;
}

/**
 * Check if a file path has an XML extension.
 */
function isXmlFile(uri: string): boolean {
  const lower = uri.toLowerCase();
  return XML_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * XML/DTD validator that validates XML files on open/save/edit and
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

  @inject(KairoI18nService)
  @optional()
  protected readonly i18n?: KairoI18nService;

  protected subs = new DisposableCollection();
  protected attached = new Set<string>();
  protected debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  @postConstruct()
  protected init(): void {
    setJspI18n(this.i18n);
    this.subs.push(
      monaco.editor.onDidCreateModel(model => {
        if (isXmlFile(model.uri.path)) {
          this.attachModel(model);
        }
      }),
    );
  }

  onStart(): void {
    // Validate already-open XML models
    for (const model of monaco.editor.getModels()) {
      if (isXmlFile(model.uri.path)) {
        this.attachModel(model);
      }
    }
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.subs.dispose();
  }

  private attachModel(model: monaco.editor.ITextModel): void {
    const key = model.uri.toString();
    if (this.attached.has(key)) {
      return;
    }
    this.attached.add(key);

    this.validateModel(model);

    const changeSub = model.onDidChangeContent(() => {
      this.scheduleValidate(model);
    });
    const disposeSub = model.onWillDispose(() => {
      const timer = this.debounceTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(key);
      }
      this.attached.delete(key);
      changeSub.dispose();
    });
    this.subs.push(changeSub);
    this.subs.push(disposeSub);
  }

  private scheduleValidate(model: monaco.editor.ITextModel): void {
    const key = model.uri.toString();
    const prev = this.debounceTimers.get(key);
    if (prev) clearTimeout(prev);
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.validateModel(model);
      }, VALIDATE_DEBOUNCE_MS),
    );
  }

  /**
   * Validate a single Monaco text model. Runs the validation logic
   * with a deadline and sets markers on the model.
   */
  private async validateModel(model: monaco.editor.ITextModel): Promise<void> {
    const content = model.getValue();
    const size = new Blob([content]).size;

    if (size > MAX_FILE_SIZE) {
      this.logger.warn(`XML 验证: 跳过文件 ${model.uri.path} (大小 ${(size / 1024 / 1024).toFixed(1)} MB 超过限制)`);
      monaco.editor.setModelMarkers(model, MARKER_OWNER, [{
        severity: monaco.MarkerSeverity.Warning,
        message: t('validator.xml.tooLarge', { size: (size / 1024 / 1024).toFixed(1) }),
        source: t('validator.xml.source'),
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      }]);
      return;
    }

    try {
      const deadline = Date.now() + PARSE_TIMEOUT_MS;
      const markers = validateXmlContent(content, deadline);

      const missing = await this.findMissingLocalRefs(model, content, deadline);
      markers.push(...markersForMissingRefs(content, missing));

      if (Date.now() > deadline) {
        throw new TimeoutError();
      }
      monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
    } catch (err) {
      if (err instanceof TimeoutError) {
        this.logger.warn(`XML 验证: 解析超时 ${model.uri.path}`);
        monaco.editor.setModelMarkers(model, MARKER_OWNER, [{
          severity: monaco.MarkerSeverity.Warning,
          message: t('validator.xml.timeout'),
          source: t('validator.xml.source'),
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

  private async findMissingLocalRefs(
    model: monaco.editor.ITextModel,
    content: string,
    deadline: number,
  ): Promise<Set<string>> {
    const missing = new Set<string>();
    const baseUri = new URI(model.uri.toString(true));
    for (const { ref } of collectLocalXmlRefs(content)) {
      if (Date.now() > deadline) {
        throw new TimeoutError();
      }
      const exists = await this.localRefExists(baseUri, ref);
      if (!exists) {
        missing.add(ref);
      }
    }
    return missing;
  }

  private async localRefExists(baseUri: URI, ref: string): Promise<boolean> {
    try {
      // Absolute file path or workspace-relative / same-dir relative
      const candidate = /^(?:[a-zA-Z]:[\\/]|\/)/.test(ref)
        ? URI.fromFilePath(ref)
        : baseUri.parent.resolve(ref);
      await this.fileService.resolve(candidate, { resolveMetadata: false });
      return true;
    } catch {
      return false;
    }
  }
}

/** Timeout error class. */
export class TimeoutError extends Error {
  constructor() {
    super(t('validator.xml.operationTimeout'));
    this.name = 'TimeoutError';
  }
}
