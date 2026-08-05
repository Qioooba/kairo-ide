import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { GitService, GitFileStatus, GitStatusResult, GitCommitResult, GitCommitOptions } from './git-service';

export interface GitChangesState {
    branch: string;
    stagedChanges: GitFileStatus[];
    unstagedChanges: GitFileStatus[];
    ahead: number;
    behind: number;
    loading: boolean;
    error?: string;
}

@injectable()
export class GitStore {
    @inject(GitService)
    private readonly gitService!: GitService;

    private state: GitChangesState = {
        branch: '',
        stagedChanges: [],
        unstagedChanges: [],
        ahead: 0,
        behind: 0,
        loading: false,
    };

    private readonly onDidChangeEmitter = new Emitter<GitChangesState>();
    readonly onDidChange: Event<GitChangesState> = this.onDidChangeEmitter.event;

    private readonly onDiffRequestEmitter = new Emitter<{ file: string; staged: boolean }>();
    readonly onDiffRequest: Event<{ file: string; staged: boolean }> = this.onDiffRequestEmitter.event;

    @postConstruct()
    protected init(): void {
        this.gitService.onDidChange(() => {
            this.refresh();
        });
    }

    getState(): GitChangesState {
        return { ...this.state };
    }

    async refresh(): Promise<void> {
        this.state = { ...this.state, loading: true, error: undefined };
        this.onDidChangeEmitter.fire(this.state);

        try {
            const result: GitStatusResult = await this.gitService.getStatus();
            const staged = result.files.filter(f => f.staged);
            const unstaged = result.files.filter(f => !f.staged);
            this.state = {
                branch: result.branch,
                stagedChanges: staged,
                unstagedChanges: unstaged,
                ahead: result.ahead,
                behind: result.behind,
                loading: false,
            };
        } catch (err) {
            this.state = {
                ...this.state,
                loading: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
        this.onDidChangeEmitter.fire(this.state);
    }

    async stageFiles(files: string[]): Promise<void> {
        try {
            await this.gitService.stageFiles(files);
            await this.refresh();
        } catch (err) {
            this.state = { ...this.state, error: err instanceof Error ? err.message : String(err) };
            this.onDidChangeEmitter.fire(this.state);
        }
    }

    async unstageFiles(files: string[]): Promise<void> {
        try {
            await this.gitService.unstageFiles(files);
            await this.refresh();
        } catch (err) {
            this.state = { ...this.state, error: err instanceof Error ? err.message : String(err) };
            this.onDidChangeEmitter.fire(this.state);
        }
    }

    async stageAll(): Promise<void> {
        await this.gitService.stageAll();
        await this.refresh();
    }

    async unstageAll(): Promise<void> {
        await this.gitService.unstageAll();
        await this.refresh();
    }

    async commit(message: string, amendOrOptions: boolean | GitCommitOptions = false): Promise<GitCommitResult> {
        try {
            const result = await this.gitService.commit(message, amendOrOptions);
            await this.refresh();
            return result;
        } catch (err) {
            this.state = { ...this.state, error: err instanceof Error ? err.message : String(err) };
            this.onDidChangeEmitter.fire(this.state);
            throw err;
        }
    }

    requestDiff(file: string, staged: boolean = false): void {
        this.onDiffRequestEmitter.fire({ file, staged });
    }
}