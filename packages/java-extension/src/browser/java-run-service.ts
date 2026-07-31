import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { OutputChannelManager, OutputChannel } from '@theia/output/lib/browser/output-channel';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EditorManager } from '@theia/editor/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { RunJavaParams, RunJavaResult, JavaClassInfo, JavaMethodInfo } from './java-run-protocol';

const RUNTIME_URL_KEY = 'kairo.runtimeUrl';
const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:18080';

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

  protected outputChannel: OutputChannel | undefined;
  protected classInfoCache = new Map<string, { info: JavaClassInfo; mtime: number }>();

  getRuntimeUrl(): string {
    return (window as any).__KAIRO_RUNTIME_URL__ ||
      (typeof process !== 'undefined' && process.env ? process.env.KAIRO_RUNTIME_URL : undefined) ||
      DEFAULT_RUNTIME_URL;
  }

  getOutputChannel(): OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = this.outputChannelManager.getChannel('Java Run');
    }
    return this.outputChannel;
  }

  async getProjectRoot(fileUri: string): Promise<string | undefined> {
    try {
      const uri = new URI(fileUri);
      const uriPath = uri.path.toString();
      const wsRoot = this.workspaceService.tryGetRoots()[0];
      if (wsRoot) {
        return wsRoot.resource.path.toString();
      }
      if (uriPath.includes('/src/')) {
        const idx = uriPath.indexOf('/src/');
        return uriPath.substring(0, idx);
      }
      return undefined;
    } catch (e) {
      this.logger.error('getProjectRoot failed', e);
      return undefined;
    }
  }

  getFilePath(fileUri: string): string {
    const uri = new URI(fileUri);
    return uri.path.toString();
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
      const runtimeUrl = this.getRuntimeUrl();
      const resp = await fetch(`${runtimeUrl}/api/v1/java/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      if (!resp.ok) {
        return this.parseJavaFileLocal(fileUri);
      }
      const data = await resp.json();
      if (!data.ok) {
        return this.parseJavaFileLocal(fileUri);
      }
      const info = data.payload as JavaClassInfo;
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
            const method: JavaMethodInfo = {
              name: isMain ? 'main' : 'test',
              line: i + 1,
              isMain,
              isTest,
              startLine: i + 1,
              endLine: i + 1,
            };
            const methodMatch = trimmed.match(/\s+(\w+)\s*\(/);
            if (methodMatch && !isMain) method.name = methodMatch[1];
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
      const runtimeUrl = this.getRuntimeUrl();
      const resp = await fetch(`${runtimeUrl}/api/v1/java/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await resp.json();
      if (!data.ok) {
        channel.appendLine(`❌ Error: ${data.error?.message || 'Unknown error'}`);
        return { ok: false, exitCode: -1, stdout: '', stderr: data.error?.message || '' };
      }
      const result = data.payload as RunJavaResult;
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
      const msg = `Failed to run: ${e instanceof Error ? e.message : String(e)}`;
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
