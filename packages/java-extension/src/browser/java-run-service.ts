import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { OutputChannelManager, OutputChannel } from '@theia/output/lib/browser/output-channel';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EditorManager } from '@theia/editor/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';
import { ActiveProjectService } from '@kairo/project-extension';
import { RunJavaParams, RunJavaResult, JavaClassInfo, JavaMethodInfo } from './java-run-protocol';

@injectable()
export class JavaRunService {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(OutputChannelManager)
  protected readonly outputChannelManager!: OutputChannelManager;

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService;

  @inject(FileService)
  protected readonly fileService!: FileService;

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(RuntimeConnectionService)
  protected readonly runtime!: RuntimeConnectionService;

  @inject(ActiveProjectService)
  @optional()
  protected readonly activeProject?: ActiveProjectService;

  protected outputChannel: OutputChannel | undefined;
  protected classInfoCache = new Map<string, { info: JavaClassInfo; mtime: number }>();

  getOutputChannel(): OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = this.outputChannelManager.getChannel('Java Run');
    }
    return this.outputChannel;
  }

  /** OS filesystem path from a Theia file URI (not `/g:/...` URI path form). */
  protected uriToFsPath(uriOrString: URI | string): string {
    const uri = typeof uriOrString === 'string' ? new URI(uriOrString) : uriOrString;
    return FileUri.fsPath(uri);
  }

  async getProjectRoot(fileUri: string): Promise<string | undefined> {
    try {
      const filePath = this.uriToFsPath(fileUri);

      // Prefer the directory that owns a `src` segment (standard Java layout).
      const srcIdx = this.indexOfSrcSegment(filePath);
      if (srcIdx > 0) {
        return filePath.substring(0, srcIdx).replace(/[/\\]+$/, '');
      }

      const active = this.activeProject?.project;
      if (active?.root) {
        return active.root;
      }

      const wsRoot = this.workspaceService.tryGetRoots()[0];
      if (wsRoot) {
        return FileUri.fsPath(wsRoot.resource);
      }

      return undefined;
    } catch (e) {
      this.logger.error('getProjectRoot failed', e);
      return undefined;
    }
  }

  /** Index of `/src` or `\src` path segment, or -1 when absent. */
  protected indexOfSrcSegment(filePath: string): number {
    const normalized = filePath.replace(/\\/g, '/');
    const match = normalized.match(/(?:^|[/])src(?:[/]|$)/i);
    if (!match || match.index === undefined) {
      return -1;
    }
    return match.index === 0 ? 0 : match.index + 1;
  }

  getFilePath(fileUri: string): string {
    return this.uriToFsPath(fileUri);
  }

  async detectJavaMethods(fileUri: string): Promise<JavaClassInfo | undefined> {
    try {
      const filePath = this.getFilePath(fileUri);
      const uri = new URI(fileUri);
      try {
        const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
        const mtime = stat.mtime || 0;
        const cached = this.classInfoCache.get(filePath);
        if (cached && cached.mtime >= mtime) {
          return cached.info;
        }
      } catch {
        // If stat fails, continue to refetch
      }
      const info = await this.runtime.request(
        'POST /api/v1/java/detect',
        { filePath },
        { noRetry: true },
      );
      try {
        const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
        this.classInfoCache.set(filePath, { info, mtime: stat.mtime || Date.now() });
      } catch {
        this.classInfoCache.set(filePath, { info, mtime: Date.now() });
      }
      return info;
    } catch (e) {
      this.logger.warn('detectJavaMethods backend failed, using local parser', e);
      return this.parseJavaFileLocal(fileUri);
    }
  }

  protected async parseJavaFileLocal(fileUri: string): Promise<JavaClassInfo | undefined> {
    try {
      const uri = new URI(fileUri);
      const content = await this.fileService.read(uri);
      const text = content.value;
      const lines = text.split('\n');
      const info: JavaClassInfo = { packageName: '', className: '', methods: [] };
      let packageMatch = text.match(/^\s*package\s+([\w.]+)\s*;/m);
      if (packageMatch) info.packageName = packageMatch[1];
      let classMatch = text.match(/(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)/);
      if (classMatch) info.className = classMatch[1];
      const mainRegex = /public\s+static\s+(?:final\s+)?void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]|\.\.\.)\s+\w+\s*\)/;
      const testRegex = /@Test/;
      let braceDepth = 0;
      let classDepth = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (classDepth < 0) {
          if (line.includes('class')) {
            const cm = line.match(/class\s+(\w+)/);
            if (cm) classDepth = braceDepth;
          }
        }
        if (classDepth >= 0) {
          const isTest = testRegex.test(trimmed);
          const isMain = mainRegex.test(trimmed);
          if (isMain || isTest) {
            // When @Test sits alone on its line, look ahead for the method signature.
            let methodName = isMain ? 'main' : 'test';
            let methodLine = i + 1;
            const sameLineMatch = trimmed.match(/\s+(\w+)\s*\(/);
            if (sameLineMatch && !isMain) {
              methodName = sameLineMatch[1];
            } else if (isTest && !isMain) {
              for (let k = i + 1; k < Math.min(lines.length, i + 6); k++) {
                const ahead = lines[k].trim();
                if (!ahead || ahead.startsWith('@') || ahead.startsWith('//')) {
                  continue;
                }
                const aheadMatch = ahead.match(/(?:public|protected|private|static|\s)*\s+(\w+)\s*\(/);
                if (aheadMatch) {
                  methodName = aheadMatch[1];
                  methodLine = k + 1;
                }
                break;
              }
            }
            const method: JavaMethodInfo = {
              name: methodName,
              line: methodLine,
              isMain,
              isTest,
              startLine: i + 1,
              endLine: i + 1,
            };
            let depth = braceDepth;
            for (let j = i; j < lines.length; j++) {
              depth += (lines[j].match(/{/g) || []).length - (lines[j].match(/}/g) || []).length;
              if (depth <= classDepth && j > i) {
                method.endLine = j + 1;
                break;
              }
            }
            info.methods.push(method);
          }
        }
        braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      }
      return info;
    } catch (e) {
      this.logger.error('parseJavaFileLocal failed', e);
      return undefined;
    }
  }

  async runJava(params: RunJavaParams): Promise<RunJavaResult> {
    const channel = this.getOutputChannel();
    channel.clear();
    channel.show({ preserveFocus: true });
    const type = params.debug ? 'Debug' : 'Run';
    const what = params.methodType === 'test' ? 'test' : 'main';
    channel.appendLine(`[${type}] Starting ${what} method: ${params.packageName ? params.packageName + '.' : ''}${params.className}`);
    channel.appendLine(`Working directory: ${params.projectRoot}`);
    channel.appendLine('');
    try {
      const result = await this.runtime.request('POST /api/v1/java/run', { ...params });
      if (result.stdout) {
        channel.appendLine('--- stdout ---');
        channel.append(result.stdout);
        if (!result.stdout.endsWith('\n')) channel.appendLine('');
      }
      if (result.stderr) {
        channel.appendLine('--- stderr ---');
        channel.append(result.stderr);
        if (!result.stderr.endsWith('\n')) channel.appendLine('');
      }
      if (result.ok) {
        channel.appendLine(`✅ Process finished with exit code ${result.exitCode}`);
      } else {
        channel.appendLine(`❌ Process failed with exit code ${result.exitCode}`);
        if (result.error) channel.appendLine(result.error);
      }
      return result;
    } catch (e) {
      const msg = e instanceof KairoError
        ? e.message
        : `Failed to run: ${e instanceof Error ? e.message : String(e)}`;
      channel.appendLine(`❌ ${msg}`);
      return { ok: false, exitCode: -1, stdout: '', stderr: msg, error: msg };
    }
  }

  findMethodAtLine(info: JavaClassInfo, line: number): JavaMethodInfo | undefined {
    for (const m of info.methods) {
      if (line >= m.startLine && line <= m.endLine) return m;
    }
    return undefined;
  }

  async runFromUri(uri: string, line: number, debug: boolean): Promise<void> {
    const info = await this.detectJavaMethods(uri);
    if (!info) return;
    const projectRoot = await this.getProjectRoot(uri);
    if (!projectRoot) {
      this.getOutputChannel().appendLine('❌ Cannot determine project root');
      this.getOutputChannel().show();
      return;
    }
    const filePath = this.getFilePath(uri);
    const method = this.findMethodAtLine(info, line);
    const methodType = method?.isTest ? 'test' : 'main';
    await this.runJava({
      projectRoot,
      filePath,
      className: info.className,
      packageName: info.packageName,
      line,
      debug,
      methodType,
    });
  }

  async runCurrentEditor(debug: boolean): Promise<void> {
    const editor = this.editorManager.currentEditor;
    if (!editor) return;
    const uri = editor.editor.uri.toString();
    const cursor = editor.editor.cursor;
    const line = cursor.line + 1;
    await this.runFromUri(uri, line, debug);
  }
}
