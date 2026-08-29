/**
 * JSP 断点与源映射 — P3-ADVDBG-02
 *
 * Maps JSP line numbers to generated Servlet Java source line
 * numbers so that breakpoints set in .jsp files are resolved
 * to the actual generated Servlet code.
 *
 * Jasper/Tomcat may embed `// line N` comments, alternate
 * `from line #N` markers, or a JSR-045 SMAP trailer. When none
 * are present the mapper fails visibly rather than silently
 * mapping to the wrong Java line.
 *
 * Controlled by the experimental flag `kairo.jsp.debugBreakpoints`
 * (default: false). Users must explicitly opt in.
 */

import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject, postConstruct, optional } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { StorageService } from '@theia/core/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser';
import type { I18nService } from '@kairo/i18n';
import { KairoI18nService } from '@kairo/i18n';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser } from './jsp-java-nav';
import { setJspI18n, t } from './i18n-context';

/** A single line mapping: JSP line → Servlet Java line. */
export interface JspLineMapping {
  /** 1-based line number in the JSP file. */
  jspLine: number;
  /** 1-based line number in the generated Servlet Java file. */
  javaLine: number;
  /** The generated Servlet Java file path. */
  javaFile: string;
}

/** A parsed JSP-to-Servlet mapping for a single file. */
export interface JspFileMapping {
  /** Absolute path to the JSP file. */
  jspFile: string;
  /** Absolute path to the generated Servlet Java file. */
  javaFile: string;
  /** Line mappings from JSP to Java. */
  mappings: JspLineMapping[];
  /** Whether the generated Servlet source was found. */
  servletSourceAvailable: boolean;
  /** Error message if parsing failed. */
  error?: string;
}

/** Configuration for JSP debug breakpoints. */
export interface JspDebugConfig {
  /** Whether JSP debug breakpoints are enabled. */
  enabled: boolean;
  /** Path to the generated Servlet source directory. */
  servletSourceDir?: string;
}

const JSP_DEBUG_CONFIG_KEY = 'kairo.jsp.debugBreakpoints';
/** Classic Jasper `// line N` (and loose variants). */
const JSP_LINE_COMMENT_REGEX = /\/\/\s*(?:HTML\s*\/\/\s*)?(?:from\s+)?line\s+#?(\d+)/i;
const JSP_FILE_EXTENSION = '.jsp';

/** Message shown when no JSP→Servlet line mapping could be parsed. */
function noMappingMessage(): string {
  return t('jsp.debugBreakpoint.noMapping');
}

/**
 * Basename of a filesystem path that may use `/` or `\\`.
 * Exported for unit tests (JV-P1-13).
 */
export function fsPathBasename(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Join a directory and file name using the directory's separator style.
 * Exported for unit tests (JV-P1-13).
 */
export function joinFsPath(dir: string, fileName: string): string {
  const trimmed = dir.replace(/[/\\]+$/, '');
  const sep = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
  return `${trimmed}${sep}${fileName}`;
}

/**
 * Parse JSP→Java line mappings from generated Servlet source.
 * Supports `// line N` comments and a trailing JSR-045 SMAP `*L` section.
 * Exported for unit tests (JV-P1-13).
 */
export function parseServletLineMappings(
  text: string,
  javaFilePath: string,
): JspLineMapping[] {
  const mappings: JspLineMapping[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const match = JSP_LINE_COMMENT_REGEX.exec(lines[i]);
    if (match) {
      const jspLine = parseInt(match[1], 10);
      if (jspLine > 0) {
        mappings.push({
          jspLine,
          javaLine: i + 1,
          javaFile: javaFilePath,
        });
      }
    }
  }

  if (mappings.length === 0) {
    mappings.push(...parseSmapLineMappings(text, javaFilePath));
  }

  return mappings;
}

/**
 * Parse a JSR-045 SMAP `*L` section into JSP→Java line mappings.
 * Format (simplified): `InputStartLine[#FileId][,InputLineCount]:OutputStartLine[,OutputLineIncrement]`
 */
export function parseSmapLineMappings(
  text: string,
  javaFilePath: string,
): JspLineMapping[] {
  const smapStart = text.lastIndexOf('\n*S ');
  if (smapStart < 0 && !text.startsWith('Smap')) {
    // Also accept SMAP embedded after a form-feed / comment trailer
    const alt = text.lastIndexOf('*S Jasper');
    if (alt < 0) {
      return [];
    }
  }

  const lineSection = /\*L\r?\n([\s\S]*?)(?:\*E|\*S\b|$)/.exec(text);
  if (!lineSection) {
    return [];
  }

  const mappings: JspLineMapping[] = [];
  const entryRe =
    /^(\d+)(?:#\d+)?(?:,(\d+))?:(\d+)(?:,(\d+))?$/;
  for (const raw of lineSection[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = entryRe.exec(line);
    if (!m) continue;
    const inputStart = parseInt(m[1], 10);
    const inputCount = m[2] ? parseInt(m[2], 10) : 1;
    const outputStart = parseInt(m[3], 10);
    const outputInc = m[4] ? parseInt(m[4], 10) : 1;
    if (inputStart <= 0 || outputStart <= 0) continue;
    for (let i = 0; i < inputCount; i++) {
      mappings.push({
        jspLine: inputStart + i,
        javaLine: outputStart + i * outputInc,
        javaFile: javaFilePath,
      });
    }
  }
  return mappings;
}

/**
 * Map a Java source line back to the nearest preceding JSP line marker.
 * Exported for unit tests (JV-P1-13).
 */
export function mapJavaLineToJspLine(text: string, javaLine: number): number {
  const lines = text.split(/\r?\n/);
  const start = Math.min(Math.max(javaLine, 1), lines.length) - 1;
  for (let i = start; i >= 0; i--) {
    const match = JSP_LINE_COMMENT_REGEX.exec(lines[i]);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  // Fall back to SMAP: find mapping whose javaLine is closest ≤ javaLine
  const smap = parseSmapLineMappings(text, '');
  let best: JspLineMapping | undefined;
  for (const m of smap) {
    if (m.javaLine <= javaLine && (!best || m.javaLine > best.javaLine)) {
      best = m;
    }
  }
  return best ? best.jspLine : javaLine;
}

@injectable()
export class JspDebugBreakpointMapper {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
  @inject(StorageService) protected readonly storage!: StorageService;
  @inject(KairoI18nService) @optional() protected readonly i18n?: KairoI18nService;

  protected readonly onDidChangeConfigEmitter = new Emitter<JspDebugConfig>();
  readonly onDidChangeConfig: Event<JspDebugConfig> = this.onDidChangeConfigEmitter.event;

  protected readonly onDidParseMappingEmitter = new Emitter<JspFileMapping>();
  readonly onDidParseMapping: Event<JspFileMapping> = this.onDidParseMappingEmitter.event;

  protected config: JspDebugConfig = { enabled: false };
  protected mappingCache: Map<string, JspFileMapping> = new Map();

  get debugConfig(): Readonly<JspDebugConfig> {
    return this.config;
  }

  @postConstruct()
  protected init(): void {
    setJspI18n(this.i18n);
    void this.initAsync();
  }

  protected async initAsync(): Promise<void> {
    this.logger.info('JSP 断点映射器已初始化');
    await this.loadConfig();
  }

  /**
   * Check if JSP debug breakpoints are enabled.
   * Returns false if the experimental flag is not set.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable JSP debug breakpoints.
   * Shows a warning the first time it's enabled.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled && !this.config.enabled) {
      // First-time enable — show experimental warning
      this.messages.warn(t('jsp.debugBreakpoint.experimentalWarning'));
    }

    this.config.enabled = enabled;
    setJspDebugCodeLensEnabled(enabled);
    await this.storage.setData(JSP_DEBUG_CONFIG_KEY, this.config);
    this.onDidChangeConfigEmitter.fire({ ...this.config });
  }

  /**
   * Set the path to the generated Servlet source directory.
   */
  async setServletSourceDir(dir: string): Promise<void> {
    this.config.servletSourceDir = dir;
    await this.storage.setData(JSP_DEBUG_CONFIG_KEY, this.config);
    this.onDidChangeConfigEmitter.fire({ ...this.config });
  }

  /**
   * Parse a JSP file to build the JSP→Servlet line mapping.
   *
   * @param jspFilePath Absolute path to the .jsp file
   * @param javaFilePath Absolute path to the generated Servlet .java file
   */
  async parseMapping(jspFilePath: string, javaFilePath: string): Promise<JspFileMapping> {
    const cacheKey = `${jspFilePath}::${javaFilePath}`;
    const cached = this.mappingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const mapping: JspFileMapping = {
      jspFile: jspFilePath,
      javaFile: javaFilePath,
      mappings: [],
      servletSourceAvailable: false,
    };

    try {
      // Check if the generated Servlet Java file exists
      const javaUri = URI.fromFilePath(javaFilePath);
      await this.fileService.resolve(javaUri);
      mapping.servletSourceAvailable = true;

      // Read the Java file and parse line comments / SMAP
      const content = await this.fileService.readFile(javaUri);
      const text = content.value.toString();
      mapping.mappings = parseServletLineMappings(text, javaFilePath);

      if (mapping.mappings.length === 0) {
        mapping.error = noMappingMessage();
        this.logger.warn(`JSP 断点映射解析失败: ${jspFilePath} — ${mapping.error}`);
      } else {
        this.logger.info(
          `JSP 断点映射解析完成: ${jspFilePath} → ${mapping.mappings.length} 个行映射`,
        );
      }
    } catch (error) {
      mapping.servletSourceAvailable = false;
      mapping.error = error instanceof Error ? error.message : String(error);
      this.logger.warn(`JSP 断点映射解析失败: ${jspFilePath} — ${mapping.error}`);
    }

    this.mappingCache.set(cacheKey, mapping);
    this.onDidParseMappingEmitter.fire(mapping);
    return mapping;
  }

  /**
   * Map a JSP line number to the corresponding Servlet Java line number.
   *
   * @param jspFilePath Absolute path to the .jsp file
   * @param jspLine 1-based line number in the JSP file
   * @returns The corresponding Java file path and line number, or null if not found
   */
  async mapJspLineToJava(
    jspFilePath: string,
    jspLine: number,
  ): Promise<{ javaFile: string; javaLine: number } | null> {
    if (!this.config.enabled) {
      return null;
    }

    // Find the generated Servlet Java file path
    const javaFilePath = this.deriveJavaFilePath(jspFilePath);
    if (!javaFilePath) {
      this.messages.warn(t('jsp.debugBreakpoint.noSourceDirWarning'));
      return null;
    }

    const mapping = await this.parseMapping(jspFilePath, javaFilePath);

    if (!mapping.servletSourceAvailable) {
      this.messages.warn(t('jsp.debugBreakpoint.servletSourceMissingWarning', { javaFile: javaFilePath }));
      this.logger.warn(
        `JSP 断点警告: 生成的 Servlet 源码不可用 — ${javaFilePath}`,
      );
      return null;
    }

    if (mapping.mappings.length === 0) {
      this.messages.warn(mapping.error || noMappingMessage());
      return null;
    }

    // Find the closest mapping for the given JSP line
    // We use the next available mapping after the JSP line
    let bestMapping: JspLineMapping | undefined;
    for (const m of mapping.mappings) {
      if (m.jspLine >= jspLine) {
        bestMapping = m;
        break;
      }
    }

    if (!bestMapping && mapping.mappings.length > 0) {
      // If no mapping after the line, try the last one
      bestMapping = mapping.mappings[mapping.mappings.length - 1];
    }

    if (!bestMapping) {
      this.messages.warn(
        t('jsp.debugBreakpoint.cannotMapLineWarning', { line: jspLine }),
      );
      return null;
    }

    return {
      javaFile: bestMapping.javaFile,
      javaLine: bestMapping.javaLine,
    };
  }

  /**
   * Derive the generated Servlet Java file path from a JSP file path.
   *
   * Tomcat 6 generates Servlet Java files under the work directory.
   * The path convention is:
   *   work/Catalina/localhost/<context>/org/apache/jsp/<jsp-name>_jsp.java
   *
   * @param jspFilePath Absolute path to the .jsp file
   */
  deriveJavaFilePath(jspFilePath: string): string | null {
    const fileName = fsPathBasename(jspFilePath);
    if (!fileName || !fileName.toLowerCase().endsWith(JSP_FILE_EXTENSION)) {
      return null;
    }

    const baseName = fileName.replace(/\.jsp$/i, '');
    // Convert JSP file name to valid Java identifier
    const javaClassName = baseName.replace(/[^a-zA-Z0-9_]/g, '_') + '_jsp.java';

    // If a custom servlet source directory is configured, use it
    if (this.config.servletSourceDir) {
      return joinFsPath(this.config.servletSourceDir, javaClassName);
    }

    // Default: look relative to the project's work directory
    // The caller should provide the full path to the generated Java file
    return null;
  }

  /**
   * Clear the mapping cache for a specific file or all files.
   */
  clearCache(jspFilePath?: string): void {
    if (jspFilePath) {
      // Remove all cache entries for this JSP file
      for (const [key] of this.mappingCache) {
        if (key.startsWith(jspFilePath)) {
          this.mappingCache.delete(key);
        }
      }
    } else {
      this.mappingCache.clear();
    }
  }

  /**
   * Get a human-readable status message in the current language.
   */
  getStatusMessage(): string {
    if (!this.config.enabled) {
      return t('jsp.debugBreakpoint.statusDisabled');
    }
    if (!this.config.servletSourceDir) {
      return t('jsp.debugBreakpoint.statusMissingSourceDir');
    }
    return t('jsp.debugBreakpoint.statusEnabled', { dir: this.config.servletSourceDir });
  }

  /** Surface a successful mapping to the user (CodeLens command). */
  notifyMapping(message: string): void {
    this.messages.info(message);
  }

  // ── Internal ──────────────────────────────────────────────────

  protected async loadConfig(): Promise<void> {
    try {
      const data = await this.storage.getData<JspDebugConfig>(JSP_DEBUG_CONFIG_KEY);
      if (data) {
        this.config = data;
        setJspDebugCodeLensEnabled(!!data.enabled);
      }
    } catch {
      this.config = { enabled: false };
      setJspDebugCodeLensEnabled(false);
    }
  }
}

// ── CodeLens provider for JSP debug breakpoints ─────────────────

/**
 * Runtime opt-in for JSP breakpoint CodeLenses. Matches the
 * documented default of `kairo.jsp.debugBreakpoints` (off).
 * `JspDebugBreakpointMapper.setEnabled` flips this so CodeLens
 * stays quiet until the user explicitly enables the experiment.
 */
let jspDebugCodeLensEnabled = false;

export function setJspDebugCodeLensEnabled(enabled: boolean): void {
  jspDebugCodeLensEnabled = enabled;
}

/**
 * Register a CodeLens provider that shows "Toggle Breakpoint"
 * on JSP scriptlet / expression / declaration lines.
 *
 * Gated behind the experimental flag — without the gate every
 * Java line sprouts a CodeLens and drowns syntax highlighting.
 */
export function registerJspDebugCodeLens(i18n?: I18nService): monaco.IDisposable {
  setJspI18n(i18n);
  const javaParser = new JspJavaParser();

  return monaco.languages.registerCodeLensProvider(JSP_LANGUAGE_ID, {
    provideCodeLenses: async (
      model: monaco.editor.ITextModel,
      token: monaco.CancellationToken,
    ): Promise<monaco.languages.CodeLensList> => {
      if (token.isCancellationRequested || !jspDebugCodeLensEnabled) {
        return { lenses: [], dispose: () => undefined };
      }

      const lenses: monaco.languages.CodeLens[] = [];
      const content = model.getValue();
      const lines = content.split('\n');

      // Find scriptlet/expression/declaration lines
      const blocks = javaParser.findJavaBlocks(content);
      const blockLines = new Set<number>();
      for (const block of blocks) {
        const startLine = content.substring(0, block.start).split('\n').length; // 1-based
        const endLine = content.substring(0, block.end).split('\n').length;
        for (let l = startLine; l <= endLine; l++) {
          blockLines.add(l);
        }
      }

      for (const lineNum of blockLines) {
        if (token.isCancellationRequested) break;
        if (lineNum < 1 || lineNum > lines.length) continue;
        const line = lines[lineNum - 1];
        // Skip lines that are only whitespace or closing tags
        const trimmed = line.trim();
        if (trimmed === '' || trimmed === '%>' || trimmed.startsWith('%>')) continue;

        lenses.push({
          range: new monaco.Range(lineNum, 1, lineNum, 1),
          command: {
            id: 'kairo.jsp.toggleBreakpoint',
            title: t('jsp.debugBreakpoint.toggleCodelensTitle'),
            arguments: [model.uri.toString(), lineNum],
          },
        });
      }

      return { lenses, dispose: () => undefined };
    },

    resolveCodeLens: async (
      model: monaco.editor.ITextModel,
      codeLens: monaco.languages.CodeLens,
      _token: monaco.CancellationToken,
    ): Promise<monaco.languages.CodeLens> => {
      return codeLens;
    },
  });
}

/**
 * Register a command that handles the "Toggle Breakpoint" CodeLens action.
 * Must receive the DI-constructed mapper — never `new` it (injections empty).
 */
export function registerJspBreakpointCommand(
  mapper: JspDebugBreakpointMapper,
  i18n?: I18nService,
): monaco.IDisposable {
  setJspI18n(i18n);
  // Register a Monaco action for the CodeLens command
  const disposable = monaco.editor.addEditorAction({
    id: 'kairo.jsp.toggleBreakpoint',
    label: t('jsp.debugBreakpoint.toggleCommandLabel'),
    contextMenuGroupId: 'debug',
    run: async (editor: monaco.editor.ICodeEditor, ...args: unknown[]): Promise<void> => {
      const jspUri = args[0] as string;
      const jspLine = args[1] as number;

      if (!jspUri || !jspLine) return;

      // Derive the JSP file path from the URI
      const jspFilePath = monaco.Uri.parse(jspUri).fsPath;
      if (!jspFilePath) return;

      const result = await mapper.mapJspLineToJava(jspFilePath, jspLine);
      if (result) {
        const jspFileName = fsPathBasename(jspFilePath) || jspFilePath;
        mapper.notifyMapping(
          t('jsp.debugBreakpoint.mappedNotice', { file: jspFileName, line: jspLine, javaLine: result.javaLine }),
        );
      }
      // Failure paths already surface MessageService warnings from the mapper.
      void editor;
    },
  });

  return disposable;
}

// ── Editor opener: generated _jsp.java → original JSP ───────────

/** Matches generated Servlet Java file names like index_jsp.java */
const JSP_SERVLET_FILE_RE = /_jsp\.java$/i;

/**
 * Register an editor opener that intercepts generated _jsp.java files
 * and opens the corresponding JSP file at the correct line.
 *
 * When a breakpoint is hit in a generated _jsp.java file, the debugger
 * opens that file. This opener intercepts the open and navigates to
 * the original JSP source instead.
 *
 * Must use EditorManager.open — never createModel('') for a real file://
 * URI (that pollutes the model registry and Ctrl+S can write empty).
 */
export function registerJspBreakpointEditorOpener(
  editorManager: EditorManager,
  fileService: FileService,
): monaco.IDisposable {

  return monaco.editor.registerEditorOpener({
    openCodeEditor: async (
      source: monaco.editor.ICodeEditor,
      resource: monaco.Uri,
      selectionOrPosition?: monaco.IRange | monaco.IPosition,
    ): Promise<boolean> => {
      void source;
      const path = resource.path;
      if (!JSP_SERVLET_FILE_RE.test(path)) {
        return false; // Let the default opener handle it
      }

      // Derive the original JSP file name from the generated Java file name
      // e.g. "index_jsp.java" → "index.jsp"
      const javaFileName = fsPathBasename(path);
      const jspBaseName = javaFileName
        .replace(/_jsp\.java$/i, '')
        .replace(/_/g, '.'); // Replace underscores used as separators

      // Try to find the JSP file in the workspace
      const jspFilePath = await findJspFileForServlet(resource, jspBaseName);
      if (!jspFilePath) {
        return false; // Let the default opener handle it
      }

      // Map the Java line number back to the JSP line
      let jspLine = 1;
      if (selectionOrPosition && 'lineNumber' in selectionOrPosition) {
        jspLine = selectionOrPosition.lineNumber;
      } else if (selectionOrPosition && 'startLineNumber' in selectionOrPosition) {
        jspLine = selectionOrPosition.startLineNumber;
      }

      // Read generated Java via FileService (fetch('file://') fails in Electron)
      try {
        const fileContent = await fileService.readFile(new URI(resource.toString(true)));
        const text = fileContent.value.toString();
        jspLine = mapJavaLineToJspLine(text, jspLine);
      } catch {
        // Use the default line mapping
      }

      // Open via EditorManager so Theia loads real file content into the model.
      // jspFilePath is a URI path (from monaco.Uri.path), not a raw fs path.
      const monacoJspUri = monaco.Uri.from({
        scheme: resource.scheme,
        authority: resource.authority,
        path: jspFilePath,
      });
      const jspUri = new URI(monacoJspUri.toString(true));
      // Selection is 0-based in Theia/LSP Range
      const line = Math.max(0, jspLine - 1);
      await editorManager.open(jspUri, {
        selection: {
          start: { line, character: 0 },
          end: { line, character: 0 },
        },
      });

      return true; // We handled the open
    },
  });
}

/**
 * Find the JSP file that corresponds to a generated Servlet Java file.
 * Searches the workspace for matching .jsp file names.
 */
async function findJspFileForServlet(
  javaUri: monaco.Uri,
  jspBaseName: string,
): Promise<string | null> {
  // Derive the workspace root from the Java file path
  // The generated Java file is typically under:
  //   work/Catalina/localhost/<context>/org/apache/jsp/<name>_jsp.java
  // The JSP file is typically under:
  //   <webapp>/<name>.jsp

  // monaco.Uri.path is always POSIX-style (`/`)
  const javaPath = javaUri.path;

  // Try to find the webapp root by walking up from the Java file
  // Look for WEB-INF directory
  const parts = javaPath.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'WEB-INF') {
      // The webapp is the parent of WEB-INF
      const webappRoot = '/' + parts.slice(0, i).join('/');
      return `${webappRoot}/${jspBaseName}.jsp`;
    }
  }

  // Fallback: try common JSP locations relative to the parent dir
  const slash = javaPath.lastIndexOf('/');
  const parentDir = slash >= 0 ? javaPath.substring(0, slash) : javaPath;
  return `${parentDir}/${jspBaseName}.jsp`;
}
