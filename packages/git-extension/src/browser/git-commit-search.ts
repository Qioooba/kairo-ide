import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { KairoI18nService } from '@kairo/i18n';
import { GitService, GitCommit } from './git-service';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const _execFileAsync = promisify(execFile);

/** 搜索条件 */
export interface CommitSearchCriteria {
    /** 按提交消息搜索 */
    message?: string;
    /** 按作者搜索 */
    author?: string;
    /** 起始日期 (ISO 8601) */
    dateFrom?: string;
    /** 结束日期 (ISO 8601) */
    dateTo?: string;
    /** 按文件路径搜索 */
    filePath?: string;
    /** 按 SHA 前缀搜索 */
    shaPrefix?: string;
}

/** 搜索结果项 */
export interface CommitSearchResult {
    commit: GitCommit;
    /** 高亮范围 */
    highlights: SearchHighlight[];
}

/** 高亮范围 */
export interface SearchHighlight {
    field: 'message' | 'author' | 'hash';
    /** 匹配的起始位置 */
    start: number;
    /** 匹配的结束位置 */
    end: number;
}

/** 搜索状态 */
export type CommitSearchStatus = 'idle' | 'searching' | 'completed' | 'error' | 'timed_out';

/** 搜索摘要 */
export interface CommitSearchSummary {
    status: CommitSearchStatus;
    results: CommitSearchResult[];
    query: string;
    totalCount: number;
    error?: string;
}

const SEARCH_TIMEOUT_MS = 10000;

@injectable()
export class GitCommitSearch {
    @inject(GitService) protected readonly gitService!: GitService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    protected readonly onDidChangeStatusEmitter = new Emitter<CommitSearchSummary>();
    readonly onDidChangeStatus: Event<CommitSearchSummary> = this.onDidChangeStatusEmitter.event;

    /**
     * 翻译辅助方法。测试可能直接 new 本服务（不经 DI），此时 i18n 为 undefined，
     * 回退到 fallback（原中文文案），保证行为与未接入 i18n 时一致。
     */
    protected tr(key: string, params?: Record<string, string | number>, fallback?: string): string {
        if (!this.i18n) return fallback ?? key;
        return (this.i18n.t as (k: string, p?: Record<string, string | number>) => string)(key, params);
    }

    protected summary: CommitSearchSummary = {
        status: 'idle',
        results: [],
        query: '',
        totalCount: 0,
    };

    protected searchAbortController: AbortController | undefined;

    getSummary(): CommitSearchSummary {
        return { ...this.summary, results: [...this.summary.results] };
    }

    /** 取消当前搜索 */
    cancel(): void {
        if (this.searchAbortController) {
            this.searchAbortController.abort();
            this.searchAbortController = undefined;
        }
        if (this.summary.status === 'searching') {
            this.summary = { ...this.summary, status: 'idle' };
            this.onDidChangeStatusEmitter.fire(this.getSummary());
        }
    }

    /** 执行搜索 */
    async search(criteria: CommitSearchCriteria): Promise<CommitSearchSummary> {
        this.cancel();
        this.searchAbortController = new AbortController();
        const signal = this.searchAbortController.signal;

        const queryParts: string[] = [];
        if (criteria.message) queryParts.push(this.tr('git.commitSearch.queryMessage', { value: criteria.message }, `消息: ${criteria.message}`));
        if (criteria.author) queryParts.push(this.tr('git.commitSearch.queryAuthor', { value: criteria.author }, `作者: ${criteria.author}`));
        if (criteria.shaPrefix) queryParts.push(this.tr('git.commitSearch.querySha', { value: criteria.shaPrefix }, `SHA: ${criteria.shaPrefix}`));
        if (criteria.filePath) queryParts.push(this.tr('git.commitSearch.queryFile', { value: criteria.filePath }, `文件: ${criteria.filePath}`));
        if (criteria.dateFrom) queryParts.push(this.tr('git.commitSearch.queryDateFrom', { value: criteria.dateFrom }, `从: ${criteria.dateFrom}`));
        if (criteria.dateTo) queryParts.push(this.tr('git.commitSearch.queryDateTo', { value: criteria.dateTo }, `至: ${criteria.dateTo}`));
        const query = queryParts.join(', ') || this.tr('git.commitSearch.queryAll', undefined, '全部');

        this.summary = {
            status: 'searching',
            results: [],
            query,
            totalCount: 0,
        };
        this.onDidChangeStatusEmitter.fire(this.getSummary());

        try {
            const results = await this.executeSearch(criteria, signal);
            if (signal.aborted) return this.getSummary();

            this.summary = {
                status: 'completed',
                results,
                query,
                totalCount: results.length,
            };
        } catch (err: unknown) {
            const execErr = err as { killed?: boolean; code?: string; message?: string };
            if (signal.aborted) return this.getSummary();
            if (execErr.killed || execErr.code === 'ETIMEDOUT') {
                this.summary = {
                    status: 'timed_out',
                    results: this.summary.results,
                    query,
                    totalCount: this.summary.results.length,
                    error: this.tr('git.commitSearch.timedOut', undefined, '搜索超时（10秒）'),
                };
            } else {
                this.summary = {
                    status: 'error',
                    results: this.summary.results,
                    query,
                    totalCount: this.summary.results.length,
                    error: this.tr('git.commitSearch.failed', { msg: err instanceof Error ? err.message : String(err) }, `搜索失败: ${err instanceof Error ? err.message : String(err)}`),
                };
            }
        }

        this.onDidChangeStatusEmitter.fire(this.getSummary());
        return this.getSummary();
    }

    /** 执行 git log 搜索 */
    protected async executeSearch(
        criteria: CommitSearchCriteria,
        signal: AbortSignal,
    ): Promise<CommitSearchResult[]> {
        const repoRoot = this.gitService.getRepoRoot();
        if (!repoRoot) return [];

        const args = ['log', '--max-count=200', '--format=%H%x00%an%x00%ae%x00%aI%x00%s', '-z'];

        if (criteria.author) {
            args.push(`--author=${criteria.author}`);
        }
        if (criteria.dateFrom) {
            args.push(`--after=${criteria.dateFrom}`);
        }
        if (criteria.dateTo) {
            args.push(`--before=${criteria.dateTo}`);
        }
        if (criteria.message) {
            args.push(`--grep=${criteria.message}`);
        }
        if (criteria.filePath) {
            args.push('--', criteria.filePath);
        }

        const { stdout } = await execFileWithTimeout(
            'git',
            args,
            { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
            SEARCH_TIMEOUT_MS,
            signal,
        );

        if (signal.aborted) return [];

        const parts = stdout.split('\0').filter(Boolean);
        const searchResults: CommitSearchResult[] = [];

        for (let i = 0; i + 4 < parts.length; i += 5) {
            const commit: GitCommit = {
                hash: parts[i],
                author: parts[i + 1],
                email: parts[i + 2],
                date: new Date(parts[i + 3]),
                message: parts[i + 4],
            };

            // 如果指定了 SHA 前缀，在内存中过滤
            if (criteria.shaPrefix && !commit.hash.startsWith(criteria.shaPrefix)) {
                continue;
            }

            const highlights = this.findHighlights(commit, criteria);
            searchResults.push({ commit, highlights });
        }

        return searchResults;
    }

    /** 查找高亮范围 */
    protected findHighlights(commit: GitCommit, criteria: CommitSearchCriteria): SearchHighlight[] {
        const highlights: SearchHighlight[] = [];

        if (criteria.message) {
            const lowerMsg = commit.message.toLowerCase();
            const lowerSearch = criteria.message.toLowerCase();
            let idx = 0;
            while ((idx = lowerMsg.indexOf(lowerSearch, idx)) !== -1) {
                highlights.push({
                    field: 'message',
                    start: idx,
                    end: idx + lowerSearch.length,
                });
                idx += lowerSearch.length;
            }
        }

        if (criteria.author) {
            const lowerAuthor = commit.author.toLowerCase();
            const lowerSearch = criteria.author.toLowerCase();
            let idx = 0;
            while ((idx = lowerAuthor.indexOf(lowerSearch, idx)) !== -1) {
                highlights.push({
                    field: 'author',
                    start: idx,
                    end: idx + lowerSearch.length,
                });
                idx += lowerSearch.length;
            }
        }

        if (criteria.shaPrefix) {
            const lowerHash = commit.hash.toLowerCase();
            const lowerSearch = criteria.shaPrefix.toLowerCase();
            if (lowerHash.startsWith(lowerSearch)) {
                highlights.push({
                    field: 'hash',
                    start: 0,
                    end: lowerSearch.length,
                });
            }
        }

        return highlights;
    }

    /** 清空结果 */
    reset(): void {
        this.summary = {
            status: 'idle',
            results: [],
            query: '',
            totalCount: 0,
        };
        this.onDidChangeStatusEmitter.fire(this.getSummary());
    }
}

/** 带超时和取消的 execFile */
function execFileWithTimeout(
    command: string,
    args: string[],
    options: { cwd: string; maxBuffer?: number },
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = execFile(command, args, {
            ...options,
            timeout: timeoutMs,
            env: {
                ...(typeof process !== 'undefined' ? process.env : {}),
                LANG: 'C',
                LC_ALL: 'C',
                LANGUAGE: 'C',
            },
        }, (error, stdout, stderr) => {
            if (error) {
                reject(Object.assign(error, { stdout, stderr }));
            } else {
                resolve({ stdout, stderr });
            }
        });

        if (signal) {
            const onAbort = () => {
                child.kill('SIGTERM');
                reject(new Error('Aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            // 防止信号监听器泄漏
            child.on('close', () => signal.removeEventListener('abort', onAbort));
        }
    });
}