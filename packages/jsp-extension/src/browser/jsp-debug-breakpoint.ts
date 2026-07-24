/**
 * JSP 断点与源映射 — P3-ADVDBG-02
 *
 * Maps JSP line numbers to generated Servlet Java source line
 * numbers so that breakpoints set in .jsp files are resolved
 * to the actual generated Servlet code.
 *
 * Tomcat 6 generates Servlet .java files with line-number
 * comments like `// line 42`, which reference the original JSP
 * line. This service parses those comments to build a two-way
 * mapping.
 *
 * Controlled by the experimental flag `kairo.jsp.debugBreakpoints`
 * (default: false). Users must explicitly opt in.
 */

import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { StorageService } from '@theia/core/lib/browser';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser } from './jsp-java-nav';

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
const JSP_LINE_COMMENT_REGEX = /\/\/\s*line\s+(\d+)/i;
const JSP_FILE_EXTENSION = '.jsp';

@injectable()
export class JspDebugBreakpointMapper {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
  @inject(StorageService) protected readonly storage!: StorageService;

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
  protected async init(): Promise<void> {
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
      this.messages.warn(
        'JSP 断点调试是实验性功能。\n\n' +
        '已知限制：\n' +
        '• 需要 Tomcat 生成的 Servlet 源码可用\n' +
        '• 仅支持 Tomcat 6 生成的 Servlet 格式\n' +
        '• 行号映射可能有偏移\n' +
        '• 如果生成的 Servlet 源码不可用，断点将无法设置\n\n' +
        '此功能默认关闭，需要手动启用。',
      );
    }

    this.config.enabled = enabled;
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

      // Read the Java file and parse line comments
      const content = await this.fileService.readFile(javaUri);
      const text = content.value.toString();
      const lines = text.split('\n');

      // Parse `// line N` comments
      for (let i = 0; i < lines.length; i++) {
        const match = JSP_LINE_COMMENT_REGEX.exec(lines[i]);
        if (match) {
          const jspLine = parseInt(match[1], 10);
          if (jspLine > 0) {
            mapping.mappings.push({
              jspLine,
              javaLine: i + 1, // 1-based line number
              javaFile: javaFilePath,
            });
          }
        }
      }

      this.logger.info(
        `JSP 断点映射解析完成: ${jspFilePath} → ${mapping.mappings.length} 个行映射`,
      );
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
      return null;
    }

    const mapping = await this.parseMapping(jspFilePath, javaFilePath);

    if (!mapping.servletSourceAvailable) {
      this.logger.warn(
        `JSP 断点警告: 生成的 Servlet 源码不可用 — ${javaFilePath}`,
      );
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
    const _jspName = jspFilePath.replace(/\.jsp$/, '');
    const fileName = jspFilePath.split('/').pop();
    if (!fileName || !fileName.endsWith(JSP_FILE_EXTENSION)) {
      return null;
    }

    const baseName = fileName.replace(/\.jsp$/, '');
    // Convert JSP file name to valid Java identifier
    const javaClassName = baseName.replace(/[^a-zA-Z0-9_]/g, '_') + '_jsp.java';

    // If a custom servlet source directory is configured, use it
    if (this.config.servletSourceDir) {
      return `${this.config.servletSourceDir}/${javaClassName}`;
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
   * Get a human-readable status message in Chinese.
   */
  getStatusMessage(): string {
    if (!this.config.enabled) {
      return 'JSP 断点调试已禁用。在设置中启用 experimental 选项以使用此功能。';
    }
    if (!this.config.servletSourceDir) {
      return 'JSP 断点调试已启用，但未配置 Servlet 源码目录。请设置 Servlet 源码路径。';
    }
    return `JSP 断点调试已启用。Servlet 源码目录: ${this.config.servletSourceDir}`;
  }

  // ── Internal ──────────────────────────────────────────────────

  protected async loadConfig(): Promise<void> {
    try {
      const data = await this.storage.getData<JspDebugConfig>(JSP_DEBUG_CONFIG_KEY);
      if (data) {
        this.config = data;
      }
    } catch {
      this.config = { enabled: false };
    }
  }
}

// ── CodeLens provider for JSP debug breakpoints ─────────────────

/**
 * Register a CodeLens provider that shows "Set Breakpoint" / "Toggle Breakpoint"
 * on JSP scriptlet, expression, and declaration lines.
 *
 * When clicked, it maps the JSP line to the generated Servlet Java line
 * and shows a notification.
 */
export function registerJspDebugCodeLens(): monaco.IDisposable {
  const javaParser = new JspJavaParser();

  return monaco.languages.registerCodeLensProvider(JSP_LANGUAGE_ID, {
    provideCodeLenses: async (
      model: monaco.editor.ITextModel,
      token: monaco.CancellationToken,
    ): Promise<monaco.languages.CodeLensList> => {
      if (token.isCancellationRequested) {
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
            title: 'Toggle Breakpoint',
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
 * Returns a Disposable for cleanup.
 */
export function registerJspBreakpointCommand(): monaco.IDisposable {
  const mapper = new JspDebugBreakpointMapper();

  // Register a Monaco action for the CodeLens command
  const disposable = monaco.editor.addEditorAction({
    id: 'kairo.jsp.toggleBreakpoint',
    label: 'JSP: Toggle Breakpoint',
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
        // Show notification with the mapping info
        const jspFileName = jspFilePath.split('/').pop() || jspFilePath;
        const msg = `JSP 断点: ${jspFileName} 第 ${jspLine} 行 → _jspService() 第 ${result.javaLine} 行`;
        // Use global message service if available
        const model = editor.getModel();
        if (model) {
          // Show as an info decoration or just log
          console.log(msg);
        }
      } else {
        console.log(`JSP 断点: 无法映射 ${jspFilePath} 第 ${jspLine} 行到生成的 Servlet 代码`);
      }
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
 */
export function registerJspBreakpointEditorOpener(): monaco.IDisposable {

  return monaco.editor.registerEditorOpener({
    openCodeEditor: async (
      source: monaco.editor.ICodeEditor,
      resource: monaco.Uri,
      selectionOrPosition?: monaco.IRange | monaco.IPosition,
    ): Promise<boolean> => {
      const path = resource.path;
      if (!JSP_SERVLET_FILE_RE.test(path)) {
        return false; // Let the default opener handle it
      }

      // Derive the original JSP file name from the generated Java file name
      // e.g. "index_jsp.java" → "index.jsp"
      const javaFileName = path.split('/').pop() || '';
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
      } else {
        // Fallback to line 1
        jspLine = 1;
      }

      // Try to read the generated Java file to find the JSP line mapping
      try {
        // Read the generated Java file to find the `// line N` comment
        // that maps back to the original JSP line
        const response = await fetch(resource.toString(true));
        if (response.ok) {
          const text = await response.text();
          const lines = text.split('\n');
          // Look backwards from the current Java line for the nearest `// line N` comment
          for (let i = jspLine - 1; i >= 0; i--) {
            const match = JSP_LINE_COMMENT_REGEX.exec(lines[i]);
            if (match) {
              jspLine = parseInt(match[1], 10);
              break;
            }
          }
        }
      } catch {
        // Use the default line mapping
      }

      // Open the JSP file in the same editor
      const jspUri = monaco.Uri.from({
        scheme: resource.scheme,
        authority: resource.authority,
        path: jspFilePath,
      });

      let model = monaco.editor.getModel(jspUri);
      if (!model) {
        model = monaco.editor.createModel('', JSP_LANGUAGE_ID, jspUri);
      }
      source.setModel(model);
      const range = new monaco.Range(jspLine, 1, jspLine, 1);
      source.setSelection(range);
      source.revealLineInCenter(jspLine);

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

  const javaPath = javaUri.path;

  // Try to find the webapp root by walking up from the Java file
  // Look for WEB-INF directory
  const parts = javaPath.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'WEB-INF') {
      // The webapp is the parent of WEB-INF
      const webappRoot = parts.slice(0, i).join('/');
      const jspPath = `${webappRoot}/${jspBaseName}.jsp`;
      return jspPath;
    }
  }

  // Fallback: try common JSP locations relative to the workspace root
  // Look for the JSP file by name
  const parentDir = javaPath.substring(0, javaPath.lastIndexOf('/'));
  const jspCandidate = `${parentDir}/${jspBaseName}.jsp`;
  return jspCandidate;
}