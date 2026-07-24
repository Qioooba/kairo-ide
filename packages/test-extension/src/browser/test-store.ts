import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import type { Endpoint } from '@kairo/protocol';

/** A test item in the hierarchical tree: package → class → method. */
export interface TestItem {
    id: string;
    /** 'package' | 'class' | 'method' */
    kind: 'package' | 'class' | 'method';
    /** Display name (package name, class name, or method name). */
    label: string;
    /** Fully qualified name for the test element. */
    qualifiedName: string;
    /** Parent item id; null for root packages. */
    parentId: string | null;
    /** Child item ids. */
    children: string[];
    /** Test status for the last run. */
    status: TestStatus;
    /** Duration in milliseconds for the last run. */
    durationMs?: number;
    /** Failure message if status is 'failed'. */
    failureMessage?: string;
    /** Source file path for navigation. */
    filePath?: string;
    /** Line number of the test method / class. */
    line?: number;
}

export type TestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped' | 'error';

/** A group of test results from one run. */
export interface TestRun {
    id: string;
    workspaceId: string;
    projectId: string;
    /** 'class' | 'method' | 'package' | 'all' */
    scope: 'class' | 'method' | 'package' | 'all';
    /** Target qualified name (class name, method name, package name). */
    target: string;
    state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    startTime: string;
    endTime?: string;
    totalCount: number;
    passedCount: number;
    failedCount: number;
    skippedCount: number;
    errorCount: number;
    /** Detail results for each test method. */
    results: TestMethodResult[];
    /** Raw output from the test runner. */
    output: string;
}

/** Detailed result for a single test method execution. */
export interface TestMethodResult {
    testId: string;
    status: TestStatus;
    durationMs: number;
    /** Assertion failure message. */
    failureMessage?: string;
    /** Stack trace lines. */
    stackTrace?: string[];
    /** Output written during the test. */
    output?: string;
}

export type ConnectionState = 'loading' | 'connected' | 'disconnected' | 'empty';

@injectable()
export class TestStore {
    @inject(RuntimeConnectionService)
    private readonly runtimeConnection!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    private readonly workspaceContext!: WorkspaceContextService;

    private items = new Map<string, TestItem>();
    private readonly onDidChangeEmitter = new Emitter<TestItem[]>();
    readonly onDidChange: Event<TestItem[]> = this.onDidChangeEmitter.event;

    private runs: TestRun[] = [];
    private readonly onDidChangeRunsEmitter = new Emitter<TestRun[]>();
    readonly onDidChangeRuns: Event<TestRun[]> = this.onDidChangeRunsEmitter.event;

    private connectionState: ConnectionState = 'loading';
    private readonly onConnectionStateChangeEmitter = new Emitter<ConnectionState>();
    readonly onConnectionStateChange: Event<ConnectionState> = this.onConnectionStateChangeEmitter.event;

    private statusUnsubscribe?: () => void;
    private contextUnsubscribe?: { dispose(): void };

    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    @postConstruct()
    protected init(): void {
        this.statusUnsubscribe = this.runtimeConnection.onStatusChange(s => {
            if (s === 'open') {
                this.connectionState = this.items.size === 0 ? 'empty' : 'connected';
            } else if (s === 'disconnected' || s === 'closed') {
                this.connectionState = 'disconnected';
            } else {
                this.connectionState = 'loading';
            }
            this.onConnectionStateChangeEmitter.fire(this.connectionState);
        });

        this.contextUnsubscribe = this.workspaceContext.onDidChangeContext(ctx => {
            if (ctx) {
                void this.discoverTests();
            }
        });
        void this.discoverTests();
    }

    /** Discover test items from the project. */
    async discoverTests(): Promise<void> {
        const ctx = this.workspaceContext.context;
        if (!ctx) return;

        try {
            const result = await this.runtimeConnection.request(
                'GET /api/v1/tests' as Endpoint,
                undefined,
            ) as TestItem[];
            if (Array.isArray(result)) {
                this.items.clear();
                for (const item of result) {
                    this.items.set(item.id, item);
                }
                this.onDidChangeEmitter.fire(this.getItems());
                this.connectionState = this.items.size === 0 ? 'empty' : 'connected';
                this.onConnectionStateChangeEmitter.fire(this.connectionState);
            }
        } catch {
            this.connectionState = 'disconnected';
            this.onConnectionStateChangeEmitter.fire(this.connectionState);
        }
    }

    /** Get all test items as a flat array. */
    getItems(): TestItem[] {
        return Array.from(this.items.values());
    }

    /** Get root test items (packages with no parent). */
    getRootItems(): TestItem[] {
        return this.getItems().filter(item => item.parentId === null);
    }

    /** Get children of a test item. */
    getChildren(parentId: string): TestItem[] {
        const parent = this.items.get(parentId);
        if (!parent) return [];
        return parent.children.map(id => this.items.get(id)).filter(Boolean) as TestItem[];
    }

    /** Get a single test item by id. */
    getItem(id: string): TestItem | undefined {
        return this.items.get(id);
    }

    /** Update a list of test items (e.g., after a test run). */
    updateItems(items: TestItem[]): void {
        for (const item of items) {
            this.items.set(item.id, item);
        }
        this.onDidChangeEmitter.fire(this.getItems());
    }

    /** Get all test runs. */
    getRuns(): TestRun[] {
        return [...this.runs];
    }

    /** Get the latest test run. */
    getLatestRun(): TestRun | undefined {
        return this.runs[this.runs.length - 1];
    }

    /** Add a new test run. */
    addRun(run: TestRun): void {
        this.runs = [...this.runs, run].slice(-50);
        this.onDidChangeRunsEmitter.fire(this.getRuns());
    }

    /** Update a test run. */
    updateRun(id: string, update: Partial<TestRun>): void {
        this.runs = this.runs.map(r => r.id === id ? { ...r, ...update } : r);
        this.onDidChangeRunsEmitter.fire(this.getRuns());
    }

    /** Run tests with the given scope. */
    async runTests(scope: 'class' | 'method' | 'package' | 'all', target: string): Promise<TestRun | undefined> {
        const ctx = this.workspaceContext.context;
        if (!ctx) return undefined;

        try {
            const result = await this.runtimeConnection.request(
                'POST /api/v1/tests/run' as Endpoint,
                { scope, target },
            ) as TestRun;
            this.addRun(result);
            return result;
        } catch {
            return undefined;
        }
    }

    /** Cancel a running test run. */
    async cancelRun(runId: string): Promise<void> {
        const ctx = this.workspaceContext.context;
        if (!ctx) return;
        try {
            await this.runtimeConnection.request(
                'DELETE /api/v1/tests/runs/{runId}' as Endpoint,
                undefined,
                { pathParams: { runId } },
            );
        } catch {
            // ignore cancel errors
        }
    }

    dispose(): void {
        this.statusUnsubscribe?.();
        this.contextUnsubscribe?.dispose();
        this.onDidChangeEmitter.dispose();
        this.onDidChangeRunsEmitter.dispose();
        this.onConnectionStateChangeEmitter.dispose();
    }
}