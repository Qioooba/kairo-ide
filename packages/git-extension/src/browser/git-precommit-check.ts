import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { KairoI18nService } from '@kairo/i18n';
import { GitService } from './git-service';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Error shape from Node.js child_process.execFile. */
interface ExecFileError extends Error {
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

/** 单次检查结果 */
export interface PreCommitCheckResult {
    /** 检查类别 */
    type: 'build' | 'test' | 'lint';
    /** 状态 */
    status: 'passed' | 'failed' | 'timed_out' | 'skipped' | 'error';
    /** 描述信息 */
    message: string;
    /** 详细信息 */
    details?: string;
    /** 错误数量 */
    errorCount?: number;
    /** 通过数量 */
    passCount?: number;
    /** 失败数量 */
    failCount?: number;
}

/** 检查配置 */
export interface PreCommitCheckConfig {
    /** 是否运行构建检查 */
    runBuild: boolean;
    /** 是否运行测试检查 */
    runTests: boolean;
    /** 是否检查编译错误 */
    runLint: boolean;
}

/** 预提交检查整体状态 */
export type PreCommitCheckStatus = 'idle' | 'running' | 'completed';

/** 预提交检查摘要 */
export interface PreCommitCheckSummary {
    status: PreCommitCheckStatus;
    results: PreCommitCheckResult[];
    /** 是否有任何检查失败 */
    hasFailures: boolean;
    /** 当前正在运行的检查 */
    runningCheck?: string;
}

/** 持久化的用户偏好 */
export interface PreCommitPreferences {
    runBuild: boolean;
    runTests: boolean;
    runLint: boolean;
}

const PREFS_KEY = 'kairo-git-precommit-prefs';

const DEFAULT_CONFIG: PreCommitCheckConfig = {
    runBuild: false,
    runTests: false,
    runLint: true,
};

const TIMEOUTS: Record<string, number> = {
    build: 120000,
    test: 120000,
    lint: 30000,
};

@injectable()
export class GitPreCommitChecker {
    @inject(GitService) protected readonly gitService!: GitService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    protected readonly onDidChangeStatusEmitter = new Emitter<PreCommitCheckSummary>();
    readonly onDidChangeStatus: Event<PreCommitCheckSummary> = this.onDidChangeStatusEmitter.event;

    protected summary: PreCommitCheckSummary = {
        status: 'idle',
        results: [],
        hasFailures: false,
    };

    protected config: PreCommitCheckConfig = { ...DEFAULT_CONFIG };

    /** 获取当前检查摘要 */
    getSummary(): PreCommitCheckSummary {
        return { ...this.summary, results: [...this.summary.results] };
    }

    /** 获取当前配置 */
    getConfig(): PreCommitCheckConfig {
        return { ...this.config };
    }

    /** 设置配置 */
    setConfig(config: Partial<PreCommitCheckConfig>): void {
        this.config = { ...this.config, ...config };
        this.savePreferences();
    }

    /** 加载持久化的用户偏好 */
    loadPreferences(): PreCommitPreferences {
        try {
            const stored = localStorage.getItem(PREFS_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as Partial<PreCommitPreferences>;
                this.config = {
                    runBuild: parsed.runBuild ?? DEFAULT_CONFIG.runBuild,
                    runTests: parsed.runTests ?? DEFAULT_CONFIG.runTests,
                    runLint: parsed.runLint ?? DEFAULT_CONFIG.runLint,
                };
                return { ...this.config };
            }
        } catch {
            // 忽略解析错误，使用默认值
        }
        return { ...DEFAULT_CONFIG };
    }

    /** 保存偏好到 localStorage */
    protected savePreferences(): void {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({
                runBuild: this.config.runBuild,
                runTests: this.config.runTests,
                runLint: this.config.runLint,
            }));
        } catch {
            // 忽略存储错误
        }
    }

    /** 运行所有启用的检查 */
    async runChecks(): Promise<PreCommitCheckSummary> {
        this.summary = {
            status: 'running',
            results: [],
            hasFailures: false,
        };
        this.onDidChangeStatusEmitter.fire(this.getSummary());

        const checks: Array<{ type: 'build' | 'test' | 'lint'; fn: () => Promise<PreCommitCheckResult> }> = [];

        if (this.config.runBuild) {
            checks.push({ type: 'build', fn: () => this.runBuildCheck() });
        }
        if (this.config.runTests) {
            checks.push({ type: 'test', fn: () => this.runTestCheck() });
        }
        if (this.config.runLint) {
            checks.push({ type: 'lint', fn: () => this.runLintCheck() });
        }

        if (checks.length === 0) {
            this.summary = {
                status: 'completed',
                results: [],
                hasFailures: false,
            };
            this.onDidChangeStatusEmitter.fire(this.getSummary());
            return this.getSummary();
        }

        // 顺序执行检查
        for (const check of checks) {
            this.summary.runningCheck = check.type;
            this.onDidChangeStatusEmitter.fire(this.getSummary());

            try {
                const result = await check.fn();
                this.summary.results.push(result);
            } catch (err) {
                this.summary.results.push({
                    type: check.type,
                    status: 'error',
                    message: this.i18n.t('git.precommit.checkRunFailed', { msg: err instanceof Error ? err.message : String(err) }),
                });
            }
        }

        this.summary.status = 'completed';
        this.summary.runningCheck = undefined;
        this.summary.hasFailures = this.summary.results.some(
            r => r.status === 'failed' || r.status === 'timed_out' || r.status === 'error'
        );
        this.onDidChangeStatusEmitter.fire(this.getSummary());
        return this.getSummary();
    }

    /** 重置检查状态 */
    reset(): void {
        this.summary = {
            status: 'idle',
            results: [],
            hasFailures: false,
        };
        this.onDidChangeStatusEmitter.fire(this.getSummary());
    }

    /** 执行构建检查 */
    protected async runBuildCheck(): Promise<PreCommitCheckResult> {
        const repoRoot = this.gitService.getRepoRoot();
        if (!repoRoot) {
            return {
                type: 'build',
                status: 'error',
                message: this.i18n.t('git.precommit.noRepoRoot'),
            };
        }

        try {
            const { stdout, stderr } = await execFileWithTimeout(
                'npm', ['run', 'build'],
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
                TIMEOUTS.build,
            );

            const output = stdout + stderr;
            const errorCount = countErrors(output);

            if (errorCount > 0) {
                return {
                    type: 'build',
                    status: 'failed',
                    message: this.i18n.t('git.precommit.buildFailed', { count: errorCount }),
                    details: output.slice(-2000),
                    errorCount,
                };
            }
            return {
                type: 'build',
                status: 'passed',
                message: this.i18n.t('git.precommit.buildPassed'),
                details: output.slice(-500),
                errorCount: 0,
            };
        } catch (err: unknown) {
            const execErr = err as ExecFileError;
            if (execErr.killed) {
                return {
                    type: 'build',
                    status: 'timed_out',
                    message: this.i18n.t('git.precommit.buildTimedOut'),
                    errorCount: NaN,
                };
            }
            const stderr = execErr.stderr || '';
            const stdout = execErr.stdout || '';
            const output = stdout + stderr;
            const errorCount = countErrors(output);
            return {
                type: 'build',
                status: 'failed',
                message: this.i18n.t('git.precommit.buildFailed', { count: errorCount }),
                details: output.slice(-2000),
                errorCount,
            };
        }
    }

    /** 执行测试检查 */
    protected async runTestCheck(): Promise<PreCommitCheckResult> {
        const repoRoot = this.gitService.getRepoRoot();
        if (!repoRoot) {
            return {
                type: 'test',
                status: 'error',
                message: this.i18n.t('git.precommit.noRepoRoot'),
            };
        }

        try {
            const { stdout, stderr } = await execFileWithTimeout(
                'npm', ['test'],
                { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
                TIMEOUTS.test,
            );

            const output = stdout + stderr;
            const { passCount, failCount } = countTestResults(output);

            if (failCount > 0) {
                return {
                    type: 'test',
                    status: 'failed',
                    message: this.i18n.t('git.precommit.testFailed', { pass: passCount, fail: failCount }),
                    details: output.slice(-2000),
                    passCount,
                    failCount,
                };
            }
            return {
                type: 'test',
                status: 'passed',
                message: this.i18n.t('git.precommit.testPassed', { count: passCount }),
                passCount,
                failCount: 0,
            };
        } catch (err: unknown) {
            const execErr = err as ExecFileError;
            if (execErr.killed) {
                return {
                    type: 'test',
                    status: 'timed_out',
                    message: this.i18n.t('git.precommit.testTimedOut'),
                };
            }
            const stderr = execErr.stderr || '';
            const stdout = execErr.stdout || '';
            const output = stdout + stderr;
            const { passCount, failCount } = countTestResults(output);
            return {
                type: 'test',
                status: 'failed',
                message: this.i18n.t('git.precommit.testFailed', { pass: passCount, fail: failCount }),
                details: output.slice(-2000),
                passCount,
                failCount,
            };
        }
    }

    /** 检查暂存 Java 文件的编译错误 */
    protected async runLintCheck(): Promise<PreCommitCheckResult> {
        const repoRoot = this.gitService.getRepoRoot();
        if (!repoRoot) {
            return {
                type: 'lint',
                status: 'error',
                message: this.i18n.t('git.precommit.noRepoRoot'),
            };
        }

        try {
            // 获取暂存的 Java 文件
            const { stdout: stagedOutput } = await execFileAsync(
                'git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
                {
                    cwd: repoRoot,
                    env: {
                        ...(typeof process !== 'undefined' ? process.env : {}),
                        LANG: 'C',
                        LC_ALL: 'C',
                        LANGUAGE: 'C',
                    },
                },
            );

            const stagedFiles = stagedOutput.trim().split('\n').filter(f => f.endsWith('.java'));
            if (stagedFiles.length === 0) {
                return {
                    type: 'lint',
                    status: 'passed',
                    message: this.i18n.t('git.precommit.lintNoStagedFiles'),
                    errorCount: 0,
                };
            }

            try {
                const { stdout, stderr } = await execFileWithTimeout(
                    'javac', ['-Xlint:all', '-proc:none', ...stagedFiles],
                    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
                    TIMEOUTS.lint,
                );

                const output = stderr + stdout;
                const errorCount = countErrors(output);

                if (errorCount > 0) {
                    return {
                        type: 'lint',
                        status: 'failed',
                        message: this.i18n.t('git.precommit.lintFoundIssues', { count: errorCount }),
                        details: output.slice(-2000),
                        errorCount,
                    };
                }
                return {
                    type: 'lint',
                    status: 'passed',
                    message: this.i18n.t('git.precommit.lintPassed'),
                    errorCount: 0,
                };
            } catch (err: unknown) {
                const execErr = err as ExecFileError;
                if (execErr.killed) {
                    return {
                        type: 'lint',
                        status: 'timed_out',
                        message: this.i18n.t('git.precommit.lintTimedOut'),
                    };
                }
                const stderr = execErr.stderr || '';
                const stdout = execErr.stdout || '';
                const output = stderr + stdout;
                const errorCount = countErrors(output);
                return {
                    type: 'lint',
                    status: 'failed',
                    message: this.i18n.t('git.precommit.lintFoundIssues', { count: errorCount }),
                    details: output.slice(-2000),
                    errorCount,
                };
            }
        } catch (err) {
            return {
                type: 'lint',
                status: 'error',
                message: this.i18n.t('git.precommit.lintRunFailed', { msg: err instanceof Error ? err.message : String(err) }),
            };
        }
    }
}

/** 带超时的 execFile */
function execFileWithTimeout(
    command: string,
    args: string[],
    options: { cwd: string; maxBuffer?: number },
    timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const _child = execFile(command, args, {
            ...options,
            timeout: timeoutMs,
        }, (error, stdout, stderr) => {
            if (error) {
                reject(Object.assign(error, { stdout, stderr }));
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

/** 统计输出中的错误信息数量 */
function countErrors(output: string): number {
    let count = 0;
    const lines = output.split('\n');
    for (const line of lines) {
        if (/\berror\b/i.test(line) && !/\b0 errors?\b/i.test(line)) {
            count++;
        }
    }
    return count;
}

/** 统计测试结果中的通过/失败数 */
function countTestResults(output: string): { passCount: number; failCount: number } {
    let passCount = 0;
    let failCount = 0;

    // 匹配 JUnit/Mocha/Jest 等常见测试框架的输出
    const passMatch = output.match(/(\d+)\s+(?:passing|passed|tests passed)/i);
    const failMatch = output.match(/(\d+)\s+(?:failing|failed|tests failed)/i);

    if (passMatch) {
        passCount = parseInt(passMatch[1], 10);
    }
    if (failMatch) {
        failCount = parseInt(failMatch[1], 10);
    }

    // 尝试匹配 JUnit 格式
    if (passCount === 0 && failCount === 0) {
        const testsMatch = output.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)/i);
        if (testsMatch) {
            const total = parseInt(testsMatch[1], 10);
            const failures = parseInt(testsMatch[2], 10);
            const errors = parseInt(testsMatch[3], 10);
            failCount = failures + errors;
            passCount = total - failCount;
        }
    }

    // 如果没有任何测试输出，尝试匹配 OK 模式
    if (passCount === 0 && failCount === 0 && /OK[.!]?/i.test(output)) {
        const okMatch = output.match(/(\d+)\s+test/i);
        if (okMatch) {
            passCount = parseInt(okMatch[1], 10);
        }
    }

    return { passCount, failCount };
}