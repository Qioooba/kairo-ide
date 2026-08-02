import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileUri } from '@theia/core/lib/common/file-uri';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
import { RuntimeConnectionService } from './runtime-connection-service';
import { KairoError } from './runtime-errors';
import type { Workspace } from '@kairo/protocol';

export interface WorkspaceContext {
    workspaceId: string;
    workspaceRoot: string;
}

export interface KairoProjectYaml {
    /** Project display name. */
    name?: string;
    /** Project root relative to workspace root (typically '.'). */
    root?: string;
    /** Source directories. */
    sourceRoots?: string[];
    /** Resource directories. */
    resourceRoots?: string[];
    /** Web application root. */
    webappDir?: string;
    /** Output directory for compiled classes. */
    outputDir?: string;
    /** Build script path (e.g. 'build.xml'). */
    buildFile?: string;
    /** Build targets to run. */
    buildTargets?: string[];
    /** Source Java version. */
    sourceLevel?: string;
    /** Target Java version. */
    targetLevel?: string;
    /** Default file encoding (gbk, utf-8, ...). */
    encoding?: string;
    /** Build tool ('ant' | 'maven' | 'javac'). */
    buildTool?: string;
    /** Web application context path. */
    contextPath?: string;
    /** Library / classpath directories (e.g. lib). */
    libraryDirs?: string[];
}

@injectable()
export class WorkspaceContextService implements FrontendApplicationContribution {
    private currentContext: WorkspaceContext | undefined;
    private readonly onDidChangeContextEmitter = new Emitter<WorkspaceContext | undefined>();
    readonly onDidChangeContext: Event<WorkspaceContext | undefined> = this.onDidChangeContextEmitter.event;
    private toDispose: Disposable | undefined;
    private statusUnsubscribe: (() => void) | undefined;
    /** Track the last known roots so we can re-sync when the runtime connects. */
    private lastRoots: FileStat[] | undefined;
    /** Cached parsed .kairo/project.yaml for the active workspace, if any. */
    private projectYaml: KairoProjectYaml | undefined;
    private projectYamlRoot: string | undefined;
    private readonly onDidChangeProjectYamlEmitter = new Emitter<KairoProjectYaml | undefined>();
    /** Fires whenever .kairo/project.yaml is read or changes for the active workspace. */
    readonly onDidChangeProjectYaml: Event<KairoProjectYaml | undefined> = this.onDidChangeProjectYamlEmitter.event;
    /** Serialises overlapping syncFromRoots calls (workspace-changed + initial roots). */
    private syncInflight: Promise<void> | undefined;
    private syncQueuedRoots: FileStat[] | undefined;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @postConstruct()
    protected init(): void {
        this.toDispose = this.workspaceService.onWorkspaceChanged((roots) => {
            this.lastRoots = roots;
            // Reset cached project yaml — it belongs to the previous root.
            this.projectYaml = undefined;
            this.projectYamlRoot = undefined;
            this.onDidChangeProjectYamlEmitter.fire(undefined);
            void this.syncFromRoots(roots);
        });

        // Trigger the initial sync as a fire-and-forget microtask.
        void this.workspaceService.roots.then(roots => {
            this.lastRoots = roots;
            if (roots.length > 0) {
                void this.syncFromRoots(roots);
            }
        });

        // Re-sync when the runtime (re)connects, in case the initial
        // sync failed because the agent was not reachable (N-026).
        //
        // KAIRO-RC-WEB-2026-07-25-14: only re-sync if we do NOT have
        // an active context. Once a workspace is selected (either
        // from the initial sync OR explicitly by the user via
        // setWorkspace, e.g. after the import wizard), we must NOT
        // overwrite it on every EventStream reconnect — the import
        // wizard sets the workspaceContext to the freshly created
        // project workspace, but the EventStream then cycles through
        // connecting → open which used to fire syncFromRoots(roots)
        // with the Theia parent folder and reset currentContext back
        // to the parent. The ActiveProjectService listener saw the
        // parent workspace, found no project, and cleared the
        // just-selected active project. The status bar then stayed
        // on `(no workspace)` even though the import succeeded.
        this.statusUnsubscribe = this.runtime.onStatusChange(s => {
            if (s === 'open' && !this.currentContext && this.lastRoots && this.lastRoots.length > 0) {
                void this.syncFromRoots(this.lastRoots);
            }
        });
    }

    onStart(_app: FrontendApplication): void {
        // WorkspaceContextService is initialized via @postConstruct;
        // onStart is a no-op but required by FrontendApplicationContribution.
    }

    onStop(): void {
        this.statusUnsubscribe?.();
    }

    /**
     * Resolve the Kairo workspace for the given Theia roots and
     * fire `onDidChangeContext` if it changed. Async; callers
     * should `void` the returned promise.
     *
     * Coalesces overlapping calls so the initial `roots` promise and
     * `onWorkspaceChanged` do not both POST /workspaces.
     */
    protected async syncFromRoots(roots: FileStat[]): Promise<void> {
        this.syncQueuedRoots = roots;
        if (this.syncInflight) {
            return this.syncInflight;
        }
        this.syncInflight = (async () => {
            try {
                // Drain the latest queued roots (may be overwritten while we run).
                for (;;) {
                    const target = this.syncQueuedRoots;
                    if (!target) return;
                    this.syncQueuedRoots = undefined;
                    await this.doSyncFromRoots(target);
                    if (!this.syncQueuedRoots) return;
                }
            } finally {
                this.syncInflight = undefined;
            }
        })();
        return this.syncInflight;
    }

    protected async doSyncFromRoots(roots: FileStat[]): Promise<void> {
        if (roots.length === 0) {
            if (this.currentContext !== undefined) {
                this.currentContext = undefined;
                this.onDidChangeContextEmitter.fire(undefined);
            }
            return;
        }

        const rootStat = roots[0];
        // Use OS filesystem path for the agent API. Theia URI paths like
        // `/g:/spaces/...` cause filepath.Abs / os.Stat to fail on Windows
        // and the agent returns 403 Forbidden.
        const rootPath = FileUri.fsPath(rootStat.resource);

        // KAIRO-RC-WEB-027: read .kairo/project.yaml if it exists so
        // the UI can fall back to the on-disk definition when the
        // Runtime Agent is unreachable. This is what "open this
        // folder and the project auto-loads" actually requires.
        await this.refreshProjectYaml(rootStat.resource, rootPath);

        try {
            // Call backend to get/create workspace
            const workspaces = await this.runtime.request('GET /api/v1/workspaces', undefined) as Workspace[];
            const existing = workspaces.find((w: Workspace) => this.sameFsPath(w.rootPath, rootPath));

            if (existing) {
                this.setWorkspace(existing.id, existing.rootPath);
            } else {
                const name = rootPath.split(/[/\\]/).filter(Boolean).pop() || 'workspace';
                const created = await this.runtime.request('POST /api/v1/workspaces', { rootPath, name }) as Workspace;
                this.setWorkspace(created.id, created.rootPath);
            }
        } catch (_err) {
            // If the backend is not available, derive workspaceId from path
            const fallbackId = `local-${btoa(rootPath).replace(/[+/=]/g, '').slice(0, 16)}`;
            this.setWorkspace(fallbackId, rootPath);
        }
    }

    /** Case- and separator-insensitive path equality for Windows/macOS. */
    protected sameFsPath(a: string, b: string): boolean {
        const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        return norm(a) === norm(b);
    }

    /**
     * Read .kairo/project.yaml from the workspace root and cache
     * the parsed result. Best-effort: any failure (file missing,
     * unreadable, parse error) leaves the cache as undefined and
     * emits undefined so listeners can fall back to manual
     * project import.
     */
    protected async refreshProjectYaml(rootUri: URI, rootPath: string): Promise<void> {
        const candidates = ['.kairo/project.yaml', '.kairo/project.yml'];
        for (const rel of candidates) {
            try {
                const fileUri = rootUri.resolve(rel);
                const stat = await this.fileService.resolve(fileUri);
                if (!stat || !stat.isFile) {
                    continue;
                }
                const content = await this.fileService.readFile(stat.resource);
                // Read raw bytes; the file is small text, the TextDecoder
                // constructor takes an ArrayBufferView which is satisfied
                // by the Uint8Array the API hands us.
                const bytes = content.value instanceof Uint8Array
                    ? content.value
                    : new Uint8Array(content.value.buffer || content.value);
                const text = new TextDecoder('utf-8').decode(bytes);
                const parsed = this.parseSimpleYaml(text);
                if (parsed) {
                    this.projectYaml = parsed;
                    this.projectYamlRoot = rootPath;
                    this.onDidChangeProjectYamlEmitter.fire(parsed);
                    return;
                }
            } catch {
                // Try the next candidate.
            }
        }
        this.projectYaml = undefined;
        this.projectYamlRoot = undefined;
        this.onDidChangeProjectYamlEmitter.fire(undefined);
    }

    /**
     * Minimal YAML parser scoped to the keys we care about in
     * `.kairo/project.yaml`. Avoids pulling a heavyweight
     * dependency and stays tolerant of comments, blank lines,
     * and unrecognised keys.
     */
    protected parseSimpleYaml(text: string): KairoProjectYaml | undefined {
        const out: Record<string, unknown> = {};
        let listKey: string | undefined;
        for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.replace(/#.*$/, '').replace(/\s+$/, '');
            if (!line.trim()) {
                continue;
            }
            // List item line ("  - foo")
            const listMatch = line.match(/^\s*-\s+(.+?)\s*$/);
            if (listMatch && listKey) {
                const existing = (out[listKey] as string[] | undefined) ?? (out[listKey] = [] as string[]);
                existing.push(listMatch[1].replace(/^['"]|['"]$/g, ''));
                continue;
            }
            const m = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
            if (!m) {
                continue;
            }
            const key = m[1];
            const value = m[2];
            if (!value) {
                listKey = key;
                continue;
            }
            listKey = undefined;
            const clean = value.replace(/^['"]|['"]$/g, '').trim();
            if (['sourceRoots', 'resourceRoots', 'buildTargets', 'libraryDirs'].includes(key)) {
                out[key] = [clean];
                listKey = key;
            } else {
                out[key] = clean;
            }
        }
        const result: KairoProjectYaml = {};
        if (typeof out.name === 'string') result.name = out.name;
        if (typeof out.root === 'string') result.root = out.root;
        if (Array.isArray(out.sourceRoots)) result.sourceRoots = out.sourceRoots as string[];
        if (Array.isArray(out.resourceRoots)) result.resourceRoots = out.resourceRoots as string[];
        if (Array.isArray(out.libraryDirs)) result.libraryDirs = out.libraryDirs as string[];
        if (typeof out.webappDir === 'string') result.webappDir = out.webappDir;
        if (typeof out.outputDir === 'string') result.outputDir = out.outputDir;
        if (typeof out.buildFile === 'string') result.buildFile = out.buildFile;
        if (Array.isArray(out.buildTargets)) result.buildTargets = out.buildTargets as string[];
        if (typeof out.sourceLevel === 'string') result.sourceLevel = out.sourceLevel;
        if (typeof out.targetLevel === 'string') result.targetLevel = out.targetLevel;
        if (typeof out.encoding === 'string') result.encoding = out.encoding;
        if (typeof out.buildTool === 'string') result.buildTool = out.buildTool;
        if (typeof out.contextPath === 'string') result.contextPath = out.contextPath;
        return result.name || result.root || result.sourceRoots ? result : undefined;
    }

    dispose(): void {
        this.toDispose?.dispose();
        this.statusUnsubscribe?.();
        this.onDidChangeContextEmitter.dispose();
        this.onDidChangeProjectYamlEmitter.dispose();
    }

    get context(): WorkspaceContext | undefined {
        return this.currentContext;
    }

    /** Cached parsed .kairo/project.yaml for the active workspace, if any. */
    get detectedProject(): KairoProjectYaml | undefined {
        return this.projectYaml;
    }

    async setWorkspace(workspaceId: string, workspaceRoot: string): Promise<void> {
        this.currentContext = { workspaceId, workspaceRoot };
        this.runtime.setWorkspace(workspaceId);
        this.onDidChangeContextEmitter.fire(this.currentContext);
    }

    requireContext(): WorkspaceContext {
        if (!this.currentContext) {
            throw new KairoError({ code: 'invalid_request', message: 'No workspace is open' });
        }
        return this.currentContext;
    }
}
