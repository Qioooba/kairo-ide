/**
 * Kairo Maven service — communicates with the Go Runtime Agent's
 * Maven API endpoints (/api/v1/maven/*) and maintains the Maven
 * project state for the UI.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { RuntimeConnectionService } from '@kairo/runtime-extension';

export interface MavenProjectInfo {
    groupId: string;
    artifactId: string;
    version: string;
    packaging: string;
    name: string;
    description: string;
    buildDir: string;
    outputDir: string;
}

export interface MavenDependency {
    groupId: string;
    artifactId: string;
    version: string;
    scope: string;
    optional: boolean;
    type: string;
}

export interface MavenDependencyTreeNode {
    groupId: string;
    artifactId: string;
    version: string;
    scope: string;
    optional: boolean;
    type: string;
    children?: MavenDependencyTreeNode[];
}

export interface MavenDependencyConflict {
    groupId: string;
    artifactId: string;
    versions: string[];
    resolvedVersion: string;
    depth: number;
}

export interface MavenLifecycleTask {
    id: string;
    label: string;
    description: string;
    phase: string;
}

export interface MavenDetectResult {
    found: boolean;
    project?: MavenProjectInfo;
    tasks: MavenLifecycleTask[];
    dependencies: MavenDependency[];
    tree?: MavenDependencyTreeNode[];
    conflicts?: MavenDependencyConflict[];
    warnings: string[];
}

export interface MavenRunResult {
    task: string;
    success: boolean;
    exitCode: number;
    output: string;
    error?: string;
}

export interface MavenModuleInfo {
    path: string;
    groupId: string;
    artifactId: string;
    version: string;
    packaging: string;
    name: string;
    dependencies: MavenDependency[];
    parent?: { groupId: string; artifactId: string; version: string };
    subModules?: string[];
    isRoot: boolean;
}

export interface MavenMultiModuleProject {
    root: MavenModuleInfo;
    modules: MavenModuleInfo[];
    buildOrder: string[];
}

export interface MavenPluginBinding {
    groupId: string;
    artifactId: string;
    goal: string;
    phase: string;
}

export interface MavenLifecycleTreeItem {
    id: string;
    label: string;
    description: string;
    order: number;
    bindings?: MavenPluginBinding[];
    children?: MavenLifecycleTreeItem[];
}

export interface MavenBuildProgress {
    phase: string;
    module: string;
    status: 'running' | 'success' | 'failed';
    message: string;
    percentComplete: number;
}

export type MavenViewTab = 'overview' | 'dependencies' | 'lifecycle' | 'modules';

@injectable()
export class KairoMavenService {
    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    protected detectResult: MavenDetectResult | null = null;
    protected multiModule: MavenMultiModuleProject | null = null;
    protected lifecycleTree: MavenLifecycleTreeItem[] = [];
    protected buildProgress: MavenBuildProgress | null = null;
    protected activeTab: MavenViewTab = 'overview';
    protected rootPath: string = '';

    protected listeners = new Set<(state: MavenDetectResult | null) => void>();
    protected progressListeners = new Set<(p: MavenBuildProgress | null) => void>();

    @postConstruct()
    protected init(): void {
        // Initialize empty state
    }

    /** Detect a Maven project at the given root path. */
    async detect(rootPath: string): Promise<MavenDetectResult | null> {
        this.rootPath = rootPath;
        try {
            const result = await this.runtime.request(
                'POST /api/v1/maven/detect',
                { body: { rootPath } }
            ) as MavenDetectResult;
            this.detectResult = result;
            this.notifyListeners();
            return result;
        } catch {
            this.detectResult = null;
            this.notifyListeners();
            return null;
        }
    }

    /** Get the dependency tree for the current project. */
    async getDependencies(offline: boolean = false): Promise<MavenDetectResult | null> {
        try {
            const result = await this.runtime.request(
                'GET /api/v1/maven/dependencies',
                { query: { rootPath: this.rootPath, offline } }
            ) as MavenDetectResult;
            this.detectResult = result;
            this.notifyListeners();
            return result;
        } catch {
            return null;
        }
    }

    /** Run a Maven lifecycle task. */
    async runTask(task: string, offline: boolean = false): Promise<MavenRunResult | null> {
        // Reset progress
        this.setBuildProgress({
            phase: task,
            module: this.rootPath,
            status: 'running',
            message: `Running mvn ${task}...`,
            percentComplete: 0,
        });

        try {
            const result = await this.runtime.request(
                'POST /api/v1/maven/run',
                { body: { rootPath: this.rootPath, task, offline } }
            ) as MavenRunResult;

            this.setBuildProgress({
                phase: task,
                module: this.rootPath,
                status: result.success ? 'success' : 'failed',
                message: result.success ? 'Build succeeded' : (result.error || 'Build failed'),
                percentComplete: 100,
            });

            return result;
        } catch (err) {
            this.setBuildProgress({
                phase: task,
                module: this.rootPath,
                status: 'failed',
                message: err instanceof Error ? err.message : String(err),
                percentComplete: 0,
            });
            return null;
        }
    }

    /** Set build progress and notify listeners. */
    setBuildProgress(p: MavenBuildProgress | null): void {
        this.buildProgress = p;
        for (const l of this.progressListeners) {
            l(p);
        }
    }

    /** Get the current detect result. */
    getDetectResult(): MavenDetectResult | null {
        return this.detectResult;
    }

    /** Get the active root path. */
    getRootPath(): string {
        return this.rootPath;
    }

    /** Get the active tab. */
    getActiveTab(): MavenViewTab {
        return this.activeTab;
    }

    /** Set the active tab. */
    setActiveTab(tab: MavenViewTab): void {
        this.activeTab = tab;
    }

    /** Subscribe to state changes. */
    onState(cb: (state: MavenDetectResult | null) => void): { dispose(): void } {
        this.listeners.add(cb);
        return {
            dispose: () => { this.listeners.delete(cb); },
        };
    }

    /** Subscribe to build progress changes. */
    onProgress(cb: (p: MavenBuildProgress | null) => void): { dispose(): void } {
        this.progressListeners.add(cb);
        return {
            dispose: () => { this.progressListeners.delete(cb); },
        };
    }

    private notifyListeners(): void {
        for (const l of this.listeners) {
            l(this.detectResult);
        }
    }
}